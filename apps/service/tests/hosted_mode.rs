use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

use axum::{
    body::{to_bytes, Body},
    extract::{Query, State},
    http::{header, HeaderMap, Method, Request, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Form, Json, Router,
};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tan_studio_service::device::NanoDeviceManager;
use tan_studio_service::{
    build_router,
    config::{API_CLIENT_ID, HOSTED_CLIENT_ID},
    ApiState, Database, LaunchMode, OperatorAuthConfig, ServiceConfig,
};
use tempfile::TempDir;
use tower::ServiceExt;

const STUDIO_HOST: &str = "studio.tan.coffee";
/// Every request the hosted SPA makes carries its client identity; so must the tests.
const HOSTED_CLIENT: &[(&str, &str)] = &[("x-tan-studio-client", HOSTED_CLIENT_ID)];
const STUDIO_ORIGIN: &str = "https://studio.tan.coffee";
const OPERATOR_EMAIL: &str = "operator@tan.coffee";
const OTHER_EMAIL: &str = "intruder@gmail.com";
const OIDC_CLIENT_ID: &str = "test-google-client";
const OIDC_CLIENT_SECRET: &str = "test-google-secret";
const SESSION_SECRET: [u8; 32] = [0x5a; 32];
const INDEX_HTML: &str =
    "<!doctype html><html><head><title>Tan Studio</title></head><body><div id=\"root\"></div></body></html>";
const TEST_RSA_PEM: &str = "-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCprBdBiIotGGwv
XDuhhscz9dH8oOzwMOjtr/D+BEVTn4pHxWSVfUEYgSjq4vapeoubbBS+5wkaIdNu
1kAyj/gXHIE0AiOTcKOeTkimyUMjjjdSx8O4UGA8bUNn5rwNy18l9fMWRvQxida2
wJVdG5Y0goUM57zCoBV1kx+Bjihcbl5X/+1naAvsWOpOCUbqludr5wTeF9RYQQxm
eVIBSJqPZW3A6BqJkI3y6j4mO9yfANwOhtwBWAo/FWmbpOyLFzuEfk4tC2esFr9j
iPCIXEf9X4JE6luLuAGAUIWjT7n2JMSURdGMgFgmg8niKmWR7qG9PBBT7XPaCtjI
5y+fZSizAgMBAAECggEAXLKNfhs3yo1mRbWxSn1VBdlOYSQWbt950qnmExGIQriO
FsoMOvPUhavDDBj1xAAUl9RDvUyCF4nVdt+M8VLgqtfC6wQkJaBLc+i3HpAkox9G
sG49Ssx212ymf/R6V1r938JwjYI0VYBGE1BCCj1RId0RDczpvrcxIiw/8UsWV/B8
0nsJrQr7S7cJwkH/A5EkvvqvfyyaK2dAdSG/IMaeVZwSe/SlbCrU+TQgKgmLngXP
/UBcEpfOw9C/do9DXhleh75ggghXVw4mo5aqyy1OVSN/16lrt146xl/t56sMqlYS
gKlVANLd4N1jQFfJ5GRQ3mco0UKp1jPlekPKEnueuQKBgQDSuDpHm2xFv0ghial2
sI3q8riVqGni7hoQHL9teL/msinjgR25J1wC4wXiDA7eDusTK3Q/b8zEUUOg5hbI
CgolKyR3yYFWpOEnvR5acn0cyTsmmq5l7JpQxt0cdypNvuLsgODpRBq1LSjl0mSN
R8s6UDVtoQ4+vAsvb7gGqqOq5QKBgQDOIdQh0T229MlrFnhxUNINQM8YVT7L20RS
gVJjyE4jMVVOsNmbWxizYw0VJznuUHhLjMO19xDCEwfdCLPjGhhmp7w7U8vkddtT
7bvbE0o6EKTvCyCAWfS6Vi1rRwIqGw2O9M0at3arbyk6LRu79e0OZBTOEQ95sTc9
UCqWvWsTtwKBgEEc0k1sNmG7ALP0UNwvJDtUczszhjysLHuMFo7iQBIuPYliTWf4
RJNTyW6XIUT2wSb0R4COsGx9W/NtBd8cUxQ3J5aoOoImgrh/1NBIDmcFu3RrWbZ/
DRQmzw5LuFO7x20jSdxqwgH4CWoywAV0CNVlEY1ltfwmqSIoWGoe8mINAoGBAMDN
bXBwGSxui5LpgqBiuwYAb3RQD5t3rNEK+vgv274ZH7Spv/AK5fCsHgmCFjJs/AeW
U1x5CiisyjcZM8CgoOAr1ekb+OLoxcwb2hEQWuYyuUKJgs3q1fgQMQ1dbo3ZnfXv
zYRGw+2X3NT4ai+F2EQUok0YMgReGM/1ktBJvcTDAoGAM7xkoDIcnD+B2t50BxFd
pfhdNHv3FjZjLvtrPLVt4PEC3rFM5jsFeQ8IisC7DjG2nxlZtYINDrMQtOpGO1in
PnzHujjU2A750Zb5uAF41riA/zBx3ramPiTc8P9HcfeEcIHFo68xN0n7DUJFWWGA
j+RM6GQ+PoIFoa/2mR+CYYw=
-----END PRIVATE KEY-----";
const TEST_RSA_N: &str = "qawXQYiKLRhsL1w7oYbHM_XR_KDs8DDo7a_w_gRFU5-KR8VklX1BGIEo6uL2qXqLm2wUvucJGiHTbtZAMo_4FxyBNAIjk3Cjnk5IpslDI443UsfDuFBgPG1DZ-a8DctfJfXzFkb0MYnWtsCVXRuWNIKFDOe8wqAVdZMfgY4oXG5eV__tZ2gL7FjqTglG6pbna-cE3hfUWEEMZnlSAUiaj2VtwOgaiZCN8uo-JjvcnwDcDobcAVgKPxVpm6Tsixc7hH5OLQtnrBa_Y4jwiFxH_V-CROpbi7gBgFCFo0-59iTElEXRjIBYJoPJ4iplke6hvTwQU-1z2grYyOcvn2Uosw";

struct Hosted {
    app: Router,
    _directory: TempDir,
    device: Arc<NanoDeviceManager>,
}

impl Drop for Hosted {
    fn drop(&mut self) {
        self.device.stop();
    }
}

struct FakeIssuer {
    base_url: String,
    email: Arc<Mutex<String>>,
    _task: tokio::task::JoinHandle<()>,
}

impl FakeIssuer {
    async fn start(email: &str) -> Self {
        let email = Arc::new(Mutex::new(email.to_owned()));
        let codes = Arc::new(Mutex::new(HashMap::<String, (String, String)>::new()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake OIDC issuer");
        let addr = listener.local_addr().expect("fake OIDC address");
        let base_url = format!("http://{addr}");
        let state = IssuerState {
            issuer: base_url.clone(),
            email: email.clone(),
            codes: codes.clone(),
        };
        let app = Router::new()
            .route("/.well-known/openid-configuration", get(issuer_discovery))
            .route("/authorize", get(issuer_authorize))
            .route("/token", post(issuer_token))
            .route("/jwks", get(issuer_jwks))
            .with_state(state);
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("fake OIDC serve");
        });
        Self {
            base_url,
            email,
            _task: task,
        }
    }

    fn sign_in_as(&self, email: &str) {
        *self.email.lock().expect("fake OIDC email") = email.to_owned();
    }
}

#[derive(Clone)]
struct IssuerState {
    issuer: String,
    email: Arc<Mutex<String>>,
    codes: Arc<Mutex<HashMap<String, (String, String)>>>,
}

#[derive(Debug, Deserialize)]
struct AuthorizeQuery {
    client_id: String,
    redirect_uri: String,
    response_type: String,
    state: String,
    nonce: String,
}

#[derive(Debug, Deserialize)]
struct TokenForm {
    grant_type: String,
    code: String,
    redirect_uri: String,
    client_id: String,
    client_secret: String,
}

#[derive(Debug, Serialize)]
struct FakeClaims {
    iss: String,
    sub: String,
    aud: String,
    exp: i64,
    iat: i64,
    nonce: String,
    email: String,
    email_verified: bool,
}

async fn issuer_discovery(State(state): State<IssuerState>) -> Json<Value> {
    Json(json!({
        "issuer": state.issuer,
        "authorization_endpoint": format!("{}/authorize", state.issuer),
        "token_endpoint": format!("{}/token", state.issuer),
        "jwks_uri": format!("{}/jwks", state.issuer),
        "id_token_signing_alg_values_supported": ["RS256"],
    }))
}

async fn issuer_authorize(
    State(state): State<IssuerState>,
    Query(query): Query<AuthorizeQuery>,
) -> Response {
    if query.client_id != OIDC_CLIENT_ID || query.response_type != "code" {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let code = uuid::Uuid::now_v7().to_string();
    let email = state.email.lock().expect("fake OIDC email").clone();
    state
        .codes
        .lock()
        .expect("fake OIDC codes")
        .insert(code.clone(), (email, query.nonce));
    let separator = if query.redirect_uri.contains('?') {
        '&'
    } else {
        '?'
    };
    Redirect::temporary(&format!(
        "{}{separator}code={code}&state={}",
        query.redirect_uri, query.state
    ))
    .into_response()
}

async fn issuer_token(State(state): State<IssuerState>, Form(form): Form<TokenForm>) -> Response {
    if form.grant_type != "authorization_code"
        || form.client_id != OIDC_CLIENT_ID
        || form.client_secret != OIDC_CLIENT_SECRET
        || form.redirect_uri != "https://studio.tan.coffee/auth/google/callback"
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some((email, nonce)) = state
        .codes
        .lock()
        .expect("fake OIDC codes")
        .remove(&form.code)
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let now = chrono::Utc::now().timestamp();
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("test-key".into());
    let token = encode(
        &header,
        &FakeClaims {
            iss: state.issuer.clone(),
            sub: "google-subject".into(),
            aud: OIDC_CLIENT_ID.into(),
            exp: now + 3600,
            iat: now,
            nonce,
            email,
            email_verified: true,
        },
        &EncodingKey::from_rsa_pem(TEST_RSA_PEM.as_bytes()).expect("test RSA key"),
    )
    .expect("id_token");
    Json(json!({ "id_token": token, "token_type": "Bearer" })).into_response()
}

async fn issuer_jwks() -> Json<Value> {
    Json(json!({
        "keys": [{
            "kty": "RSA",
            "kid": "test-key",
            "use": "sig",
            "alg": "RS256",
            "n": TEST_RSA_N,
            "e": "AQAB"
        }]
    }))
}

fn hosted_config(database_path: &Path, web_root: &Path, issuer: &str) -> ServiceConfig {
    ServiceConfig {
        mode: LaunchMode::Hosted,
        bind_host: "0.0.0.0".into(),
        port: 8080,
        bridge_port: None,
        database_path: database_path.to_path_buf(),
        web_root: Some(web_root.to_path_buf()),
        launch_token: String::new(),
        allowed_origins: vec![STUDIO_ORIGIN.into()],
        allowed_hosts: vec![STUDIO_HOST.into()],
        allowed_client_ids: vec![HOSTED_CLIENT_ID.into(), API_CLIENT_ID.into()],
        // Mirrors `ServiceConfig::hosted()`; see `hosted_allows_originless_same_origin_requests`.
        allow_originless_requests: true,
        application_version: "test".into(),
        development: false,
        operator_auth: Some(OperatorAuthConfig {
            operator_email: OPERATOR_EMAIL.into(),
            oidc_issuer: issuer.into(),
            oidc_client_id: OIDC_CLIENT_ID.into(),
            oidc_client_secret: OIDC_CLIENT_SECRET.into(),
            oidc_redirect_uri: "https://studio.tan.coffee/auth/google/callback".into(),
            session_secret: SESSION_SECRET.to_vec(),
        }),
    }
}

fn hosted_app(issuer: &str) -> Hosted {
    let directory = TempDir::new().unwrap();
    let web_root = directory.path().join("web");
    std::fs::create_dir_all(&web_root).unwrap();
    std::fs::write(web_root.join("index.html"), INDEX_HTML).unwrap();
    let database_path = directory.path().join("studio.sqlite");
    let database = Database::open(&database_path).unwrap();
    let device = Arc::new(NanoDeviceManager::start(database.clone()));
    let app = build_router(
        ApiState::new(
            hosted_config(&database_path, &web_root, issuer),
            database,
            device.clone(),
        )
        .unwrap(),
    );
    Hosted {
        app,
        _directory: directory,
        device,
    }
}

fn desktop_app() -> Hosted {
    let directory = TempDir::new().unwrap();
    let database_path = directory.path().join("studio.sqlite");
    let database = Database::open(&database_path).unwrap();
    let device = Arc::new(NanoDeviceManager::start(database.clone()));
    let config = ServiceConfig {
        mode: LaunchMode::Desktop,
        bind_host: "127.0.0.1".into(),
        port: 4317,
        bridge_port: None,
        database_path: database_path.clone(),
        web_root: None,
        launch_token: "test-contract-token".into(),
        allowed_origins: vec!["http://127.0.0.1:1420".into()],
        allowed_hosts: vec![],
        allowed_client_ids: vec!["tan-studio-browser-dev".into()],
        allow_originless_requests: false,
        application_version: "test".into(),
        development: true,
        operator_auth: None,
    };
    Hosted {
        app: build_router(ApiState::new(config, database, device.clone()).unwrap()),
        _directory: directory,
        device,
    }
}

fn headless_app() -> Hosted {
    let directory = TempDir::new().unwrap();
    let web_root = directory.path().join("web");
    std::fs::create_dir_all(&web_root).unwrap();
    std::fs::write(web_root.join("index.html"), INDEX_HTML).unwrap();
    let database_path = directory.path().join("studio.sqlite");
    let database = Database::open(&database_path).unwrap();
    let device = Arc::new(NanoDeviceManager::start(database.clone()));
    let config = ServiceConfig {
        mode: LaunchMode::Headless,
        bind_host: "0.0.0.0".into(),
        port: 8080,
        bridge_port: None,
        database_path: database_path.clone(),
        web_root: Some(web_root),
        launch_token: "ab".repeat(32),
        allowed_origins: vec!["http://tan-studio.local".into()],
        allowed_hosts: vec!["tan-studio.local".into()],
        allowed_client_ids: vec!["tan-studio-lan-v1".into(), "tan-studio-api-v1".into()],
        allow_originless_requests: true,
        application_version: "test".into(),
        development: false,
        operator_auth: None,
    };
    Hosted {
        app: build_router(ApiState::new(config, database, device.clone()).unwrap()),
        _directory: directory,
        device,
    }
}

async fn send(
    app: &Router,
    method: Method,
    path: &str,
    host: &str,
    origin: Option<&str>,
    cookie: Option<&str>,
    extra: &[(&str, &str)],
) -> (StatusCode, HeaderMap, axum::body::Bytes) {
    dispatch(app, method, path, host, origin, cookie, extra, None).await
}

#[allow(clippy::too_many_arguments)]
async fn send_json(
    app: &Router,
    method: Method,
    path: &str,
    host: &str,
    origin: Option<&str>,
    cookie: Option<&str>,
    extra: &[(&str, &str)],
    body: Value,
) -> (StatusCode, HeaderMap, axum::body::Bytes) {
    dispatch(app, method, path, host, origin, cookie, extra, Some(body)).await
}

#[allow(clippy::too_many_arguments)]
async fn dispatch(
    app: &Router,
    method: Method,
    path: &str,
    host: &str,
    origin: Option<&str>,
    cookie: Option<&str>,
    extra: &[(&str, &str)],
    body: Option<Value>,
) -> (StatusCode, HeaderMap, axum::body::Bytes) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, host);
    if body.is_some() {
        request = request.header(header::CONTENT_TYPE, "application/json");
    }
    if let Some(origin) = origin {
        request = request.header(header::ORIGIN, origin);
    }
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    for (name, value) in extra {
        request = request.header(*name, *value);
    }
    let body = body
        .map(|value| Body::from(value.to_string()))
        .unwrap_or_else(Body::empty);
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    (status, headers, bytes)
}

