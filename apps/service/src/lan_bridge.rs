use std::{
    collections::VecDeque,
    io::{self, Read, Write},
    net::TcpStream as StdTcpStream,
    time::Duration,
};

use rand::random;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    time::timeout,
};

use crate::{db::Database, device::NanoDeviceManager};

pub const BRIDGE_PROTOCOL_VERSION: u8 = 1;
pub const DEFAULT_BRIDGE_PORT: u16 = 8081;
const HANDSHAKE_LIMIT_BYTES: usize = 2_048;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const IO_TIMEOUT: Duration = Duration::from_millis(250);
const MAX_TUNNEL_PAYLOAD_BYTES: usize = 8_192;
const USB_TO_BACKEND: u8 = 1;
const BACKEND_TO_USB: u8 = 2;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeHello {
    schema_version: u8,
    bridge_id: String,
    firmware_version: String,
    build_id: String,
    claim_token: Option<String>,
    device_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeHelloResponse<'a> {
    schema_version: u8,
    accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    device_token: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

#[derive(Debug, Clone)]
pub struct CreatedBridgeClaim {
    pub token: String,
    pub expires_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct StoredBridge {
    pub id: i64,
    pub bridge_id: String,
    pub firmware_version: String,
    pub build_id: String,
    pub state: String,
    pub last_seen_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

struct Authentication {
    issued_device_token: Option<String>,
    revision: i64,
}

pub fn create_claim(database: &Database) -> Result<CreatedBridgeClaim, rusqlite::Error> {
    let token = hex::encode(random::<[u8; 32]>());
    let now = now_ms();
    let expires_at_ms = now + 10 * 60 * 1_000;
    database.connection().execute(
        "INSERT INTO bridge_claims(token_sha256, expires_at_ms, created_at_ms)
         VALUES (?, ?, ?)",
        params![sha256_hex(&token), expires_at_ms, now],
    )?;
    Ok(CreatedBridgeClaim {
        token,
        expires_at_ms,
    })
}

pub fn list_bridges(database: &Database) -> Result<Vec<StoredBridge>, rusqlite::Error> {
    let connection = database.connection();
    let mut statement = connection.prepare(
        "SELECT id, bridge_id, firmware_version, build_id, state,
                last_seen_at_ms, created_at_ms, updated_at_ms
           FROM tan_bridges
          ORDER BY coalesce(last_seen_at_ms, 0) DESC, id DESC",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok(StoredBridge {
                id: row.get(0)?,
                bridge_id: row.get(1)?,
                firmware_version: row.get(2)?,
                build_id: row.get(3)?,
                state: row.get(4)?,
                last_seen_at_ms: row.get(5)?,
                created_at_ms: row.get(6)?,
                updated_at_ms: row.get(7)?,
            })
        })?
        .collect();
    rows
}

pub async fn serve(
    listener: TcpListener,
    database: Database,
    device: std::sync::Arc<NanoDeviceManager>,
) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let local_peer = match peer.ip() {
                    std::net::IpAddr::V4(address) => {
                        address.is_private() || address.is_loopback() || address.is_link_local()
                    }
                    std::net::IpAddr::V6(address) => {
                        address.is_loopback()
                            || address.is_unique_local()
                            || address.is_unicast_link_local()
                    }
                };
                if !local_peer {
                    tracing::warn!(event = "bridge_peer_rejected", peer = %peer.ip());
                    continue;
                }
                let database = database.clone();
                let device = device.clone();
                tokio::spawn(async move {
                    if let Err(reason) = accept_bridge(stream, database, device).await {
                        tracing::warn!(event = "bridge_session_rejected", reason);
                    }
                });
            }
            Err(error) => tracing::error!(event = "bridge_accept_failed", %error),
        }
    }
}

