use std::{
    collections::HashMap,
    io::{self, Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender, TryRecvError},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use parking_lot::RwLock;
use serialport::{ClearBuffer, DataBits, FlowControl, Parity, SerialPortType, StopBits};
use tokio::sync::oneshot;

use crate::{
    contract::DeviceSnapshot,
    db::Database,
    klog::{ImportInput as KlogImportInput, KlogError, KlogImporter},
    kpro::{ImportInput as KproImportInput, KproError, KproImporter},
    lan_bridge::BridgeTransport,
    sassi::{
        self, acknowledgement_frame, directory_frame, file_frame, info_frame, time_sync_frame,
        Decoder, Message, TransferChunk,
    },
    virtual_nano::{VirtualNanoScenario, VirtualNanoTranscript, VirtualNanoTransport},
};

const KAFFELOGIC_VENDOR_ID: u16 = 0x2e8a;
const KAFFELOGIC_PRODUCT_ID: u16 = 0x000a;
const EXPECTED_MODEL: &str = "KN1007B";
const EXPECTED_MANUFACTURER: &str = "kaffelogic.com";
const SCAN_INTERVAL: Duration = Duration::from_millis(1_500);
const READ_TIMEOUT: Duration = Duration::from_millis(25);
const NEGOTIATION_TIMEOUT: Duration = Duration::from_secs(12);
const BRIDGE_REPLAY_SETTLE_TIME: Duration = Duration::from_millis(750);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_DIRECTORY_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;
const LOG_DIRECTORY: &str = "kaffelogic/roast-logs";
const PROFILE_DIRECTORY: &str = "kaffelogic/roast-profiles";

enum Command {
    Refresh,
    Synchronize(oneshot::Sender<Result<(), String>>),
    AttachBridge {
        bridge_id: String,
        transport: BridgeTransport,
    },
    Stop,
}

pub struct NanoDeviceManager {
    snapshot: Arc<RwLock<DeviceSnapshot>>,
    commands: Sender<Command>,
    stopped: Arc<AtomicBool>,
}

impl NanoDeviceManager {
    pub fn start(database: Database) -> Self {
        Self::start_worker(database, None, true)
    }

    pub fn start_simulated(
        database: Database,
        scenario: VirtualNanoScenario,
    ) -> Result<(Self, VirtualNanoTranscript), io::Error> {
        let (transport, transcript) = VirtualNanoTransport::new(scenario)?;
        Ok((
            Self::start_worker(database, Some(Box::new(transport)), false),
            transcript,
        ))
    }

    fn start_worker(
        database: Database,
        initial_transport: Option<Box<dyn SessionTransport>>,
        discover_physical_device: bool,
    ) -> Self {
        let snapshot = Arc::new(RwLock::new(disconnected("starting")));
        let stopped = Arc::new(AtomicBool::new(false));
        let (commands, receiver) = mpsc::channel();
        let worker_snapshot = snapshot.clone();
        let worker_stopped = stopped.clone();
        thread::Builder::new()
            .name("tan-studio-nano-session".into())
            .spawn(move || {
                device_loop(
                    database,
                    worker_snapshot,
                    receiver,
                    worker_stopped,
                    initial_transport,
                    discover_physical_device,
                )
            })
            .expect("Nano session worker");
        Self {
            snapshot,
            commands,
            stopped,
        }
    }

    pub fn snapshot(&self) -> DeviceSnapshot {
        self.snapshot.read().clone()
    }

    pub fn refresh(&self) {
        let _ = self.commands.send(Command::Refresh);
    }

    pub async fn synchronize(&self) -> Result<(), String> {
        let (sender, receiver) = oneshot::channel();
        self.commands
            .send(Command::Synchronize(sender))
            .map_err(|_| "device_session_stopped".to_owned())?;
        receiver
            .await
            .map_err(|_| "device_session_stopped".to_owned())?
    }

    pub fn attach_bridge(&self, bridge_id: String, transport: BridgeTransport) {
        let _ = self.commands.send(Command::AttachBridge {
            bridge_id,
            transport,
        });
    }

    pub fn stop(&self) {
        if !self.stopped.swap(true, Ordering::AcqRel) {
            let _ = self.commands.send(Command::Stop);
        }
    }
}

trait SessionTransport: Read + Write + Send {}
impl<T: Read + Write + Send> SessionTransport for T {}

struct Session {
    port: Box<dyn SessionTransport>,
    decoder: Decoder,
    phase: Phase,
    phase_started: Instant,
    started: Instant,
    last_elapsed_ms: u64,
    crc_seed: Option<u16>,
    maximum_packet_bytes: Option<usize>,
    sync_attempted: bool,
    handshake_not_before: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    AwaitingHandshake,
    AwaitingTimeSync,
    AwaitingStatus,
    AwaitingFirmware,
    Ready,
}

fn device_loop(
    database: Database,
    snapshot: Arc<RwLock<DeviceSnapshot>>,
    commands: Receiver<Command>,
    stopped: Arc<AtomicBool>,
    initial_transport: Option<Box<dyn SessionTransport>>,
    discover_physical_device: bool,
) {
    let log_importer = KlogImporter::new(database.clone());
    let profile_importer = KproImporter::new(database);
    let mut session = initial_transport.map(|transport| {
        let mut current = reconnecting("awaiting_sassi_handshake");
        current.transport = Some("simulated-nano".into());
        *snapshot.write() = current;
        new_session(transport)
    });
    let mut next_scan = Instant::now();
    while !stopped.load(Ordering::Acquire) {
        loop {
            match commands.try_recv() {
                Ok(Command::Refresh) => {
                    if session
                        .as_ref()
                        .is_some_and(|active| active.phase != Phase::Ready)
                    {
                        session = None;
                        *snapshot.write() = reconnecting("refresh_requested");
                    }
                    next_scan = Instant::now();
                }
                Ok(Command::Synchronize(reply)) => {
                    let result = if let Some(active) = session.as_mut() {
                        synchronize(active, &snapshot, &log_importer, &profile_importer)
                    } else {
                        Err("device_not_connected".into())
                    };
                    let _ = reply.send(result);
                }
                Ok(Command::AttachBridge {
                    bridge_id,
                    transport,
                }) => {
                    session = Some(new_bridge_session(Box::new(transport)));
                    let mut current = reconnecting("awaiting_sassi_handshake");
                    current.transport = Some("tan-bridge".into());
                    current.bridge_id = Some(bridge_id);
                    *snapshot.write() = current;
                }
                Ok(Command::Stop) => return,
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }

        if discover_physical_device && session.is_none() && Instant::now() >= next_scan {
            next_scan = Instant::now() + SCAN_INTERVAL;
            match discover_port() {
                Ok(None) => *snapshot.write() = disconnected("nano_not_found"),
                Ok(Some(path)) => match open_session(&path) {
                    Ok(opened) => {
                        *snapshot.write() = reconnecting("awaiting_sassi_handshake");
                        session = Some(opened);
                    }
                    Err(reason) => *snapshot.write() = degraded(reason),
                },
                Err(reason) => *snapshot.write() = degraded(reason),
            }
        }

        let negotiation_timed_out = session.as_ref().is_some_and(|active| {
            active.phase != Phase::Ready && active.phase_started.elapsed() >= NEGOTIATION_TIMEOUT
        });
        if negotiation_timed_out {
            let transport = snapshot
                .read()
                .transport
                .clone()
                .unwrap_or_else(|| "unknown".into());
            tracing::warn!(
                event = "device_session_failed",
                reason = "negotiation_timeout",
                transport
            );
            *snapshot.write() = degraded("negotiation_timeout");
            session = None;
            next_scan = Instant::now() + SCAN_INTERVAL;
            continue;
        }

        if let Some(active) = session.as_mut() {
            match poll_session(active, &snapshot) {
                Ok(()) => {
                    if active.phase == Phase::Ready && !active.sync_attempted {
                        active.sync_attempted = true;
                        if let Err(reason) =
                            synchronize(active, &snapshot, &log_importer, &profile_importer)
                        {
                            let waiting =
                                matches!(reason.as_str(), "device_busy" | "sassi_outcome_103");
                            if waiting {
                                active.sync_attempted = false;
                            }
                            let mut current = snapshot.write();
                            current.reason = Some(reason);
                            current.sync_state = if waiting { "idle" } else { "failed" }.into();
                            if !waiting {
                                current.state = "degraded".into();
                            }
                        }
                    }
                }
                Err(reason) => {
                    let transport = snapshot
                        .read()
                        .transport
                        .clone()
                        .unwrap_or_else(|| "unknown".into());
                    tracing::warn!(
                        event = "device_session_failed",
                        reason = %reason,
                        transport
                    );
                    *snapshot.write() = degraded(&reason);
                    session = None;
                    next_scan = Instant::now() + SCAN_INTERVAL;
                }
            }
        } else {
            thread::sleep(Duration::from_millis(25));
        }
    }
}

fn discover_port() -> Result<Option<String>, &'static str> {
    let ports = serialport::available_ports().map_err(|_| "enumeration_failed")?;
    let mut grouped: HashMap<String, String> = HashMap::new();
    for port in ports {
        let SerialPortType::UsbPort(usb) = port.port_type else {
            continue;
        };
        if usb.vid != KAFFELOGIC_VENDOR_ID || usb.pid != KAFFELOGIC_PRODUCT_ID {
            continue;
        }
        let suffix = port
            .port_name
            .strip_prefix("/dev/cu.")
            .or_else(|| port.port_name.strip_prefix("/dev/tty."))
            .unwrap_or(&port.port_name)
            .to_owned();
        grouped
            .entry(suffix)
            .and_modify(|current| {
                if port.port_name.starts_with("/dev/cu.") {
                    *current = port.port_name.clone();
                }
            })
            .or_insert(port.port_name);
    }
    match grouped.len() {
        0 => Ok(None),
        1 => Ok(grouped.into_values().next()),
        _ => Err("multiple_cdc_candidates"),
    }
}

fn open_session(path: &str) -> Result<Session, &'static str> {
    if path.is_empty()
        || path.len() > 1024
        || path.contains('\0')
        || !serialport::available_ports()
            .map(|ports| ports.into_iter().any(|port| port.port_name == path))
            .unwrap_or(false)
    {
        return Err("invalid_port");
    }
    let builder = serialport::new(path, 115_200)
        .timeout(READ_TIMEOUT)
        .data_bits(DataBits::Eight)
        .flow_control(FlowControl::None)
        .parity(Parity::None)
        .stop_bits(StopBits::One)
        .dtr_on_open(true);
    #[cfg(unix)]
    let builder = builder.exclusive(true);
    let mut port = builder.open().map_err(|error| match error.kind() {
        serialport::ErrorKind::NoDevice => "device_unavailable",
        serialport::ErrorKind::InvalidInput => "invalid_port",
        serialport::ErrorKind::Io(io::ErrorKind::PermissionDenied) => "permission_denied",
        serialport::ErrorKind::Io(io::ErrorKind::WouldBlock) => "port_in_use",
        _ => "open_failed",
    })?;
    port.write_data_terminal_ready(true)
        .map_err(|_| "dtr_failed")?;
    let _ = port.clear(ClearBuffer::Output);
    Ok(new_session(Box::new(port)))
}