fn json_body(bytes: &[u8]) -> Value {
    if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(bytes).unwrap()
    }
}

fn apply_cookies(jar: &mut HashMap<String, String>, headers: &HeaderMap) {
    for value in headers.get_all(header::SET_COOKIE) {
        let Ok(value) = value.to_str() else {
            continue;
        };
        let (pair, attrs) = value.split_once(';').unwrap_or((value, ""));
        let Some((name, cookie_value)) = pair.split_once('=') else {
            continue;
        };
        let expired = attrs
            .split(';')
            .any(|part| part.trim().eq_ignore_ascii_case("Max-Age=0"));
        if expired || cookie_value.is_empty() {
            jar.remove(name);
        } else {
            jar.insert(name.to_owned(), cookie_value.to_owned());
        }
    }
}

fn cookie_header(jar: &HashMap<String, String>) -> Option<String> {
    if jar.is_empty() {
        None
    } else {
        Some(
            jar.iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; "),
        )
    }
}

fn session_set_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::SET_COOKIE)
        .iter()
        .find_map(|value| {
            let value = value.to_str().ok()?;
            value
                .starts_with("tan_operator_session=")
                .then(|| value.to_owned())
        })
}

async fn complete_google_login(
    app: &Router,
    issuer: &FakeIssuer,
    jar: &mut HashMap<String, String>,
) -> (StatusCode, HeaderMap, axum::body::Bytes) {
    let (status, headers, _body) = send(
        app,
        Method::GET,
        "/auth/google",
        STUDIO_HOST,
        None,
        cookie_header(jar).as_deref(),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::FOUND);
    apply_cookies(jar, &headers);
    let location = headers
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .expect("authorize redirect");
    assert!(location.starts_with(&format!("{}/authorize?", issuer.base_url)));
    assert!(location.contains("client_id=test-google-client"));
    assert!(!location.contains("test-google-secret"));
    let authorize = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .get(location)
        .send()
        .await
        .unwrap();
    assert_eq!(authorize.status(), StatusCode::TEMPORARY_REDIRECT);
    let callback = authorize
        .headers()
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .expect("callback redirect");
    assert!(callback.starts_with("https://studio.tan.coffee/auth/google/callback?"));
    let callback_path = callback
        .strip_prefix("https://studio.tan.coffee")
        .expect("studio callback");
    send(
        app,
        Method::GET,
        callback_path,
        STUDIO_HOST,
        None,
        cookie_header(jar).as_deref(),
        &[],
    )
    .await
}

