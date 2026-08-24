use std::{
    env,
    io::{self, BufRead, Read},
    net::IpAddr,
    path::PathBuf,
};

use serde::Deserialize;
use thiserror::Error;

const MAX_LAUNCH_RECORD_BYTES: u64 = 16 * 1024;

/// The client identity the hosted SPA sends and hosted mode accepts.
pub const HOSTED_CLIENT_ID: &str = "tan-studio-hosted-v1";

/// The client identity every non-browser client sends: the MCP plugin and any
/// HTTP client holding an API token.
pub const API_CLIENT_ID: &str = "tan-studio-api-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    Desktop,
    Headless,
    Hosted,
}

/// Everything hosted mode needs to run Sign in with Google for the one operator.
#[derive(Debug, Clone)]
pub struct OperatorAuthConfig {
    pub operator_email: String,
    pub oidc_issuer: String,
    pub oidc_client_id: String,
    pub oidc_client_secret: String,
    pub oidc_redirect_uri: String,
    pub session_secret: Vec<u8>,
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
    pub operator_auth: Option<OperatorAuthConfig>,
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
        if env::var_os("TAN_STUDIO_HOSTED").as_deref() == Some(std::ffi::OsStr::new("1")) {
            Self::hosted()
        } else if env::var_os("TAN_STUDIO_HEADLESS").as_deref() == Some(std::ffi::OsStr::new("1")) {
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
            operator_auth: None,
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
            operator_auth: None,
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
            allowed_client_ids: vec!["tan-studio-lan-v1".into(), API_CLIENT_ID.into()],
            allow_originless_requests: true,
            application_version: env::var("TAN_STUDIO_VERSION")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").into()),
            development: false,
            operator_auth: None,
        })
    }

    fn hosted() -> Result<Self, ConfigError> {
        let bind_host = value("TAN_STUDIO_BIND_HOST")?;
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
        let public_origin = value("TAN_STUDIO_PUBLIC_ORIGIN")?;
        let allowed_host = public_origin_host(&public_origin)
            .ok_or(ConfigError::InvalidEnvironment("TAN_STUDIO_PUBLIC_ORIGIN"))?;
        let operator_email = value("TAN_STUDIO_OPERATOR_EMAIL")?;
        if !valid_operator_email(&operator_email) {
            return Err(ConfigError::InvalidEnvironment("TAN_STUDIO_OPERATOR_EMAIL"));
        }
        let session_secret = parse_session_secret(&value("TAN_STUDIO_SESSION_SECRET")?)
            .ok_or(ConfigError::InvalidEnvironment("TAN_STUDIO_SESSION_SECRET"))?;
        let oidc_issuer = value("TAN_STUDIO_OIDC_ISSUER")?
            .trim_end_matches('/')
            .to_owned();
        if !valid_issuer(&oidc_issuer) {
            return Err(ConfigError::InvalidEnvironment("TAN_STUDIO_OIDC_ISSUER"));
        }
        let oidc_redirect_uri = env::var("TAN_STUDIO_OIDC_REDIRECT_URI")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("{public_origin}/auth/google/callback"));
        if !oidc_redirect_uri.starts_with(&format!("{public_origin}/")) {
            return Err(ConfigError::InvalidEnvironment(
                "TAN_STUDIO_OIDC_REDIRECT_URI",
            ));
        }
        Ok(Self {
            mode: LaunchMode::Hosted,
            bind_host,
            port,
            // A public host has no LAN bridge listener; Tan Bridge reaches the studio origin.
            bridge_port: None,
            database_path,
            web_root: Some(web_root),
            launch_token: String::new(),
            allowed_origins: vec![public_origin],
            allowed_hosts: vec![allowed_host],
            // The SPA presents the operator session; the MCP plugin and other HTTP
            // clients present an API token. Any other client identity is refused
            // before its credential is even looked at.
            allowed_client_ids: vec![HOSTED_CLIENT_ID.into(), API_CLIENT_ID.into()],
            // Browsers omit Origin on same-origin GETs and hosted mode serves its own SPA
            // same-origin, so originless requests must be allowed. A foreign Origin is still
            // rejected by `api_security`, and the operator session cookie is SameSite=Lax.
            allow_originless_requests: true,
            application_version: env::var("TAN_STUDIO_VERSION")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").into()),
            development: false,
            operator_auth: Some(OperatorAuthConfig {
                operator_email: operator_email.to_ascii_lowercase(),
                oidc_issuer,
                oidc_client_id: value("TAN_STUDIO_OIDC_CLIENT_ID")?,
                oidc_client_secret: value("TAN_STUDIO_OIDC_CLIENT_SECRET")?,
                oidc_redirect_uri,
                session_secret,
            }),
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

fn parse_session_secret(value: &str) -> Option<Vec<u8>> {
    let bytes = hex::decode(value).ok()?;
    (bytes.len() == 32).then_some(bytes)
}

fn valid_operator_email(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.is_empty()
        && domain.contains('.')
        && !value.contains(' ')
        && value.len() <= 320
        && value.is_ascii()
        && !value.contains('\0')
}

fn valid_issuer(value: &str) -> bool {
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://127.0.0.1:"));
    rest.is_some_and(|rest| !rest.is_empty()) && !value.contains(' ') && !value.contains('\0')
}

fn public_origin_host(value: &str) -> Option<String> {
    let rest = value.strip_prefix("https://")?;
    if value.contains(' ') || value.contains('\0') {
        return None;
    }
    if rest.is_empty() || rest.contains('/') || rest.contains('?') || rest.contains('#') {
        return None;
    }
    Some(rest.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// `hosted()` reads the process environment, which is shared by every test thread.
    static ENVIRONMENT: Mutex<()> = Mutex::new(());

    const HOSTED_ENVIRONMENT: &[(&str, &str)] = &[
        ("TAN_STUDIO_BIND_HOST", "127.0.0.1"),
        ("TAN_STUDIO_PORT", "8080"),
        ("TAN_STUDIO_DATABASE_PATH", "/srv/tan-studio/studio.sqlite"),
        ("TAN_STUDIO_WEB_ROOT", "/srv/tan-studio/web"),
        ("TAN_STUDIO_PUBLIC_ORIGIN", "https://studio.tan.coffee"),
        ("TAN_STUDIO_OIDC_ISSUER", "https://accounts.google.com"),
        (
            "TAN_STUDIO_OIDC_REDIRECT_URI",
            "https://studio.tan.coffee/auth/google/callback",
        ),
        ("TAN_STUDIO_OIDC_CLIENT_ID", "hosted-client-id"),
        ("TAN_STUDIO_OIDC_CLIENT_SECRET", "hosted-client-secret"),
        ("TAN_STUDIO_OPERATOR_EMAIL", "Operator@Tan.Coffee"),
        (
            "TAN_STUDIO_SESSION_SECRET",
            "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a",
        ),
    ];

    fn load_hosted(overrides: &[(&str, &str)]) -> Result<ServiceConfig, ConfigError> {
        let _guard = ENVIRONMENT
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for (name, value) in HOSTED_ENVIRONMENT {
            env::set_var(name, value);
        }
        for (name, value) in overrides {
            env::set_var(name, value);
        }
        let loaded = ServiceConfig::hosted();
        for (name, _) in HOSTED_ENVIRONMENT {
            env::remove_var(name);
        }
        for (name, _) in overrides {
            env::remove_var(name);
        }
        loaded
    }

    #[test]
    fn validates_tokens_without_exposing_them() {
        assert!(valid_token(&"a".repeat(43)));
        assert!(valid_lan_token(&"f".repeat(64)));
        assert!(!valid_lan_token("secret"));
        assert!(parse_session_secret(&"ab".repeat(32)).is_some());
        assert!(parse_session_secret("secret").is_none());
        assert!(valid_operator_email("operator@tan.coffee"));
        assert!(!valid_operator_email("not-an-email"));
        assert_eq!(
            public_origin_host("https://studio.tan.coffee").as_deref(),
            Some("studio.tan.coffee")
        );
        assert!(public_origin_host("https://tan.coffee/studio").is_none());
        assert!(public_origin_host("http://studio.tan.coffee").is_none());
    }

    /// Browsers omit `Origin` on same-origin GETs, and hosted mode serves its own SPA
    /// same-origin. Setting this to `false` takes the live studio down with
    /// "The request Origin is not authorized for this service session."
    #[test]
    fn hosted_allows_originless_same_origin_requests() {
        let config = load_hosted(&[]).expect("hosted config");
        assert!(
            config.allow_originless_requests,
            "hosted mode must allow originless requests or its own SPA cannot call its API"
        );
    }

    #[test]
    fn hosted_derives_the_studio_authority_and_keeps_no_lan_listener() {
        let config = load_hosted(&[]).expect("hosted config");
        assert_eq!(config.mode, LaunchMode::Hosted);
        assert_eq!(config.allowed_origins, vec!["https://studio.tan.coffee"]);
        assert_eq!(config.allowed_hosts, vec!["studio.tan.coffee"]);
        assert_eq!(
            config.allowed_client_ids,
            vec![HOSTED_CLIENT_ID, API_CLIENT_ID]
        );
        assert_eq!(config.bridge_port, None);
        assert!(config.launch_token.is_empty());
        assert!(!config.development);
        let auth = config.operator_auth.expect("operator auth");
        assert_eq!(auth.operator_email, "operator@tan.coffee");
        assert_eq!(auth.session_secret.len(), 32);
    }

    #[test]
    fn hosted_refuses_a_public_origin_that_is_not_a_bare_https_authority() {
        for origin in ["http://studio.tan.coffee", "https://tan.coffee/studio"] {
            let error = load_hosted(&[("TAN_STUDIO_PUBLIC_ORIGIN", origin)])
                .expect_err("public origin must be a bare https authority");
            assert!(
                matches!(
                    error,
                    ConfigError::InvalidEnvironment("TAN_STUDIO_PUBLIC_ORIGIN")
                ),
                "{origin}"
            );
        }
    }

    #[test]
    fn hosted_refuses_a_redirect_uri_outside_the_public_origin() {
        let error = load_hosted(&[(
            "TAN_STUDIO_OIDC_REDIRECT_URI",
            "https://evil.example/auth/google/callback",
        )])
        .expect_err("redirect URI must live under the public origin");
        assert!(matches!(
            error,
            ConfigError::InvalidEnvironment("TAN_STUDIO_OIDC_REDIRECT_URI")
        ));
    }

    #[test]
    fn hosted_refuses_a_session_secret_that_is_not_thirty_two_bytes() {
        let error = load_hosted(&[("TAN_STUDIO_SESSION_SECRET", "5a5a5a5a")])
            .expect_err("session secret must be 32 bytes");
        assert!(matches!(
            error,
            ConfigError::InvalidEnvironment("TAN_STUDIO_SESSION_SECRET")
        ));
    }
}
