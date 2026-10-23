//! Native material adapter. Windows behavior migrated from OriaAide windows/window.rs.
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub opacity: f64,
    pub blur_radius: f64,
    pub corner_radius: f64,
}
#[tauri::command]
pub async fn set_window_appearance(
    window: tauri::WebviewWindow,
    appearance: Appearance,
) -> Result<(), String> {
    if !appearance.opacity.is_finite()
        || !(1.0..=100.0).contains(&appearance.opacity)
        || !appearance.blur_radius.is_finite()
        || !(0.0..=64.0).contains(&appearance.blur_radius)
        || !appearance.corner_radius.is_finite()
        || !(0.0..=64.0).contains(&appearance.corner_radius)
    {
        return Err("Invalid window appearance".into());
    }
    #[cfg(target_os = "windows")]
    {
        use tauri::window::{Effect, EffectsBuilder};
        if appearance.blur_radius > 0.0 {
            window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build())
        } else {
            window.set_effects(None)
        }
        .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos_material::apply(
            window.clone(),
            appearance.blur_radius.round() as u32,
            appearance.corner_radius,
        )
        .await?;
    }
    let _ = window.set_shadow(true);
    Ok(())
}
#[tauri::command]
pub fn read_dropped_file(path: String, max_bytes: u64) -> Result<Vec<u8>, String> {
    let path = std::path::Path::new(&path);
    if !path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"))
    {
        return Err("仅支持主题 JSON 文件".into());
    }
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > max_bytes.min(1_048_576) {
        return Err("主题文件过大".into());
    }
    std::fs::read(path).map_err(|e| e.to_string())
}

// Same native link dispatch and URL boundary as OriaAide commands.rs.
#[allow(deprecated)]
#[tauri::command]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(validated_external_url(&url)?, None)
        .map_err(|e| e.to_string())
}

fn validated_external_url(value: &str) -> Result<String, String> {
    let url = tauri::Url::parse(value).map_err(|_| "The external link is invalid")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS external links are allowed".into());
    }
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_links_allow_web_urls_only() {
        assert_eq!(
            validated_external_url("https://theme.oria.org.cn/zh/editor").unwrap(),
            "https://theme.oria.org.cn/zh/editor"
        );
        for url in [
            "javascript:alert(1)",
            "file:///C:/Windows/notepad.exe",
            "cmd:calc",
            "not a URL",
        ] {
            assert!(validated_external_url(url).is_err());
        }
    }

    #[test]
    fn dropped_theme_extension_is_case_insensitive_and_size_is_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("theme.JSON");
        std::fs::write(&file, b"{}").unwrap();
        assert_eq!(
            read_dropped_file(file.to_string_lossy().into(), 2).unwrap(),
            b"{}"
        );
        assert!(read_dropped_file(file.to_string_lossy().into(), 1).is_err());
    }
}
