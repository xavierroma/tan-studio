use std::{
    env,
    io::{self, BufRead, Read},
    net::IpAddr,
    path::PathBuf,
};

use serde::Deserialize;
use thiserror::Error;

const MAX_LAUNCH_RECORD_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    Desktop,
    Headless,
}

#[derive(Debug, Clone)]
pub struct ServiceConfig {
    pub mode: LaunchMode,
    pub bind_host: String,
    pub port: u16,
    pub bridge_port: Option<u16>,
    pub database_path: PathBuf,
    pub web_root: Option<PathBuf>,
    pub launch_token: String,
    pub allowed_origins: Vec<String>,
    pub allowed_hosts: Vec<String>,
    pub allowed_client_ids: Vec<String>,
    pub allow_originless_requests: bool,
    pub application_version: String,
    pub development: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopLaunchRecord {
    protocol_version: u8,
    launch_token: String,
    database_path: PathBuf,
    allowed_origin: String,
    development: bool,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("desktop launch record is missing or invalid")]
    InvalidLaunchRecord,
    #[error("required environment variable {0} is missing or invalid")]
    InvalidEnvironment(&'static str),
    #[error("failed to read the desktop launch channel")]
    LaunchChannel(#[from] io::Error),
}

impl ServiceConfig {
    pub fn load() -> Result<Self, ConfigError> {
        if env::var_os("TAN_STUDIO_HEADLESS").as_deref() == Some(std::ffi::OsStr::new("1")) {
            Self::headless()
        } else if env::var_os("TAN_STUDIO_DEV").as_deref() == Some(std::ffi::OsStr::new("1")) {
            Self::development()
        } else {
            Self::desktop()
        }
    }

    fn development() -> Result<Self, ConfigError> {
        let database_path = env::var_os("TAN_STUDIO_DATABASE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join(".tan-studio/dev.sqlite")
            });
        if !database_path.is_absolute() {
            return Err(ConfigError::InvalidEnvironment("TAN_STUDIO_DATABASE_PATH"));
        }
        Ok(Self {
            mode: LaunchMode::Desktop,
            bind_host: "127.0.0.1".into(),
            port: 4317,
            bridge_port: None,
            database_path,
            web_root: None,
            launch_token: "tan-studio-development-only".into(),
            allowed_origins: vec!["http://127.0.0.1:1420".into()],
            allowed_hosts: Vec::new(),
            allowed_client_ids: vec!["tan-studio-browser-dev".into()],
            allow_originless_requests: false,
            application_version: env!("CARGO_PKG_VERSION").into(),
            development: true,
        })
    }

    fn desktop() -> Result<Self, ConfigError> {
        let mut bytes = Vec::new();
        io::stdin()
            .lock()
            .take(MAX_LAUNCH_RECORD_BYTES + 1)
            .read_until(b'\n', &mut bytes)?;
        if bytes.is_empty()
            || bytes.len() as u64 > MAX_LAUNCH_RECORD_BYTES
            || bytes.last() != Some(&b'\n')
        {
            return Err(ConfigError::InvalidLaunchRecord);
        }
        bytes.pop();
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
        let record: DesktopLaunchRecord =
            serde_json::from_slice(&bytes).map_err(|_| ConfigError::InvalidLaunchRecord)?;
        if record.protocol_version != 1
            || !valid_token(&record.launch_token)
            || !record.database_path.is_absolute()
            || record.database_path.as_os_str().is_empty()
            || !matches!(
                record.allowed_origin.as_str(),
                "tauri://localhost" | "http://127.0.0.1:1420"
            )
            || record.development != (record.allowed_origin == "http://127.0.0.1:1420")
        {
            return Err(ConfigError::InvalidLaunchRecord);
        }
        Ok(Self {
            mode: LaunchMode::Desktop,
            bind_host: "127.0.0.1".into(),
            port: 0,
            bridge_port: None,
            database_path: record.database_path,
            web_root: None,
            launch_token: record.launch_token,
            allowed_origins: vec![record.allowed_origin],
            allowed_hosts: Vec::new(),
            allowed_client_ids: if record.development {
                vec!["desktop-v1".into(), "tan-studio-browser-dev".into()]
            } else {
                vec!["desktop-v1".into()]
            },
            allow_originless_requests: false,
            application_version: env!("CARGO_PKG_VERSION").into(),
            development: record.development,
        })
    }

    fn headless() -> Result<Self, ConfigError> {
        let bind_host = value("TAN_STUDIO_BIND_HOST")?.to_owned();
        if bind_host.parse::<IpAddr>().is_err() {
            return Err(ConfigError::InvalidEnvironment("TAN_STUDIO_BIND_HOST"));
        }
        let port = value("TAN_STUDIO_PORT")?
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .ok_or(ConfigError::InvalidEnvironment("TAN_STUDIO_PORT"))?;
        let database_path = PathBuf::from(value("TAN_STUDIO_DATABASE_PATH")?);
        let web_root = PathBuf::from(value("TAN_STUDIO_WEB_ROOT")?);
        if !database_path.is_absolute() || !web_root.is_absolute() {
            return Err(ConfigError::InvalidEnvironment("TAN_STUDIO_DATABASE_PATH"));
        }
        let launch_token = value("TAN_STUDIO_LAN_TOKEN")?.to_owned();
        if !valid_lan_token(&launch_token) {
            return Err(ConfigError::InvalidEnvironment("TAN_STUDIO_LAN_TOKEN"));
        }
        let bridge_port = env::var("TAN_STUDIO_BRIDGE_PORT")
            .ok()
            .map(|value| value.trim().parse::<u16>().ok())
            .unwrap_or(Some(crate::lan_bridge::DEFAULT_BRIDGE_PORT))
            .filter(|bridge_port| *bridge_port > 0 && *bridge_port != port)
            .ok_or(ConfigError::InvalidEnvironment("TAN_STUDIO_BRIDGE_PORT"))?;
        Ok(Self {
            mode: LaunchMode::Headless,
            bind_host,
            port,
            bridge_port: Some(bridge_port),
            database_path,
            web_root: Some(web_root),
            launch_token,
            allowed_origins: comma_list("TAN_STUDIO_ALLOWED_ORIGINS")?,
            allowed_hosts: comma_list("TAN_STUDIO_ALLOWED_HOSTS")?,
            allowed_client_ids: vec!["tan-studio-lan-v1".into(), "tan-studio-api-v1".into()],
            allow_originless_requests: true,
            application_version: env::var("TAN_STUDIO_VERSION")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").into()),
            development: false,
        })
    }
}

fn value(name: &'static str) -> Result<String, ConfigError> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && value.len() <= 4096 && !value.contains('\0'))
        .ok_or(ConfigError::InvalidEnvironment(name))
}

fn comma_list(name: &'static str) -> Result<Vec<String>, ConfigError> {
    let values: Vec<_> = value(name)?
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if values.is_empty() || values.len() > 32 {
        return Err(ConfigError::InvalidEnvironment(name));
    }
    Ok(values)
}

fn valid_token(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_lan_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_tokens_without_exposing_them() {
        assert!(valid_token(&"a".repeat(43)));
        assert!(valid_lan_token(&"f".repeat(64)));
        assert!(!valid_lan_token("secret"));
    }
}
