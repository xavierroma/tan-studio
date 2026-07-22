use std::{env, io::Write, path::PathBuf, sync::Arc};

use tan_studio_service::{
    build_router,
    core_contract::ApiDoc,
    device::NanoDeviceManager,
    klog::{ImportInput, KlogImporter},
    kpro::{ImportInput as ProfileImportInput, KproImporter},
    lan_bridge, ApiState, Database, LaunchMode, ServiceConfig,
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
    match args.next().as_deref() {
        Some(command) if command == std::ffi::OsStr::new("openapi") => {
            let document = ApiDoc::openapi().to_pretty_json()?;
            if let Some(path) = args.next() {
                std::fs::write(PathBuf::from(path), document)?;
            } else {
                println!("{document}");
            }
            return Ok(());
        }
        Some(command) if command == std::ffi::OsStr::new("import-klogs") => {
            let database_path = args
                .next()
                .map(PathBuf::from)
                .ok_or("import-klogs requires an absolute database path")?;
            let corpus_path = args
                .next()
                .map(PathBuf::from)
                .ok_or("import-klogs requires a corpus directory")?;
            if args.next().is_some() {
                return Err("import-klogs accepts exactly two arguments".into());
            }
            import_klogs(database_path, corpus_path)?;
            return Ok(());
        }
        Some(command) if command == std::ffi::OsStr::new("import-kpros") => {
            let database_path = args
                .next()
                .map(PathBuf::from)
                .ok_or("import-kpros requires an absolute database path")?;
            let corpus_path = args
                .next()
                .map(PathBuf::from)
                .ok_or("import-kpros requires a corpus directory")?;
            if args.next().is_some() {
                return Err("import-kpros accepts exactly two arguments".into());
            }
            import_kpros(database_path, corpus_path)?;
            return Ok(());
        }
        Some(_) => return Err("unknown Tan Studio service command".into()),
        None => {}
    }

    let config = ServiceConfig::load()?;
    let database = Database::open(&config.database_path)?;
    let device = Arc::new(NanoDeviceManager::start(database.clone()));
    let bridge_task = if let Some(bridge_port) = config.bridge_port {
        let bridge_listener = TcpListener::bind((config.bind_host.as_str(), bridge_port)).await?;
        tracing::info!(
            event = "bridge_listener_started",
            host = %config.bind_host,
            port = bridge_port
        );
        Some(tokio::spawn(lan_bridge::serve(
            bridge_listener,
            database.clone(),
            device.clone(),
        )))
    } else {
        None
    };
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
    let result = axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            shutdown_device.stop();
        })
        .await;
    if let Some(task) = bridge_task {
        task.abort();
    }
    result?;
    Ok(())
}

fn import_kpros(
    database_path: PathBuf,
    corpus_path: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    if !database_path.is_absolute() || !corpus_path.is_absolute() || !corpus_path.is_dir() {
        return Err(
            "import-kpros paths must be absolute and the corpus must be a directory".into(),
        );
    }
    let database = Database::open(&database_path)?;
    let importer = KproImporter::new(database);
    let mut paths = std::fs::read_dir(&corpus_path)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("kpro"))
        })
        .collect::<Vec<_>>();
    paths.sort();

    let mut imported = 0_u64;
    let mut unchanged = 0_u64;
    let mut warning_count = 0_u64;
    let mut failures = Vec::new();
    for path in paths {
        let Some(filename) = path.file_name().and_then(|name| name.to_str()) else {
            failures.push(serde_json::json!({
                "filename": "<non-utf8>",
                "error": "filename is not valid UTF-8"
            }));
            continue;
        };
        let source_modified_at = path
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .map(chrono::DateTime::<chrono::Utc>::from)
            .map(|modified| modified.to_rfc3339())
            .unwrap_or_else(|| "unknown".into());
        match importer.import(ProfileImportInput {
            bytes: std::fs::read(&path)?,
            device_path: format!("kaffelogic/roast-profiles/{filename}"),
            filename: filename.into(),
            source_modified_at,
        }) {
            Ok(result) => {
                imported += u64::from(result.imported);
                unchanged += u64::from(!result.imported);
                warning_count += result.warning_count as u64;
            }
            Err(error) => failures.push(serde_json::json!({
                "filename": filename,
                "error": error.to_string()
            })),
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "kind": "kproImportReport",
            "imported": imported,
            "unchanged": unchanged,
            "warningCount": warning_count,
            "failureCount": failures.len(),
            "failures": failures,
        }))?
    );
    if failures.is_empty() {
        Ok(())
    } else {
        Err("one or more Kaffeelogic profiles could not be imported".into())
    }
}

fn import_klogs(
    database_path: PathBuf,
    corpus_path: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    if !database_path.is_absolute() || !corpus_path.is_absolute() || !corpus_path.is_dir() {
        return Err(
            "import-klogs paths must be absolute and the corpus must be a directory".into(),
        );
    }
    let database = Database::open(&database_path)?;
    let importer = KlogImporter::new(database);
    let mut paths = std::fs::read_dir(&corpus_path)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("klog"))
        })
        .collect::<Vec<_>>();
    paths.sort();

    let mut imported = 0_u64;
    let mut unchanged = 0_u64;
    let mut updated = 0_u64;
    let mut warning_count = 0_u64;
    let mut failures = Vec::new();
    for path in paths {
        let Some(filename) = path.file_name().and_then(|name| name.to_str()) else {
            failures.push(serde_json::json!({
                "filename": "<non-utf8>",
                "error": "filename is not valid UTF-8"
            }));
            continue;
        };
        let source_modified_at = path
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .map(chrono::DateTime::<chrono::Utc>::from)
            .map(|modified| modified.to_rfc3339())
            .unwrap_or_else(|| "unknown".into());
        match importer.import(ImportInput {
            bytes: std::fs::read(&path)?,
            device_path: format!("kaffelogic/roast-logs/{filename}"),
            filename: filename.into(),
            source_modified_at,
        }) {
            Ok(result) => {
                imported += u64::from(result.imported);
                updated += u64::from(result.updated);
                unchanged += u64::from(!result.imported && !result.updated);
                warning_count += result.warning_count as u64;
            }
            Err(error) => failures.push(serde_json::json!({
                "filename": filename,
                "error": error.to_string()
            })),
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "kind": "klogImportReport",
            "imported": imported,
            "updated": updated,
            "unchanged": unchanged,
            "warningCount": warning_count,
            "failureCount": failures.len(),
            "failures": failures,
        }))?
    );
    if failures.is_empty() {
        Ok(())
    } else {
        Err("one or more Kaffeelogic logs could not be imported".into())
    }
}
