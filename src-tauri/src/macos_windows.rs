use std::ffi::c_void;
use tauri::{plugin::TauriPlugin, Manager, RunEvent, WindowEvent, Wry};

extern "C" {
    fn oria_tunnel_install_fullscreen_chrome(window: *mut c_void);
}

fn is_work_window(label: &str) -> bool {
    label == "main" || label.starts_with("vnc-")
}

pub fn plugin() -> TauriPlugin<Wry> {
    let mut recent = Vec::<String>::new();
    tauri::plugin::Builder::new("macos-windows")
        .on_window_ready(|window| {
            if is_work_window(window.label()) {
                if let Ok(native) = window.ns_window() {
                    // Tauri runs this hook on the main thread with a live NSWindow.
                    unsafe { oria_tunnel_install_fullscreen_chrome(native) };
                }
            }
        })
        .on_event(move |app, event| match event {
            RunEvent::WindowEvent { label, event, .. } if is_work_window(label) => match event {
                WindowEvent::Focused(true) => {
                    recent.retain(|previous| previous != label);
                    recent.push(label.clone());
                }
                WindowEvent::Destroyed => recent.retain(|previous| previous != label),
                _ => {}
            },
            RunEvent::Reopen { .. } => {
                let windows = app.webview_windows();
                let open = recent.iter().rev().chain(windows.keys()).find_map(|label| {
                    windows.get(label).filter(|window| {
                        is_work_window(label)
                            && (window.is_visible().unwrap_or(false)
                                || window.is_minimized().unwrap_or(false))
                    })
                });
                // Closing the main window can hide it in the tray. Restore it
                // when every VNC window has closed and no open window remains.
                if let Some(window) = open.or_else(|| windows.get("main")) {
                    let _ = window
                        .show()
                        .and_then(|_| window.unminimize())
                        .and_then(|_| window.set_focus());
                }
            }
            _ => {}
        })
        .build()
}