#[tokio::test]
async fn hosted_allows_studio_host_and_rejects_hostile_hosts() {
    let hosted = hosted_app("http://127.0.0.1:1");
    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/healthz",
        STUDIO_HOST,
        None,
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_body(&body)["status"], "ok");

    for host in [
        "evil.example",
        "tan.coffee",
        "studio.tan.coffee.evil.example",
    ] {
        let (status, _, body) =
            send(&hosted.app, Method::GET, "/healthz", host, None, None, &[]).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{host}");
        assert_eq!(json_body(&body)["code"], "host_not_allowed");
    }
}

#[tokio::test]
async fn hosted_html_carries_no_token_and_no_session_secret() {
    let hosted = hosted_app("http://127.0.0.1:1");
    let (status, headers, body) =
        send(&hosted.app, Method::GET, "/", STUDIO_HOST, None, None, &[]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/html; charset=utf-8")
    );
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(html.contains("token:null"));
    assert!(html.contains(&format!("clientId:\"{HOSTED_CLIENT_ID}\"")));
    assert!(html.contains("Tan Studio"));
    assert!(!html.contains("test-google-secret"));
    assert!(!html.contains("5a5a5a5a"));
    assert!(!html.contains("token:\""));
    assert!(!html.contains("Bearer "));
}