fn new_session(port: Box<dyn SessionTransport>) -> Session {
    new_session_with_handshake_delay(port, Duration::ZERO)
}

fn new_bridge_session(port: Box<dyn SessionTransport>) -> Session {
    // The Atom can authenticate after buffering several repeated type-2
    // requests. Each request carries a new CRC seed, so answering a replayed
    // request would be validly encoded but stale by the time it reaches the
    // Nano. Drain the bounded replay window and negotiate from the next live
    // request instead.
    new_session_with_handshake_delay(port, BRIDGE_REPLAY_SETTLE_TIME)
}

fn new_session_with_handshake_delay(
    port: Box<dyn SessionTransport>,
    handshake_delay: Duration,
) -> Session {
    Session {
        port,
        decoder: Decoder::default(),
        phase: Phase::AwaitingHandshake,
        phase_started: Instant::now(),
        started: Instant::now(),
        last_elapsed_ms: 0,
        crc_seed: None,
        maximum_packet_bytes: None,
        sync_attempted: false,
        handshake_not_before: Instant::now() + handshake_delay,
    }
}

fn poll_session(session: &mut Session, snapshot: &RwLock<DeviceSnapshot>) -> Result<(), String> {
    let mut buffer = [0u8; 4096];
    match session.port.read(&mut buffer) {
        Ok(0) => Ok(()),
        Ok(length) => {
            for event in session.decoder.push(&buffer[..length]) {
                let decoded =
                    event.map_err(|error| format!("protocol_{error:?}").to_ascii_lowercase())?;
                handle_message(session, snapshot, decoded.message)?;
            }
            Ok(())
        }
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
            ) =>
        {
            Ok(())
        }
        Err(_) => Err("read_failed".into()),
    }
}

