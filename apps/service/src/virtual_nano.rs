//! Stateful, privacy-safe Kaffeelogic Nano simulator.
//!
//! The simulator implements only the read-only SASSI request types already
//! emitted by `device`: acknowledgement, time synchronization, directory read,
//! file read, and information read. It is usable as the exact same `Read +
//! Write` transport as direct serial and the LAN bridge.

use std::{
    collections::{BTreeMap, VecDeque},
    io::{self, Read, Write},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};

use crate::sassi::{self, decode_frame, encode_frame};

const CRC_SEED: u16 = 0x1a2b;
const MAXIMUM_PACKET_BYTES: usize = 4_064;
const CONNECTION_REQUEST_INTERVAL: Duration = Duration::from_millis(500);
const TRANSCRIPT_EVENT_LIMIT: usize = 20_000;
const LOG_DIRECTORY: &str = "kaffelogic/roast-logs";
const PROFILE_DIRECTORY: &str = "kaffelogic/roast-profiles";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TranscriptDirection {
    NanoToHost,
    HostToNano,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptEvent {
    pub schema_version: u8,
    pub monotonic_us: u64,
    pub direction: TranscriptDirection,
    pub chunk_base64: String,
    pub frame_type: Option<u32>,
}

#[derive(Clone, Debug, Default)]
pub struct VirtualNanoTranscript {
    events: Arc<Mutex<Vec<TranscriptEvent>>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualNanoVerification {
    pub request_counts: BTreeMap<u32, u64>,
    pub directory_requests: u64,
    pub file_requests: u64,
    pub expected_file_requests: u64,
    pub smoke_complete: bool,
}

impl VirtualNanoTranscript {
    pub fn events(&self) -> Vec<TranscriptEvent> {
        self.events.lock().expect("transcript lock").clone()
    }

    pub fn to_json_lines(&self) -> Result<String, serde_json::Error> {
        let mut output = String::new();
        for event in self.events() {
            output.push_str(&serde_json::to_string(&event)?);
            output.push('\n');
        }
        Ok(output)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VirtualNanoFault {
    None,
    BusyFilesystem,
    CorruptFirstTransferCrc,
    OutOfOrderFirstTransfer,
    DisconnectDuringFirstFile,
    StallFirstTransfer,
}

#[derive(Clone, Debug)]
pub struct VirtualNanoScenario {
    pub read_pattern: Vec<usize>,
    pub transfer_payload_bytes: usize,
    pub fault: VirtualNanoFault,
    pub files: BTreeMap<String, Vec<u8>>,
}

impl VirtualNanoScenario {
    pub fn smoke() -> Self {
        let mut files = BTreeMap::new();
        files.insert(
            format!("{PROFILE_DIRECTORY}/1200-1500m Rest v1.0.kpro"),
            profile_fixture("1200-1500m Rest", "Maximum flavour after resting"),
        );
        files.insert(
            format!("{PROFILE_DIRECTORY}/Washed test v1.0.kpro"),
            profile_fixture("Washed test", "Synthetic washed-coffee profile"),
        );
        files.insert(
            format!("{LOG_DIRECTORY}/log0001.klog"),
            log_fixture(1, "1200-1500m Rest", "2.00000", "18/07/2026 18:37:27 UTC"),
        );
        files.insert(
            format!("{LOG_DIRECTORY}/log0002.klog"),
            log_fixture(2, "Washed test", "2.50000", "19/07/2026 08:15:00 UTC"),
        );
        files.insert(
            format!("{LOG_DIRECTORY}/log0003.klog"),
            log_fixture(3, "1200-1500m Rest", "1.40000", "20/07/2026 13:05:00 UTC"),
        );
        Self {
            // Includes single-byte reads, awkward boundaries, and reads large
            // enough to coalesce queued frames when the protocol permits it.
            read_pattern: vec![1, 2, 3, 7, 13, 31, 127, 4_096],
            transfer_payload_bytes: 79,
            fault: VirtualNanoFault::None,
            files,
        }
    }
}

#[derive(Debug)]
struct PendingTransfer {
    frame_type: u8,
    path: String,
    chunks: VecDeque<Vec<u8>>,
    next_sequence: u32,
}

pub struct VirtualNanoTransport {
    scenario: VirtualNanoScenario,
    inbound: VecDeque<u8>,
    inbound_types: VecDeque<Option<u32>>,
    outbound: Vec<u8>,
    pending: Option<PendingTransfer>,
    read_index: usize,
    started: Instant,
    transcript: VirtualNanoTranscript,
    first_transfer_seen: bool,
    disconnected: bool,
    request_counts: BTreeMap<u32, u64>,
    directory_requests: u64,
    file_requests: u64,
    current_crc_seed: u16,
    last_connection_request_at: Instant,
    negotiated: bool,
}

impl VirtualNanoTransport {
    pub fn new(scenario: VirtualNanoScenario) -> io::Result<(Self, VirtualNanoTranscript)> {
        if scenario.read_pattern.is_empty()
            || scenario.read_pattern.contains(&0)
            || scenario.transfer_payload_bytes == 0
            || scenario.transfer_payload_bytes > 2_048
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid virtual Nano bounds",
            ));
        }
        let transcript = VirtualNanoTranscript::default();
        let mut transport = Self {
            scenario,
            inbound: VecDeque::new(),
            inbound_types: VecDeque::new(),
            outbound: Vec::new(),
            pending: None,
            read_index: 0,
            started: Instant::now(),
            transcript: transcript.clone(),
            first_transfer_seen: false,
            disconnected: false,
            request_counts: BTreeMap::new(),
            directory_requests: 0,
            file_requests: 0,
            current_crc_seed: CRC_SEED,
            last_connection_request_at: Instant::now(),
            negotiated: false,
        };
        transport.enqueue_frame(connection_frame(CRC_SEED, 1)?);
        Ok((transport, transcript))
    }

    fn enqueue_frame(&mut self, mut frame: Vec<u8>) {
        let frame_type = frame_type(&frame);
        if !self.first_transfer_seen
            && self.scenario.fault == VirtualNanoFault::CorruptFirstTransferCrc
            && matches!(frame_type, Some(6 | 8))
        {
            if let Some(index) = frame.len().checked_sub(3) {
                frame[index] = if frame[index] == b'0' { b'1' } else { b'0' };
            }
            self.first_transfer_seen = true;
        }
        self.inbound_types
            .extend(std::iter::repeat_n(frame_type, frame.len()));
        self.inbound.extend(frame);
    }

    fn record(&self, direction: TranscriptDirection, bytes: &[u8], known_frame_type: Option<u32>) {
        let mut events = self.transcript.events.lock().expect("transcript lock");
        if events.len() >= TRANSCRIPT_EVENT_LIMIT {
            return;
        }
        events.push(TranscriptEvent {
            schema_version: 1,
            monotonic_us: self.started.elapsed().as_micros().min(u128::from(u64::MAX)) as u64,
            direction,
            chunk_base64: BASE64.encode(bytes),
            frame_type: known_frame_type.or_else(|| frame_type(bytes)),
        });
    }

    fn accept_frame(&mut self, frame: &[u8]) -> io::Result<()> {
        decode_frame(
            frame,
            Some(self.current_crc_seed),
            MAXIMUM_PACKET_BYTES + 64,
        )
        .map_err(|error| invalid_data(format!("invalid host SASSI frame: {error}")))?;
        let (kind, fields) = raw_fields(frame)?;
        *self.request_counts.entry(kind).or_default() += 1;
        match kind {
            1 => {
                if fields.is_empty() {
                    self.send_next_transfer_chunk()?;
                } else {
                    return Err(invalid_data("acknowledgement has fields"));
                }
            }
            3 => {
                if fields.len() != 4 {
                    return Err(invalid_data("invalid time synchronization request"));
                }
                self.negotiated = true;
                self.enqueue_frame(
                    encode_frame(
                        4,
                        self.elapsed_ms(),
                        &[],
                        self.current_crc_seed,
                        MAXIMUM_PACKET_BYTES,
                    )
                    .map_err(codec_error)?,
                );
            }
            5 => {
                let path = fields
                    .first()
                    .ok_or_else(|| invalid_data("directory path missing"))?;
                let bytes = self.directory_bytes(path)?;
                self.directory_requests = self.directory_requests.saturating_add(1);
                self.start_transfer(6, path, bytes)?;
            }
            7 => {
                let path = fields
                    .first()
                    .ok_or_else(|| invalid_data("file path missing"))?;
                let bytes = self
                    .scenario
                    .files
                    .get(*path)
                    .cloned()
                    .ok_or_else(|| invalid_data("virtual file not found"))?;
                self.file_requests = self.file_requests.saturating_add(1);
                if self.scenario.fault == VirtualNanoFault::DisconnectDuringFirstFile
                    && !self.first_transfer_seen
                {
                    self.first_transfer_seen = true;
                    self.disconnected = true;
                    return Ok(());
                }
                self.start_transfer(8, path, bytes)?;
            }
            13 => {
                if fields.len() != 2 || !fields[0].is_empty() {
                    return Err(invalid_data("invalid information request"));
                }
                let code = fields[1];
                let data = match code {
                    "9" => {
                        if self.scenario.fault == VirtualNanoFault::BusyFilesystem {
                            "sassi_file_lock:1"
                        } else {
                            "sassi_file_lock:0"
                        }
                    }
                    "3" => "firmware_version:7.11.3",
                    _ => return Err(invalid_data("unsupported information request")),
                };
                self.enqueue_frame(
                    encode_frame(
                        14,
                        self.elapsed_ms(),
                        &[data, code],
                        self.current_crc_seed,
                        MAXIMUM_PACKET_BYTES,
                    )
                    .map_err(codec_error)?,
                );
            }
            _ => return Err(invalid_data("unverified virtual Nano request type")),
        }
        Ok(())
    }

    fn directory_bytes(&self, path: &str) -> io::Result<Vec<u8>> {
        if !matches!(path, LOG_DIRECTORY | PROFILE_DIRECTORY) {
            return Err(invalid_data("unsupported virtual directory"));
        }
        let prefix = format!("{path}/");
        let mut output = String::new();
        for (file_path, bytes) in &self.scenario.files {
            let Some(name) = file_path.strip_prefix(&prefix) else {
                continue;
            };
            if name.contains('/') || name.contains('\r') || name.contains('\t') {
                return Err(invalid_data("invalid virtual filename"));
            }
            output.push_str(&format!(" \t{name}\t202607220000000\t{}\r", bytes.len()));
        }
        Ok(output.into_bytes())
    }

    fn start_transfer(&mut self, frame_type: u8, path: &str, bytes: Vec<u8>) -> io::Result<()> {
        if self.pending.is_some() {
            return Err(invalid_data("overlapping virtual transfer"));
        }
        if !self.first_transfer_seen && self.scenario.fault == VirtualNanoFault::StallFirstTransfer
        {
            self.first_transfer_seen = true;
            return Ok(());
        }
        let chunks = bytes
            .chunks(self.scenario.transfer_payload_bytes)
            .map(ToOwned::to_owned)
            .collect::<VecDeque<_>>();
        self.pending = Some(PendingTransfer {
            frame_type,
            path: path.to_owned(),
            chunks: if chunks.is_empty() {
                VecDeque::from([Vec::new()])
            } else {
                chunks
            },
            next_sequence: 1,
        });
        self.send_next_transfer_chunk()
    }

    fn send_next_transfer_chunk(&mut self) -> io::Result<()> {
        let Some(mut transfer) = self.pending.take() else {
            return Err(invalid_data("unexpected transfer acknowledgement"));
        };
        let Some(bytes) = transfer.chunks.pop_front() else {
            return Err(invalid_data("empty pending transfer"));
        };
        let final_chunk = transfer.chunks.is_empty();
        let mut sequence = transfer.next_sequence;
        if !self.first_transfer_seen
            && self.scenario.fault == VirtualNanoFault::OutOfOrderFirstTransfer
        {
            sequence = sequence.saturating_add(1);
            self.first_transfer_seen = true;
        }
        let combined = if final_chunk { "128" } else { "0" };
        let sequence_text = sequence.to_string();
        let encoded = BASE64.encode(bytes);
        let frame = encode_frame(
            transfer.frame_type,
            self.elapsed_ms(),
            &[&transfer.path, combined, "", &sequence_text, &encoded],
            self.current_crc_seed,
            MAXIMUM_PACKET_BYTES,
        )
        .map_err(codec_error)?;
        transfer.next_sequence = transfer.next_sequence.saturating_add(1);
        if !final_chunk {
            self.pending = Some(transfer);
        }
        self.enqueue_frame(frame);
        Ok(())
    }

    fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
    }

    pub fn verification(&self) -> VirtualNanoVerification {
        let expected_file_requests = self.scenario.files.len() as u64;
        let smoke_complete = self.request_counts.get(&3).copied().unwrap_or(0) >= 1
            && self.request_counts.get(&13).copied().unwrap_or(0) >= 2
            && self.directory_requests >= 2
            && self.file_requests >= expected_file_requests
            && self.pending.is_none()
            && !self.disconnected;
        VirtualNanoVerification {
            request_counts: self.request_counts.clone(),
            directory_requests: self.directory_requests,
            file_requests: self.file_requests,
            expected_file_requests,
            smoke_complete,
        }
    }
}