/// Browsers omit `Origin` on same-origin GETs and hosted mode serves its own SPA
/// same-origin, so an absent `Origin` must reach authentication rather than being
/// refused as `origin_not_allowed`.
#[tokio::test]
async fn hosted_serves_its_own_spa_when_the_browser_omits_origin() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        None,
        None,
        HOSTED_CLIENT,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "an originless request must be judged on its session, not refused as a foreign origin"
    );
    assert_eq!(json_body(&body)["code"], "unauthenticated");

    let mut jar = HashMap::new();
    let (status, headers, _) = complete_google_login(&hosted.app, &issuer, &mut jar).await;
    assert_eq!(status, StatusCode::FOUND);
    apply_cookies(&mut jar, &headers);

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        None,
        cookie_header(&jar).as_deref(),
        HOSTED_CLIENT,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", json_body(&body));
    assert!(json_body(&body)["items"].as_array().unwrap().is_empty());
}

/// An absent `Origin` is allowed, but a foreign one is not, even with a valid session.
#[tokio::test]
async fn hosted_refuses_a_foreign_origin_even_with_an_operator_session() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let mut jar = HashMap::new();
    let (status, headers, _) = complete_google_login(&hosted.app, &issuer, &mut jar).await;
    assert_eq!(status, StatusCode::FOUND);
    apply_cookies(&mut jar, &headers);

    for origin in [
        "https://evil.example",
        "https://studio.tan.coffee.evil.example",
    ] {
        let (status, _, body) = send(
            &hosted.app,
            Method::GET,
            "/api/v1/profiles",
            STUDIO_HOST,
            Some(origin),
            cookie_header(&jar).as_deref(),
            HOSTED_CLIENT,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{origin}");
        assert_eq!(json_body(&body)["code"], "origin_not_allowed");
    }
}

