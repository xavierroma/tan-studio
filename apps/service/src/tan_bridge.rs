//! Typed, hardware-free Tan Bridge contract simulator.
//!
//! This module deliberately contains no discovery, socket, USB, or device-write
//! code. It lets a future `TanBridgeRoasterLink` adapter develop against the
//! versioned native contract before the Nano hardware gate passes.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const BRIDGE_STATUS_PATH: &str = "/bridge/v1/status";
pub const BRIDGE_FILES_PATH: &str = "/bridge/v1/files";
pub const BRIDGE_FILE_PATH: &str = "/bridge/v1/files/{hash}";
pub const BRIDGE_EVENTS_PATH: &str = "/bridge/v1/events";
pub const BRIDGE_SYNCHRONIZE_PATH: &str = "/bridge/v1/synchronize";

pub const BRIDGE_OPERATIONS: [BridgeOperation; 5] = [
    BridgeOperation::new("GET", BRIDGE_STATUS_PATH, "getBridgeStatus"),
    BridgeOperation::new("GET", BRIDGE_FILES_PATH, "listBridgeFiles"),
    BridgeOperation::new("GET", BRIDGE_FILE_PATH, "downloadBridgeFile"),
    BridgeOperation::new("GET", BRIDGE_EVENTS_PATH, "observeBridgeEvents"),
    BridgeOperation::new("POST", BRIDGE_SYNCHRONIZE_PATH, "synchronizeBridge"),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BridgeOperation {
    pub method: &'static str,
    pub path: &'static str,
    pub operation_id: &'static str,
}

impl BridgeOperation {
    const fn new(method: &'static str, path: &'static str, operation_id: &'static str) -> Self {
        Self {
            method,
            path,
            operation_id,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeUsbState {
    Booting,
    UsbDetached,
    UsbEnumerated,
    Observing,
    ReadOnlyReady,
    Recovering,
    Faulted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeBuildIdentity {
    pub firmware_version: String,
    pub git_commit: String,
    pub esp_idf_version: String,
    pub binary_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeNanoCapabilities {
    pub model: String,
    pub platform: u16,
    pub capability_bits: u32,
    pub sassi_version: u16,
    pub maximum_packet_bytes: u16,
    pub maximum_filename_bytes: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSpoolBounds {
    pub low_cursor: u64,
    pub high_cursor: u64,
    pub capacity_bytes: u32,
    pub used_bytes: u32,
    pub retention_gap: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFeatureFlags {
    pub sassi_transmit: bool,
    pub wifi: bool,
    pub api: bool,
    pub pairing: bool,
    pub ota: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub schema_version: u16,
    pub bridge_id: String,
    pub boot_id: String,
    pub uptime_ms: u64,
    pub usb_state: BridgeUsbState,
    pub nano: Option<BridgeNanoCapabilities>,
    pub spool: BridgeSpoolBounds,
    pub features: BridgeFeatureFlags,
    pub build: BridgeBuildIdentity,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeFileKind {
    Profile,
    Log,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFileSummary {
    pub kind: BridgeFileKind,
    pub path: String,
    pub size_bytes: u64,
    pub modified_evidence: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFilePage {
    pub items: Vec<BridgeFileSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeSynchronizeReason {
    Startup,
    User,
    Reconnect,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeSynchronizationState {
    Accepted,
    Running,
    Complete,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSynchronizeReceipt {
    pub job_id: String,
    pub state: BridgeSynchronizationState,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BridgeFileBlob {
    pub sha256: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum BridgeMockError {
    #[error("bridge file was not found")]
    FileNotFound,
    #[error("requested range is invalid")]
    InvalidRange,
    #[error("idempotency key is invalid")]
    InvalidIdempotencyKey,
}

#[derive(Clone, Debug)]
pub struct BridgeMockClient {
    status: BridgeStatus,
    files: Vec<BridgeFileSummary>,
    blobs: BTreeMap<String, Vec<u8>>,
    synchronization_receipts: BTreeMap<String, BridgeSynchronizeReceipt>,
    next_job: u64,
}

impl BridgeMockClient {
    pub fn new(status: BridgeStatus) -> Self {
        Self {
            status,
            files: Vec::new(),
            blobs: BTreeMap::new(),
            synchronization_receipts: BTreeMap::new(),
            next_job: 1,
        }
    }

    pub fn status(&self) -> BridgeStatus {
        self.status.clone()
    }

    pub fn add_file(&mut self, summary: BridgeFileSummary, bytes: Vec<u8>) {
        self.blobs.insert(summary.sha256.clone(), bytes);
        self.files.push(summary);
    }

    pub fn list_files(&self, offset: usize, limit: usize) -> BridgeFilePage {
        let bounded_limit = limit.clamp(1, 100);
        let end = offset.saturating_add(bounded_limit).min(self.files.len());
        let items = self.files.get(offset..end).unwrap_or_default().to_vec();
        let next_cursor = (end < self.files.len()).then(|| end.to_string());
        BridgeFilePage { items, next_cursor }
    }

    pub fn download_file_range(
        &self,
        sha256: &str,
        start: usize,
        end_exclusive: usize,
    ) -> Result<BridgeFileBlob, BridgeMockError> {
        let bytes = self
            .blobs
            .get(sha256)
            .ok_or(BridgeMockError::FileNotFound)?;
        if start >= end_exclusive || end_exclusive > bytes.len() || end_exclusive - start > 65_536 {
            return Err(BridgeMockError::InvalidRange);
        }
        Ok(BridgeFileBlob {
            sha256: sha256.to_owned(),
            bytes: bytes[start..end_exclusive].to_vec(),
        })
    }

    pub fn synchronize(
        &mut self,
        idempotency_key: &str,
        _reason: BridgeSynchronizeReason,
    ) -> Result<BridgeSynchronizeReceipt, BridgeMockError> {
        if !(16..=128).contains(&idempotency_key.len()) {
            return Err(BridgeMockError::InvalidIdempotencyKey);
        }
        if let Some(existing) = self.synchronization_receipts.get(idempotency_key) {
            let mut replayed = existing.clone();
            replayed.replayed = true;
            return Ok(replayed);
        }
        let receipt = BridgeSynchronizeReceipt {
            job_id: format!("00000000-0000-0000-0000-{:012}", self.next_job),
            state: BridgeSynchronizationState::Accepted,
            replayed: false,
        };
        self.next_job += 1;
        self.synchronization_receipts
            .insert(idempotency_key.to_owned(), receipt.clone());
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status() -> BridgeStatus {
        BridgeStatus {
            schema_version: 1,
            bridge_id: "aaaaaaaaaaaaaaaa".into(),
            boot_id: "00000000-0000-0000-0000-000000000001".into(),
            uptime_ms: 0,
            usb_state: BridgeUsbState::UsbDetached,
            nano: None,
            spool: BridgeSpoolBounds {
                low_cursor: 0,
                high_cursor: 0,
                capacity_bytes: 0x3a0000,
                used_bytes: 0,
                retention_gap: false,
            },
            features: BridgeFeatureFlags {
                sassi_transmit: false,
                wifi: false,
                api: false,
                pairing: false,
                ota: false,
            },
            build: BridgeBuildIdentity {
                firmware_version: "test".into(),
                git_commit: "0".repeat(40),
                esp_idf_version: "5.5.5".into(),
                binary_sha256: "0".repeat(64),
            },
        }
    }

    #[test]
    fn operations_match_the_native_contract() {
        assert_eq!(BRIDGE_OPERATIONS.len(), 5);
        assert!(BRIDGE_OPERATIONS
            .iter()
            .all(|operation| !operation.path.contains("commands")));
    }

    #[test]
    fn simulator_is_bounded_and_idempotent() {
        let mut client = BridgeMockClient::new(status());
        client.add_file(
            BridgeFileSummary {
                kind: BridgeFileKind::Log,
                path: "kaffelogic/roast-logs/log0001.klog".into(),
                size_bytes: 4,
                modified_evidence: "202607186184617".into(),
                sha256: "a".repeat(64),
            },
            vec![1, 2, 3, 4],
        );
        assert_eq!(client.list_files(0, 500).items.len(), 1);
        assert_eq!(
            client
                .download_file_range(&"a".repeat(64), 1, 3)
                .unwrap()
                .bytes,
            vec![2, 3]
        );

        let first = client
            .synchronize("stable-key-0000001", BridgeSynchronizeReason::Startup)
            .unwrap();
        let replay = client
            .synchronize("stable-key-0000001", BridgeSynchronizeReason::User)
            .unwrap();
        assert!(!first.replayed);
        assert!(replay.replayed);
        assert_eq!(first.job_id, replay.job_id);
    }
}