impl Read for VirtualNanoTransport {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.disconnected {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionReset,
                "virtual Nano disconnected",
            ));
        }
        if self.inbound.is_empty()
            && !self.negotiated
            && self.last_connection_request_at.elapsed() >= CONNECTION_REQUEST_INTERVAL
        {
            self.current_crc_seed = self.current_crc_seed.wrapping_add(0x101).max(1);
            self.last_connection_request_at = Instant::now();
            self.enqueue_frame(connection_frame(self.current_crc_seed, self.elapsed_ms())?);
        }
        if self.inbound.is_empty() {
            return Err(io::Error::from(io::ErrorKind::WouldBlock));
        }
        let requested =
            self.scenario.read_pattern[self.read_index % self.scenario.read_pattern.len()];
        self.read_index = self.read_index.saturating_add(1);
        let length = requested.min(output.len()).min(self.inbound.len());
        let mut known_frame_type = None;
        for destination in &mut output[..length] {
            *destination = self.inbound.pop_front().expect("bounded inbound byte");
            let byte_frame_type = self
                .inbound_types
                .pop_front()
                .expect("bounded inbound type");
            known_frame_type = known_frame_type.or(byte_frame_type);
        }
        self.record(
            TranscriptDirection::NanoToHost,
            &output[..length],
            known_frame_type,
        );
        Ok(length)
    }
}

