use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use parking_lot::RwLock;
use serialport::SerialPortType;

use crate::{contract::DeviceSnapshot, db::Database};

const KAFFELOGIC_VENDOR_ID: u16 = 0x2e8a;
const KAFFELOGIC_PRODUCT_ID: u16 = 0x000a;

pub struct NanoDeviceManager {
    snapshot: Arc<RwLock<DeviceSnapshot>>,
    stopped: Arc<AtomicBool>,
}

impl NanoDeviceManager {
    pub fn start(_database: Database) -> Self {
        let snapshot = Arc::new(RwLock::new(disconnected("starting")));
        let stopped = Arc::new(AtomicBool::new(false));
        let worker_snapshot = snapshot.clone();
        let worker_stopped = stopped.clone();
        thread::Builder::new()
            .name("tan-studio-device-discovery".into())
            .spawn(move || {
                while !worker_stopped.load(Ordering::Acquire) {
                    refresh_snapshot(&worker_snapshot);
                    for _ in 0..15 {
                        if worker_stopped.load(Ordering::Acquire) {
                            return;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                }
            })
            .expect("device discovery worker");
        Self { snapshot, stopped }
    }

    pub fn snapshot(&self) -> DeviceSnapshot {
        self.snapshot.read().clone()
    }

    pub fn refresh(&self) {
        refresh_snapshot(&self.snapshot);
    }

    pub fn synchronize(&self) -> Result<(), &'static str> {
        if self.snapshot.read().connection != "connected" {
            return Err("device_not_connected");
        }
        Err("device_session_negotiating")
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }
}

fn refresh_snapshot(snapshot: &RwLock<DeviceSnapshot>) {
    let ports = match serialport::available_ports() {
        Ok(ports) => ports,
        Err(_) => {
            *snapshot.write() = failed("enumeration_failed");
            return;
        }
    };
    let matches = ports
        .iter()
        .filter(|port| {
            matches!(
                &port.port_type,
                SerialPortType::UsbPort(usb)
                    if usb.vid == KAFFELOGIC_VENDOR_ID && usb.pid == KAFFELOGIC_PRODUCT_ID
            )
        })
        .count();
    *snapshot.write() = match matches {
        0 => disconnected("nano_not_found"),
        1 => DeviceSnapshot {
            state: "ready".into(),
            reason: Some("awaiting_sassi_handshake".into()),
            connection: "reconnecting".into(),
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
            last_synced_at: None,
            read_only: true,
        },
        _ => failed("multiple_cdc_candidates"),
    };
}

fn disconnected(reason: &str) -> DeviceSnapshot {
    DeviceSnapshot {
        state: "ready".into(),
        reason: Some(reason.into()),
        connection: "disconnected".into(),
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
        last_synced_at: None,
        read_only: true,
    }
}

fn failed(reason: &str) -> DeviceSnapshot {
    DeviceSnapshot {
        state: "failed".into(),
        reason: Some(reason.into()),
        ..disconnected(reason)
    }
}