async fn accept_bridge(
    stream: TcpStream,
    database: Database,
    device: std::sync::Arc<NanoDeviceManager>,
) -> Result<(), &'static str> {
    stream
        .set_nodelay(true)
        .map_err(|_| "socket_setup_failed")?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let length = timeout(HANDSHAKE_TIMEOUT, reader.read_line(&mut line))
        .await
        .map_err(|_| "handshake_timeout")?
        .map_err(|_| "handshake_read_failed")?;
    if length == 0 || length > HANDSHAKE_LIMIT_BYTES || !line.ends_with('\n') {
        return Err("invalid_handshake");
    }
    let hello: BridgeHello =
        serde_json::from_str(line.trim_end()).map_err(|_| "invalid_handshake")?;
    if hello.schema_version != BRIDGE_PROTOCOL_VERSION
        || !valid_bridge_id(&hello.bridge_id)
        || hello.firmware_version.is_empty()
        || hello.firmware_version.len() > 64
        || hello.build_id.is_empty()
        || hello.build_id.len() > 64
        || (hello.claim_token.is_some() == hello.device_token.is_some())
    {
        return reject(reader.into_inner(), "invalid_handshake").await;
    }
    let authentication = authenticate(&database, &hello).map_err(|_| "authentication_failed")?;
    let Some(authentication) = authentication else {
        return reject(reader.into_inner(), "authentication_failed").await;
    };

    let response = BridgeHelloResponse {
        schema_version: BRIDGE_PROTOCOL_VERSION,
        accepted: true,
        device_token: authentication.issued_device_token.as_deref(),
        error: None,
    };
    let mut stream = reader.into_inner();
    let mut encoded = serde_json::to_vec(&response).map_err(|_| "handshake_encode_failed")?;
    encoded.push(b'\n');
    stream
        .write_all(&encoded)
        .await
        .map_err(|_| "handshake_write_failed")?;
    stream.flush().await.map_err(|_| "handshake_write_failed")?;
    let standard = stream.into_std().map_err(|_| "socket_setup_failed")?;
    standard
        .set_nonblocking(false)
        .map_err(|_| "socket_setup_failed")?;
    standard
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|_| "socket_setup_failed")?;
    standard
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "socket_setup_failed")?;

    tracing::info!(event = "bridge_connected", bridge_id = %hello.bridge_id);
    device.attach_bridge(
        hello.bridge_id.clone(),
        BridgeTransport::new(standard, database, hello.bridge_id, authentication.revision),
    );
    Ok(())
}

async fn reject(mut stream: TcpStream, error: &'static str) -> Result<(), &'static str> {
    let response = BridgeHelloResponse {
        schema_version: BRIDGE_PROTOCOL_VERSION,
        accepted: false,
        device_token: None,
        error: Some(error),
    };
    if let Ok(mut encoded) = serde_json::to_vec(&response) {
        encoded.push(b'\n');
        let _ = stream.write_all(&encoded).await;
    }
    Err(error)
}

fn authenticate(
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
                    "SELECT device_token_sha256 FROM tan_bridges WHERE bridge_id=?",
                    [&hello.bridge_id],
                    |row| row.get(0),
                )
                .optional()?;
            let presented = sha256_hex(device_token);
            if expected.as_deref().is_some_and(|value| {
                value.len() == presented.len()
                    && constant_time_eq::constant_time_eq(value.as_bytes(), presented.as_bytes())
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

pub struct BridgeTransport {
    stream: StdTcpStream,
    network_buffer: Vec<u8>,
    decoded: VecDeque<u8>,
    database: Database,
    bridge_id: String,
    revision: i64,
}

impl BridgeTransport {
    fn new(stream: StdTcpStream, database: Database, bridge_id: String, revision: i64) -> Self {
        Self {
            stream,
            network_buffer: Vec::with_capacity(MAX_TUNNEL_PAYLOAD_BYTES + 3),
            decoded: VecDeque::new(),
            database,
            bridge_id,
            revision,
        }
    }

    fn decode_available(&mut self) -> io::Result<()> {
        while self.network_buffer.len() >= 3 {
            let kind = self.network_buffer[0];
            let length =
                u16::from_be_bytes([self.network_buffer[1], self.network_buffer[2]]) as usize;
            if length == 0 || length > MAX_TUNNEL_PAYLOAD_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid bridge frame length",
                ));
            }
            if self.network_buffer.len() < length + 3 {
                break;
            }
            if kind != USB_TO_BACKEND {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid bridge frame kind",
                ));
            }
            self.decoded
                .extend(self.network_buffer[3..3 + length].iter().copied());
            self.network_buffer.drain(..3 + length);
        }
        Ok(())
    }
}

impl Read for BridgeTransport {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        loop {
            self.decode_available()?;
            if !self.decoded.is_empty() {
                let count = output.len().min(self.decoded.len());
                for slot in &mut output[..count] {
                    *slot = self.decoded.pop_front().expect("decoded length checked");
                }
                return Ok(count);
            }
            let mut chunk = [0u8; 4_096];
            match self.stream.read(&mut chunk) {
                Ok(0) => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "bridge disconnected",
                    ))
                }
                Ok(length) => self.network_buffer.extend_from_slice(&chunk[..length]),
                Err(error) => return Err(error),
            }
        }
    }
}

impl Write for BridgeTransport {
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
        let length = u16::try_from(bytes.len())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "bridge frame too large"))?;
        self.stream.write_all(&[BACKEND_TO_USB])?;
        self.stream.write_all(&length.to_be_bytes())?;
        self.stream.write_all(bytes)?;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stream.flush()
    }
}

