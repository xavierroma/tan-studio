use std::{
    collections::HashMap,
    io::{self, BufRead, Read, Write},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use serialport::{
    ClearBuffer, DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits,
};

const PROTOCOL_VERSION: u8 = 1;
const MAX_COMMAND_BYTES: usize = 128 * 1024;
const MAX_WRITE_BYTES: usize = 64 * 1024;
const READ_TIMEOUT: Duration = Duration::from_millis(25);

type Output = Arc<Mutex<io::Stdout>>;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum WireCommand {
    List {
        protocol_version: u8,
        request_id: String,
    },
    Open {
        protocol_version: u8,
        request_id: String,
        candidate_id: String,
        generation: u64,
    },
    Write {
        protocol_version: u8,
        request_id: String,
        session_id: String,
        payload_base64: String,
    },
    Close {
        protocol_version: u8,
        request_id: String,
        session_id: String,
    },
    Shutdown {
        protocol_version: u8,
        request_id: String,
    },
}

impl WireCommand {
    fn protocol_version(&self) -> u8 {
        match self {
            Self::List {
                protocol_version, ..
            }
            | Self::Open {
                protocol_version, ..
            }
            | Self::Write {
                protocol_version, ..
            }
            | Self::Close {
                protocol_version, ..
            }
            | Self::Shutdown {
                protocol_version, ..
            } => *protocol_version,
        }
    }

    fn request_id(&self) -> &str {
        match self {
            Self::List { request_id, .. }
            | Self::Open { request_id, .. }
            | Self::Write { request_id, .. }
            | Self::Close { request_id, .. }
            | Self::Shutdown { request_id, .. } => request_id,
        }
    }
}

struct SerialSession {
    id: String,
    writer: Box<dyn SerialPort>,
    start: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    reader: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct CandidateRegistry {
    generation: u64,
    paths: HashMap<String, String>,
}

impl SerialSession {
    fn start_reader(&self) {
        self.start.store(true, Ordering::Release);
    }

    fn close(mut self) {
        self.stop.store(true, Ordering::Release);
        drop(self.writer);
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

fn main() {
    let output = Arc::new(Mutex::new(io::stdout()));
    emit(
        &output,
        json!({ "protocolVersion": PROTOCOL_VERSION, "type": "ready" }),
    );

    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut session: Option<SerialSession> = None;
    let mut candidates = CandidateRegistry::default();
    let mut next_session = 1_u64;

    loop {
        let line = match read_bounded_line(&mut input) {
            Ok(Some(Ok(line))) => line,
            Ok(Some(Err(()))) => {
                emit_error(&output, None, "command_too_large", false);
                continue;
            }
            Ok(None) | Err(_) => break,
        };

        let command: WireCommand = match serde_json::from_slice(&line) {
            Ok(command) => command,
            Err(_) => {
                emit_error(&output, None, "invalid_command", false);
                continue;
            }
        };

        let request_id = command.request_id().to_owned();
        if command.protocol_version() != PROTOCOL_VERSION || !valid_request_id(&request_id) {
            emit_error(
                &output,
                valid_request_id(&request_id).then_some(request_id.as_str()),
                "invalid_command",
                false,
            );
            continue;
        }

        match command {
            WireCommand::List { .. } => list_ports(&output, &request_id, &mut candidates),
            WireCommand::Open {
                candidate_id,
                generation,
                ..
            } => {
                if let Some(previous) = session.take() {
                    previous.close();
                }
                let path = generation
                    .eq(&candidates.generation)
                    .then(|| candidates.paths.get(&candidate_id))
                    .flatten()
                    .cloned();
                let Some(path) = path else {
                    emit_error(&output, Some(&request_id), "stale_candidate", true);
                    continue;
                };
                let session_id = format!("s{}-{}", generation, next_session);
                next_session = next_session.saturating_add(1);
                match open_port(&path, &session_id, output.clone()) {
                    Ok(opened) => {
                        emit_ok(&output, &request_id, json!({ "sessionId": opened.id }));
                        opened.start_reader();
                        session = Some(opened);
                    }
                    Err(code) => emit_error(&output, Some(&request_id), code, true),
                }
            }
            WireCommand::Write {
                session_id,
                payload_base64,
                ..
            } => {
                let result = write_payload(session.as_mut(), &session_id, &payload_base64);
                match result {
                    Ok(bytes_written) => emit_ok(
                        &output,
                        &request_id,
                        json!({ "bytesWritten": bytes_written }),
                    ),
                    Err((code, retryable)) => {
                        emit_error(&output, Some(&request_id), code, retryable)
                    }
                }
            }
            WireCommand::Close { session_id, .. } => {
                if session.as_ref().map(|opened| opened.id.as_str()) == Some(session_id.as_str()) {
                    if let Some(opened) = session.take() {
                        opened.close();
                    }
                    emit_ok(&output, &request_id, json!({ "closed": true }));
                } else {
                    emit_error(&output, Some(&request_id), "stale_session", true);
                }
            }
            WireCommand::Shutdown { .. } => {
                if let Some(opened) = session.take() {
                    opened.close();
                }
                emit_ok(&output, &request_id, json!({ "shutdown": true }));
                return;
            }
        }
    }

    if let Some(opened) = session.take() {
        opened.close();
    }
}

fn list_ports(output: &Output, request_id: &str, registry: &mut CandidateRegistry) {
    match serialport::available_ports() {
        Ok(ports) => {
            registry.generation = registry.generation.saturating_add(1).max(1);
            registry.paths.clear();
            let mut grouped: HashMap<(Option<u16>, Option<u16>, String), (String, &'static str)> =
                HashMap::new();

            for port in ports {
                let (vendor_id, product_id, kind) = match port.port_type {
                    SerialPortType::UsbPort(usb) => (Some(usb.vid), Some(usb.pid), "usb"),
                    SerialPortType::PciPort => (None, None, "pci"),
                    SerialPortType::BluetoothPort => (None, None, "bluetooth"),
                    SerialPortType::Unknown => (None, None, "unknown"),
                };
                let suffix =
                    paired_suffix(&port.port_name).unwrap_or_else(|| port.port_name.clone());
                let key = (vendor_id, product_id, suffix);
                let prefer = port.port_name.starts_with("/dev/cu.");
                grouped
                    .entry(key)
                    .and_modify(|existing| {
                        if prefer {
                            *existing = (port.port_name.clone(), kind);
                        }
                    })
                    .or_insert((port.port_name, kind));
            }

            let mut grouped: Vec<_> = grouped.into_iter().collect();
            grouped.sort_by(|left, right| left.0.cmp(&right.0));
            let safe_ports: Vec<Value> = grouped
                .into_iter()
                .enumerate()
                .map(|(index, ((vendor_id, product_id, _), (path, kind)))| {
                    let candidate_id = format!("c{}", index + 1);
                    registry.paths.insert(candidate_id.clone(), path);
                    json!({
                        "candidateId": candidate_id,
                        "vendorId": vendor_id,
                        "productId": product_id,
                        "kind": kind,
                    })
                })
                .collect();
            emit_ok(
                output,
                request_id,
                json!({ "generation": registry.generation, "candidates": safe_ports }),
            );
        }
        Err(_) => emit_error(output, Some(request_id), "enumeration_failed", true),
    }
}

fn open_port(path: &str, session_id: &str, output: Output) -> Result<SerialSession, &'static str> {
    if path.is_empty() || path.len() > 1024 || path.contains('\0') || !is_enumerated_port(path) {
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

    let mut writer = builder.open().map_err(|error| match error.kind() {
        serialport::ErrorKind::NoDevice => "device_unavailable",
        serialport::ErrorKind::InvalidInput => "invalid_port",
        serialport::ErrorKind::Io(io::ErrorKind::PermissionDenied) => "permission_denied",
        serialport::ErrorKind::Io(io::ErrorKind::WouldBlock) => "port_in_use",
        _ => "open_failed",
    })?;

    writer
        .write_data_terminal_ready(true)
        .map_err(|_| "dtr_failed")?;
    let _ = writer.clear(ClearBuffer::Output);
    let mut reader = writer.try_clone().map_err(|_| "clone_failed")?;
    let start = Arc::new(AtomicBool::new(false));
    let reader_start = start.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    let event_session_id = session_id.to_owned();
    let reader_handle = thread::Builder::new()
        .name("tan-studio-serial-reader".into())
        .spawn(move || {
            while !reader_start.load(Ordering::Acquire) && !reader_stop.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(1));
            }
            let sequence = AtomicU64::new(1);
            let mut buffer = [0_u8; 4096];
            while !reader_stop.load(Ordering::Acquire) {
                match reader.read(&mut buffer) {
                    Ok(0) => {}
                    Ok(length) => {
                        let seq = sequence.fetch_add(1, Ordering::AcqRel);
                        if !emit(
                            &output,
                            json!({
                                "protocolVersion": PROTOCOL_VERSION,
                                "type": "data",
                                "sessionId": event_session_id,
                                "seq": seq,
                                "payloadBase64": BASE64.encode(&buffer[..length]),
                            }),
                        ) {
                            break;
                        }
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            io::ErrorKind::TimedOut
                                | io::ErrorKind::WouldBlock
                                | io::ErrorKind::Interrupted
                        ) => {}
                    Err(_) => {
                        if !reader_stop.load(Ordering::Acquire) {
                            let seq = sequence.fetch_add(1, Ordering::AcqRel);
                            let _ = emit(
                                &output,
                                json!({
                                    "protocolVersion": PROTOCOL_VERSION,
                                    "type": "disconnected",
                                    "sessionId": event_session_id,
                                    "seq": seq,
                                    "reason": "read_failed",
                                }),
                            );
                        }
                        break;
                    }
                }
            }
        })
        .map_err(|_| "reader_start_failed")?;

    Ok(SerialSession {
        id: session_id.to_owned(),
        writer,
        start,
        stop,
        reader: Some(reader_handle),
    })
}

fn is_enumerated_port(path: &str) -> bool {
    serialport::available_ports()
        .map(|ports| ports.into_iter().any(|port| port.port_name == path))
        .unwrap_or(false)
}

fn write_payload(
    session: Option<&mut SerialSession>,
    session_id: &str,
    payload_base64: &str,
) -> Result<usize, (&'static str, bool)> {
    let Some(session) = session else {
        return Err(("not_open", true));
    };
    if session.id != session_id {
        return Err(("stale_session", true));
    }
    if payload_base64.len() > MAX_WRITE_BYTES * 2 {
        return Err(("payload_too_large", false));
    }
    let payload = BASE64
        .decode(payload_base64)
        .map_err(|_| ("invalid_payload", false))?;
    if payload.len() > MAX_WRITE_BYTES {
        return Err(("payload_too_large", false));
    }
    session
        .writer
        .write_all(&payload)
        .map_err(|_| ("write_failed", true))?;
    session.writer.flush().map_err(|_| ("write_failed", true))?;
    Ok(payload.len())
}

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn emit_ok(output: &Output, request_id: &str, result: Value) {
    emit(
        output,
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "response",
            "requestId": request_id,
            "ok": true,
            "result": result,
        }),
    );
}

fn emit_error(output: &Output, request_id: Option<&str>, code: &str, retryable: bool) {
    emit(
        output,
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "response",
            "requestId": request_id,
            "ok": false,
            "error": { "code": code, "retryable": retryable },
        }),
    );
}

