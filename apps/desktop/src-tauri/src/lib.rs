mod companion;

use std::sync::Mutex;

use companion::{create_webview_bootstrap_script, start_companion, CompanionProcess};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct CompanionState(Mutex<Option<CompanionProcess>>);

fn stop_companion(app: &tauri::AppHandle) {
    let state = app.state::<CompanionState>();
    let process = state.0.lock().ok().and_then(|mut child| child.take());
    if let Some(process) = process {
        // CommandChild::kill consumes the handle, which guarantees this path runs at most once.
        let _ = process.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Tauri requires the single-instance plugin to be registered first.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .filter(|metadata| metadata.target().starts_with("tan_studio"))
                .build(),
        )
        .setup(|app| {
            let running = start_companion(app.handle())?;
            let init_script = create_webview_bootstrap_script(&running.bootstrap)?;

            app.manage(CompanionState(Mutex::new(Some(running.process))));

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Tan Studio")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 720.0)
                .resizable(true)
                .center()
                .initialization_script(init_script)
                .on_navigation(|url| {
                    if cfg!(debug_assertions) {
                        url.scheme() == "http"
                            && url.host_str() == Some("127.0.0.1")
                            && url.port() == Some(1420)
                    } else {
                        url.scheme() == "tauri" && url.host_str() == Some("localhost")
                    }
                })
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tan Studio failed to initialize");

    app.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            stop_companion(app);
        }
    });
}