impl Drop for BridgeTransport {
    fn drop(&mut self) {
        let now = now_ms();
        let _ = self.database.connection().execute(
            "UPDATE tan_bridges SET state='offline', updated_at_ms=?, revision=revision+1
              WHERE bridge_id=? AND revision=?",
            params![now, self.bridge_id, self.revision],
        );
        tracing::info!(event = "bridge_disconnected", bridge_id = %self.bridge_id);
    }
}

fn allowed_read_only_sassi_frame(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || !bytes.starts_with(b"KL") || bytes.last() != Some(&b'\r') {
        return false;
    }
    let Some(comma) = bytes[2..]
        .iter()
        .position(|byte| *byte == b',')
        .map(|index| index + 2)
    else {
        return false;
    };
    let Ok(message_type) = std::str::from_utf8(&bytes[2..comma])
        .ok()
        .and_then(|value| value.parse::<u8>().ok())
        .ok_or(())
    else {
        return false;
    };
    matches!(message_type, 1 | 3 | 5 | 7 | 13)
}

fn valid_bridge_id(value: &str) -> bool {
    value.len() == 26
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(&byte))
}

fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connected_socket_pair() -> (StdTcpStream, StdTcpStream) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let client = StdTcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (server, _) = listener.accept().unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        server
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        (client, server)
    }

    #[test]
    fn bridge_claim_is_single_use_and_tokens_are_not_stored_in_plaintext() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
        let claim = create_claim(&database).unwrap();
        let hello = BridgeHello {
            schema_version: 1,
            bridge_id: "abcdefghijklmnopqrstuvwxyz".into(),
            firmware_version: "0.2.0-local".into(),
            build_id: "test".into(),
            claim_token: Some(claim.token.clone()),
            device_token: None,
        };
        let first = authenticate(&database, &hello).unwrap().unwrap();
        assert_eq!(first.issued_device_token.as_deref().map(str::len), Some(64));
        assert!(authenticate(&database, &hello).unwrap().is_none());
        let connection = database.connection();
        let stored: String = connection
            .query_row("SELECT token_sha256 FROM bridge_claims", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_ne!(stored, claim.token);
    }

    #[test]
    fn tunnel_only_allows_verified_read_only_sassi_types() {
        for message_type in [1, 3, 5, 7, 13] {
            assert!(allowed_read_only_sassi_frame(
                format!("KL{message_type},0,00,0000\r").as_bytes()
            ));
        }
        assert!(!allowed_read_only_sassi_frame(b"KL9,0,00,0000\r"));
        assert!(!allowed_read_only_sassi_frame(b"not-sassi\r"));
    }

    #[test]
    fn tunnel_reassembles_fragmented_early_usb_bytes_and_frames_backend_output() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
        let (mut bridge, service) = connected_socket_pair();
        let payload = b"KL2,verified-bootstrap-frame\r";
        let length = u16::try_from(payload.len()).unwrap().to_be_bytes();

        bridge.write_all(&[USB_TO_BACKEND]).unwrap();
        bridge.write_all(&length[..1]).unwrap();
        bridge.write_all(&length[1..]).unwrap();
        bridge.write_all(&payload[..7]).unwrap();
        bridge.write_all(&payload[7..]).unwrap();

        let mut transport =
            BridgeTransport::new(service, database, "abcdefghijklmnopqrstuvwxyz".into(), 1);
        let mut decoded = vec![0; payload.len()];
        transport.read_exact(&mut decoded).unwrap();
        assert_eq!(decoded, payload);

        let response = b"KL1,0,00,0000\r";
        transport.write_all(response).unwrap();
        transport.flush().unwrap();
        let mut framed = vec![0; response.len() + 3];
        bridge.read_exact(&mut framed).unwrap();
        assert_eq!(framed[0], BACKEND_TO_USB);
        assert_eq!(
            u16::from_be_bytes([framed[1], framed[2]]) as usize,
            response.len()
        );
        assert_eq!(&framed[3..], response);
    }

    #[test]
    fn tunnel_rejects_non_usb_input_without_exposing_payload() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.sqlite")).unwrap();
        let (mut bridge, service) = connected_socket_pair();
        bridge.write_all(&[BACKEND_TO_USB, 0, 1, 0]).unwrap();
        let mut transport =
            BridgeTransport::new(service, database, "abcdefghijklmnopqrstuvwxyz".into(), 1);

        let error = transport.read(&mut [0; 8]).unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(error.to_string(), "invalid bridge frame kind");
    }
}