#[tokio::test]
async fn hosted_api_requires_operator_session_and_studio_origin() {
    let hosted = hosted_app("http://127.0.0.1:1");
    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        None,
        HOSTED_CLIENT,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json_body(&body)["code"], "unauthenticated");

    // Hosted mode now accepts a bearer, but only a token it minted itself. A secret
    // borrowed from somewhere else — here the OIDC client secret — is still nothing.
    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        None,
        &[
            ("authorization", "Bearer test-google-secret"),
            ("x-tan-studio-client", HOSTED_CLIENT_ID),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json_body(&body)["code"], "unauthenticated");

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        Some("https://evil.example"),
        None,
        HOSTED_CLIENT,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json_body(&body)["code"], "origin_not_allowed");
}

#[tokio::test]
async fn google_login_sets_operator_cookie_and_allowlist_refuses_other_accounts() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let mut jar = HashMap::new();
    let (status, headers, _) = complete_google_login(&hosted.app, &issuer, &mut jar).await;
    assert_eq!(status, StatusCode::FOUND);
    let set_cookie = session_set_cookie(&headers).expect("operator session cookie");
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("Secure"));
    assert!(set_cookie.to_ascii_lowercase().contains("samesite=lax"));
    assert!(set_cookie.contains("Path=/"));
    apply_cookies(&mut jar, &headers);
    assert!(jar.contains_key("tan_operator_session"));

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        HOSTED_CLIENT,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", json_body(&body));
    assert!(json_body(&body)["items"].as_array().unwrap().is_empty());

    let (status, headers, body) = send(
        &hosted.app,
        Method::GET,
        "/",
        STUDIO_HOST,
        None,
        cookie_header(&jar).as_deref(),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(!html.contains(jar.get("tan_operator_session").unwrap()));
    assert_eq!(
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/html; charset=utf-8")
    );

    issuer.sign_in_as(OTHER_EMAIL);
    let mut stranger = HashMap::new();
    let (status, headers, body) = complete_google_login(&hosted.app, &issuer, &mut stranger).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(html.contains("You are not the operator of this notebook."));
    assert!(!html.contains("id=\"root\""));
    assert!(session_set_cookie(&headers).is_none());
    apply_cookies(&mut stranger, &headers);
    assert!(!stranger.contains_key("tan_operator_session"));

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&stranger).as_deref(),
        HOSTED_CLIENT,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json_body(&body)["code"], "unauthenticated");
}

