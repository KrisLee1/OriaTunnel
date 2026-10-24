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
}
impl TrayMenu {
    fn from_snapshot(snapshot: &crate::model::Snapshot) -> Self {
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
                        .unwrap_or_else(|| format!("来源失效 · {}", rule.host_id));
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
    menu: TrayMenu,
    tooltip: String,
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
    format!("OriaTunnel · 监听 {listening} · 重连 {retrying} · 需处理 {attention}")
}
pub fn update_tray(app: &tauri::AppHandle, snapshot: &crate::model::Snapshot) {
    let menu = TrayMenu::from_snapshot(snapshot);
    let tooltip = tooltip(snapshot);
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
        if previous.menu != menu {
            if let Ok(native_menu) = build_tray_menu(&handle, &menu) {
                if tray.set_menu(Some(native_menu)).is_ok() {
                    previous.menu = menu;
                }
            }
        }
        if previous.tooltip != tooltip && tray.set_tooltip(Some(&tooltip)).is_ok() {
            previous.tooltip = tooltip;
        }
        previous.revision = revision;
    });
}
fn build_tray_menu(app: &tauri::AppHandle, model: &TrayMenu) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "show",
        "显示 OriaTunnel",
        true,
        None::<&str>,
    )?)?;
    for (start, label, all_label, groups) in [
        (true, "启动转发", "全部启动", &model.start),
        (false, "停止转发", "全部停止", &model.stop),
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
        "退出 OriaTunnel",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}
#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) {
    show(&app);
}
fn handle_menu(app: &tauri::AppHandle, id: &str) {
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
            let model = TrayMenu::from_snapshot(&crate::app::state(app).snapshot());
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
            return Err(std::io::Error::other(
                "OriaTunnel 已在当前用户下运行，但窗口唤起暂时失败",
            ));
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
    let model = TrayMenu::from_snapshot(&snapshot);
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
        revision: snapshot.revision,
        menu: model,
        tooltip,
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
