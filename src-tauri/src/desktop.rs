//! Per-user process ownership and tray lifecycle. IPC can only request window activation.
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

pub struct Instance {
    _file: File,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct TrayRule {
    id: String,
    name: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct TrayGroup {
    host_id: String,
    label: String,
    rules: Vec<TrayRule>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct TrayMenu {
    start: Vec<TrayGroup>,
    stop: Vec<TrayGroup>,
    services: Vec<TrayService>,
    hosts: Vec<TrayHost>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct TrayHost {
    id: String,
    label: String,
    enabled: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct TrayService {
    id: String,
    label: String,
    targets: Vec<TrayServiceTarget>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct TrayServiceTarget {
    label: String,
    actions: Vec<TrayServiceAction>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct TrayServiceAction {
    label: String,
    enabled: bool,
    request: TrayServiceRequest,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayServiceRequest {
    service_id: String,
    revision: String,
    rule_id: String,
    action_id: String,
    stop_terminal: bool,
}
impl TrayServiceRequest {
    fn menu_id(&self) -> String {
        format!("tray:service:{}", serde_json::to_string(self).unwrap())
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TrayServiceActivity {
    pub busy: std::collections::BTreeSet<String>,
    pub terminals: std::collections::BTreeSet<(String, String, String)>,
}
const TRAY_PANELS: [(&str, &str, &str); 2] = [
    (
        "tray:service-commands",
        "服务命令",
        "tunnel://open-service-commands",
    ),
    ("tray:ssh-terminal", "SSH 终端", "tunnel://open-terminal"),
];
impl TrayMenu {
    #[cfg(test)]
    fn from_snapshot(snapshot: &crate::model::Snapshot) -> Self {
        Self::with_activity(snapshot, &TrayServiceActivity::default())
    }
    fn with_activity(snapshot: &crate::model::Snapshot, activity: &TrayServiceActivity) -> Self {
        let mut menu = Self::default();
        for rule in &snapshot.rules {
            let running = snapshot
                .runtimes
                .iter()
                .any(|runtime| runtime.rule_id == rule.id && is_active(&runtime.status));
            let groups = if running {
                &mut menu.stop
            } else {
                &mut menu.start
            };
            let index = groups
                .iter()
                .position(|group| group.host_id == rule.host_id)
                .unwrap_or_else(|| {
                    let host = snapshot.hosts.iter().find(|host| host.id == rule.host_id);
                    let label = host
                        .map(|host| {
                            format!(
                                "{} · {}@{}:{}",
                                host.name, host.user, host.address, host.port
                            )
                        })
                        .unwrap_or_else(|| {
                            crate::native_message::text(
                                "traySourceMissingId",
                                serde_json::json!({"arg0":rule.host_id}),
                            )
                        });
                    groups.push(TrayGroup {
                        host_id: rule.host_id.clone(),
                        label,
                        rules: vec![],
                    });
                    groups.len() - 1
                });
            groups[index].rules.push(TrayRule {
                id: rule.id.clone(),
                name: rule.name.clone(),
            });
        }
        menu.hosts = snapshot
            .hosts
            .iter()
            .filter(|host| snapshot.added_host_ids.contains(&host.id) && !host.hidden)
            .map(|host| TrayHost {
                id: host.id.clone(),
                label: format!(
                    "{} · {}@{}:{}",
                    host.name, host.user, host.address, host.port
                ),
                enabled: host.diagnostics.is_empty(),
            })
            .collect();
        for service in &snapshot.services {
            let mut targets = Vec::new();
            for rule in snapshot
                .rules
                .iter()
                .filter(|rule| service.rule_ids.contains(&rule.id))
            {
                let host = snapshot.hosts.iter().find(|host| host.id == rule.host_id);
                let ready = service.execution_enabled
                    && host.is_some_and(|host| host.diagnostics.is_empty())
                    && !activity.busy.contains(&service.id);
                let foreground = service.actions.iter().find(|action| {
                    action.kind == "start"
                        && action.mode == crate::commands::ExecutionMode::Terminal
                        && activity.terminals.contains(&(
                            service.id.clone(),
                            rule.id.clone(),
                            action.id.clone(),
                        ))
                });
                let request = |action_id: &str, stop_terminal: bool| TrayServiceRequest {
                    service_id: service.id.clone(),
                    revision: service.revision.clone(),
                    rule_id: rule.id.clone(),
                    action_id: action_id.into(),
                    stop_terminal,
                };
                let mut actions: Vec<_> = service
                    .actions
                    .iter()
                    .filter(|action| !(foreground.is_some() && action.kind == "stop"))
                    .map(|action| TrayServiceAction {
                        label: action.label.clone(),
                        enabled: ready,
                        request: request(&action.id, false),
                    })
                    .collect();
                let terminal_start = service.actions.iter().find(|action| {
                    action.kind == "start"
                        && action.mode == crate::commands::ExecutionMode::Terminal
                });
                if let Some(start) = foreground.or(terminal_start
                    .filter(|_| !service.actions.iter().any(|action| action.kind == "stop")))
                {
                    actions.push(TrayServiceAction {
                        label: crate::native_message::text("trayStop", serde_json::json!({})),
                        enabled: foreground.is_some(),
                        request: request(&start.id, true),
                    });
                }
                targets.push(TrayServiceTarget {
                    label: format!(
                        "{} · {}",
                        rule.name,
                        host.map(|host| host.name.clone()).unwrap_or_else(|| {
                            crate::native_message::text("traySourceMissing", serde_json::json!({}))
                        })
                    ),
                    actions,
                });
            }
            menu.services.push(TrayService {
                id: service.id.clone(),
                label: service.name.clone(),
                targets,
            });
        }
        menu
    }
    fn ids(&self, start: bool) -> Vec<String> {
        let groups = if start { &self.start } else { &self.stop };
        groups
            .iter()
            .flat_map(|group| group.rules.iter().map(|rule| rule.id.clone()))
            .collect()
    }
}
fn is_active(status: &str) -> bool {
    !matches!(
        status,
        "" | "stopped" | "failed" | "tested" | "needs-attention"
    )
}
struct TraySummary {
    revision: u64,
    language: String,
    menu: TrayMenu,
    tooltip: String,
    activity: TrayServiceActivity,
}
pub(crate) fn update_service_tray(app: &tauri::AppHandle) {
    let Some(summary) = app.try_state::<std::sync::Mutex<TraySummary>>() else {
        return;
    };
    let state = crate::app::state(app);
    let activity = state.tray_service_activity();
    if summary.lock().unwrap().activity == activity {
        return;
    }
    update_tray(app, &state.snapshot());
}
fn tooltip(snapshot: &crate::model::Snapshot) -> String {
    let (mut listening, mut retrying, mut attention) = (0, 0, 0);
    for runtime in snapshot
        .runtimes
        .iter()
        .filter(|r| !r.rule_id.starts_with("host-test:"))
    {
        match runtime.status.as_str() {
            "listening" => listening += 1,
            "reconnecting" => retrying += 1,
            "needs-attention" | "failed" => attention += 1,
            _ => {}
        }
    }
    crate::native_message::text(
        "trayTooltip",
        serde_json::json!({"listening":listening,"retrying":retrying,"attention":attention}),
    )
}
pub(crate) fn refresh_language(app: &tauri::AppHandle) {
    update_tray(app, &crate::app::state(app).snapshot());
}
pub fn update_tray(app: &tauri::AppHandle, snapshot: &crate::model::Snapshot) {
    let snapshot = snapshot.clone();
    let revision = snapshot.revision;
    let handle = app.clone();
    // Native menus belong to the UI thread. Do not hold a shared lock while
    // dispatching to it, and do not rebuild menus for traffic-only snapshots.
    let _ = app.run_on_main_thread(move || {
        let Some(summary) = handle.try_state::<std::sync::Mutex<TraySummary>>() else {
            return;
        };
        let mut previous = summary.lock().unwrap();
        if revision < previous.revision {
            return;
        }
        let Some(tray) = handle.tray_by_id("main-tray") else {
            return;
        };
        // Render after dispatch so an older queued refresh cannot restore a previous language.
        let tooltip = tooltip(&snapshot);
        let activity = crate::app::state(&handle).tray_service_activity();
        let menu = TrayMenu::with_activity(&snapshot, &activity);
        let mut updated =
            previous.menu == menu && previous.language == crate::native_message::language();
        if !updated {
            if let Ok(native_menu) = build_tray_menu(&handle, &menu) {
                if tray.set_menu(Some(native_menu)).is_ok() {
                    previous.menu = menu;
                    previous.language = crate::native_message::language().into();
                    updated = true;
                }
            }
        }
        if previous.tooltip != tooltip && tray.set_tooltip(Some(&tooltip)).is_ok() {
            previous.tooltip = tooltip;
        }
        if updated {
            previous.activity = activity;
        }
        previous.revision = revision;
    });
}
fn build_tray_menu(app: &tauri::AppHandle, model: &TrayMenu) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "show",
        crate::native_message::text("trayShow", serde_json::json!({})),
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let services = Submenu::new(
        app,
        crate::native_message::text("trayServiceCommands", serde_json::json!({})),
        true,
    )?;
    services.append(&MenuItem::with_id(
        app,
        "tray:service-commands",
        crate::native_message::text("trayOpenCommands", serde_json::json!({})),
        true,
        None::<&str>,
    )?)?;
    if !model.services.is_empty() {
        services.append(&PredefinedMenuItem::separator(app)?)?;
    }
    for (service_index, service) in model.services.iter().enumerate() {
        let submenu = Submenu::new(app, &service.label, !service.targets.is_empty())?;
        if service.targets.is_empty() {
            submenu.append(&MenuItem::with_id(
                app,
                format!("tray:service-unbound:{service_index}"),
                crate::native_message::text("trayUnbound", serde_json::json!({})),
                false,
                None::<&str>,
            )?)?;
        }
        for (index, target) in service.targets.iter().enumerate() {
            if index > 0 {
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
            }
            submenu.append(&MenuItem::with_id(
                app,
                format!("tray:service-heading:{service_index}:{index}"),
                &target.label,
                false,
                None::<&str>,
            )?)?;
            for action in &target.actions {
                submenu.append(&MenuItem::with_id(
                    app,
                    action.request.menu_id(),
                    &action.label,
                    action.enabled,
                    None::<&str>,
                )?)?;
            }
        }
        services.append(&submenu)?;
    }
    menu.append(&services)?;
    let terminals = Submenu::new(
        app,
        crate::native_message::text("traySshTerminal", serde_json::json!({})),
        true,
    )?;
    terminals.append(&MenuItem::with_id(
        app,
        "tray:ssh-terminal",
        crate::native_message::text("trayOpenTerminal", serde_json::json!({})),
        true,
        None::<&str>,
    )?)?;
    if !model.hosts.is_empty() {
        terminals.append(&PredefinedMenuItem::separator(app)?)?;
    }
    for host in &model.hosts {
        terminals.append(&MenuItem::with_id(
            app,
            format!("tray:ssh-host:{}", host.id),
            &host.label,
            host.enabled,
            None::<&str>,
        )?)?;
    }
    menu.append(&terminals)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    for (start, label, all_label, groups) in [
        (
            true,
            crate::native_message::text("trayStartForwards", serde_json::json!({})),
            crate::native_message::text("trayStartAll", serde_json::json!({})),
            &model.start,
        ),
        (
            false,
            crate::native_message::text("trayStopForwards", serde_json::json!({})),
            crate::native_message::text("trayStopAll", serde_json::json!({})),
            &model.stop,
        ),
    ] {
        let action = if start { "start" } else { "stop" };
        let submenu = Submenu::new(app, label, true)?;
        submenu.append(&MenuItem::with_id(
            app,
            format!("tray:{action}-all"),
            all_label,
            !groups.is_empty(),
            None::<&str>,
        )?)?;
        for (index, group) in groups.iter().enumerate() {
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
            // Disabled headings keep each host's forwards directly accessible.
            submenu.append(&MenuItem::with_id(
                app,
                format!("tray:heading:{action}:{index}"),
                &group.label,
                false,
                None::<&str>,
            )?)?;
            for rule in &group.rules {
                submenu.append(&MenuItem::with_id(
                    app,
                    format!("tray:{action}:{}", rule.id),
                    &rule.name,
                    true,
                    None::<&str>,
                )?)?;
            }
        }
        menu.append(&submenu)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        crate::native_message::text("trayQuit", serde_json::json!({})),
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}
#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) {
    show(&app);
}

#[cfg(target_os = "macos")]
pub fn install_application_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    // Tauri's default macOS application submenu starts with native About.
    // Keep its system-localized label and all other standard menu behaviors.
    if let Some(application_menu) = menu.items()?.first().and_then(|item| item.as_submenu()) {
        if let Some(native_about) = application_menu
            .items()?
            .first()
            .and_then(|item| item.as_predefined_menuitem())
        {
            let about =
                MenuItem::with_id(app, "app:about", native_about.text()?, true, None::<&str>)?;
            application_menu.remove_at(0)?;
            application_menu.insert(&about, 0)?;
        }
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id.as_ref() == "app:about" {
            show(app);
            let _ = app.emit_to("main", "tunnel://open-about", ());
        }
    });
    Ok(())
}

fn handle_menu(app: &tauri::AppHandle, id: &str) {
    if let Some((_, _, event)) = TRAY_PANELS.iter().find(|(panel_id, _, _)| *panel_id == id) {
        show(app);
        let _ = app.emit_to("main", event, ());
        return;
    }
    if id.starts_with("tray:ssh-host:") || id.starts_with("tray:service:") {
        let state = crate::app::state(app);
        let model = TrayMenu::with_activity(&state.snapshot(), &state.tray_service_activity());
        if let Some(host) = model
            .hosts
            .iter()
            .find(|host| host.enabled && format!("tray:ssh-host:{}", host.id) == id)
        {
            show(app);
            let _ = app.emit_to(
                "main",
                "tunnel://open-terminal",
                serde_json::json!({"hostId": host.id}),
            );
        } else if let Some(action) = model
            .services
            .iter()
            .flat_map(|service| &service.targets)
            .flat_map(|target| &target.actions)
            .find(|action| action.enabled && action.request.menu_id() == id)
        {
            show(app);
            let _ = app.emit_to("main", "tunnel://tray-service-action", &action.request);
        }
        return;
    }
    match id {
        "show" => show(app),
        "quit" => app.exit(0),
        _ => {
            let (start, requested) = if id == "tray:start-all" {
                (true, None)
            } else if id == "tray:stop-all" {
                (false, None)
            } else if let Some(id) = id.strip_prefix("tray:start:") {
                (true, Some(id))
            } else if let Some(id) = id.strip_prefix("tray:stop:") {
                (false, Some(id))
            } else {
                return;
            };
            // Re-check current state: a menu can be clicked just as a run changes.
            let model = TrayMenu::with_activity(
                &crate::app::state(app).snapshot(),
                &crate::app::state(app).tray_service_activity(),
            );
            let ids: Vec<_> = model
                .ids(start)
                .into_iter()
                .filter(|id| requested.is_none_or(|wanted| id == wanted))
                .collect();
            if ids.is_empty() {
                return;
            }
            if start {
                // Reuse the existing UI authentication flow, including private-key
                // first attempts, explicit passwords and host-key confirmation.
                if app.emit_to("main", "tunnel://tray-start", ids).is_err() {
                    show(app);
                }
            } else {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::app::stop_batch(app.state(), app.clone(), ids).await;
                });
            }
        }
    }
}
pub fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
pub fn acquire(directory: &Path, app: tauri::AppHandle) -> std::io::Result<Option<Instance>> {
    std::fs::create_dir_all(directory)?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("instance.lock"))?;
    let rendezvous = directory.join("instance.port");
    match file.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => {
            if std::env::args().any(|arg| arg == "--background") {
                return Ok(None);
            }
            // The owner may still be writing its rendezvous address during startup.
            for _ in 0..50 {
                let text = std::fs::read_to_string(&rendezvous).unwrap_or_default();
                if let Ok(port) = text.trim().parse::<u16>() {
                    if let Ok(mut stream) = TcpStream::connect_timeout(
                        &([127, 0, 0, 1], port).into(),
                        Duration::from_millis(100),
                    ) {
                        let _ = stream.write_all(b"show");
                        return Ok(None);
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            return Err(std::io::Error::other(crate::native_message::text(
                "instanceActivation",
                serde_json::json!({}),
            )));
        }
        Err(std::fs::TryLockError::Error(e)) => return Err(e),
    }
    let listener = TcpListener::bind("127.0.0.1:0")?;
    std::fs::write(&rendezvous, listener.local_addr()?.port().to_string())?;
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let mut message = [0; 4];
            if stream.read_exact(&mut message).is_ok() && &message == b"show" {
                show(&app);
            }
        }
    });
    Ok(Some(Instance { _file: file }))
}
pub fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let snapshot = crate::app::state(app).snapshot();
    let activity = crate::app::state(app).tray_service_activity();
    let model = TrayMenu::with_activity(&snapshot, &activity);
    let tooltip = tooltip(&snapshot);
    let menu = build_tray_menu(app, &model)?;
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip(&tooltip)
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| handle_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if !cfg!(target_os = "macos")
                && matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                )
            {
                show(tray.app_handle());
            }
        });
    #[cfg(not(target_os = "macos"))]
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/windows-tray-icon.png"))?;
    #[cfg(not(target_os = "macos"))]
    {
        tray = tray.icon(icon);
    }
    #[cfg(target_os = "macos")]
    {
        // A small alpha template stays legible in both macOS menu bar appearances.
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/macos-tray-icon.png"))?;
        tray = tray.icon(icon).icon_as_template(true);
    }
    tray.build(app)?;
    app.manage(std::sync::Mutex::new(TraySummary {
        language: crate::native_message::language().into(),
        revision: snapshot.revision,
        menu: model,
        tooltip,
        activity,
    }));
    Ok(())
}

