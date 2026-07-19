use std::{env, io::Write, path::PathBuf, sync::Arc};

use tan_studio_service::{
    build_router, contract::ApiDoc, device::NanoDeviceManager, ApiState, Database, LaunchMode,
    ServiceConfig,
};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .json()
        .with_writer(std::io::stderr)
        .init();

    let mut args = env::args_os().skip(1);
    if args.next().as_deref() == Some(std::ffi::OsStr::new("openapi")) {
        let document = ApiDoc::openapi().to_pretty_json()?;
        if let Some(path) = args.next() {
            std::fs::write(PathBuf::from(path), document)?;
        } else {
            println!("{document}");
        }
        return Ok(());
    }

    let config = ServiceConfig::load()?;
    let database = Database::open(&config.database_path)?;
    let device = Arc::new(NanoDeviceManager::start(database.clone()));
    let state = ApiState::new(config.clone(), database, device.clone())?;
    let router = build_router(state);
    let listener = TcpListener::bind((config.bind_host.as_str(), config.port)).await?;
    let local = listener.local_addr()?;

    match config.mode {
        LaunchMode::Desktop => {
            let record = serde_json::json!({
                "schemaVersion": 1,
                "host": "127.0.0.1",
                "port": local.port(),
                "apiBasePath": "/api/v1"
            });
            let mut stdout = std::io::stdout().lock();
            serde_json::to_writer(&mut stdout, &record)?;
            stdout.write_all(b"\n")?;
            stdout.flush()?;
        }
        LaunchMode::Headless => tracing::info!(
            event = "server_started",
            host = %local.ip(),
            port = local.port(),
            version = %config.application_version
        ),
    }

    let shutdown_device = device.clone();
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            shutdown_device.stop();
        })
        .await?;
    Ok(())
}