fn handle_message(
    session: &mut Session,
    snapshot: &RwLock<DeviceSnapshot>,
    message: Message,
) -> Result<(), String> {
    match message {
        Message::ConnectionRequest(request) => {
            if request.platform != 1
                || request.sassi_version != 1
                || request.model != EXPECTED_MODEL
                || request.manufacturer_domain != EXPECTED_MANUFACTURER
            {
                return Err("unsupported_device".into());
            }
            if session.phase != Phase::AwaitingHandshake {
                return Ok(());
            }
            if Instant::now() < session.handshake_not_before {
                return Ok(());
            }
            session.crc_seed = Some(request.crc_seed);
            session.maximum_packet_bytes = Some(request.maximum_packet_bytes);
            session
                .decoder
                .negotiate(request.maximum_packet_bytes, request.crc_seed)
                .map_err(|_| "invalid_negotiated_limits".to_owned())?;
            write_frame(session, |elapsed, seed, maximum| {
                time_sync_frame(elapsed, seed, maximum)
            })?;
            session.phase = Phase::AwaitingTimeSync;
            session.phase_started = Instant::now();
            let mut current = snapshot.write();
            current.state = "ready".into();
            current.reason = Some("awaiting_time_sync_ack".into());
            current.connection = "reconnecting".into();
            current.model = Some(request.model);
            current.protocol = Some("SASSI v1".into());
            current.packet_limit_bytes = Some(request.maximum_packet_bytes as u32);
            if current.transport.is_none() {
                current.transport = Some("direct-usb".into());
            }
        }
        Message::TimeSyncAcknowledgement if session.phase == Phase::AwaitingTimeSync => {
            write_frame(session, |elapsed, seed, maximum| {
                info_frame(elapsed, seed, maximum, 9)
            })?;
            session.phase = Phase::AwaitingStatus;
            session.phase_started = Instant::now();
            let mut current = snapshot.write();
            current.connection = "connected".into();
            current.reason = None;
            current.protocol = Some("SASSI v1 · read-only".into());
        }
        Message::InfoResponse { data, info_code: 9 } if session.phase == Phase::AwaitingStatus => {
            snapshot.write().busy = filesystem_locked(&data);
            write_frame(session, |elapsed, seed, maximum| {
                info_frame(elapsed, seed, maximum, 3)
            })?;
            session.phase = Phase::AwaitingFirmware;
            session.phase_started = Instant::now();
        }
        Message::InfoResponse { data, info_code: 3 }
            if session.phase == Phase::AwaitingFirmware =>
        {
            snapshot.write().firmware = extract_firmware(&data);
            session.phase = Phase::Ready;
            session.phase_started = Instant::now();
        }
        Message::StatusNotification { info_code: 6, .. } => snapshot.write().busy = Some(true),
        Message::StatusNotification { info_code: 7, .. } => snapshot.write().busy = Some(false),
        _ => {}
    }
    Ok(())
}