impl Write for VirtualNanoTransport {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.disconnected {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "virtual Nano disconnected",
            ));
        }
        self.record(TranscriptDirection::HostToNano, bytes, None);
        self.outbound.extend_from_slice(bytes);
        while let Some(end) = self.outbound.iter().position(|byte| *byte == b'\r') {
            let frame = self.outbound.drain(..=end).collect::<Vec<_>>();
            self.accept_frame(&frame)?;
        }
        if self.outbound.len() > MAXIMUM_PACKET_BYTES + 64 {
            self.outbound.clear();
            return Err(invalid_data("unterminated host frame is too large"));
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn connection_frame(crc_seed: u16, elapsed_ms: u64) -> io::Result<Vec<u8>> {
    let seed = format!("{crc_seed:04x}");
    encode_frame(
        2,
        elapsed_ms,
        &[
            "1",
            "128",
            "TS00000001",
            "1",
            "KN1007B",
            "kaffelogic.com",
            "",
            "4064",
            "192",
            &seed,
        ],
        crc_seed,
        512,
    )
    .map_err(codec_error)
}

fn raw_fields(frame: &[u8]) -> io::Result<(u32, Vec<&str>)> {
    let text = std::str::from_utf8(frame).map_err(|_| invalid_data("host frame is not UTF-8"))?;
    let body = text
        .strip_suffix('\r')
        .and_then(|value| value.strip_prefix("KL*"))
        .ok_or_else(|| invalid_data("host frame syntax"))?;
    let (payload, _) = body
        .rsplit_once('|')
        .ok_or_else(|| invalid_data("host frame CRC missing"))?;
    let mut tokens = payload.split('|');
    let kind = tokens
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| invalid_data("host frame type"))?;
    let _elapsed = tokens
        .next()
        .ok_or_else(|| invalid_data("host frame elapsed time"))?;
    Ok((kind, tokens.collect()))
}

