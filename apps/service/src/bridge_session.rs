use std::{
    collections::VecDeque,
    io::{self, Read, Write},
    sync::{mpsc, Arc},
    time::Duration,
};

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::Response,
};
use constant_time_eq::constant_time_eq;
use rand::random;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::mpsc as async_mpsc;

use crate::{db::Database, device::NanoDeviceManager};

pub const BRIDGE_PROTOCOL_VERSION: u8 = 1;
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const TRANSPORT_READ_TIMEOUT: Duration = Duration::from_millis(25);
const TUNNEL_QUEUE_CAPACITY: usize = 256;
pub(crate) const MAX_TUNNEL_PAYLOAD_BYTES: usize = 8_192;
const MAX_WEBSOCKET_MESSAGE_BYTES: usize = MAX_TUNNEL_PAYLOAD_BYTES + 3;
pub(crate) const USB_TO_BACKEND: u8 = 1;
pub(crate) const BACKEND_TO_USB: u8 = 2;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BridgeHello {
    pub(crate) schema_version: u8,
    pub(crate) bridge_id: String,
    pub(crate) firmware_version: String,
    pub(crate) build_id: String,
    pub(crate) claim_token: Option<String>,
    pub(crate) device_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeHelloResponse<'a> {
    pub(crate) schema_version: u8,
    pub(crate) accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) device_token: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeDiagnostics {
    schema_version: u8,
    #[serde(rename = "type")]
    message_type: String,
    uptime_ms: u64,
    boot_count: u32,
    watchdog_count: u32,
    interrupt_watchdog_count: u32,
    brownout_count: u32,
    received_bytes: u64,
    forwarded_bytes: u64,
    discarded_bytes: u64,
    overflows: u32,
    session_failures: u32,
    usb_recoveries: u32,
    high_water_bytes: u32,
}

fn parse_diagnostics(encoded: &str) -> Option<BridgeDiagnostics> {
    if encoded.len() > 2048 {
        return None;
    }
    let message: BridgeDiagnostics = serde_json::from_str(encoded).ok()?;
    (message.schema_version == 1
        && message.message_type == "diagnostics"
        && message.boot_count > 0
        && message.high_water_bytes <= 32768)
        .then_some(message)
}

pub(crate) struct Authentication {
    pub(crate) issued_device_token: Option<String>,
    pub(crate) revision: i64,
}

pub(crate) struct AcceptedBridge {
    pub(crate) hello: BridgeHello,
    pub(crate) authentication: Authentication,
}

pub(crate) fn accept_hello(
    database: &Database,
    encoded: &str,
) -> Result<AcceptedBridge, &'static str> {
    let hello: BridgeHello = serde_json::from_str(encoded).map_err(|_| "invalid_handshake")?;
    if hello.schema_version != BRIDGE_PROTOCOL_VERSION
        || !valid_bridge_id(&hello.bridge_id)
        || hello.firmware_version.is_empty()
        || hello.firmware_version.len() > 64
        || hello.build_id.is_empty()
        || hello.build_id.len() > 64
        || (hello.claim_token.is_some() == hello.device_token.is_some())
    {
        return Err("invalid_handshake");
    }
    let authentication = authenticate(database, &hello)
        .map_err(|_| "authentication_failed")?
        .ok_or("authentication_failed")?;
    Ok(AcceptedBridge {
        hello,
        authentication,
    })
}

pub(crate) fn upgrade(
    ws: WebSocketUpgrade,
    database: Database,
    device: Arc<NanoDeviceManager>,
) -> Response {
    ws.max_message_size(MAX_WEBSOCKET_MESSAGE_BYTES)
        .max_frame_size(MAX_WEBSOCKET_MESSAGE_BYTES)
        .on_upgrade(move |socket| websocket_session(socket, database, device))
}

