//! Native application icon selection migrated from OriaAide.
#[cfg(target_os = "macos")]
#[path = "app_icon_macos.rs"]
mod platform;
#[cfg(windows)]
#[path = "app_icon_windows.rs"]
mod platform;

#[tauri::command]
pub async fn set_application_icon(app: tauri::AppHandle, icon: String) -> Result<(), String> {
    #[cfg(any(windows, target_os = "macos"))]
    let icon = platform::ApplicationIcon::parse(&icon)?;
    #[cfg(target_os = "macos")]
    return platform::set(&app, icon).await;
    #[cfg(windows)]
    return platform::set(&app, icon);
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, icon);
        Err("Application icon selection is supported on macOS and Windows".into())
    }
}
