mod activity;
mod app;
mod application_icon;
pub mod batch;
pub mod commands;
mod config_export;
mod config_import;
mod credentials;
mod desktop;
mod jump_endpoint;
mod long_running;
#[cfg(target_os = "macos")]
mod macos_material;
pub mod model;
mod service;
pub mod service_control;
pub mod service_templates;
mod ssh_algorithms;
mod ssh_conditions;
pub mod ssh_config;
pub mod supervisor;
pub mod terminal;
pub mod tunnel;
mod updater;
mod window;
use std::sync::Arc;
use tauri::Manager;
#[derive(Default)]
struct ExitState(Arc<std::sync::atomic::AtomicU8>);
pub fn run() {
    let mut context = tauri::generate_context!();
    configure_webviews(context.config_mut(), cfg!(debug_assertions));
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            let updates = Arc::new(updater::UpdateState::load(app.handle(), directory));
            app.manage(updates.clone());
            let update_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = updates.check(&update_app, true).await;
            });
            desktop::install_tray(app.handle())?;
            #[cfg(target_os = "macos")]
            desktop::install_application_menu(app.handle())?;
            if !std::env::args().any(|arg| arg == "--background") {
                desktop::show(app.handle());
            }
            #[cfg(any(windows, target_os = "macos"))]
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
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(state) = window.app_handle().try_state::<Arc<app::AppState>>() {
                    state.interrupt_terminals();
                }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app
                    .state::<ExitState>()
                    .0
                    .load(std::sync::atomic::Ordering::SeqCst)
                    == 3
                {
                    api.prevent_close();
                    return;
                }
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
            app::terminal_api::terminal_sessions,
            app::terminal_api::open_terminal,
            app::terminal_api::attach_terminal,
            app::terminal_api::ack_terminal,
            app::terminal_api::terminal_input,
            app::terminal_api::resize_terminal,
            app::terminal_api::close_terminal,
            app::terminal_api::detach_terminal,
            app::terminal_api::forget_terminal,
            app::command_api::save_service_profile,
            app::command_api::set_service_execution,
            app::command_api::preview_service_template,
            app::command_api::delete_service_profile,
            app::command_api::delete_service_profiles,
            app::command_api::command_runs,
            app::command_api::start_command,
            app::service_api::run_service_operation,
            app::service_api::service_observations,
            app::service_api::stop_service_forward,
            app::command_api::attach_command,
            app::command_api::ack_command,
            app::command_api::detach_command,
            app::command_api::cancel_command,
            updater::update_snapshot,
            updater::check_update,
            updater::download_update,
            updater::set_update_auto_check,
            updater::update_install_context,
            updater::install_update,
            desktop::show_main_window,
            app::refresh_hosts,
            app::set_host_sources,
            app::save_host,
            app::save_host_metadata,
            app::add_discovered_hosts,
            app::save_rule,
            app::open_service,
            app::start_rule,
            app::password_status,
            app::clear_password,
            app::test_host,
            app::stop_rule,
            app::trust_host,
            app::delete_host,
            app::hide_host,
            app::delete_rule,
            app::delete_rules,
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
            application_icon::set_application_icon,
            window::read_dropped_file,
            window::open_external_url
        ])
        .build(context)
        .expect("Unable to build OriaTunnel")
        .run(|handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                desktop::show(handle);
            }
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

fn configure_webviews(config: &mut tauri::Config, debug: bool) {
    if !debug {
        for window in &mut config.app.windows {
            window.devtools = Some(false);
        }
    }
}

#[cfg(test)]
mod webview_tests {
    #[test]
    fn release_disables_native_devtools_for_every_window() {
        let mut config = tauri::Config::default();
        config.app.windows = vec![
            tauri::utils::config::WindowConfig {
                devtools: Some(true),
                ..Default::default()
            },
            tauri::utils::config::WindowConfig {
                label: "secondary".into(),
                ..Default::default()
            },
        ];
        let mut debug = config.clone();
        super::configure_webviews(&mut debug, true);
        assert_eq!(debug.app.windows[0].devtools, Some(true));
        super::configure_webviews(&mut config, false);
        assert!(config
            .app
            .windows
            .iter()
            .all(|window| window.devtools == Some(false)));
    }
}
