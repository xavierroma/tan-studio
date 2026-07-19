use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use thiserror::Error;
use tokio::{
    sync::mpsc::Receiver,
    time::{timeout_at, Instant},
};

const SIDECAR_NAME: &str = "tan-studio-service";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BOOTSTRAP_RECORD_BYTES: usize = 4 * 1024;
const PACKAGED_UI_ORIGIN: &str = "tauri://localhost";
const DEVELOPMENT_UI_ORIGIN: &str = "http://127.0.0.1:1420";

#[derive(Debug, Error)]
pub enum CompanionError {
    #[error("application data directory is unavailable")]
    AppDataUnavailable(#[source] tauri::Error),
    #[error("application data directory could not be prepared")]
    AppDataPrepare(#[source] std::io::Error),
    #[error("secure launch token generation failed")]
    Random(#[source] getrandom::Error),
    #[error("companion process could not be started")]
    Spawn,
    #[error("companion launch channel could not be initialized")]
    LaunchChannel,
    #[error("companion launch record could not be serialized")]
    LaunchSerialization(#[source] serde_json::Error),
    #[error("development companion source is unavailable")]
    DevelopmentSource,
    #[error("companion startup timed out")]
    Timeout,
    #[error("companion exited before startup completed")]
    EarlyExit,
    #[error("companion bootstrap is invalid")]
    InvalidBootstrap,
    #[error("webview bootstrap could not be serialized")]
    BootstrapSerialization(#[source] serde_json::Error),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireBootstrap {
    schema_version: u8,
    host: String,
    port: u16,
    api_base_path: String,
}

#[derive(Default)]
struct BootstrapDecoder {
    bytes: Vec<u8>,
    complete: bool,
}

impl BootstrapDecoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Option<WireBootstrap>, CompanionError> {
        if self.complete {
            return Err(CompanionError::InvalidBootstrap);
        }

        let next_len = self
            .bytes
            .len()
            .checked_add(chunk.len())
            .ok_or(CompanionError::InvalidBootstrap)?;
        if next_len > MAX_BOOTSTRAP_RECORD_BYTES {
            return Err(CompanionError::InvalidBootstrap);
        }
        self.bytes.extend_from_slice(chunk);

        let Some(newline) = self.bytes.iter().position(|byte| *byte == b'\n') else {
            return Ok(None);
        };
        if newline + 1 != self.bytes.len() {
            return Err(CompanionError::InvalidBootstrap);
        }

        let mut record = &self.bytes[..newline];
        if record.ends_with(b"\r") {
            record = &record[..record.len() - 1];
        }
        if record.is_empty() {
            return Err(CompanionError::InvalidBootstrap);
        }

        let bootstrap = parse_wire_bootstrap(record)?;
        self.complete = true;
        Ok(Some(bootstrap))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewBootstrap {
    pub api_origin: String,
    pub token: String,
    pub client_id: &'static str,
    pub api_base_path: &'static str,
    pub build_version: String,
}

pub struct CompanionProcess(CommandChild);

impl CompanionProcess {
    pub fn kill(self) -> Result<(), tauri_plugin_shell::Error> {
        self.0.kill()
    }
}

pub struct RunningCompanion {
    pub process: CompanionProcess,
    pub bootstrap: WebviewBootstrap,
}

#[derive(Debug)]
struct LaunchConfiguration {
    launch_token: String,
    database_path: PathBuf,
    allowed_origin: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchRecord<'a> {
    protocol_version: u8,
    launch_token: &'a str,
    database_path: &'a Path,
    allowed_origin: &'a str,
    development: bool,
}

pub fn start_companion<R: Runtime>(app: &AppHandle<R>) -> Result<RunningCompanion, CompanionError> {
    let config = LaunchConfiguration::new(app)?;
    let (mut events, child) = spawn_with_development_fallback(app, &config)?;
    let pid = child.pid();

    let wire = tauri::async_runtime::block_on(read_bootstrap(&mut events));
    let wire = match wire {
        Ok(bootstrap) => bootstrap,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };

    let api_origin = format!("http://127.0.0.1:{}", wire.port);
    let bootstrap = WebviewBootstrap {
        api_origin,
        token: config.launch_token,
        client_id: "desktop-v1",
        api_base_path: "/api/v1",
        build_version: app.package_info().version.to_string(),
    };

    monitor_companion(app.clone(), pid, events);

    Ok(RunningCompanion {
        process: CompanionProcess(child),
        bootstrap,
    })
}

impl LaunchConfiguration {
    fn new<R: Runtime>(app: &AppHandle<R>) -> Result<Self, CompanionError> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(CompanionError::AppDataUnavailable)?
            .join("store");
        std::fs::create_dir_all(&data_dir).map_err(CompanionError::AppDataPrepare)?;
        restrict_data_directory(&data_dir)?;

        Ok(Self {
            launch_token: generate_launch_token()?,
            database_path: data_dir.join("tan-studio.sqlite"),
            allowed_origin: if cfg!(debug_assertions) {
                DEVELOPMENT_UI_ORIGIN
            } else {
                PACKAGED_UI_ORIGIN
            },
        })
    }
}

#[cfg(unix)]
fn restrict_data_directory(path: &Path) -> Result<(), CompanionError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = std::fs::Permissions::from_mode(0o700);
    std::fs::set_permissions(path, permissions).map_err(CompanionError::AppDataPrepare)
}

#[cfg(not(unix))]
fn restrict_data_directory(_path: &Path) -> Result<(), CompanionError> {
    // Windows inherits the current user's ACL from the platform app-data directory.
    Ok(())
}

fn generate_launch_token() -> Result<String, CompanionError> {
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(CompanionError::Random)?;
    Ok(URL_SAFE_NO_PAD.encode(random))
}

fn spawn_with_development_fallback<R: Runtime>(
    app: &AppHandle<R>,
    config: &LaunchConfiguration,
) -> Result<(Receiver<CommandEvent>, CommandChild), CompanionError> {
    let packaged = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .ok()
        .and_then(|command| command.set_raw_out(true).spawn().ok());

    if let Some(process) = packaged {
        return initialize_launch_channel(process, config);
    }

    if !cfg!(debug_assertions) {
        return Err(CompanionError::Spawn);
    }

    let manifest = development_manifest()?;
    let working_directory = manifest
        .parent()
        .ok_or(CompanionError::DevelopmentSource)?;

    let process = app
        .shell()
        .command("cargo")
        .set_raw_out(true)
        .args(["run", "--quiet", "--manifest-path"])
        .arg(&manifest)
        .current_dir(working_directory)
        .spawn()
        .map_err(|_| CompanionError::Spawn)?;
    initialize_launch_channel(process, config)
}

fn initialize_launch_channel(
    (events, mut child): (Receiver<CommandEvent>, CommandChild),
    config: &LaunchConfiguration,
) -> Result<(Receiver<CommandEvent>, CommandChild), CompanionError> {
    let record = LaunchRecord {
        protocol_version: 1,
        launch_token: &config.launch_token,
        database_path: &config.database_path,
        allowed_origin: config.allowed_origin,
        development: cfg!(debug_assertions),
    };
    let mut bytes = serde_json::to_vec(&record).map_err(CompanionError::LaunchSerialization)?;
    bytes.push(b'\n');

    if child.write(&bytes).is_err() {
        let _ = child.kill();
        return Err(CompanionError::LaunchChannel);
    }

    Ok((events, child))
}

fn development_manifest() -> Result<PathBuf, CompanionError> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest_dir.join("../../service/Cargo.toml");
    let canonical = candidate
        .canonicalize()
        .map_err(|_| CompanionError::DevelopmentSource)?;
    let expected_suffix = Path::new("apps/service/Cargo.toml");

    if !canonical.ends_with(expected_suffix) || !canonical.is_file() {
        return Err(CompanionError::DevelopmentSource);
    }

    Ok(canonical)
}

async fn read_bootstrap(
    events: &mut Receiver<CommandEvent>,
) -> Result<WireBootstrap, CompanionError> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let mut decoder = BootstrapDecoder::default();
    loop {
        let event = timeout_at(deadline, events.recv())
            .await
            .map_err(|_| CompanionError::Timeout)?
            .ok_or(CompanionError::EarlyExit)?;

        match event {
            CommandEvent::Stdout(bytes) => {
                if let Some(bootstrap) = decoder.push(&bytes)? {
                    return Ok(bootstrap);
                }
            }
            CommandEvent::Stderr(_) => {
                // Child output is intentionally never forwarded: it can contain local paths or secrets.
            }
            CommandEvent::Error(_) => return Err(CompanionError::EarlyExit),
            CommandEvent::Terminated(_) => return Err(CompanionError::EarlyExit),
            _ => {}
        }
    }
}

fn parse_wire_bootstrap(bytes: &[u8]) -> Result<WireBootstrap, CompanionError> {
    let bootstrap: WireBootstrap =
        serde_json::from_slice(bytes).map_err(|_| CompanionError::InvalidBootstrap)?;

    if bootstrap.schema_version != 1
        || bootstrap.host != "127.0.0.1"
        || bootstrap.port == 0
        || bootstrap.api_base_path != "/api/v1"
    {
        return Err(CompanionError::InvalidBootstrap);
    }

    Ok(bootstrap)
}

fn monitor_companion<R: Runtime>(
    app: AppHandle<R>,
    expected_pid: u32,
    mut events: Receiver<CommandEvent>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(_) => {
                    // The bootstrap record is the only permitted stdout line.
                    log::error!(target: "tan_studio::companion", "companion_stdout_protocol_violation");
                    app.exit(1);
                    return;
                }
                CommandEvent::Terminated(_) => {
                    log::error!(target: "tan_studio::companion", "companion_terminated pid={expected_pid}");
                    app.exit(1);
                    return;
                }
                CommandEvent::Error(_) => {
                    log::error!(target: "tan_studio::companion", "companion_transport_error pid={expected_pid}");
                    app.exit(1);
                    return;
                }
                CommandEvent::Stderr(_) => {
                    // Stderr is deliberately not copied into shell logs. The companion owns redacted logs.
                }
                _ => {}
            }
        }
    });
}

