mod activity;
mod app;
mod application_icon;
pub mod batch;
pub mod commands;
mod config_export;
mod config_import;
mod credentials;
mod desktop;
pub mod files;
mod jump_endpoint;
mod long_running;
#[cfg(target_os = "macos")]
mod macos_material;
pub mod model;
mod native_message;
mod proxy_browser;
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
mod vnc;
mod window;
mod workspace;
use std::sync::Arc;
use tauri::Manager;
#[derive(Default)]
struct ExitState(Arc<std::sync::atomic::AtomicU8>);
pub fn run() {
    let Ok(endpoint) = desktop::launch_endpoint() else {
        return;
    };
    let mut context = tauri::generate_context!();
    configure_webviews(context.config_mut(), cfg!(debug_assertions));
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ExitState::default())
        .manage(vnc::Viewers::default())
        .manage(workspace::Workspaces::default())
        .setup(move |app| {
            app.state::<workspace::Workspaces>().reset("main", false);
            let directory = app.path().app_data_dir()?;
            // Debug validation can use an isolated profile without touching the user's data.
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("ORIATUNNEL_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(directory);
            app.manage(native_message::NativeLanguageState::load(&directory));
            let path = directory.join("connections.json");
            // The per-user lock is held for the entire process, including shutdown cleanup.
            let Some(instance) =
                desktop::acquire(&directory, app.handle().clone(), endpoint.as_ref())?
            else {
                std::process::exit(0);
            };
            app.manage(instance);
            app.manage(Arc::new(app::AppState::load(path).map_err(|error| {
                std::io::Error::other(native_message::render_in_language(
                    &error,
                    native_message::language(),
                ))
            })?));
            let updates = Arc::new(updater::UpdateState::load(app.handle(), directory));
            app.manage(updates.clone());
            let update_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = updates.check(&update_app, true).await;
            });
            desktop::install_tray(app.handle())?;
            #[cfg(target_os = "macos")]
            desktop::install_application_menu(app.handle())?;
            let protocol_launch = endpoint.is_some();
            if let Some(endpoint) = endpoint {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || vnc::open(&handle, endpoint));
            } else if !std::env::args().any(|arg| arg == "--background") {
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
            if !protocol_launch {
                let startup = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    app::state(&startup).auto_connect(&startup).await;
                });
            }
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
                if let Some(scope) = window
                    .state::<workspace::Workspaces>()
                    .reset(window.label(), false)
                {
                    if let Some(state) = window.try_state::<Arc<app::AppState>>() {
                        state.close_workspace(&scope);
                    }
                }
                if window.label().starts_with("vnc-") {
                    window.state::<vnc::Viewers>().stop(window.label());
                }
            }
        })
        .on_window_event(|window, event| {
            if window.label().starts_with("vnc-") {
                if let tauri::WindowEvent::DragDrop(drop) = event {
                    workspace::drag_drop(window, drop);
                }
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    if let Some(scope) = window
                        .state::<workspace::Workspaces>()
                        .reset(window.label(), true)
                    {
                        window.state::<Arc<app::AppState>>().close_workspace(&scope);
                    }
                    window.state::<vnc::Viewers>().remove(window.label());
                }
                return;
            }
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
                } else {
                    api.prevent_close();
                    app.exit(0);
                }
            }
        })
        .invoke_handler({
            let main: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                vnc::choose_default_vnc,
                app::snapshot,
                app::file_api::file_snapshot,
                app::file_api::file_clear_history,
                app::file_api::file_connect,
                app::file_api::file_list,
                app::file_api::file_sources,
                app::file_api::file_submit,
                app::file_api::file_control,
                app::file_api::file_resolve_conflict,
                app::file_api::file_disconnect,
                app::file_api::file_mutate,
                app::file_api::file_pick,
                app::file_api::file_reveal,
                app::file_api::file_open_target,
                app::file_api::file_open_transfer_folder,
                app::file_api::file_preview,
                app::file_api::file_read_text,
                app::file_api::file_write_text,
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
                app::command_api::set_host_services,
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
                app::open_host_service,
                app::open_proxy_browser,
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
                native_message::set_native_language,
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
            ];
            let viewer: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                window::set_window_appearance,
                workspace::vnc_workspace_watch,
                app::trust_host,
                window::open_external_url,
                app::file_api::file_snapshot,
                app::file_api::file_clear_history,
                app::file_api::file_connect,
                app::file_api::file_list,
                app::file_api::file_sources,
                app::file_api::file_submit,
                app::file_api::file_control,
                app::file_api::file_resolve_conflict,
                app::file_api::file_disconnect,
                app::file_api::file_mutate,
                app::file_api::file_pick,
                app::file_api::file_reveal,
                app::file_api::file_open_target,
                app::file_api::file_open_transfer_folder,
                app::file_api::file_preview,
                app::file_api::file_read_text,
                app::file_api::file_write_text,
                app::terminal_api::terminal_sessions,
                app::terminal_api::open_terminal,
                app::terminal_api::attach_terminal,
                app::terminal_api::ack_terminal,
                app::terminal_api::terminal_input,
                app::terminal_api::resize_terminal,
                app::terminal_api::close_terminal,
                app::terminal_api::detach_terminal,
                app::terminal_api::forget_terminal,
                vnc::vnc_window_action,
                vnc::vnc_window_theme,
                vnc::vnc_endpoint,
                vnc::vnc_begin,
                vnc::vnc_next,
                vnc::vnc_input,
                vnc::vnc_forget_password,
                vnc::vnc_end
            ];
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                if invoke.message.webview().label() == "main" {
                    main(invoke)
                } else if invoke.message.webview().label().starts_with("vnc-") {
                    viewer(invoke)
                } else {
                    false
                }
            }
        })
        .build(context)
        .expect("Unable to build OriaTunnel")
        .run(|handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { ref urls } = event {
                for url in urls {
                    if let Ok(endpoint) = vnc::Endpoint::parse(url.as_str()) {
                        let app = handle.clone();
                        tauri::async_runtime::spawn_blocking(move || vnc::open(&app, endpoint));
                    }
                }
            }
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
                            if app::state(&app).has_file_work() {
                                let choice = tokio::task::spawn_blocking(|| {
                                    rfd::MessageDialog::new()
                                        .set_title(crate::native_message::text(
                                            "trayFiles",
                                            serde_json::json!({}),
                                        ))
                                        .set_description(crate::native_message::text(
                                            "filesExitConfirm",
                                            serde_json::json!({}),
                                        ))
                                        .set_buttons(rfd::MessageButtons::YesNo)
                                        .show()
                                })
                                .await;
                                if !matches!(choice, Ok(rfd::MessageDialogResult::Yes)) {
                                    app.state::<ExitState>()
                                        .0
                                        .store(0, std::sync::atomic::Ordering::SeqCst);
                                    return;
                                }
                            }
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
