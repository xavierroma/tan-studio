//! Pure Kaffeelogic SASSI framing. This module has no serial, HTTP, database,
//! or filesystem dependencies and is exercised with privacy-safe captured
//! frame shapes.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{Datelike, Timelike, Utc};

pub const FRAME_TERMINATOR: u8 = 0x0d;
const PRE_HANDSHAKE_MAX: usize = 512;
const FRAME_OVERHEAD: usize = 64;
const ABSOLUTE_MAX_PACKET: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionRequest {
    pub platform: u16,
    pub capability_bits: u32,
    pub sassi_version: u16,
    pub model: String,
    pub manufacturer_domain: String,
    pub description: String,
    pub maximum_packet_bytes: usize,
    pub maximum_filename_bytes: usize,
    pub crc_seed: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferChunk {
    pub path: String,
    pub outcome: u8,
    pub final_chunk: bool,
    pub third: String,
    pub sequence: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    ConnectionRequest(ConnectionRequest),
    TimeSyncAcknowledgement,
    DirectoryChunk(TransferChunk),
    FileChunk(TransferChunk),
    InfoResponse { data: String, info_code: u16 },
    StatusNotification { data: String, info_code: u16 },
    IncrementalFileChunk(TransferChunk),
    Unknown { kind: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedMessage {
    pub kind: u32,
    pub elapsed_ms: u64,
    pub message: Message,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CodecError {
    #[error("malformed SASSI syntax")]
    MalformedSyntax,
    #[error("invalid SASSI field")]
    InvalidField,
    #[error("SASSI CRC validation failed")]
    InvalidCrc,
    #[error("SASSI frame is too large")]
    TooLarge,
}

pub struct Decoder {
    buffer: Vec<u8>,
    discard_until_terminator: bool,
    maximum_packet_bytes: Option<usize>,
    crc_seed: Option<u16>,
}

impl Default for Decoder {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            discard_until_terminator: false,
            maximum_packet_bytes: None,
            crc_seed: None,
        }
    }
}

impl Decoder {
    pub fn negotiate(
        &mut self,
        maximum_packet_bytes: usize,
        crc_seed: u16,
    ) -> Result<(), CodecError> {
        if maximum_packet_bytes == 0 || maximum_packet_bytes > ABSOLUTE_MAX_PACKET {
            return Err(CodecError::InvalidField);
        }
        self.maximum_packet_bytes = Some(maximum_packet_bytes);
        self.crc_seed = Some(crc_seed);
        Ok(())
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
        self.discard_until_terminator = false;
        self.maximum_packet_bytes = None;
        self.crc_seed = None;
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<Result<DecodedMessage, CodecError>> {
        let mut events = Vec::new();
        for byte in bytes {
            if self.discard_until_terminator {
                if *byte == FRAME_TERMINATOR {
                    self.discard_until_terminator = false;
                }
                continue;
            }
            if *byte == FRAME_TERMINATOR {
                self.buffer.push(*byte);
                let frame = std::mem::take(&mut self.buffer);
                events.push(decode_frame(
                    &frame,
                    self.crc_seed,
                    self.maximum_frame_bytes(),
                ));
                continue;
            }
            self.buffer.push(*byte);
            if self.buffer.len() + 1 > self.maximum_frame_bytes() {
                self.buffer.clear();
                self.discard_until_terminator = true;
                events.push(Err(CodecError::TooLarge));
            }
        }
        events
    }

    pub fn buffered_bytes(&self) -> usize {
        self.buffer.len()
    }

    fn maximum_frame_bytes(&self) -> usize {
        self.maximum_packet_bytes
            .map(|maximum| maximum + FRAME_OVERHEAD)
            .unwrap_or(PRE_HANDSHAKE_MAX)
    }
}

pub fn decode_frame(
    frame: &[u8],
    negotiated_seed: Option<u16>,
    maximum: usize,
) -> Result<DecodedMessage, CodecError> {
    if frame.len() > maximum {
        return Err(CodecError::TooLarge);
    }
    if frame.last() != Some(&FRAME_TERMINATOR) || frame.len() < 2 {
        return Err(CodecError::MalformedSyntax);
    }
    let body = &frame[..frame.len() - 1];
    if body.iter().any(|byte| !(0x20..=0x7e).contains(byte)) {
        return Err(CodecError::MalformedSyntax);
    }
    let text = std::str::from_utf8(body).map_err(|_| CodecError::MalformedSyntax)?;
    let payload = text
        .strip_prefix("KL*")
        .ok_or(CodecError::MalformedSyntax)?;
    let separator = payload.rfind('|').ok_or(CodecError::MalformedSyntax)?;
    let crc_text = &payload[separator + 1..];
    if crc_text.len() != 4 || !crc_text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CodecError::MalformedSyntax);
    }
    let tokens: Vec<&str> = payload[..separator].split('|').collect();
    if tokens.len() < 2 {
        return Err(CodecError::MalformedSyntax);
    }
    let kind = decimal(tokens[0], u32::MAX as u64)? as u32;
    let elapsed_ms = u64::from_str_radix(tokens[1], 16).map_err(|_| CodecError::InvalidField)?;
    let fields = &tokens[2..];
    let parsed = parse_message(kind, fields)?;
    let seed = match &parsed {
        Message::ConnectionRequest(request) => request.crc_seed,
        _ => negotiated_seed.unwrap_or(0),
    };
    let crc_input_len = 3 + separator + 1;
    let actual = crc16_ccitt_xmodem(&body[..crc_input_len], seed);
    let supplied = u16::from_str_radix(crc_text, 16).map_err(|_| CodecError::MalformedSyntax)?;
    if actual != supplied {
        return Err(CodecError::InvalidCrc);
    }
    Ok(DecodedMessage {
        kind,
        elapsed_ms,
        message: parsed,
    })
}

fn parse_message(kind: u32, fields: &[&str]) -> Result<Message, CodecError> {
    match kind {
        2 => {
            if fields.len() != 10 {
                return Err(CodecError::InvalidField);
            }
            let serial = fields[2];
            if serial.len() != 10 || !serial.is_ascii() {
                return Err(CodecError::InvalidField);
            }
            let request = ConnectionRequest {
                platform: decimal(fields[0], u16::MAX as u64)? as u16,
                capability_bits: decimal(fields[1], u32::MAX as u64)? as u32,
                sassi_version: decimal(fields[3], u16::MAX as u64)? as u16,
                model: bounded_ascii(fields[4], 1, 64)?,
                manufacturer_domain: bounded_ascii(fields[5], 3, 255)?,
                description: bounded_ascii(fields[6], 0, 255)?,
                maximum_packet_bytes: decimal(fields[7], ABSOLUTE_MAX_PACKET as u64)? as usize,
                maximum_filename_bytes: decimal(fields[8], 4096)? as usize,
                crc_seed: u16::from_str_radix(fields[9], 16)
                    .map_err(|_| CodecError::InvalidField)?,
            };
            if !request.manufacturer_domain.contains('.') {
                return Err(CodecError::InvalidField);
            }
            Ok(Message::ConnectionRequest(request))
        }
        4 if fields.is_empty() => Ok(Message::TimeSyncAcknowledgement),
        6 => Ok(Message::DirectoryChunk(parse_transfer(fields)?)),
        8 => Ok(Message::FileChunk(parse_transfer(fields)?)),
        14 | 30 => {
            if fields.len() != 2 {
                return Err(CodecError::InvalidField);
            }
            let data = fields[0].to_owned();
            let info_code = decimal(fields[1], u16::MAX as u64)? as u16;
            Ok(if kind == 14 {
                Message::InfoResponse { data, info_code }
            } else {
                Message::StatusNotification { data, info_code }
            })
        }
        32 => Ok(Message::IncrementalFileChunk(parse_transfer(fields)?)),
        _ => Ok(Message::Unknown { kind }),
    }
}

fn parse_transfer(fields: &[&str]) -> Result<TransferChunk, CodecError> {
    if fields.len() != 5 {
        return Err(CodecError::InvalidField);
    }
    let combined = decimal(fields[1], u8::MAX as u64)? as u8;
    Ok(TransferChunk {
        path: bounded_ascii(fields[0], 0, 4096)?,
        outcome: combined & 0x7f,
        final_chunk: combined & 0x80 != 0,
        third: bounded_ascii(fields[2], 0, 512)?,
        sequence: decimal(fields[3], u32::MAX as u64)? as u32,
        bytes: BASE64
            .decode(fields[4])
            .map_err(|_| CodecError::InvalidField)?,
    })
}

fn decimal(value: &str, maximum: u64) -> Result<u64, CodecError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CodecError::InvalidField);
    }
    value
        .parse::<u64>()
        .ok()
        .filter(|value| *value <= maximum)
        .ok_or(CodecError::InvalidField)
}