async fn websocket_session(
    mut socket: WebSocket,
    database: Database,
    device: Arc<NanoDeviceManager>,
) {
    let first = match tokio::time::timeout(HANDSHAKE_TIMEOUT, socket.recv()).await {
        Ok(Some(Ok(Message::Text(encoded)))) => encoded,
        _ => {
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };
    let accepted = accept_hello(&database, &first);
    let response = match &accepted {
        Ok(accepted) => BridgeHelloResponse {
            schema_version: BRIDGE_PROTOCOL_VERSION,
            accepted: true,
            device_token: accepted.authentication.issued_device_token.as_deref(),
            error: None,
        },
        Err(error) => BridgeHelloResponse {
            schema_version: BRIDGE_PROTOCOL_VERSION,
            accepted: false,
            device_token: None,
            error: Some(error),
        },
    };
    if let Ok(encoded) = serde_json::to_string(&response) {
        if socket.send(Message::Text(encoded.into())).await.is_err() {
            return;
        }
    } else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }
    let accepted = match accepted {
        Ok(accepted) => accepted,
        Err(_) => {
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    let (nano_sender, nano_receiver) = mpsc::sync_channel(TUNNEL_QUEUE_CAPACITY);
    let (backend_sender, mut backend_receiver) =
        async_mpsc::channel::<Vec<u8>>(TUNNEL_QUEUE_CAPACITY);
    let transport = WebSocketBridgeTransport::new(
        nano_receiver,
        backend_sender,
        database,
        accepted.hello.bridge_id.clone(),
        accepted.authentication.revision,
    );
    tracing::info!(event = "bridge_connected", bridge_id = %accepted.hello.bridge_id, transport = "websocket");
    let bridge_id = accepted.hello.bridge_id;
    device.attach_bridge(bridge_id.clone(), transport);
    let mut last_diagnostics: Option<std::time::Instant> = None;

    loop {
        tokio::select! {
            message = socket.recv() => match message {
                Some(Ok(Message::Binary(record))) => {
                    let payload = match decode_usb_record(&record) {
                        Ok(payload) => payload.to_vec(),
                        Err(_) => {
                            let _ = socket.send(Message::Close(None)).await;
                            return;
                        }
                    };
                    if nano_sender.try_send(payload).is_err() {
                        let _ = socket.send(Message::Close(None)).await;
                        return;
                    }
                }
                Some(Ok(Message::Ping(payload))) => {
                    if socket.send(Message::Pong(payload)).await.is_err() {
                        return;
                    }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                Some(Ok(Message::Text(encoded))) => {
                    let Some(diagnostic) = parse_diagnostics(&encoded) else {
                        let _ = socket.send(Message::Close(None)).await;
                        return;
                    };
                    // Numeric-only, authenticated diagnostics; bound log volume.
                    if last_diagnostics.is_none_or(|last| last.elapsed() >= Duration::from_secs(5)) {
                        last_diagnostics = Some(std::time::Instant::now());
                        tracing::info!(event = "bridge_diagnostics", bridge_id = %bridge_id,
                            uptime_ms = diagnostic.uptime_ms, boot_count = diagnostic.boot_count,
                            watchdog_count = diagnostic.watchdog_count,
                            interrupt_watchdog_count = diagnostic.interrupt_watchdog_count,
                            brownout_count = diagnostic.brownout_count,
                            received_bytes = diagnostic.received_bytes,
                            forwarded_bytes = diagnostic.forwarded_bytes,
                            discarded_bytes = diagnostic.discarded_bytes,
                            overflows = diagnostic.overflows,
                            session_failures = diagnostic.session_failures,
                            usb_recoveries = diagnostic.usb_recoveries,
                            high_water_bytes = diagnostic.high_water_bytes);
                    }
                }
            },
            record = backend_receiver.recv() => match record {
                Some(record) => {
                    if socket.send(Message::Binary(record.into())).await.is_err() {
                        return;
                    }
                }
                None => return,
            },
        }
    }
}

struct WebSocketBridgeTransport {
    inbound: mpsc::Receiver<Vec<u8>>,
    decoded: VecDeque<u8>,
    outbound: async_mpsc::Sender<Vec<u8>>,
    database: Database,
    bridge_id: String,
    revision: i64,
}

impl WebSocketBridgeTransport {
    fn new(
        inbound: mpsc::Receiver<Vec<u8>>,
        outbound: async_mpsc::Sender<Vec<u8>>,
        database: Database,
        bridge_id: String,
        revision: i64,
    ) -> Self {
        Self {
            inbound,
            decoded: VecDeque::new(),
            outbound,
            database,
            bridge_id,
            revision,
        }
    }
}

impl Read for WebSocketBridgeTransport {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.decoded.is_empty() {
            match self.inbound.recv_timeout(TRANSPORT_READ_TIMEOUT) {
                Ok(bytes) => self.decoded.extend(bytes),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    return Err(io::Error::from(io::ErrorKind::TimedOut));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "bridge disconnected",
                    ));
                }
            }
        }
        let count = output.len().min(self.decoded.len());
        for slot in &mut output[..count] {
            *slot = self.decoded.pop_front().expect("decoded length checked");
        }
        Ok(count)
    }
}