fn frame_type(frame: &[u8]) -> Option<u32> {
    let prefix = frame.strip_prefix(b"KL*")?;
    let separator = prefix.iter().position(|byte| *byte == b'|')?;
    std::str::from_utf8(&prefix[..separator]).ok()?.parse().ok()
}

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn codec_error(error: sassi::CodecError) -> io::Error {
    invalid_data(format!("virtual Nano frame encoding failed: {error}"))
}

fn profile_fixture(name: &str, description: &str) -> Vec<u8> {
    [
        format!("profile_short_name:{name}"),
        "profile_designer:Kaffelogic Ltd".into(),
        format!("profile_description:{description}"),
        "profile_schema_version:1.4".into(),
        "recommended_level:2.0".into(),
        "reference_load_size:100".into(),
        "roast_levels:205,215,222".into(),
        "roast_profile:0,20,0,0,20,50,60,110,40,90,80,130".into(),
        "fan_profile:0,14700,0,0,20,14700,60,14000,40,14500,80,13500".into(),
    ]
    .join("\r\n")
    .into_bytes()
}

fn log_fixture(number: u32, profile: &str, level: &str, date: &str) -> Vec<u8> {
    [
        format!("log_file_name:{LOG_DIRECTORY}/log{number:04}.klog"),
        format!("profile_file_name:{profile} v1.0.kpro"),
        format!("profile_short_name:{profile}"),
        "profile_schema_version:1.4".into(),
        format!("roasting_level:{level}"),
        "boost_load_size:50.0000".into(),
        format!("roast_date:{date}"),
        "model:KN1007B/J/TS00000001".into(),
        String::new(),
        "offsets\t-8.5\t-8.75\t-12\t0\t0\t-19.5\t-8.75\t-8.5\t-8.5\t-8.5\t-8.5\t-8.5\t-8.5".into(),
        "time\t#spot_temp\t#=temp\t=mean_temp\t=profile\tprofile_ROR\t=actual_ROR\t#=desired_ROR\tpower_kW\t#volts-9\t#Kp\t#Ki\t#Kd\t#^actual_fan_RPM".into(),
        "0\t25.0\t25.0\t25.0\t25.0\t15.0\t15.0\t15.0\t0.20\t4.5\t0.7\t0\t3\t1200\t".into(),
        "240\t180.0\t180.0\t179.9\t182.0\t8.0\t7.5\t8.0\t0.71\t4.5\t0.7\t0\t3\t13200\t".into(),
        "!roast_end:521.216".into(),
        "!roast_end_reason:0.00000".into(),
        format!("!roast_date:{date}"),
        "522\t120\t121\t200\t218\t6.6\t-1\t6\t0\t4.4\t0.7\t0\t3\t15000\t".into(),
        String::new(),
    ]
    .join("\n")
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_is_bounded_and_json_lines_round_trips() {
        let (mut transport, transcript) =
            VirtualNanoTransport::new(VirtualNanoScenario::smoke()).unwrap();
        let mut bytes = [0; 512];
        while transport.read(&mut bytes).is_ok() {}
        let json_lines = transcript.to_json_lines().unwrap();
        let decoded = json_lines
            .lines()
            .map(|line| serde_json::from_str::<TranscriptEvent>(line).unwrap())
            .collect::<Vec<_>>();
        assert!(!decoded.is_empty());
        assert!(decoded.len() <= TRANSCRIPT_EVENT_LIMIT);
        assert_eq!(decoded[0].direction, TranscriptDirection::NanoToHost);
    }

    #[test]
    fn synthetic_files_are_accepted_by_the_real_parsers() {
        let scenario = VirtualNanoScenario::smoke();
        for (path, bytes) in scenario.files {
            if path.ends_with(".klog") {
                let document = crate::klog::parse(&bytes).unwrap();
                assert!(document.safe_to_import, "{path}");
            } else {
                crate::kpro::parse(&bytes).unwrap();
            }
        }
    }

    #[test]
    fn repeats_connection_requests_with_a_fresh_crc_seed() {
        let (mut transport, _) = VirtualNanoTransport::new(VirtualNanoScenario::smoke()).unwrap();
        transport.inbound.clear();
        transport.inbound_types.clear();
        let original_seed = transport.current_crc_seed;
        transport.last_connection_request_at = Instant::now() - CONNECTION_REQUEST_INTERVAL;

        let mut frame = Vec::new();
        let mut bytes = [0u8; 512];
        loop {
            match transport.read(&mut bytes) {
                Ok(length) => frame.extend_from_slice(&bytes[..length]),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) => panic!("unexpected virtual Nano read: {error}"),
            }
        }
        assert_ne!(transport.current_crc_seed, original_seed);
        let decoded = decode_frame(&frame, None, 512).unwrap();
        let sassi::Message::ConnectionRequest(request) = decoded.message else {
            panic!("connection request")
        };
        assert_eq!(request.crc_seed, transport.current_crc_seed);
    }
}