pub fn create_webview_bootstrap_script(
    bootstrap: &WebviewBootstrap,
) -> Result<String, CompanionError> {
    let json = serde_json::to_string(bootstrap).map_err(CompanionError::BootstrapSerialization)?;
    let expected_origin = serde_json::to_string(if cfg!(debug_assertions) {
        DEVELOPMENT_UI_ORIGIN
    } else {
        PACKAGED_UI_ORIGIN
    })
    .map_err(CompanionError::BootstrapSerialization)?;

    Ok(format!(
    "if (window.location.origin === {expected_origin}) {{ Object.defineProperty(window, '__TAN_STUDIO_BOOTSTRAP__', {{ value: Object.freeze({json}), enumerable: false, configurable: false, writable: false }}); }}"
  ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_companion_bootstrap_contract() {
        let parsed = parse_wire_bootstrap(
            br#"{"schemaVersion":1,"host":"127.0.0.1","port":49152,"apiBasePath":"/api/v1"}"#,
        )
        .expect("valid bootstrap");

        assert_eq!(parsed.port, 49152);
    }

    #[test]
    fn decodes_a_bootstrap_fragmented_across_stdout_events() {
        let mut decoder = BootstrapDecoder::default();
        assert!(decoder
            .push(br#"{"schemaVersion":1,"host":"127.0."#)
            .expect("first fragment")
            .is_none());
        assert!(decoder
            .push(br#"0.1","port":49152,"apiBasePath":"/api/v1"}"#)
            .expect("second fragment")
            .is_none());

        let parsed = decoder
            .push(b"\n")
            .expect("terminator")
            .expect("complete bootstrap");
        assert_eq!(parsed.port, 49152);
    }

    #[test]
    fn requires_a_newline_before_completing_bootstrap() {
        let mut decoder = BootstrapDecoder::default();
        let complete_json =
            br#"{"schemaVersion":1,"host":"127.0.0.1","port":49152,"apiBasePath":"/api/v1"}"#;

        assert!(decoder.push(complete_json).expect("fragment").is_none());
    }

    #[test]
    fn rejects_oversized_and_trailing_bootstrap_output() {
        let mut oversized = BootstrapDecoder::default();
        assert!(oversized
            .push(&vec![b'a'; MAX_BOOTSTRAP_RECORD_BYTES + 1])
            .is_err());

        let mut trailing = BootstrapDecoder::default();
        assert!(trailing
            .push(
                br#"{"schemaVersion":1,"host":"127.0.0.1","port":49152,"apiBasePath":"/api/v1"}
extra"#,
            )
            .is_err());
    }

    #[test]
    fn rejects_an_additional_stdout_record_after_completion() {
        let mut decoder = BootstrapDecoder::default();
        let bootstrap =
            b"{\"schemaVersion\":1,\"host\":\"127.0.0.1\",\"port\":49152,\"apiBasePath\":\"/api/v1\"}\n";

        assert!(decoder.push(bootstrap).expect("bootstrap").is_some());
        assert!(decoder.push(b"{}\n").is_err());
    }

    #[test]
    fn rejects_hosts_paths_and_unknown_fields() {
        for input in [
            br#"{"schemaVersion":1,"host":"0.0.0.0","port":49152,"apiBasePath":"/api/v1"}"#.as_slice(),
            br#"{"schemaVersion":1,"host":"127.0.0.1","port":49152,"apiBasePath":"/other"}"#.as_slice(),
            br#"{"schemaVersion":1,"host":"127.0.0.1","port":49152,"apiBasePath":"/api/v1","token":"must-not-exist"}"#.as_slice(),
        ] {
            assert!(parse_wire_bootstrap(input).is_err());
        }
    }

    #[test]
    fn bootstrap_script_uses_an_immutable_non_url_value() {
        let bootstrap = WebviewBootstrap {
            api_origin: "http://127.0.0.1:49152".into(),
            token: "secret-token".into(),
            client_id: "desktop-v1",
            api_base_path: "/api/v1",
            build_version: "0.1.0".into(),
        };

        let script = create_webview_bootstrap_script(&bootstrap).expect("script");
        assert!(script.contains("Object.defineProperty"));
        assert!(script.contains("Object.freeze"));
        assert!(!script.contains("?token="));
        assert!(!script.contains("#secret-token"));
    }

    #[test]
    fn launch_token_contains_exactly_256_bits() {
        let token = generate_launch_token().expect("token");
        let decoded = URL_SAFE_NO_PAD.decode(token).expect("base64url");
        assert_eq!(decoded.len(), 32);
    }
}