#[tokio::test]
async fn sign_out_clears_the_operator_session() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let mut jar = HashMap::new();
    let (status, headers, _) = complete_google_login(&hosted.app, &issuer, &mut jar).await;
    assert_eq!(status, StatusCode::FOUND);
    apply_cookies(&mut jar, &headers);

    let (status, headers, _) = send(
        &hosted.app,
        Method::POST,
        "/auth/logout",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::FOUND);
    apply_cookies(&mut jar, &headers);
    assert!(!jar.contains_key("tan_operator_session"));
    let logout_cookie = session_set_cookie(&headers).expect("cleared session cookie");
    assert!(logout_cookie.contains("Max-Age=0"));

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        HOSTED_CLIENT,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json_body(&body)["code"], "unauthenticated");
}

#[tokio::test]
async fn desktop_bearer_still_works_and_rejects_studio_host() {
    let desktop = desktop_app();
    let (status, _, body) = send(
        &desktop.app,
        Method::GET,
        "/api/v1/profiles",
        "127.0.0.1:4317",
        Some("http://127.0.0.1:1420"),
        None,
        &[
            ("authorization", "Bearer test-contract-token"),
            ("x-tan-studio-client", "tan-studio-browser-dev"),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", json_body(&body));

    let (status, _, body) = send(
        &desktop.app,
        Method::GET,
        "/healthz",
        STUDIO_HOST,
        None,
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json_body(&body)["code"], "host_not_allowed");
}

#[tokio::test]
async fn lan_token_still_works_in_headless_mode() {
    let headless = headless_app();
    let (status, _, body) = send(
        &headless.app,
        Method::GET,
        "/api/v1/profiles",
        "tan-studio.local",
        Some("http://tan-studio.local"),
        None,
        &[
            ("authorization", &format!("Bearer {}", "ab".repeat(32))),
            ("x-tan-studio-client", "tan-studio-lan-v1"),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", json_body(&body));

    let (status, headers, body) = send(
        &headless.app,
        Method::GET,
        "/",
        "tan-studio.local",
        None,
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/html; charset=utf-8")
    );
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(html.contains(&format!(
        "token:{}",
        serde_json::to_string(&"ab".repeat(32)).unwrap()
    )));
}

/// Signs in and mints one API token the way the operator does: from behind their
/// own session. Returns the secret, which the notebook shows exactly once.
async fn mint_api_token(app: &Router, issuer: &FakeIssuer, label: &str) -> (String, i64) {
    let mut jar = HashMap::new();
    let (status, headers, _) = complete_google_login(app, issuer, &mut jar).await;
    assert_eq!(status, StatusCode::FOUND);
    apply_cookies(&mut jar, &headers);

    let (status, _, body) = send_json(
        app,
        Method::POST,
        "/api/v1/api-tokens",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        HOSTED_CLIENT,
        json!({ "label": label }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{}", json_body(&body));
    let minted = json_body(&body);
    (
        minted["secret"].as_str().expect("minted secret").to_owned(),
        minted["token"]["id"].as_i64().expect("minted token id"),
    )
}

/// The whole point of the ticket: the MCP plugin sends `Authorization: Bearer` plus
/// its client identity and no cookie at all, from a machine that is not the VM.
#[tokio::test]
async fn a_minted_token_authenticates_an_mcp_shaped_request() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let (secret, _id) = mint_api_token(&hosted.app, &issuer, "codex plugin").await;

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/coffees",
        STUDIO_HOST,
        None,
        None,
        &[
            ("authorization", &format!("Bearer {secret}")),
            ("x-tan-studio-client", API_CLIENT_ID),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", json_body(&body));
    assert!(json_body(&body)["items"].as_array().unwrap().is_empty());

    // The contract itself must be readable by the client that has to obey it.
    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/openapi.json",
        STUDIO_HOST,
        None,
        None,
        &[
            ("authorization", &format!("Bearer {secret}")),
            ("x-tan-studio-client", API_CLIENT_ID),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json_body(&body)["paths"]["/api/v1/coffees"].is_object());
}

#[tokio::test]
async fn the_minted_secret_is_shown_once_and_never_listed() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let (secret, id) = mint_api_token(&hosted.app, &issuer, "codex plugin").await;

    let mut jar = HashMap::new();
    let (_, headers, _) = complete_google_login(&hosted.app, &issuer, &mut jar).await;
    apply_cookies(&mut jar, &headers);
    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/api-tokens",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        HOSTED_CLIENT,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{}", json_body(&body));
    let listing = String::from_utf8(body.to_vec()).unwrap();
    assert!(
        !listing.contains(&secret),
        "a listing must never carry the secret back"
    );
    let listed = json_body(&body);
    let listed = &listed["items"][0];
    assert_eq!(listed["id"].as_i64(), Some(id));
    assert_eq!(listed["label"], "codex plugin");
    assert!(listed["revokedAt"].is_null());
}

#[tokio::test]
async fn hosted_refuses_unknown_and_revoked_api_tokens() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let (secret, id) = mint_api_token(&hosted.app, &issuer, "codex plugin").await;

    for unknown in ["f".repeat(64), "not-a-token".into(), String::new()] {
        let (status, _, body) = send(
            &hosted.app,
            Method::GET,
            "/api/v1/coffees",
            STUDIO_HOST,
            None,
            None,
            &[
                ("authorization", &format!("Bearer {unknown}")),
                ("x-tan-studio-client", API_CLIENT_ID),
            ],
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{unknown}");
        assert_eq!(json_body(&body)["code"], "unauthenticated");
    }

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/coffees",
        STUDIO_HOST,
        None,
        None,
        &[("x-tan-studio-client", API_CLIENT_ID)],
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json_body(&body)["code"], "unauthenticated");

    let mut jar = HashMap::new();
    let (_, headers, _) = complete_google_login(&hosted.app, &issuer, &mut jar).await;
    apply_cookies(&mut jar, &headers);
    let (status, _, body) = send_json(
        &hosted.app,
        Method::POST,
        &format!("/api/v1/api-tokens/{id}/revoke"),
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        HOSTED_CLIENT,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", json_body(&body));
    assert!(json_body(&body)["revokedAt"].is_string());

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/coffees",
        STUDIO_HOST,
        None,
        None,
        &[
            ("authorization", &format!("Bearer {secret}")),
            ("x-tan-studio-client", API_CLIENT_ID),
        ],
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a revoked token must stop working at once"
    );
    assert_eq!(json_body(&body)["code"], "unauthenticated");
}

/// `allowed_client_ids` is defence in depth on both credentials, and on the cookie
/// it is also the CSRF gate: a cross-site form post cannot set a custom header.
#[tokio::test]
async fn hosted_refuses_an_unrecognized_client_identity() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let (secret, _id) = mint_api_token(&hosted.app, &issuer, "codex plugin").await;
    let mut jar = HashMap::new();
    let (_, headers, _) = complete_google_login(&hosted.app, &issuer, &mut jar).await;
    apply_cookies(&mut jar, &headers);

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/coffees",
        STUDIO_HOST,
        None,
        None,
        &[
            ("authorization", &format!("Bearer {secret}")),
            ("x-tan-studio-client", "tan-studio-lan-v1"),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{}", json_body(&body));
    assert_eq!(json_body(&body)["code"], "unauthenticated");

    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/coffees",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        &[("x-tan-studio-client", "tan-studio-lan-v1")],
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{}", json_body(&body));

    let (status, _, body) = send_json(
        &hosted.app,
        Method::POST,
        "/api/v1/coffees",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        &[],
        json!({ "name": "Cross-site coffee" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a cookie mutation without the client header is a cross-site form post"
    );
    assert_eq!(json_body(&body)["code"], "unauthenticated");
}

/// A leaked API token must not be able to mint itself a successor, or revoke the
/// operator's other tokens.
#[tokio::test]
async fn an_api_token_can_neither_mint_nor_revoke_api_tokens() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let (secret, id) = mint_api_token(&hosted.app, &issuer, "codex plugin").await;
    let bearer = format!("Bearer {secret}");
    let api_client: &[(&str, &str)] = &[
        ("authorization", &bearer),
        ("x-tan-studio-client", API_CLIENT_ID),
    ];

    let (status, _, body) = send_json(
        &hosted.app,
        Method::POST,
        "/api/v1/api-tokens",
        STUDIO_HOST,
        None,
        None,
        api_client,
        json!({ "label": "a successor" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{}", json_body(&body));
    assert_eq!(json_body(&body)["code"], "operator_session_required");

    let (status, _, body) = send_json(
        &hosted.app,
        Method::POST,
        &format!("/api/v1/api-tokens/{id}/revoke"),
        STUDIO_HOST,
        None,
        None,
        api_client,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{}", json_body(&body));

    let (status, _, _) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/api-tokens",
        STUDIO_HOST,
        None,
        None,
        api_client,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// A GET sign-out is a link any other site can fire with an `<img src>`.
#[tokio::test]
async fn sign_out_refuses_a_get() {
    let issuer = FakeIssuer::start(OPERATOR_EMAIL).await;
    let hosted = hosted_app(&issuer.base_url);
    let mut jar = HashMap::new();
    let (status, headers, _) = complete_google_login(&hosted.app, &issuer, &mut jar).await;
    assert_eq!(status, StatusCode::FOUND);
    apply_cookies(&mut jar, &headers);

    let (status, headers, _) = send(
        &hosted.app,
        Method::GET,
        "/auth/logout",
        STUDIO_HOST,
        None,
        cookie_header(&jar).as_deref(),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    assert!(session_set_cookie(&headers).is_none());
    let (status, _, body) = send(
        &hosted.app,
        Method::GET,
        "/api/v1/profiles",
        STUDIO_HOST,
        Some(STUDIO_ORIGIN),
        cookie_header(&jar).as_deref(),
        HOSTED_CLIENT,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", json_body(&body));
}