fn bounded_ascii(value: &str, minimum: usize, maximum: usize) -> Result<String, CodecError> {
    if value.len() < minimum
        || value.len() > maximum
        || !value.is_ascii()
        || value.bytes().any(|byte| !(0x20..=0x7e).contains(&byte))
    {
        Err(CodecError::InvalidField)
    } else {
        Ok(value.to_owned())
    }
}

pub fn crc16_ccitt_xmodem(input: &[u8], initial: u16) -> u16 {
    let mut crc = initial;
    for byte in input {
        crc ^= u16::from(*byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 == 0 {
                crc << 1
            } else {
                (crc << 1) ^ 0x1021
            };
        }
    }
    crc
}

pub fn encode_frame(
    kind: u8,
    elapsed_ms: u64,
    fields: &[&str],
    crc_seed: u16,
    maximum: usize,
) -> Result<Vec<u8>, CodecError> {
    if fields.iter().any(|field| {
        field
            .bytes()
            .any(|byte| !(0x20..=0x7e).contains(&byte) || matches!(byte, b'|' | b'\r'))
    }) {
        return Err(CodecError::InvalidField);
    }
    let payload = if fields.is_empty() {
        String::new()
    } else {
        format!("{}|", fields.join("|"))
    };
    let body = format!("KL*{kind}|{elapsed_ms:x}|{payload}");
    let crc = crc16_ccitt_xmodem(body.as_bytes(), crc_seed);
    let frame = format!("{body}{crc:04x}\r").into_bytes();
    if frame.len() > maximum {
        Err(CodecError::TooLarge)
    } else {
        Ok(frame)
    }
}

