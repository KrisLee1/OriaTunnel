//! Per-user process ownership and tray lifecycle. IPC can only request window activation.
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

pub struct Instance {
    _file: File,
}
#[derive(Default)]
struct TraySummary(std::sync::Mutex<String>);
pub fn update_tray(app: &tauri::AppHandle, snapshot: &crate::model::Snapshot) {
    let Some(summary) = app.try_state::<TraySummary>() else {
        return;
    };
    let rules = snapshot
        .runtimes
        .iter()
        .filter(|r| !r.rule_id.starts_with("host-test:"));
    let (mut listening, mut retrying, mut attention) = (0, 0, 0);
    for r in rules {
        match r.status.as_str() {
            "listening" => listening += 1,
            "reconnecting" => retrying += 1,
            "needs-attention" | "failed" => attention += 1,
            _ => {}
        }
    }
    let tooltip = format!("OriaTunnel · 监听 {listening} · 重连 {retrying} · 需处理 {attention}");
    let mut previous = summary.0.lock().unwrap();
    if *previous == tooltip {
        return;
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        if tray.set_tooltip(Some(&tooltip)).is_ok() {
            *previous = tooltip;
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
    let show_item = MenuItem::with_id(app, "show", "显示 OriaTunnel", true, None::<&str>)?;
    let stop_item = MenuItem::with_id(app, "stop", "停止全部转发", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 OriaTunnel", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_item, &stop_item, &separator, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("OriaTunnel · 关闭窗口后仍可从此处恢复")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app),
            "stop" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::app::state(&app).stop_all().await;
                    crate::app::state(&app).publish(&app);
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        });
    let icon = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::AssetNotFound("OriaTunnel application icon".into()))?;
    tray = tray.icon(icon.clone());
    tray.build(app)?;
    app.manage(TraySummary::default());
    Ok(())
}