impl Write for WebSocketBridgeTransport {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        if bytes.len() > MAX_TUNNEL_PAYLOAD_BYTES || !allowed_read_only_sassi_frame(bytes) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "bridge rejected an unverified Nano command",
            ));
        }
        self.outbound
            .blocking_send(encode_backend_record(bytes)?)
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "bridge disconnected"))?;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for WebSocketBridgeTransport {
    fn drop(&mut self) {
        let now = now_ms();
        let _ = self.database.connection().execute(
            "UPDATE tan_bridges SET state='offline', updated_at_ms=?, revision=revision+1
              WHERE bridge_id=? AND revision=?",
            params![now, self.bridge_id, self.revision],
        );
        tracing::info!(event = "bridge_disconnected", bridge_id = %self.bridge_id, transport = "websocket");
    }
}

fn decode_usb_record(record: &[u8]) -> io::Result<&[u8]> {
    if record.len() < 4 || record[0] != USB_TO_BACKEND {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid bridge record",
        ));
    }
    let length = u16::from_be_bytes([record[1], record[2]]) as usize;
    if length == 0 || length > MAX_TUNNEL_PAYLOAD_BYTES || record.len() != length + 3 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid bridge record length",
        ));
    }
    Ok(&record[3..])
}

fn encode_backend_record(payload: &[u8]) -> io::Result<Vec<u8>> {
    let length = u16::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "bridge frame too large"))?;
    let mut record = Vec::with_capacity(payload.len() + 3);
    record.push(BACKEND_TO_USB);
    record.extend_from_slice(&length.to_be_bytes());
    record.extend_from_slice(payload);
    Ok(record)
}

pub(crate) fn allowed_read_only_sassi_frame(bytes: &[u8]) -> bool {
    if bytes.len() < 8
        || !bytes.starts_with(b"KL*")
        || bytes.last() != Some(&b'\r')
        || bytes[..bytes.len() - 1]
            .iter()
            .any(|byte| !(0x20..=0x7e).contains(byte))
    {
        return false;
    }
    let Some(separator) = bytes[3..]
        .iter()
        .position(|byte| *byte == b'|')
        .map(|index| index + 3)
    else {
        return false;
    };
    let Ok(message_type) = std::str::from_utf8(&bytes[3..separator])
        .ok()
        .and_then(|value| value.parse::<u8>().ok())
        .ok_or(())
    else {
        return false;
    };
    matches!(message_type, 1 | 3 | 5 | 7 | 13)
}

