mod activity;
mod app;
pub mod batch;
mod config_export;
mod config_import;
mod desktop;
mod jump_endpoint;
mod long_running;
#[cfg(target_os = "macos")]
mod macos_material;
pub mod model;
mod ssh_conditions;
pub mod ssh_config;
pub mod supervisor;
pub mod tunnel;
mod window;
use std::sync::Arc;
use tauri::Manager;
#[derive(Default)]
struct ExitState(std::sync::atomic::AtomicU8);
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ExitState::default())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            // Debug validation can use an isolated profile without touching the user's data.
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("ORIATUNNEL_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(directory);
            let path = directory.join("connections.json");
            // The per-user lock is held for the entire process, including shutdown cleanup.
            let Some(instance) = desktop::acquire(&directory, app.handle().clone())? else {
                std::process::exit(0);
            };
            app.manage(instance);
            app.manage(Arc::new(
                app::AppState::load(path).map_err(std::io::Error::other)?,
            ));
            desktop::install_tray(app.handle())?;
            if !std::env::args().any(|arg| arg == "--background") {
                desktop::show(app.handle());
            }
            #[cfg(windows)]
            {
                match long_running::subscribe(app::state(app.handle()).wake_sender()) {
                    Ok(subscription) => {
                        app.manage(subscription);
                    }
                    Err(_) => app::state(app.handle()).power_unavailable(),
                }
            }
            let startup = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                app::state(&startup).auto_connect(&startup).await;
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
                loop {
                    interval.tick().await;
                    app::state(&handle).poll_hosts(&handle);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app::state(app).close_to_tray() {
                    api.prevent_close();
                    let _ = window.hide();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        app::state(&app).cancel_host_tests_on_hide().await;
                        app::state(&app).publish(&app);
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app::snapshot,
            app::refresh_hosts,
            app::set_host_sources,
            app::save_host,
            app::save_host_metadata,
            app::save_rule,
            app::start_rule,
            app::test_host,
            app::stop_rule,
            app::trust_host,
            app::delete_host,
            app::hide_host,
            app::delete_rule,
            app::set_close_to_tray,
            app::quit_app,
            app::export_config,
            app::pick_identity_file,
            app::pick_ssh_config_file,
            app::preview_import_file,
            app::commit_import,
            app::cancel_import,
            app::start_batch,
            app::stop_batch,
            app::undo_delete,
            app::set_autostart,
            window::set_window_appearance,
            window::read_dropped_file,
            window::open_external_url
        ])
        .build(tauri::generate_context!())
        .expect("Unable to build OriaTunnel")
        .run(|handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let exit = &handle.state::<ExitState>().0;
                if exit.load(std::sync::atomic::Ordering::SeqCst) != 2 {
                    api.prevent_exit();
                    if exit
                        .compare_exchange(
                            0,
                            1,
                            std::sync::atomic::Ordering::SeqCst,
                            std::sync::atomic::Ordering::SeqCst,
                        )
                        .is_ok()
                    {
                        let app = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            app::state(&app).shutdown().await;
                            app.state::<ExitState>()
                                .0
                                .store(2, std::sync::atomic::Ordering::SeqCst);
                            app.exit(0);
                        });
                    }
                }
            }
        });
}