#[cfg(test)]
mod icon_tests {
    #[test]
    fn tray_assets_are_transparent_and_the_macos_template_is_monochrome() {
        for (bytes, size, monochrome) in [
            (
                include_bytes!("../icons/windows-tray-icon.png").as_slice(),
                32,
                false,
            ),
            (
                include_bytes!("../icons/macos-tray-icon.png").as_slice(),
                36,
                true,
            ),
        ] {
            let image = tauri::image::Image::from_bytes(bytes).unwrap();
            assert_eq!((image.width(), image.height()), (size, size));
            let pixels: Vec<_> = image.rgba().chunks_exact(4).collect();
            assert_eq!(pixels[0][3], 0);
            assert!(pixels.iter().any(|pixel| pixel[3] == 255));
            if monochrome {
                assert!(pixels.iter().all(|pixel| pixel[..3] == [0, 0, 0]));
            } else {
                assert!(pixels
                    .iter()
                    .any(|pixel| pixel[3] > 0 && pixel[0] != pixel[1]));
            }
        }
    }
}

#[cfg(test)]
mod tray_menu_tests {
    use super::*;
    use crate::model::{Host, Rule, Runtime, Snapshot};

    fn rule(id: &str, host: &str) -> Rule {
        Rule {
            id: id.into(),
            name: format!("转发 {id}"),
            host_id: host.into(),
            ..Default::default()
        }
    }
    fn runtime(id: &str, status: &str) -> Runtime {
        Runtime {
            rule_id: id.into(),
            status: status.into(),
            ..Default::default()
        }
    }
    fn service() -> crate::commands::Service {
        serde_json::from_value(serde_json::json!({
            "id":"service", "name":"DSH", "revision":"v1", "ruleIds":["a","b"], "noLocalEnvironment":true,
            "actions":[
                {"id":"start:one", "kind":"start", "label":"启动", "command":"dsh web --port 3080", "mode":"terminal", "timeoutSecs":0, "successCodes":[0], "confirm":false},
                {"id":"stop", "kind":"stop", "label":"原生停止", "command":"native-stop", "timeoutSecs":60, "successCodes":[0], "confirm":true}
            ]
        })).unwrap()
    }
    #[test]
    fn terminal_submenu_includes_only_visible_added_hosts_and_retains_blocked_state() {
        let snapshot = Snapshot {
            hosts: vec![
                Host {
                    id: "added".into(),
                    name: "Added".into(),
                    user: "user".into(),
                    address: "example.invalid".into(),
                    port: 2222,
                    ..Default::default()
                },
                Host {
                    id: "blocked".into(),
                    diagnostics: vec!["blocked".into()],
                    ..Default::default()
                },
                Host {
                    id: "hidden".into(),
                    hidden: true,
                    ..Default::default()
                },
                Host {
                    id: "discovered".into(),
                    ..Default::default()
                },
            ],
            added_host_ids: vec!["added".into(), "blocked".into(), "hidden".into()],
            ..Default::default()
        };
        let menu = TrayMenu::from_snapshot(&snapshot);
        assert_eq!(
            menu.hosts
                .iter()
                .map(|host| host.id.as_str())
                .collect::<Vec<_>>(),
            ["added", "blocked"]
        );
        assert!(menu.hosts[0].enabled);
        assert!(menu.hosts[0].label.contains("user@example.invalid:2222"));
        assert!(!menu.hosts[1].enabled);
    }
    #[test]
    fn service_submenu_binds_each_action_to_revision_and_forward_and_tracks_foreground_stop() {
        let mut snapshot = Snapshot {
            services: vec![service()],
            hosts: vec![
                Host {
                    id: "host-a".into(),
                    name: "Host A".into(),
                    ..Default::default()
                },
                Host {
                    id: "host-b".into(),
                    name: "Host B".into(),
                    ..Default::default()
                },
            ],
            rules: vec![rule("a", "host-a"), rule("b", "host-b")],
            ..Default::default()
        };
        let idle = TrayMenu::from_snapshot(&snapshot);
        assert_eq!(idle.services.len(), 1);
        assert_eq!(idle.services[0].label, "DSH");
        assert_eq!(idle.services[0].targets.len(), 2);
        assert!(idle.services[0].targets[0].label.contains("Host A"));
        assert!(idle.services[0].targets[1].label.contains("Host B"));
        assert!(idle
            .services
            .iter()
            .flat_map(|group| &group.targets)
            .flat_map(|target| &target.actions)
            .all(|action| action.enabled));
        let mut activity = TrayServiceActivity::default();
        activity.busy.insert("service".into());
        activity
            .terminals
            .insert(("service".into(), "a".into(), "start:one".into()));
        let running = TrayMenu::with_activity(&snapshot, &activity);
        assert!(!running.services[0].targets[0].actions[0].enabled);
        let stop = running.services[0].targets[0]
            .actions
            .iter()
            .find(|action| action.request.stop_terminal)
            .unwrap();
        assert!(stop.enabled);
        assert_eq!(stop.request.rule_id, "a");
        assert_eq!(stop.request.action_id, "start:one");
        assert!(!running.services[0].targets[0]
            .actions
            .iter()
            .any(|action| action.label == "原生停止"));
        assert!(running.services[0].targets[1]
            .actions
            .iter()
            .all(|action| !action.enabled && !action.request.stop_terminal));
        assert_ne!(
            idle.services[0].targets[0].actions[0].request.menu_id(),
            idle.services[0].targets[1].actions[0].request.menu_id()
        );
        snapshot.services[0].revision = "v2".into();
        let edited = TrayMenu::from_snapshot(&snapshot);
        assert_ne!(
            idle.services[0].targets[0].actions[0].request.menu_id(),
            edited.services[0].targets[0].actions[0].request.menu_id()
        );
        snapshot.services[0].execution_enabled = false;
        assert!(TrayMenu::from_snapshot(&snapshot)
            .services
            .iter()
            .flat_map(|group| &group.targets)
            .flat_map(|target| &target.actions)
            .all(|action| !action.enabled));
        snapshot.services[0].rule_ids.clear();
        assert!(TrayMenu::from_snapshot(&snapshot).services[0]
            .targets
            .is_empty());
    }
    #[test]
    fn partitions_every_runtime_phase_and_excludes_host_tests() {
        let phases = [
            "stopped",
            "failed",
            "needs-attention",
            "tested",
            "connecting",
            "authenticating",
            "verifying-host",
            "listening",
            "reconnecting",
        ];
        let mut snapshot = Snapshot::default();
        snapshot.rules.push(rule("never-started", "a"));
        for phase in phases {
            snapshot.rules.push(rule(phase, "a"));
            snapshot.runtimes.push(runtime(phase, phase));
        }
        snapshot.runtimes.push(runtime("host-test:a", "listening"));
        let model = TrayMenu::from_snapshot(&snapshot);
        assert_eq!(
            model.ids(true),
            [
                "never-started",
                "stopped",
                "failed",
                "needs-attention",
                "tested"
            ]
        );
        assert_eq!(
            model.ids(false),
            [
                "connecting",
                "authenticating",
                "verifying-host",
                "listening",
                "reconnecting"
            ]
        );
    }
    #[test]
    fn groups_by_stable_host_identity_and_keeps_rule_order() {
        let snapshot = Snapshot {
            hosts: vec![
                Host {
                    id: "a".into(),
                    name: "同名主机".into(),
                    user: "alice".into(),
                    address: "example.invalid".into(),
                    port: 22,
                    ..Default::default()
                },
                Host {
                    id: "b".into(),
                    name: "同名主机".into(),
                    user: "bob".into(),
                    address: "example.invalid".into(),
                    port: 2222,
                    ..Default::default()
                },
            ],
            rules: vec![
                rule("1", "a"),
                rule("2", "b"),
                rule("3", "a"),
                rule("4", "missing"),
            ],
            ..Default::default()
        };
        let model = TrayMenu::from_snapshot(&snapshot);
        assert_eq!(model.start.len(), 3);
        assert_eq!(
            model.start[0]
                .rules
                .iter()
                .map(|rule| rule.id.as_str())
                .collect::<Vec<_>>(),
            ["1", "3"]
        );
        assert!(model.start[0].label.contains("alice@example.invalid:22"));
        assert!(model.start[1].label.contains("bob@example.invalid:2222"));
        assert_eq!(model.start[2].label, "来源失效 · missing");
    }
    #[test]
    fn menu_changes_for_state_names_and_deletion_but_not_metrics() {
        let mut snapshot = Snapshot {
            rules: vec![rule("1", "a")],
            runtimes: vec![runtime("1", "listening")],
            ..Default::default()
        };
        let listening = TrayMenu::from_snapshot(&snapshot);
        snapshot.runtimes[0].sent = 500;
        snapshot.runtimes[0].uptime_secs = 10;
        snapshot.revision += 1;
        assert_eq!(TrayMenu::from_snapshot(&snapshot), listening);
        snapshot.rules[0].name = "新名称".into();
        assert_ne!(TrayMenu::from_snapshot(&snapshot), listening);
        snapshot.runtimes[0].status = "failed".into();
        let failed = TrayMenu::from_snapshot(&snapshot);
        assert_eq!(failed.ids(true), ["1"]);
        assert!(failed.stop.is_empty());
        snapshot.rules.clear();
        assert_eq!(TrayMenu::from_snapshot(&snapshot), TrayMenu::default());
    }
}