pub(crate) fn authenticate(
    database: &Database,
    hello: &BridgeHello,
) -> Result<Option<Authentication>, rusqlite::Error> {
    let now = now_ms();
    let mut connection = database.connection();
    let transaction = connection.transaction()?;
    let result = if let Some(claim_token) = &hello.claim_token {
        if !valid_token(claim_token) {
            None
        } else {
            let claim_id: Option<i64> = transaction
                .query_row(
                    "SELECT id FROM bridge_claims
                      WHERE token_sha256=? AND consumed_at_ms IS NULL AND expires_at_ms>=?",
                    params![sha256_hex(claim_token), now],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(claim_id) = claim_id {
                let device_token = hex::encode(random::<[u8; 32]>());
                transaction.execute(
                    "INSERT INTO tan_bridges(
                       bridge_id, device_token_sha256, firmware_version, build_id,
                       state, last_seen_at_ms, created_at_ms, updated_at_ms
                     ) VALUES (?, ?, ?, ?, 'connected', ?, ?, ?)
                     ON CONFLICT(bridge_id) DO UPDATE SET
                       device_token_sha256=excluded.device_token_sha256,
                       firmware_version=excluded.firmware_version,
                       build_id=excluded.build_id,
                       revoked_at_ms=NULL,
                       state='connected', last_seen_at_ms=excluded.last_seen_at_ms,
                       updated_at_ms=excluded.updated_at_ms, revision=tan_bridges.revision+1",
                    params![
                        hello.bridge_id,
                        sha256_hex(&device_token),
                        hello.firmware_version,
                        hello.build_id,
                        now,
                        now,
                        now
                    ],
                )?;
                transaction.execute(
                    "UPDATE bridge_claims SET consumed_at_ms=? WHERE id=?",
                    params![now, claim_id],
                )?;
                let revision = transaction.query_row(
                    "SELECT revision FROM tan_bridges WHERE bridge_id=?",
                    [&hello.bridge_id],
                    |row| row.get(0),
                )?;
                Some(Authentication {
                    issued_device_token: Some(device_token),
                    revision,
                })
            } else {
                None
            }
        }
    } else if let Some(device_token) = &hello.device_token {
        if !valid_token(device_token) {
            None
        } else {
            let expected: Option<String> = transaction
                .query_row(
                    "SELECT device_token_sha256 FROM tan_bridges
                      WHERE bridge_id=? AND revoked_at_ms IS NULL",
                    [&hello.bridge_id],
                    |row| row.get(0),
                )
                .optional()?;
            let presented = sha256_hex(device_token);
            if expected.as_deref().is_some_and(|value| {
                value.len() == presented.len()
                    && constant_time_eq(value.as_bytes(), presented.as_bytes())
            }) {
                transaction.execute(
                    "UPDATE tan_bridges SET firmware_version=?, build_id=?, state='connected',
                            last_seen_at_ms=?, updated_at_ms=?, revision=revision+1
                      WHERE bridge_id=?",
                    params![
                        hello.firmware_version,
                        hello.build_id,
                        now,
                        now,
                        hello.bridge_id
                    ],
                )?;
                let revision = transaction.query_row(
                    "SELECT revision FROM tan_bridges WHERE bridge_id=?",
                    [&hello.bridge_id],
                    |row| row.get(0),
                )?;
                Some(Authentication {
                    issued_device_token: None,
                    revision,
                })
            } else {
                None
            }
        }
    } else {
        None
    };
    if result.is_some() {
        transaction.commit()?;
    }
    Ok(result)
}

pub(crate) fn valid_bridge_id(value: &str) -> bool {
    value.len() == 26
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(&byte))
}

pub(crate) fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod diagnostic_tests {
    use super::*;
    #[test]
    fn diagnostic_contract_is_bounded_numeric_and_strict() {
        let mut value = serde_json::json!({"schemaVersion":1,"type":"diagnostics",
            "uptimeMs":1234,"bootCount":2,"watchdogCount":0,"interruptWatchdogCount":0,
            "brownoutCount":0,"receivedBytes":100,"forwardedBytes":90,"discardedBytes":10,
            "overflows":0,"sessionFailures":1,"usbRecoveries":1,"highWaterBytes":512});
        assert!(parse_diagnostics(&value.to_string()).is_some());
        value["secret"] = "unexpected".into();
        assert!(parse_diagnostics(&value.to_string()).is_none());
        value.as_object_mut().unwrap().remove("secret");
        value["highWaterBytes"] = 32769.into();
        assert!(parse_diagnostics(&value.to_string()).is_none());
        value["highWaterBytes"] = (-1).into();
        assert!(parse_diagnostics(&value.to_string()).is_none());
        assert!(parse_diagnostics(&" ".repeat(2049)).is_none());
    }
}