fn write_frame<F>(session: &mut Session, encode: F) -> Result<(), String>
where
    F: FnOnce(u64, u16, usize) -> Result<Vec<u8>, sassi::CodecError>,
{
    let seed = session
        .crc_seed
        .ok_or_else(|| "session_not_negotiated".to_owned())?;
    let maximum = session
        .maximum_packet_bytes
        .ok_or_else(|| "session_not_negotiated".to_owned())?;
    let elapsed = next_elapsed(session);
    let frame = encode(elapsed, seed, maximum).map_err(|_| "frame_encoding_failed".to_owned())?;
    session
        .port
        .write_all(&frame)
        .and_then(|_| session.port.flush())
        .map_err(|_| "write_failed".to_owned())
}

fn next_elapsed(session: &mut Session) -> u64 {
    let candidate = session
        .started
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    session.last_elapsed_ms = candidate.max(session.last_elapsed_ms.saturating_add(1));
    session.last_elapsed_ms
}

#[derive(Debug)]
struct DirectoryEntry {
    name: String,
    path: String,
    modified_at: String,
    directory: bool,
}

fn synchronize(
    session: &mut Session,
    snapshot: &RwLock<DeviceSnapshot>,
    log_importer: &KlogImporter,
    profile_importer: &KproImporter,
) -> Result<(), String> {
    if session.phase != Phase::Ready {
        return Err("device_session_negotiating".into());
    }
    if snapshot.read().busy == Some(true) {
        return Err("device_busy".into());
    }
    {
        let mut current = snapshot.write();
        current.sync_state = "syncing".into();
        current.reason = None;
    }
    let log_bytes = request_transfer(
        session,
        |elapsed, seed, maximum| directory_frame(elapsed, seed, maximum, LOG_DIRECTORY),
        TransferKind::Directory,
    )?;
    let profile_bytes = request_transfer(
        session,
        |elapsed, seed, maximum| directory_frame(elapsed, seed, maximum, PROFILE_DIRECTORY),
        TransferKind::Directory,
    )?;
    let mut logs = parse_directory(LOG_DIRECTORY, &log_bytes)?
        .into_iter()
        .filter(|entry| !entry.directory && is_log_filename(&entry.name))
        .collect::<Vec<_>>();
    logs.sort_by(|left, right| left.name.cmp(&right.name));
    let mut profiles = parse_directory(PROFILE_DIRECTORY, &profile_bytes)?
        .into_iter()
        .filter(|entry| !entry.directory && entry.name.to_ascii_lowercase().ends_with(".kpro"))
        .collect::<Vec<_>>();
    profiles.sort_by(|left, right| left.name.cmp(&right.name));
    {
        let mut current = snapshot.write();
        current.log_count = Some(logs.len() as u32);
        current.profile_count = Some(profiles.len() as u32);
    }
    let mut imported = 0;
    let mut updated = 0;
    let mut warnings = 0;
    let mut quarantined = 0;
    let mut imported_profiles = 0;
    let mut profile_warnings = 0;
    let mut quarantined_profiles = 0;
    for entry in profiles {
        let result = request_transfer(
            session,
            |elapsed, seed, maximum| file_frame(elapsed, seed, maximum, &entry.path),
            TransferKind::File,
        )?;
        match profile_importer.import(KproImportInput {
            bytes: result,
            device_path: entry.path,
            filename: entry.name,
            source_modified_at: entry.modified_at,
        }) {
            Ok(result) => {
                imported_profiles += u32::from(result.imported);
                profile_warnings += result.warning_count as u32;
            }
            Err(KproError::Database(_)) => return Err("profile_database_failed".into()),
            Err(_) => {
                profile_warnings += 1;
                quarantined_profiles += 1;
            }
        }
    }
    for entry in logs {
        let result = request_transfer(
            session,
            |elapsed, seed, maximum| file_frame(elapsed, seed, maximum, &entry.path),
            TransferKind::File,
        )?;
        match log_importer.import(KlogImportInput {
            bytes: result,
            device_path: entry.path,
            filename: entry.name,
            source_modified_at: entry.modified_at,
        }) {
            Ok(result) => {
                imported += u32::from(result.imported);
                updated += u32::from(result.updated);
                warnings += result.warning_count as u32;
            }
            Err(KlogError::Database(_)) => return Err("log_database_failed".into()),
            Err(_) => {
                quarantined += 1;
                warnings += 1;
            }
        }
    }
    let mut current = snapshot.write();
    current.state = "ready".into();
    current.reason = None;
    current.sync_state = "ready".into();
    current.imported_log_count = imported;
    current.updated_log_count = updated;
    current.import_warning_count = warnings;
    current.quarantined_log_count = quarantined;
    current.imported_profile_count = imported_profiles;
    current.profile_warning_count = profile_warnings;
    current.quarantined_profile_count = quarantined_profiles;
    current.last_synced_at =
        Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    Ok(())
}

