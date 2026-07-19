use std::{path::PathBuf, sync::Arc};

use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    response::{IntoResponse, Response},
};

#[derive(Clone)]
pub struct StaticUi {
    pub root: PathBuf,
    pub token: Arc<str>,
}

pub async fn serve(State(ui): State<StaticUi>, request: Request<Body>) -> Response {
    if request.method() != http::Method::GET && request.method() != http::Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let decoded = percent_decode(request.uri().path());
    let Some(relative) = decoded else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if relative.split('/').any(|part| matches!(part, "." | ".."))
        || relative.contains('\\')
        || relative.contains('\0')
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let relative = relative.trim_start_matches('/');
    let candidate = ui.root.join(relative);
    if !relative.is_empty() && candidate.is_file() {
        return file_response(&candidate, request.method() == http::Method::HEAD);
    }
    if !relative.is_empty() && std::path::Path::new(relative).extension().is_some() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let index = ui.root.join("index.html");
    let Ok(mut html) = std::fs::read_to_string(index) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Some(position) = html.find("</head>") else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let token = serde_json::to_string(ui.token.as_ref()).unwrap_or_else(|_| "null".into());
    let bootstrap = format!(
        r#"<script>Object.defineProperty(window,"__TAN_STUDIO_BOOTSTRAP__",{{value:Object.freeze({{apiOrigin:window.location.origin,token:{token},clientId:"tan-studio-lan-v1"}}),enumerable:false,configurable:false,writable:false}});</script>"#
    );
    html.insert_str(position, &bootstrap);
    let mut response = if request.method() == http::Method::HEAD {
        Body::empty()
    } else {
        Body::from(html)
    }
    .into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert("content-security-policy", header::HeaderValue::from_static("default-src 'self'; base-uri 'none'; connect-src 'self' ws: wss:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"));
    security_headers(&mut response);
    response
}

fn file_response(path: &std::path::Path, head: bool) -> Response {
    let Ok(bytes) = std::fs::read(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = if head {
        Body::empty()
    } else {
        Body::from(bytes)
    }
    .into_response();
    if let Ok(value) = header::HeaderValue::from_str(mime.as_ref()) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        if path.components().any(|part| part.as_os_str() == "assets") {
            header::HeaderValue::from_static("public, max-age=31536000, immutable")
        } else {
            header::HeaderValue::from_static("no-cache")
        },
    );
    security_headers(&mut response);
    response
}

fn security_headers(response: &mut Response) {
    response.headers_mut().insert(
        "cross-origin-resource-policy",
        header::HeaderValue::from_static("same-origin"),
    );
    response.headers_mut().insert(
        "referrer-policy",
        header::HeaderValue::from_static("no-referrer"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        header::HeaderValue::from_static("nosniff"),
    );
    response
        .headers_mut()
        .insert("x-frame-options", header::HeaderValue::from_static("DENY"));
}

fn percent_decode(value: &str) -> Option<String> {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3)?;
            output.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}