pub fn time_sync_frame(
    elapsed_ms: u64,
    crc_seed: u16,
    maximum: usize,
) -> Result<Vec<u8>, CodecError> {
    let now = Utc::now();
    let date = format!(
        "{:04}{:02}{:02}{}{:02}{:02}{:02}",
        now.year(),
        now.month(),
        now.day(),
        now.weekday().num_days_from_sunday(),
        now.hour(),
        now.minute(),
        now.second()
    );
    encode_frame(3, elapsed_ms, &["10", "256", &date, "1"], crc_seed, maximum)
}

pub fn info_frame(
    elapsed_ms: u64,
    crc_seed: u16,
    maximum: usize,
    code: u16,
) -> Result<Vec<u8>, CodecError> {
    encode_frame(13, elapsed_ms, &["", &code.to_string()], crc_seed, maximum)
}

pub fn directory_frame(
    elapsed_ms: u64,
    crc_seed: u16,
    maximum: usize,
    path: &str,
) -> Result<Vec<u8>, CodecError> {
    encode_frame(5, elapsed_ms, &[path, "", "1"], crc_seed, maximum)
}

pub fn file_frame(
    elapsed_ms: u64,
    crc_seed: u16,
    maximum: usize,
    path: &str,
) -> Result<Vec<u8>, CodecError> {
    encode_frame(7, elapsed_ms, &[path], crc_seed, maximum)
}

pub fn acknowledgement_frame(
    elapsed_ms: u64,
    crc_seed: u16,
    maximum: usize,
) -> Result<Vec<u8>, CodecError> {
    encode_frame(1, elapsed_ms, &[], crc_seed, maximum)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TYPE_2: &str =
        "KL*2|00A1F2|1|128|TS00000001|1|KN1007B|kaffelogic.com||4064|192|1A2B|61F7\r";

    #[test]
    fn crc_matches_the_standard_check_vector() {
        assert_eq!(crc16_ccitt_xmodem(b"123456789", 0), 0x31c3);
    }

    #[test]
    fn decodes_the_privacy_safe_verified_handshake() {
        let decoded = decode_frame(TYPE_2.as_bytes(), None, PRE_HANDSHAKE_MAX).unwrap();
        assert_eq!(decoded.elapsed_ms, 0x00a1f2);
        let Message::ConnectionRequest(request) = decoded.message else {
            panic!("connection request")
        };
        assert_eq!(request.model, "KN1007B");
        assert_eq!(request.maximum_packet_bytes, 4064);
        assert_eq!(request.crc_seed, 0x1a2b);
    }

    #[test]
    fn supports_every_fragment_boundary() {
        for split in 0..=TYPE_2.len() {
            let mut decoder = Decoder::default();
            let mut events = decoder.push(&TYPE_2.as_bytes()[..split]);
            events.extend(decoder.push(&TYPE_2.as_bytes()[split..]));
            assert_eq!(events.len(), 1);
            assert!(events[0].is_ok());
        }
    }

    #[test]
    fn rejects_crc_mutation() {
        let changed = TYPE_2.replace("|128|", "|129|");
        assert_eq!(
            decode_frame(changed.as_bytes(), None, PRE_HANDSHAKE_MAX),
            Err(CodecError::InvalidCrc)
        );
    }

    #[test]
    fn decodes_final_busy_transfer() {
        let seed = 0x1d0f;
        let frame = encode_frame(
            6,
            42,
            &["kaffelogic/roast-logs", "231", "1", "0", ""],
            seed,
            4064,
        )
        .unwrap();
        let decoded = decode_frame(&frame, Some(seed), 4064).unwrap();
        let Message::DirectoryChunk(chunk) = decoded.message else {
            panic!("directory")
        };
        assert!(chunk.final_chunk);
        assert_eq!(chunk.outcome, 103);
        assert_eq!(chunk.sequence, 0);
    }
}