#[derive(Clone, Copy)]
enum TransferKind {
    Directory,
    File,
}

fn request_transfer<F>(
    session: &mut Session,
    encode: F,
    kind: TransferKind,
) -> Result<Vec<u8>, String>
where
    F: FnOnce(u64, u16, usize) -> Result<Vec<u8>, sassi::CodecError>,
{
    request_transfer_with_timeout(session, encode, kind, REQUEST_TIMEOUT)
}

fn request_transfer_with_timeout<F>(
    session: &mut Session,
    encode: F,
    kind: TransferKind,
    timeout: Duration,
) -> Result<Vec<u8>, String>
where
    F: FnOnce(u64, u16, usize) -> Result<Vec<u8>, sassi::CodecError>,
{
    write_frame(session, encode)?;
    let deadline = Instant::now() + timeout;
    let mut output = Vec::new();
    let mut expected_sequence = 1u32;
    let mut buffer = [0u8; 4096];
    while Instant::now() < deadline {
        match session.port.read(&mut buffer) {
            Ok(0) => continue,
            Ok(length) => {
                for event in session.decoder.push(&buffer[..length]) {
                    let message = event
                        .map_err(|error| format!("protocol_{error:?}").to_ascii_lowercase())?
                        .message;
                    let chunk = match (kind, message) {
                        (TransferKind::Directory, Message::DirectoryChunk(chunk)) => Some(chunk),
                        (TransferKind::File, Message::FileChunk(chunk)) => Some(chunk),
                        (_, Message::StatusNotification { info_code: 6, .. }) => {
                            return Err("device_busy".into())
                        }
                        _ => None,
                    };
                    let Some(chunk) = chunk else {
                        continue;
                    };
                    accept_chunk(&chunk, expected_sequence)?;
                    if chunk.outcome != 0 {
                        return Err(format!("sassi_outcome_{}", chunk.outcome));
                    }
                    expected_sequence += 1;
                    let maximum_bytes = match kind {
                        TransferKind::Directory => MAX_DIRECTORY_BYTES,
                        TransferKind::File => MAX_FILE_BYTES,
                    };
                    if output.len().saturating_add(chunk.bytes.len()) > maximum_bytes {
                        return Err("sassi_transfer_too_large".into());
                    }
                    output.extend_from_slice(&chunk.bytes);
                    if chunk.final_chunk {
                        return Ok(output);
                    }
                    write_frame(session, acknowledgement_frame)?;
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut
                        | io::ErrorKind::WouldBlock
                        | io::ErrorKind::Interrupted
                ) =>
            {
                continue
            }
            Err(_) => return Err("read_failed".into()),
        }
    }
    Err("request_timeout".into())
}

fn accept_chunk(chunk: &TransferChunk, expected: u32) -> Result<(), String> {
    if chunk.outcome != 0 {
        return Ok(());
    }
    if chunk.sequence != expected {
        Err("sassi_data_sequence_error".into())
    } else {
        Ok(())
    }
}

fn parse_directory(parent: &str, bytes: &[u8]) -> Result<Vec<DirectoryEntry>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "invalid_directory_record")?;
    text.split('\r')
        .filter(|record| !record.is_empty())
        .map(|record| {
            let fields: Vec<_> = record.split('\t').collect();
            if fields.len() != 4
                || !matches!(fields[0], ">" | " ")
                || fields[1].is_empty()
                || fields[1].contains('/')
                || fields[1].contains('\\')
                || matches!(fields[1], "." | "..")
                || fields[1].chars().any(char::is_control)
                || fields[3].parse::<u64>().is_err()
            {
                return Err("invalid_directory_record".into());
            }
            Ok(DirectoryEntry {
                directory: fields[0] == ">",
                name: fields[1].into(),
                path: format!("{}/{}", parent.trim_end_matches('/'), fields[1]),
                modified_at: fields[2].into(),
            })
        })
        .collect()
}

