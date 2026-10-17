use std::{path::Path, sync::Arc};

use futures_util::{SinkExt, StreamExt};
use http::{header, HeaderValue, Request};
use serde_json::json;
use tan_studio_service::{
    build_router,
    config::{AttachmentStore, API_CLIENT_ID, HOSTED_CLIENT_ID},
    device::NanoDeviceManager,
    ApiState, Database, LaunchMode, OperatorAuthConfig, ServiceConfig,
};
use tempfile::TempDir;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

const STUDIO_HOST: &str = "studio.tan.coffee";

struct HostedBridge {
    address: std::net::SocketAddr,
    device: Arc<NanoDeviceManager>,
    task: tokio::task::JoinHandle<()>,
    _directory: TempDir,
}

impl Drop for HostedBridge {
    fn drop(&mut self) {
        self.task.abort();
        self.device.stop();
    }
}

fn hosted_config(database_path: &Path, web_root: &Path) -> ServiceConfig {
    ServiceConfig {
        mode: LaunchMode::Hosted,
        bind_host: "127.0.0.1".into(),
        port: 0,
        bridge_port: None,
        database_path: database_path.to_path_buf(),
        web_root: Some(web_root.to_path_buf()),
        launch_token: String::new(),
        allowed_origins: vec!["https://studio.tan.coffee".into()],
        allowed_hosts: vec![STUDIO_HOST.into()],
        allowed_client_ids: vec![HOSTED_CLIENT_ID.into(), API_CLIENT_ID.into()],
        allow_originless_requests: true,
        application_version: "test".into(),
        development: false,
        operator_auth: Some(OperatorAuthConfig {
            operator_email: "operator@tan.coffee".into(),
            oidc_issuer: "https://accounts.example.test".into(),
            oidc_client_id: "test-client".into(),
            oidc_client_secret: "test-secret".into(),
            oidc_redirect_uri: "https://studio.tan.coffee/auth/google/callback".into(),
            session_secret: vec![0x5a; 32],
        }),
        attachment_store: AttachmentStore::LocalDisk,
    }
}

async fn hosted_bridge() -> HostedBridge {
    let directory = TempDir::new().expect("temporary hosted bridge directory");
    let web_root = directory.path().join("web");
    std::fs::create_dir_all(&web_root).expect("create web root");
    std::fs::write(
        web_root.join("index.html"),
        "<!doctype html><title>Tan</title>",
    )
    .expect("write index");
    let database_path = directory.path().join("studio.sqlite");
    let database = Database::open(&database_path).expect("open test database");
    let device = Arc::new(NanoDeviceManager::start(database.clone()));
    let app = build_router(
        ApiState::new(
            hosted_config(&database_path, &web_root),
            database,
            device.clone(),
        )
        .expect("hosted state"),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind hosted bridge");
    let address = listener.local_addr().expect("hosted bridge address");
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("serve hosted bridge");
    });
    HostedBridge {
        address,
        device,
        task,
        _directory: directory,
    }
}

fn websocket_request(address: std::net::SocketAddr) -> Request<()> {
    let mut request = format!("ws://{address}/device/v1/session")
        .into_client_request()
        .expect("WebSocket request");
    request
        .headers_mut()
        .insert(header::HOST, HeaderValue::from_static(STUDIO_HOST));
    request
}

#[tokio::test]
async fn hosted_bridge_session_rejects_an_unknown_device_credential() {
    let hosted = hosted_bridge().await;
    let (mut socket, response) = connect_async(websocket_request(hosted.address))
        .await
        .expect("hosted WebSocket upgrade");
    assert_eq!(response.status(), http::StatusCode::SWITCHING_PROTOCOLS);

    socket
        .send(Message::Text(
            json!({
                "schemaVersion": 1,
                "bridgeId": "abcdefghijklmnopqrstuvwxyz",
                "firmwareVersion": "0.3.0-hosted",
                "buildId": "test-hosted",
                "deviceToken": "f".repeat(64)
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("send bridge hello");

    let rejection = socket
        .next()
        .await
        .expect("bridge response")
        .expect("valid bridge response");
    let Message::Text(rejection) = rejection else {
        panic!("expected text rejection");
    };
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&rejection).expect("JSON rejection"),
        json!({
            "schemaVersion": 1,
            "accepted": false,
            "error": "authentication_failed"
        })
    );
}

#[tokio::test]
async fn authenticated_diagnostics_stay_out_of_usb_and_reject_unknown_fields() {
    use sha2::{Digest, Sha256};
    let hosted = hosted_bridge().await;
    let database = Database::open(&hosted._directory.path().join("studio.sqlite")).unwrap();
    let token = "a".repeat(64);
    database
        .connection()
        .execute(
            "INSERT INTO tan_bridges (bridge_id, device_token_sha256, firmware_version, build_id,
         state, last_seen_at_ms, created_at_ms, updated_at_ms)
         VALUES (?, ?, 'test', 'test', 'offline', 1, 1, 1)",
            rusqlite::params![
                "abcdefghijklmnopqrstuvwxyz",
                hex::encode(Sha256::digest(token.as_bytes()))
            ],
        )
        .unwrap();
    let (mut socket, _) = connect_async(websocket_request(hosted.address))
        .await
        .unwrap();
    socket
        .send(Message::Text(
            json!({"schemaVersion":1,
        "bridgeId":"abcdefghijklmnopqrstuvwxyz", "firmwareVersion":"0.3.3-hosted",
        "buildId":"test", "deviceToken":token})
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let accepted = socket.next().await.unwrap().unwrap().into_text().unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&accepted).unwrap()["accepted"],
        true
    );
    let mut diagnostic = json!({"schemaVersion":1,"type":"diagnostics",
        "uptimeMs":100,"bootCount":1,"watchdogCount":0,"interruptWatchdogCount":0,
        "brownoutCount":0,"receivedBytes":0,"forwardedBytes":0,"discardedBytes":0,
        "overflows":0,"sessionFailures":0,"usbRecoveries":0,"highWaterBytes":0});
    socket
        .send(Message::Text(diagnostic.to_string().into()))
        .await
        .unwrap();
    socket
        .send(Message::Ping(vec![1, 2, 3].into()))
        .await
        .unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(response, Message::Pong(_)));
    assert_ne!(hosted.device.snapshot().connection, "connected");
    diagnostic["unexpected"] = "not allowed".into();
    socket
        .send(Message::Text(diagnostic.to_string().into()))
        .await
        .unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(response, Message::Close(_)));
}
