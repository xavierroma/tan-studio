use std::collections::HashMap;

use axum::{
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use sha2::Sha256;

use crate::{config::OperatorAuthConfig, error::ApiError};

pub const OPERATOR_SESSION_COOKIE: &str = "tan_operator_session";
pub const OIDC_STATE_COOKIE: &str = "tan_oidc_state";

const SESSION_TTL_SECS: i64 = 12 * 60 * 60;
const OIDC_STATE_TTL_SECS: i64 = 10 * 60;

#[derive(Debug, Deserialize)]
pub struct OidcCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DiscoveryDocument {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JsonWebKeySet {
    keys: Vec<JsonWebKey>,
}

#[derive(Debug, Deserialize)]
struct JsonWebKey {
    kid: Option<String>,
    kty: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IdTokenClaims {
    nonce: Option<String>,
    email: Option<String>,
    email_verified: Option<bool>,
}

pub async fn start_google_login(auth: &OperatorAuthConfig, http: &reqwest::Client) -> Response {
    let discovery = match discover(http, &auth.oidc_issuer).await {
        Ok(discovery) => discovery,
        Err(error) => return error.into_response(),
    };
    let state = uuid::Uuid::now_v7().to_string();
    let nonce = uuid::Uuid::now_v7().to_string();
    let Ok(mut url) = reqwest::Url::parse(&discovery.authorization_endpoint) else {
        return oidc_misconfigured();
    };
    url.query_pairs_mut()
        .append_pair("client_id", &auth.oidc_client_id)
        .append_pair("redirect_uri", &auth.oidc_redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email")
        .append_pair("state", &state)
        .append_pair("nonce", &nonce);
    let Some(state_cookie) = signed_cookie_header(
        OIDC_STATE_COOKIE,
        &encode_payload(&[&state, &nonce], now_unix() + OIDC_STATE_TTL_SECS),
        &auth.session_secret,
        OIDC_STATE_TTL_SECS,
    ) else {
        return oidc_misconfigured();
    };
    let Ok(location) = HeaderValue::from_str(url.as_str()) else {
        return oidc_misconfigured();
    };
    let mut response = StatusCode::FOUND.into_response();
    response.headers_mut().insert(header::LOCATION, location);
    response
        .headers_mut()
        .append(header::SET_COOKIE, state_cookie);
    response
}

pub async fn finish_google_login(
    auth: &OperatorAuthConfig,
    http: &reqwest::Client,
    headers: &HeaderMap,
    query: OidcCallbackQuery,
) -> Response {
    if query.error.is_some() {
        return html_page(
            StatusCode::UNAUTHORIZED,
            "<p>Sign in with Google was cancelled or failed.</p>",
        );
    }
    let Some(code) = query.code.filter(|value| !value.is_empty()) else {
        return html_page(
            StatusCode::UNAUTHORIZED,
            "<p>Sign in with Google was cancelled or failed.</p>",
        );
    };
    let Some(returned_state) = query.state.filter(|value| !value.is_empty()) else {
        return html_page(
            StatusCode::BAD_REQUEST,
            "<p>Sign in with Google could not be completed.</p>",
        );
    };
    let Some(state_cookie) = cookie_value(headers, OIDC_STATE_COOKIE) else {
        return html_page(
            StatusCode::BAD_REQUEST,
            "<p>Sign in with Google could not be completed.</p>",
        );
    };
    let Some(parts) = verify_signed_payload(&auth.session_secret, &state_cookie) else {
        return html_page(
            StatusCode::BAD_REQUEST,
            "<p>Sign in with Google could not be completed.</p>",
        );
    };
    if parts.len() != 2 || parts[0] != returned_state {
        return html_page(
            StatusCode::BAD_REQUEST,
            "<p>Sign in with Google could not be completed.</p>",
        );
    }
    let nonce = parts[1].clone();
    let discovery = match discover(http, &auth.oidc_issuer).await {
        Ok(discovery) => discovery,
        Err(error) => return error.into_response(),
    };
    let id_token = match exchange_code(auth, http, &discovery, &code).await {
        Ok(token) => token,
        Err(error) => return error.into_response(),
    };
    let email = match email_from_id_token(auth, http, &discovery, &id_token, &nonce).await {
        Ok(email) => email,
        Err(error) => return error.into_response(),
    };
    let mut response = if emails_match(&email, &auth.operator_email) {
        let Some(session_cookie) = signed_cookie_header(
            OPERATOR_SESSION_COOKIE,
            &encode_payload(
                &[&email.to_ascii_lowercase()],
                now_unix() + SESSION_TTL_SECS,
            ),
            &auth.session_secret,
            SESSION_TTL_SECS,
        ) else {
            return oidc_misconfigured();
        };
        let mut response = StatusCode::FOUND.into_response();
        response
            .headers_mut()
            .insert(header::LOCATION, HeaderValue::from_static("/"));
        response
            .headers_mut()
            .append(header::SET_COOKIE, session_cookie);
        tracing::info!(event = "operator_session_established");
        response
    } else {
        tracing::info!(event = "operator_session_refused");
        operator_refused_page()
    };
    if let Ok(clear_state) = expired_cookie(OIDC_STATE_COOKIE) {
        response
            .headers_mut()
            .append(header::SET_COOKIE, clear_state);
    }
    response
}

pub fn logout_response() -> Response {
    let mut response = StatusCode::FOUND.into_response();
    response
        .headers_mut()
        .insert(header::LOCATION, HeaderValue::from_static("/"));
    if let Ok(cookie) = expired_cookie(OPERATOR_SESSION_COOKIE) {
        response.headers_mut().append(header::SET_COOKIE, cookie);
    }
    if let Ok(cookie) = expired_cookie(OIDC_STATE_COOKIE) {
        response.headers_mut().append(header::SET_COOKIE, cookie);
    }
    response
}

pub fn operator_from_request(auth: &OperatorAuthConfig, headers: &HeaderMap) -> Option<String> {
    let value = cookie_value(headers, OPERATOR_SESSION_COOKIE)?;
    let parts = verify_signed_payload(&auth.session_secret, &value)?;
    let email = parts.into_iter().next()?;
    emails_match(&email, &auth.operator_email).then_some(email)
}

fn emails_match(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

async fn discover(http: &reqwest::Client, issuer: &str) -> Result<DiscoveryDocument, ApiError> {
    let url = format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    );
    let document = http
        .get(url)
        .send()
        .await
        .map_err(|_| oidc_unavailable())?
        .error_for_status()
        .map_err(|_| oidc_unavailable())?
        .json::<DiscoveryDocument>()
        .await
        .map_err(|_| oidc_unavailable())?;
    if document.issuer.trim_end_matches('/') != issuer.trim_end_matches('/') {
        return Err(oidc_unavailable());
    }
    Ok(document)
}

async fn exchange_code(
    auth: &OperatorAuthConfig,
    http: &reqwest::Client,
    discovery: &DiscoveryDocument,
    code: &str,
) -> Result<String, ApiError> {
    let mut form = HashMap::new();
    form.insert("grant_type", "authorization_code");
    form.insert("code", code);
    form.insert("redirect_uri", auth.oidc_redirect_uri.as_str());
    form.insert("client_id", auth.oidc_client_id.as_str());
    form.insert("client_secret", auth.oidc_client_secret.as_str());
    let response = http
        .post(&discovery.token_endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|_| oidc_unavailable())?
        .error_for_status()
        .map_err(|_| oidc_unavailable())?
        .json::<TokenResponse>()
        .await
        .map_err(|_| oidc_unavailable())?;
    response
        .id_token
        .filter(|value| !value.is_empty())
        .ok_or_else(oidc_unavailable)
}

async fn email_from_id_token(
    auth: &OperatorAuthConfig,
    http: &reqwest::Client,
    discovery: &DiscoveryDocument,
    id_token: &str,
    expected_nonce: &str,
) -> Result<String, ApiError> {
    let header = decode_header(id_token).map_err(|_| oidc_unavailable())?;
    let jwks = http
        .get(&discovery.jwks_uri)
        .send()
        .await
        .map_err(|_| oidc_unavailable())?
        .error_for_status()
        .map_err(|_| oidc_unavailable())?
        .json::<JsonWebKeySet>()
        .await
        .map_err(|_| oidc_unavailable())?;
    let key = jwks
        .keys
        .iter()
        .find(|key| {
            key.kty.as_deref() == Some("RSA")
                && match (&header.kid, &key.kid) {
                    (Some(expected), Some(found)) => expected == found,
                    (None, _) => jwks.keys.len() == 1,
                    _ => false,
                }
        })
        .ok_or_else(oidc_unavailable)?;
    let decoding_key = DecodingKey::from_rsa_components(
        key.n.as_deref().ok_or_else(oidc_unavailable)?,
        key.e.as_deref().ok_or_else(oidc_unavailable)?,
    )
    .map_err(|_| oidc_unavailable())?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[auth.oidc_issuer.trim_end_matches('/')]);
    validation.set_audience(&[&auth.oidc_client_id]);
    let claims = decode::<IdTokenClaims>(id_token, &decoding_key, &validation)
        .map_err(|_| oidc_unavailable())?
        .claims;
    if claims.nonce.as_deref() != Some(expected_nonce) || claims.email_verified != Some(true) {
        return Err(oidc_unavailable());
    }
    let email = claims
        .email
        .filter(|value| valid_claim_email(value))
        .ok_or_else(oidc_unavailable)?;
    Ok(email)
}

fn valid_claim_email(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty() && !domain.is_empty() && !value.contains('\n') && value.is_ascii()
}

fn encode_payload(parts: &[&str], exp: i64) -> String {
    let mut payload = parts.join("\n");
    payload.push('\n');
    payload.push_str(&exp.to_string());
    payload
}

fn signed_cookie_header(
    name: &str,
    payload: &str,
    secret: &[u8],
    max_age: i64,
) -> Option<HeaderValue> {
    let mac = sign(secret, payload.as_bytes())?;
    let value = format!(
        "v1.{}.{}",
        URL_SAFE_NO_PAD.encode(payload.as_bytes()),
        URL_SAFE_NO_PAD.encode(mac)
    );
    HeaderValue::from_str(&format!(
        "{name}={value}; Path=/; Max-Age={max_age}; HttpOnly; Secure; SameSite=Lax"
    ))
    .ok()
}

fn verify_signed_payload(secret: &[u8], value: &str) -> Option<Vec<String>> {
    let payload = value.strip_prefix("v1.")?;
    let (payload_b64, mac_b64) = payload.split_once('.')?;
    let payload = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let mac = URL_SAFE_NO_PAD.decode(mac_b64).ok()?;
    let expected = sign(secret, &payload)?;
    if mac.len() != expected.len() || !constant_time_eq::constant_time_eq(&mac, &expected) {
        return None;
    }
    let payload = String::from_utf8(payload).ok()?;
    let mut parts: Vec<String> = payload.split('\n').map(ToOwned::to_owned).collect();
    let exp = parts.pop()?.parse::<i64>().ok()?;
    if exp < now_unix() || parts.is_empty() {
        return None;
    }
    Some(parts)
}

fn sign(secret: &[u8], payload: &[u8]) -> Option<Vec<u8>> {
    let mut hmac = Hmac::<Sha256>::new_from_slice(secret).ok()?;
    hmac.update(payload);
    Some(hmac.finalize().into_bytes().to_vec())
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let header = headers.get(header::COOKIE)?.to_str().ok()?;
    header.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == name).then(|| value.to_owned())
    })
}

fn expired_cookie(name: &str) -> Result<HeaderValue, header::InvalidHeaderValue> {
    HeaderValue::from_str(&format!(
        "{name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
    ))
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

fn oidc_unavailable() -> ApiError {
    ApiError::new(
        StatusCode::BAD_GATEWAY,
        "oidc_unavailable",
        "Sign in unavailable",
        "Tan Studio could not complete Sign in with Google.",
    )
}

fn oidc_misconfigured() -> Response {
    oidc_unavailable().into_response()
}

fn operator_refused_page() -> Response {
    html_page(
        StatusCode::FORBIDDEN,
        "<p>You are not the operator of this notebook.</p>",
    )
}

fn html_page(status: StatusCode, body: &str) -> Response {
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Tan Studio</title></head><body>{body}</body></html>"
    );
    let mut response = (status, html).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