fn is_log_filename(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower
        .strip_prefix("log")
        .and_then(|value| value.strip_suffix(".klog"))
        .is_some_and(|digits| {
            !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn fields(data: &str) -> HashMap<&str, &str> {
    data.split(';')
        .filter_map(|entry| entry.split_once(':'))
        .collect()
}
fn filesystem_locked(data: &str) -> Option<bool> {
    fields(data)
        .get("sassi_file_lock")
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|value| value != 0)
}
fn extract_firmware(data: &str) -> Option<String> {
    let fields = fields(data);
    [
        "firmware_version",
        "firmware",
        "software_version",
        "version",
    ]
    .iter()
    .find_map(|key| {
        fields
            .get(key)
            .map(|value| value.trim())
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 64
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._+/-".contains(&byte))
            })
            .map(ToOwned::to_owned)
    })
}

fn disconnected(reason: &str) -> DeviceSnapshot {
    DeviceSnapshot {
        state: "ready".into(),
        reason: Some(reason.into()),
        connection: "disconnected".into(),
        transport: None,
        bridge_id: None,
        model: None,
        firmware: None,
        protocol: None,
        packet_limit_bytes: None,
        busy: None,
        profile_count: None,
        log_count: None,
        sync_state: "idle".into(),
        imported_log_count: 0,
        updated_log_count: 0,
        import_warning_count: 0,
        quarantined_log_count: 0,
        imported_profile_count: 0,
        profile_warning_count: 0,
        quarantined_profile_count: 0,
        last_synced_at: None,
        read_only: true,
    }
}
fn reconnecting(reason: &str) -> DeviceSnapshot {
    DeviceSnapshot {
        connection: "reconnecting".into(),
        ..disconnected(reason)
    }
}
fn degraded(reason: &str) -> DeviceSnapshot {
    DeviceSnapshot {
        state: "degraded".into(),
        ..disconnected(reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::virtual_nano::VirtualNanoFault;

    #[test]
    fn parses_studio_directory_records() {
        let entries = parse_directory(
            LOG_DIRECTORY,
            b" \tlog0001.klog\t202607186184617\t1234\r>\tarchive\t\t0\r",
        )
        .unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "kaffelogic/roast-logs/log0001.klog");
        assert!(entries[1].directory);
    }

    #[test]
    fn groups_mac_callout_and_tty_names() {
        assert!(is_log_filename("log0013.klog"));
        assert!(!is_log_filename("notes.klog"));
    }

    fn negotiate_virtual(
        scenario: VirtualNanoScenario,
    ) -> (Session, Arc<RwLock<DeviceSnapshot>>, VirtualNanoTranscript) {
        let (transport, transcript) = VirtualNanoTransport::new(scenario).unwrap();
        let snapshot = Arc::new(RwLock::new(reconnecting("test")));
        let mut session = new_session(Box::new(transport));
        for _ in 0..2_000 {
            poll_session(&mut session, &snapshot).unwrap();
            if session.phase == Phase::Ready {
                return (session, snapshot, transcript);
            }
        }
        panic!("virtual Nano negotiation did not complete");
    }

    #[test]
    fn virtual_nano_completes_real_session_sync_and_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
        let log_importer = KlogImporter::new(database.clone());
        let profile_importer = KproImporter::new(database.clone());
        let (mut session, snapshot, transcript) = negotiate_virtual(VirtualNanoScenario::smoke());

        synchronize(&mut session, &snapshot, &log_importer, &profile_importer).unwrap();
        let first = snapshot.read().clone();
        assert_eq!(first.connection, "connected");
        assert_eq!(first.profile_count, Some(2));
        assert_eq!(first.log_count, Some(3));
        assert_eq!(first.imported_profile_count, 2);
        assert_eq!(first.imported_log_count, 3);
        assert_eq!(first.profile_warning_count, 0);
        assert_eq!(first.import_warning_count, 0);
        assert_eq!(first.quarantined_profile_count, 0);
        assert_eq!(first.quarantined_log_count, 0);

        {
            let connection = database.connection();
            let roast_count: i64 = connection
                .query_row("SELECT count(*) FROM roasts", [], |row| row.get(0))
                .unwrap();
            let profile_count: i64 = connection
                .query_row("SELECT count(*) FROM profiles", [], |row| row.get(0))
                .unwrap();
            let sample_count: i64 = connection
                .query_row("SELECT count(*) FROM roast_series_points", [], |row| {
                    row.get(0)
                })
                .unwrap();
            // Each distinct profile snapshot embedded in a KLOG is retained as
            // an extracted child revision of its imported KPRO family.
            assert_eq!((roast_count, profile_count, sample_count), (3, 4, 9));
        }

        synchronize(&mut session, &snapshot, &log_importer, &profile_importer).unwrap();
        let connection = database.connection();
        let repeated_roast_count: i64 = connection
            .query_row("SELECT count(*) FROM roasts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(repeated_roast_count, 3);
        assert_eq!(snapshot.read().imported_log_count, 0);

        let events = transcript.events();
        assert!(events.iter().any(|event| event.frame_type == Some(2)));
        assert!(events.iter().any(|event| event.frame_type == Some(3)));
        assert!(events.iter().any(|event| event.frame_type == Some(5)));
        assert!(events.iter().any(|event| event.frame_type == Some(7)));
        assert!(events.iter().any(|event| event.frame_type == Some(1)));
    }

    #[test]
    fn bridge_session_drains_replayed_handshakes_before_answering() {
        let (transport, _) = VirtualNanoTransport::new(VirtualNanoScenario::smoke()).unwrap();
        let snapshot = Arc::new(RwLock::new(reconnecting("test")));
        let mut session = new_bridge_session(Box::new(transport));
        let mut buffer = [0u8; 512];
        let message = loop {
            let length = session.port.read(&mut buffer).unwrap();
            let mut events = session.decoder.push(&buffer[..length]);
            if let Some(decoded) = events.pop() {
                break decoded.unwrap().message;
            }
        };

        handle_message(&mut session, &snapshot, message.clone()).unwrap();
        assert_eq!(session.phase, Phase::AwaitingHandshake);

        session.handshake_not_before = Instant::now();
        handle_message(&mut session, &snapshot, message).unwrap();
        assert_eq!(session.phase, Phase::AwaitingTimeSync);
    }

    #[test]
    fn virtual_nano_faults_fail_closed_with_stable_reasons() {
        let cases = [
            (
                VirtualNanoFault::CorruptFirstTransferCrc,
                "protocol_invalidcrc",
            ),
            (
                VirtualNanoFault::OutOfOrderFirstTransfer,
                "sassi_data_sequence_error",
            ),
            (VirtualNanoFault::DisconnectDuringFirstFile, "read_failed"),
        ];
        for (fault, expected) in cases {
            let directory = tempfile::tempdir().unwrap();
            let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
            let log_importer = KlogImporter::new(database.clone());
            let profile_importer = KproImporter::new(database);
            let mut scenario = VirtualNanoScenario::smoke();
            scenario.fault = fault;
            let (mut session, snapshot, _) = negotiate_virtual(scenario);
            let result = synchronize(&mut session, &snapshot, &log_importer, &profile_importer);
            assert_eq!(result.unwrap_err(), expected, "{fault:?}");
        }

        let mut busy = VirtualNanoScenario::smoke();
        busy.fault = VirtualNanoFault::BusyFilesystem;
        let (session, snapshot, _) = negotiate_virtual(busy);
        assert_eq!(session.phase, Phase::Ready);
        assert_eq!(snapshot.read().busy, Some(true));

        let mut stalled = VirtualNanoScenario::smoke();
        stalled.fault = VirtualNanoFault::StallFirstTransfer;
        let (mut session, _, _) = negotiate_virtual(stalled);
        let timeout = request_transfer_with_timeout(
            &mut session,
            |elapsed, seed, maximum| directory_frame(elapsed, seed, maximum, LOG_DIRECTORY),
            TransferKind::Directory,
            Duration::from_millis(5),
        );
        assert_eq!(timeout.unwrap_err(), "request_timeout");
    }

    #[test]
    fn virtual_nano_sync_survives_extreme_transport_chunking() {
        for pattern in [vec![1], vec![2, 1], vec![17], vec![4_096]] {
            let directory = tempfile::tempdir().unwrap();
            let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
            let log_importer = KlogImporter::new(database.clone());
            let profile_importer = KproImporter::new(database);
            let mut scenario = VirtualNanoScenario::smoke();
            scenario.read_pattern = pattern.clone();
            scenario.transfer_payload_bytes = if pattern == vec![4_096] { 2_048 } else { 37 };
            let (mut session, snapshot, _) = negotiate_virtual(scenario);
            synchronize(&mut session, &snapshot, &log_importer, &profile_importer).unwrap();
            assert_eq!(snapshot.read().imported_log_count, 3, "{pattern:?}");
        }
    }
}
