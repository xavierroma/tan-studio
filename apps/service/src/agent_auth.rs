//! Hosted MCP credentials and narrowly scoped API delegation. No notebook logic.
use crate::{
    api::{ApiState, Credential},
    config::{LaunchMode, ServiceConfig},
    db::Database,
    error::{ApiError, ApiResult},
};
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{Method, StatusCode},
    routing::{get, post},
    Extension, Json, Router,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};
use utoipa::ToSchema;

const ISSUER: &str = "tan-studio-agent-authority";
const API_AUDIENCE: &str = "https://studio.tan.coffee/api/v1";
pub const MCP_AUDIENCE: &str = "https://studio.tan.coffee/mcp";
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn denied() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "invalid_agent_credential",
        "Authentication required",
        "A valid MCP credential is required.",
    )
}
fn forbidden() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "agent_operation_forbidden",
        "Operation forbidden",
        "This agent cannot perform this operation.",
    )
}
fn unavailable() -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "mcp_disabled",
        "MCP disabled",
        "Hosted MCP is not enabled.",
    )
}

/// A restart rotates only the short-lived delegation signing key. Persisted agent
/// credentials remain valid. The key never leaves Rust and needs no disk secret.
pub struct AgentAuthority {
    key: [u8; 32],
    pub socket: PathBuf,
}
impl AgentAuthority {
    pub fn new(socket: PathBuf) -> Self {
        Self {
            key: rand::random(),
            socket,
        }
    }
    pub fn from_environment(config: &ServiceConfig) -> ApiResult<Option<Arc<Self>>> {
        if std::env::var("TAN_STUDIO_MCP_ENABLED").as_deref() != Ok("1") {
            return Ok(None);
        }
        let path =
            PathBuf::from(std::env::var("TAN_STUDIO_MCP_AUTH_SOCKET").map_err(|_| unavailable())?);
        if config.mode != LaunchMode::Hosted
            || !path.is_absolute()
            || !config
                .allowed_hosts
                .iter()
                .any(|h| h == "studio.tan.coffee")
        {
            return Err(unavailable());
        }
        Ok(Some(Arc::new(Self::new(path))))
    }
    pub fn delegate(&self, db: &Database, input: DelegateInput) -> ApiResult<Delegation> {
        let agent = authenticate(db, &input.token)?;
        let routes = operation_routes(
            &input.method,
            input.name.as_deref(),
            input.uri.as_deref(),
            &input.arguments,
        )?;
        if !agent.write && routes.iter().any(|r| r.method != "GET") {
            return Err(forbidden());
        }
        let expires = (now() / 1000 + 60).min(agent.expires_at_ms / 1000);
        let token = if routes.is_empty() {
            None
        } else {
            let claims = Claims {
                iss: ISSUER.into(),
                aud: API_AUDIENCE.into(),
                sub: agent.id.to_string(),
                exp: expires as u64,
                iat: (now() / 1000) as u64,
                parent: agent.id,
                version: agent.version,
                routes,
            };
            Some(format!(
                "tsapi_{}",
                encode(
                    &Header::new(Algorithm::HS256),
                    &claims,
                    &EncodingKey::from_secret(&self.key)
                )
                .map_err(|_| unavailable())?
            ))
        };
        Ok(Delegation {
            agent_id: agent.id,
            write: agent.write,
            token,
        })
    }
    pub fn authorize(
        &self,
        db: &Database,
        token: &str,
        method: &Method,
        path: &str,
    ) -> ApiResult<i64> {
        let token = token.strip_prefix("tsapi_").ok_or_else(denied)?;
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&[API_AUDIENCE]);
        validation.set_issuer(&[ISSUER]);
        validation.leeway = 0;
        let claims = decode::<Claims>(token, &DecodingKey::from_secret(&self.key), &validation)
            .map_err(|_| denied())?
            .claims;
        let agent = find(db, claims.parent)?.ok_or_else(denied)?;
        if agent.revoked_at_ms.is_some()
            || agent.expires_at_ms <= now()
            || agent.version != claims.version
            || agent.audience != MCP_AUDIENCE
            || claims.sub != agent.id.to_string()
            || claims.exp > claims.iat + 60
            || claims.iat > (now() / 1000) as u64
        {
            return Err(denied());
        }
        if !claims
            .routes
            .iter()
            .any(|r| r.method == method.as_str() && r.path == path)
            || (!agent.write && method != Method::GET)
        {
            return Err(forbidden());
        }
        Ok(agent.id)
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct RouteGrant {
    method: String,
    path: String,
}
#[derive(Serialize, Deserialize)]
struct Claims {
    iss: String,
    aud: String,
    sub: String,
    exp: u64,
    iat: u64,
    parent: i64,
    version: i64,
    routes: Vec<RouteGrant>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DelegateInput {
    pub token: String,
    pub method: String,
    pub name: Option<String>,
    pub uri: Option<String>,
    #[serde(default)]
    pub arguments: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delegation {
    pub agent_id: i64,
    pub write: bool,
    pub token: Option<String>,
}

fn operation_routes(
    method: &str,
    name: Option<&str>,
    uri: Option<&str>,
    args: &Value,
) -> ApiResult<Vec<RouteGrant>> {
    let route = |verb: &str, path: &str| RouteGrant {
        method: verb.into(),
        path: path.into(),
    };
    let id = |field: &str| -> ApiResult<i64> {
        args.get(field)
            .and_then(Value::as_i64)
            .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
            .ok_or_else(forbidden)
    };
    let context = |kind: &str, n: i64| -> ApiResult<String> {
        match kind {
            "profile" => Ok(format!("/profiles/{n}/context")),
            "coffee" => Ok(format!("/coffees/{n}/context")),
            "roast" => Ok(format!("/roasts/{n}/context")),
            "brew" => Ok(format!("/brews/{n}")),
            _ => Err(forbidden()),
        }
    };
    if matches!(
        method,
        "initialize"
            | "notifications/initialized"
            | "server/discover"
            | "ping"
            | "tools/list"
            | "resources/list"
            | "resources/templates/list"
    ) {
        return Ok(vec![]);
    }
    if method == "resources/read" {
        let uri = uri.ok_or_else(forbidden)?;
        if uri == "tan://pantry" {
            return Ok(vec![route("GET", "/pantry")]);
        }
        if uri == "tan://device" {
            return Ok(vec![route("GET", "/device")]);
        }
        for (prefix, kind) in [
            ("profiles", "profile"),
            ("coffees", "coffee"),
            ("roasts", "roast"),
            ("brews", "brew"),
        ] {
            if let Some(raw) = uri.strip_prefix(&format!("tan://{prefix}/")) {
                let n: i64 = raw.parse().map_err(|_| forbidden())?;
                if n <= 0 || n > 9_007_199_254_740_991 || raw != n.to_string() {
                    return Err(forbidden());
                }
                return Ok(vec![route("GET", &context(kind, n)?)]);
            }
        }
        return Err(forbidden());
    }
    if method != "tools/call" {
        return Err(forbidden());
    }
    let (verb, path) = match name.ok_or_else(forbidden)? {
        "tan_status" => {
            return Ok(["/system/bootstrap", "/device", "/bridges"]
                .map(|p| route("GET", p))
                .to_vec())
        }
        "tan_list_pantry" => ("GET", "/pantry".into()),
        "tan_search_profiles" => ("GET", "/profiles".into()),
        "tan_search_coffees" => ("GET", "/coffees".into()),
        "tan_search_roasts" => ("GET", "/roasts".into()),
        "tan_get_context" => (
            "GET",
            context(
                args.get("resourceType")
                    .and_then(Value::as_str)
                    .ok_or_else(forbidden)?,
                id("id")?,
            )?,
        ),
        "tan_get_roast" => {
            let n = id("roastId")?;
            return Ok(vec![
                route("GET", &format!("/roasts/{n}")),
                route("GET", &format!("/roasts/{n}/series")),
            ]);
        }
        "tan_list_attachments" => ("GET", "/attachments".into()),
        "tan_create_coffee" => ("POST", "/coffees".into()),
        "tan_update_coffee" => ("PATCH", format!("/coffees/{}", id("coffeeId")?)),
        "tan_update_roast" => ("PATCH", format!("/roasts/{}", id("roastId")?)),
        "tan_record_brew" => ("POST", "/brews".into()),
        "tan_update_brew" => {
            let path = format!("/brews/{}", id("brewId")?);
            let mut routes = vec![route("PATCH", &path)];
            if args.get("technique").is_some() {
                routes.push(route("GET", &path));
            }
            return Ok(routes);
        }
        "tan_add_note" => ("POST", "/notes".into()),
        "tan_create_label" => ("POST", "/labels".into()),
        "tan_set_profile_image" => {
            let kind = args
                .get("resourceType")
                .and_then(Value::as_str)
                .ok_or_else(forbidden)?;
            if !["profile", "coffee", "roast", "brew"].contains(&kind) {
                return Err(forbidden());
            }
            (
                "PUT",
                format!("/entity-profile-images/{kind}/{}", id("resourceId")?),
            )
        }
        _ => return Err(forbidden()),
    };
    Ok(vec![route(verb, &path)])
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentCredential {
    pub id: i64,
    pub label: String,
    pub audience: String,
    pub write: bool,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
    pub last_used_at_ms: Option<i64>,
    pub revoked_at_ms: Option<i64>,
    pub version: i64,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentCredentialPage {
    pub enabled: bool,
    pub endpoint: String,
    pub items: Vec<AgentCredential>,
}
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCredentialCreate {
    pub label: String,
    #[serde(default)]
    pub write: bool,
    #[serde(default)]
    pub expires_in_days: Option<i64>,
    /// Explicit calendar-year term; currently only five years is supported.
    #[serde(default)]
    pub expires_in_years: Option<u32>,
}
fn credential_expiry(input: &AgentCredentialCreate, issued_at: i64) -> ApiResult<i64> {
    match (input.expires_in_days, input.expires_in_years) {
        (None, Some(5)) => chrono::DateTime::from_timestamp_millis(issued_at)
            .and_then(|date| date.checked_add_months(chrono::Months::new(60)))
            .map(|date| date.timestamp_millis())
            .ok_or_else(|| ApiError::validation("Invalid calendar expiry.")),
        (days, None) if (1..=90).contains(&days.unwrap_or(30)) => {
            Ok(issued_at + days.unwrap_or(30) * 86_400_000)
        }
        _ => Err(ApiError::validation(
            "Choose 1 to 90 days or five calendar years, not both.",
        )),
    }
}
#[derive(Serialize, ToSchema)]
pub struct MintedAgentCredential {
    pub credential: AgentCredential,
    pub secret: String,
}
fn map(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentCredential> {
    Ok(AgentCredential {
        id: row.get(0)?,
        label: row.get(1)?,
        audience: row.get(2)?,
        write: row.get(3)?,
        created_at_ms: row.get(4)?,
        expires_at_ms: row.get(5)?,
        last_used_at_ms: row.get(6)?,
        revoked_at_ms: row.get(7)?,
        version: row.get(8)?,
    })
}
const COLUMNS: &str =
    "id,label,audience,can_write,created_at_ms,expires_at_ms,last_used_at_ms,revoked_at_ms,version";
fn find(db: &Database, id: i64) -> ApiResult<Option<AgentCredential>> {
    Ok(db
        .connection()
        .query_row(
            &format!("SELECT {COLUMNS} FROM agent_credentials WHERE id=?"),
            [id],
            map,
        )
        .optional()?)
}
pub fn mint(db: &Database, input: AgentCredentialCreate) -> ApiResult<MintedAgentCredential> {
    if !crate::api_token::valid_label(&input.label) {
        return Err(ApiError::validation("Use a one-line label."));
    }
    let time = now();
    let expires_at = credential_expiry(&input, time)?;
    let secret = format!("tsmcp_{}", hex::encode(rand::random::<[u8; 32]>()));
    let id = {
        let c = db.connection();
        c.execute("INSERT INTO agent_credentials(label,token_sha256,audience,can_write,created_at_ms,expires_at_ms) VALUES (?,?,?,?,?,?)",params![input.label.trim(),hex::encode(Sha256::digest(secret.as_bytes())),MCP_AUDIENCE,input.write,time,expires_at])?;
        c.last_insert_rowid()
    };
    Ok(MintedAgentCredential {
        credential: find(db, id)?.ok_or_else(denied)?,
        secret,
    })
}
fn authenticate(db: &Database, token: &str) -> ApiResult<AgentCredential> {
    if token.len() != 70
        || !token.starts_with("tsmcp_")
        || !token[6..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(denied());
    }
    let digest = hex::encode(Sha256::digest(token.as_bytes()));
    let c = db.connection();
    let mut stmt=c.prepare(&format!("SELECT {COLUMNS},token_sha256 FROM agent_credentials WHERE revoked_at_ms IS NULL AND expires_at_ms>?"))?;
    let rows = stmt
        .query_map([now()], |row| Ok((map(row)?, row.get::<_, String>(9)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut found = None;
    for (agent, stored) in rows {
        if constant_time_eq::constant_time_eq(stored.as_bytes(), digest.as_bytes())
            && agent.audience == MCP_AUDIENCE
        {
            found = Some(agent);
        }
    }
    let agent = found.ok_or_else(denied)?;
    c.execute(
        "UPDATE agent_credentials SET last_used_at_ms=? WHERE id=?",
        params![now(), agent.id],
    )?;
    Ok(agent)
}
fn operator(credential: Credential) -> ApiResult<()> {
    if credential == Credential::OperatorSession {
        Ok(())
    } else {
        Err(forbidden())
    }
}
#[utoipa::path(get,path="/api/v1/agent-credentials",tag="agent-credentials",responses((status=200,body=AgentCredentialPage)))]
pub async fn list(
    State(state): State<ApiState>,
    Extension(credential): Extension<Credential>,
) -> ApiResult<Json<AgentCredentialPage>> {
    operator(credential)?;
    let c = state.database.connection();
    let mut stmt = c.prepare(&format!(
        "SELECT {COLUMNS} FROM agent_credentials ORDER BY id DESC"
    ))?;
    let items = stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(AgentCredentialPage {
        enabled: state.agent_auth.is_some(),
        endpoint: MCP_AUDIENCE.into(),
        items,
    }))
}
#[utoipa::path(post,path="/api/v1/agent-credentials",tag="agent-credentials",request_body=AgentCredentialCreate,responses((status=201,body=MintedAgentCredential)))]
pub async fn create(
    State(state): State<ApiState>,
    Extension(credential): Extension<Credential>,
    Json(input): Json<AgentCredentialCreate>,
) -> ApiResult<(StatusCode, Json<MintedAgentCredential>)> {
    operator(credential)?;
    state.agent_auth.as_ref().ok_or_else(unavailable)?;
    let result = mint(&state.database, input)?;
    tracing::info!(
        event = "agent_credential_created",
        agent_id = result.credential.id
    );
    Ok((StatusCode::CREATED, Json(result)))
}
#[utoipa::path(post,path="/api/v1/agent-credentials/{id}/revoke",tag="agent-credentials",params(("id"=i64,Path)),responses((status=200,body=AgentCredential)))]
pub async fn revoke(
    State(state): State<ApiState>,
    Extension(credential): Extension<Credential>,
    Path(id): Path<i64>,
) -> ApiResult<Json<AgentCredential>> {
    operator(credential)?;
    state.database.connection().execute("UPDATE agent_credentials SET revoked_at_ms=?,version=version+1 WHERE id=? AND revoked_at_ms IS NULL",params![now(),id])?;
    tracing::info!(event = "agent_credential_revoked", agent_id = id);
    Ok(Json(find(&state.database, id)?.ok_or_else(|| {
        ApiError::not_found("agent", &id.to_string())
    })?))
}
async fn delegate(
    State(state): State<ApiState>,
    Json(input): Json<DelegateInput>,
) -> ApiResult<Json<Delegation>> {
    Ok(Json(
        state
            .agent_auth
            .as_ref()
            .ok_or_else(unavailable)?
            .delegate(&state.database, input)?,
    ))
}
pub fn internal_router(state: ApiState) -> Router {
    Router::new()
        .route("/internal/mcp/delegate", post(delegate))
        .route("/readyz", get(|| async { StatusCode::NO_CONTENT }))
        .layer(DefaultBodyLimit::max(262144))
        .with_state(state)
}

#[cfg(unix)]
pub async fn start(
    state: ApiState,
) -> Result<Option<tokio::task::JoinHandle<()>>, Box<dyn std::error::Error>> {
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};
    let Some(authority) = &state.agent_auth else {
        return Ok(None);
    };
    // systemd owns the parent directory. Never create an arbitrary writable parent.
    let parent = authority.socket.parent().ok_or("missing socket parent")?;
    let metadata = std::fs::symlink_metadata(parent)?;
    if !metadata.is_dir() || metadata.permissions().mode() & 0o022 != 0 {
        return Err("unsafe MCP socket directory".into());
    }
    if let Ok(meta) = std::fs::symlink_metadata(&authority.socket) {
        if !meta.file_type().is_socket() {
            return Err("MCP socket path is not a socket".into());
        }
        std::fs::remove_file(&authority.socket)?;
    }
    let listener = tokio::net::UnixListener::bind(&authority.socket)?;
    std::fs::set_permissions(&authority.socket, std::fs::Permissions::from_mode(0o660))?;
    Ok(Some(tokio::spawn(async move {
        if axum::serve(listener, internal_router(state)).await.is_err() {
            tracing::error!(event = "mcp_auth_listener_failed");
        }
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn notebook() -> (tempfile::TempDir, Database, AgentAuthority) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test.sqlite")).unwrap();
        let authority = AgentAuthority::new(dir.path().join("auth.sock"));
        (dir, db, authority)
    }
    fn input(token: &str, name: &str, args: Value) -> DelegateInput {
        DelegateInput {
            token: token.into(),
            method: "tools/call".into(),
            name: Some(name.into()),
            uri: None,
            arguments: args,
        }
    }
    fn credential(db: &Database, write: bool) -> MintedAgentCredential {
        mint(
            db,
            AgentCredentialCreate {
                label: "test-only agent".into(),
                write,
                expires_in_days: Some(1),
                expires_in_years: None,
            },
        )
        .unwrap()
    }
    #[test]
    fn credential_and_delegation_audiences_are_disjoint_and_revocation_is_immediate() {
        let (_dir, db, auth) = notebook();
        let agent = credential(&db, false);
        let grant = auth
            .delegate(
                &db,
                input(
                    &agent.secret,
                    "tan_get_context",
                    json!({"resourceType":"coffee","id":42}),
                ),
            )
            .unwrap();
        let token = grant.token.unwrap();
        assert!(auth
            .authorize(&db, &agent.secret, &Method::GET, "/coffees/42/context")
            .is_err());
        assert!(auth
            .delegate(&db, input(&token, "tan_status", json!({})))
            .is_err());
        assert_eq!(
            auth.authorize(&db, &token, &Method::GET, "/coffees/42/context")
                .unwrap(),
            agent.credential.id
        );
        assert_eq!(
            auth.authorize(&db, &token, &Method::GET, "/coffees/43/context")
                .unwrap_err()
                .status,
            StatusCode::FORBIDDEN
        );
        assert!(auth
            .authorize(&db, &token, &Method::PATCH, "/coffees/42/context")
            .is_err());
        db.connection()
            .execute(
                "UPDATE agent_credentials SET revoked_at_ms=? WHERE id=?",
                params![now(), agent.credential.id],
            )
            .unwrap();
        assert_eq!(
            auth.authorize(&db, &token, &Method::GET, "/coffees/42/context")
                .unwrap_err()
                .status,
            StatusCode::UNAUTHORIZED
        );
    }
    #[test]
    fn scopes_and_unimplemented_tools_fail_closed() {
        let (_dir, db, auth) = notebook();
        let read = credential(&db, false);
        let write = credential(&db, true);
        assert_eq!(
            auth.delegate(&db, input(&read.secret, "tan_create_coffee", json!({})))
                .err()
                .unwrap()
                .status,
            StatusCode::FORBIDDEN
        );
        let grant = auth
            .delegate(&db, input(&write.secret, "tan_create_coffee", json!({})))
            .unwrap()
            .token
            .unwrap();
        assert!(auth
            .authorize(&db, &grant, &Method::POST, "/coffees")
            .is_ok());
        let brew = auth
            .delegate(
                &db,
                input(
                    &write.secret,
                    "tan_update_brew",
                    json!({"brewId": 8, "technique": "pour"}),
                ),
            )
            .unwrap()
            .token
            .unwrap();
        assert!(auth.authorize(&db, &brew, &Method::GET, "/brews/8").is_ok());
        assert!(auth
            .authorize(&db, &brew, &Method::PATCH, "/brews/8")
            .is_ok());
        assert!(auth
            .authorize(&db, &brew, &Method::GET, "/brews/9")
            .is_err());
        for path in [
            "/api-tokens",
            "/agent-credentials",
            "/bridges/claims",
            "/bridges/1/revoke",
            "/device/synchronize",
            "/coffees/1",
            "/coffees/../notes",
        ] {
            assert!(auth.authorize(&db, &grant, &Method::POST, path).is_err());
        }
        for name in [
            "tan_attach_file",
            "tan_sync_device",
            "raw_http",
            "tan_delete_coffee",
        ] {
            assert!(auth
                .delegate(&db, input(&write.secret, name, json!({})))
                .is_err());
        }
        assert!(auth
            .delegate(&db, input(&"a".repeat(64), "tan_status", json!({})))
            .is_err());
        assert!(auth
            .delegate(&db, input("tsmcp_wrong", "tan_status", json!({})))
            .is_err());
    }
    #[test]
    fn expiry_audience_version_signature_and_issuer_are_checked() {
        let (_dir, db, auth) = notebook();
        let agent = credential(&db, true);
        let token = auth
            .delegate(&db, input(&agent.secret, "tan_status", json!({})))
            .unwrap()
            .token
            .unwrap();
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&[API_AUDIENCE]);
        let original = decode::<Claims>(
            &token[6..],
            &DecodingKey::from_secret(&auth.key),
            &validation,
        )
        .unwrap()
        .claims;
        for change in ["aud", "iss", "exp", "version"] {
            let mut claims = Claims {
                iss: original.iss.clone(),
                aud: original.aud.clone(),
                sub: original.sub.clone(),
                exp: original.exp,
                iat: original.iat,
                parent: original.parent,
                version: original.version,
                routes: original.routes.clone(),
            };
            match change {
                "aud" => claims.aud = MCP_AUDIENCE.into(),
                "iss" => claims.iss = "attacker".into(),
                "exp" => claims.exp = 1,
                _ => claims.version += 1,
            }
            let signed = format!(
                "tsapi_{}",
                encode(
                    &Header::new(Algorithm::HS256),
                    &claims,
                    &EncodingKey::from_secret(&auth.key)
                )
                .unwrap()
            );
            assert!(auth
                .authorize(&db, &signed, &Method::GET, "/device")
                .is_err());
        }
        let other = AgentAuthority::new(PathBuf::from("/unused"));
        assert!(other
            .authorize(&db, &token, &Method::GET, "/device")
            .is_err());
        db.connection()
            .execute(
                "UPDATE agent_credentials SET audience='https://other.example/mcp' WHERE id=?",
                [agent.credential.id],
            )
            .unwrap();
        assert!(auth
            .delegate(&db, input(&agent.secret, "tan_status", json!({})))
            .is_err());
        db.connection()
            .execute(
                "UPDATE agent_credentials SET audience=?,expires_at_ms=1 WHERE id=?",
                params![MCP_AUDIENCE, agent.credential.id],
            )
            .unwrap();
        assert!(auth
            .authorize(&db, &token, &Method::GET, "/device")
            .is_err());
    }
    #[test]
    fn every_hosted_tool_has_an_explicit_policy_and_resources_cannot_fetch_urls() {
        let names = [
            "tan_status",
            "tan_list_pantry",
            "tan_search_profiles",
            "tan_search_coffees",
            "tan_search_roasts",
            "tan_get_context",
            "tan_get_roast",
            "tan_list_attachments",
            "tan_create_coffee",
            "tan_update_coffee",
            "tan_update_roast",
            "tan_record_brew",
            "tan_update_brew",
            "tan_add_note",
            "tan_set_profile_image",
            "tan_create_label",
        ];
        for name in names {
            assert!(!operation_routes("tools/call",Some(name),None,&json!({"id":1,"resourceId":1,"coffeeId":1,"brewId":1,"roastId":1,"resourceType":"coffee"})).unwrap().is_empty(),"{name}");
        }
        for uri in [
            "tan://pantry",
            "tan://device",
            "tan://profiles/1",
            "tan://coffees/1",
            "tan://roasts/1",
            "tan://brews/1",
        ] {
            assert!(operation_routes("resources/read", None, Some(uri), &Value::Null).is_ok());
        }
        for uri in [
            "file:///etc/passwd",
            "https://example.com",
            "tan://coffees/../1",
            "tan://coffees/1?x=2",
            "tan://coffees/0",
        ] {
            assert!(operation_routes("resources/read", None, Some(uri), &Value::Null).is_err());
        }
        assert!(operator(Credential::Agent(1)).is_err());
        assert!(operator(Credential::ApiToken(1)).is_err());
        assert!(operator(Credential::OperatorSession).is_ok());
    }
    #[test]
    fn secrets_are_hashed_and_metadata_never_contains_them() {
        let (_dir, db, _auth) = notebook();
        let agent = credential(&db, false);
        let digest: String = db
            .connection()
            .query_row(
                "SELECT token_sha256 FROM agent_credentials WHERE id=?",
                [agent.credential.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(digest, hex::encode(Sha256::digest(agent.secret.as_bytes())));
        assert!(!serde_json::to_string(&agent.credential)
            .unwrap()
            .contains(&agent.secret));
        assert!(mint(
            &db,
            AgentCredentialCreate {
                label: "bad".into(),
                write: false,
                expires_in_days: Some(91),
                expires_in_years: None
            }
        )
        .is_err());
    }
    #[test]
    fn five_year_expiry_preserves_calendar_date_and_rejects_ambiguous_terms() {
        let input = |days, years| AgentCredentialCreate {
            label: "Calendar fixture".into(),
            write: true,
            expires_in_days: days,
            expires_in_years: years,
        };
        let ts = |date: &str| {
            chrono::DateTime::parse_from_rfc3339(date)
                .unwrap()
                .timestamp_millis()
        };
        let issued = ts("2026-10-17T17:00:00.123Z");
        assert_eq!(
            credential_expiry(&input(None, Some(5)), issued).unwrap(),
            ts("2031-10-17T17:00:00.123Z")
        );
        assert_eq!(
            credential_expiry(&input(None, Some(5)), ts("2028-02-29T12:00:00Z")).unwrap(),
            ts("2033-02-28T12:00:00Z")
        );
        assert_eq!(
            credential_expiry(&input(None, None), issued).unwrap(),
            issued + 30 * 86_400_000
        );
        for (days, years) in [
            (Some(0), None),
            (Some(91), None),
            (None, Some(6)),
            (Some(30), Some(5)),
        ] {
            assert!(credential_expiry(&input(days, years), issued).is_err());
        }
        let (_dir, db, _auth) = notebook();
        let minted = mint(&db, input(None, Some(5))).unwrap();
        assert!(minted.credential.write);
        assert_eq!(
            minted.credential.expires_at_ms,
            credential_expiry(&input(None, Some(5)), minted.credential.created_at_ms).unwrap()
        );
    }
    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn hosted_bun_to_rust_isolated_integration() {
        use crate::{
            config::{AttachmentStore, API_CLIENT_ID},
            device::NanoDeviceManager,
        };
        let (directory, db, authority) = notebook();
        let reader = credential(&db, false);
        let writer = credential(&db, true);
        let config = ServiceConfig {
            mode: LaunchMode::Hosted,
            bind_host: "127.0.0.1".into(),
            port: 0,
            bridge_port: None,
            database_path: directory.path().join("test.sqlite"),
            web_root: None,
            launch_token: String::new(),
            allowed_origins: vec!["https://studio.tan.coffee".into()],
            allowed_hosts: vec!["studio.tan.coffee".into()],
            allowed_client_ids: vec![API_CLIENT_ID.into()],
            allow_originless_requests: true,
            application_version: "isolated-test".into(),
            development: true,
            operator_auth: None,
            attachment_store: AttachmentStore::LocalDisk,
        };
        let device = Arc::new(NanoDeviceManager::start(db.clone()));
        let mut state = ApiState::new(config, db, device.clone()).unwrap();
        let socket = authority.socket.clone();
        state.agent_auth = Some(Arc::new(authority));
        let auth_task = start(state.clone()).await.unwrap().unwrap();
        // Fixed ports are reserved for the no-network Docker fixture, never production.
        let bind = if std::env::var("TAN_TEST_BUNDLED_MCP").as_deref() == Ok("1") {
            "127.0.0.1:8080"
        } else {
            "127.0.0.1:0"
        };
        let listener = tokio::net::TcpListener::bind(bind).await.unwrap();
        let address = listener.local_addr().unwrap();
        let api_task = tokio::spawn(async move {
            axum::serve(listener, crate::build_router(state))
                .await
                .unwrap()
        });
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let result = tokio::task::spawn_blocking(move || {
            std::process::Command::new("bun")
                .arg("run")
                .arg("plugins/tan-studio/scripts/hosted-integration.ts")
                .current_dir(root)
                .env("TAN_TEST_SOCKET", socket)
                .env("TAN_TEST_API_URL", format!("http://{address}"))
                .env("TAN_TEST_READ_TOKEN", reader.secret)
                .env("TAN_TEST_WRITE_TOKEN", writer.secret)
                .output()
        })
        .await
        .unwrap()
        .unwrap();
        auth_task.abort();
        api_task.abort();
        device.stop();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