fn emit(output: &Output, value: Value) -> bool {
    let Ok(mut stdout) = output.lock() else {
        return false;
    };
    serde_json::to_writer(&mut *stdout, &value).is_ok()
        && stdout.write_all(b"\n").is_ok()
        && stdout.flush().is_ok()
}

fn paired_suffix(path: &str) -> Option<String> {
    path.strip_prefix("/dev/cu.")
        .or_else(|| path.strip_prefix("/dev/tty."))
        .map(ToOwned::to_owned)
}

fn read_bounded_line(reader: &mut dyn BufRead) -> io::Result<Option<Result<Vec<u8>, ()>>> {
    let mut line = Vec::new();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() && !oversized {
                Ok(None)
            } else if oversized {
                Ok(Some(Err(())))
            } else {
                Ok(Some(Ok(line)))
            };
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |position| position + 1);
        if !oversized {
            if line.len().saturating_add(take) > MAX_COMMAND_BYTES {
                oversized = true;
                line.clear();
            } else {
                line.extend_from_slice(&available[..take]);
            }
        }
        let terminated = available.get(take.saturating_sub(1)) == Some(&b'\n');
        reader.consume(take);
        if terminated {
            if oversized {
                return Ok(Some(Err(())));
            }
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return Ok(Some(Ok(line)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_bounded_opaque_request_ids() {
        assert!(valid_request_id("018f0123-4567-7abc-8def-0123456789ab"));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id("contains spaces"));
        assert!(!valid_request_id(&"a".repeat(65)));
    }

    #[test]
    fn command_schema_rejects_unknown_fields() {
        let value = r#"{"type":"list","protocolVersion":1,"requestId":"r1","secret":"no"}"#;
        assert!(serde_json::from_str::<WireCommand>(value).is_err());
    }

    #[test]
    fn command_schema_rejects_unknown_commands() {
        let value = r#"{"type":"erase","protocolVersion":1,"requestId":"r1"}"#;
        assert!(serde_json::from_str::<WireCommand>(value).is_err());
    }
}
