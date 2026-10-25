// Migrated from OriaAide; only shortcuts targeting this executable are changed.
use std::{
    ffi::OsString,
    fs,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
};

use tauri::{image::Image, AppHandle, Manager, Runtime};
use windows::{
    core::{Interface, HSTRING},
    Win32::{
        Foundation::RPC_E_CHANGED_MODE,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED, STGM_READWRITE,
        },
        UI::Shell::{
            IShellLinkW, SHChangeNotify, ShellLink, SHCNE_UPDATEITEM, SHCNF_PATHW, SLGP_RAWPATH,
        },
    },
};

const LIGHT_ICON: &[u8] = include_bytes!("../icons/windows-taskbar-light.png");
const DARK_ICON: &[u8] = include_bytes!("../icons/windows-taskbar-dark.png");
const MONO_ICON: &[u8] = include_bytes!("../icons/windows-taskbar-mono.png");
const LIGHT_ICO: &[u8] = include_bytes!("../icons/windows-taskbar-light.ico");
const DARK_ICO: &[u8] = include_bytes!("../icons/windows-taskbar-dark.ico");
const MONO_ICO: &[u8] = include_bytes!("../icons/windows-taskbar-mono.ico");
const INSTALLED_SHORTCUT_NAME: &str = "OriaTunnel.lnk";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApplicationIcon {
    Light,
    Dark,
    Mono,
}

impl ApplicationIcon {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            "mono" => Ok(Self::Mono),
            _ => Err(crate::native_message::plain("iconChoice")),
        }
    }

    fn bytes(self) -> &'static [u8] {
        match self {
            Self::Light => LIGHT_ICON,
            Self::Dark => DARK_ICON,
            Self::Mono => MONO_ICON,
        }
    }

    fn ico_bytes(self) -> &'static [u8] {
        match self {
            Self::Light => LIGHT_ICO,
            Self::Dark => DARK_ICO,
            Self::Mono => MONO_ICO,
        }
    }

    fn file_stem(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
            Self::Mono => "mono",
        }
    }
}

pub fn set<R: Runtime>(app: &AppHandle<R>, icon: ApplicationIcon) -> Result<(), String> {
    let image = Image::from_bytes(icon.bytes()).map_err(|error| {
        crate::native_message::message(
            "iconWindowsDecode",
            serde_json::json!({"error":error.to_string()}),
        )
    })?;
    let Some(window) = app.get_webview_window("main") else {
        return Err(crate::native_message::plain("iconMainWindow"));
    };

    // Installed Windows apps can keep using the icon recorded in their Start
    // Menu/taskbar shortcut even after WM_SETICON changes the live window. Keep
    // that shortcut in sync, but only when it targets this exact executable so
    // a development build never rewrites an installed copy of OriaTunnel.
    if let Err(error) = synchronize_installed_shortcut_icon(app, icon) {
        eprintln!("Cannot synchronize the installed Windows shortcut icon: {error}");
    }

    let refresh_taskbar = window.is_visible().map_err(window_icon_error)?;
    if refresh_taskbar {
        window.set_skip_taskbar(true).map_err(window_icon_error)?;
    }

    let set_result = window.set_icon(image).map_err(window_icon_error);
    let restore_result = if refresh_taskbar {
        window.set_skip_taskbar(false).map_err(window_icon_error)
    } else {
        Ok(())
    };

    set_result.and(restore_result)
}

fn window_icon_error(error: impl std::fmt::Display) -> String {
    crate::native_message::message(
        "iconWindowsUpdate",
        serde_json::json!({"error":error.to_string()}),
    )
}

fn synchronize_installed_shortcut_icon<R: Runtime>(
    app: &AppHandle<R>,
    icon: ApplicationIcon,
) -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("Cannot resolve the running executable: {error}"))?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("ORIATUNNEL_TEST_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(directory);
    let icon_dir = directory.join("taskbar-icons");
    fs::create_dir_all(&icon_dir)
        .map_err(|error| format!("Cannot create the taskbar icon directory: {error}"))?;
    let icon_path = icon_dir.join(format!("{}.ico", icon.file_stem()));
    fs::write(&icon_path, icon.ico_bytes())
        .map_err(|error| format!("Cannot persist the taskbar icon: {error}"))?;

    for shortcut in installed_shortcut_candidates() {
        if !shortcut.is_file() {
            continue;
        }
        unsafe { update_shortcut_icon_if_target_matches(&shortcut, &current_exe, &icon_path) }
            .map_err(|error| format!("Cannot update {}: {error}", shortcut.display()))?;
    }
    Ok(())
}

fn installed_shortcut_candidates() -> Vec<PathBuf> {
    let Some(app_data) = std::env::var_os("APPDATA") else {
        return Vec::new();
    };
    let app_data = PathBuf::from(app_data);
    let start_menu_shortcut = app_data
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join(INSTALLED_SHORTCUT_NAME);
    let pinned_directory = app_data
        .join("Microsoft")
        .join("Internet Explorer")
        .join("Quick Launch")
        .join("User Pinned")
        .join("TaskBar");
    let mut candidates = vec![start_menu_shortcut];
    if let Ok(entries) = fs::read_dir(pinned_directory) {
        candidates.extend(entries.flatten().map(|entry| entry.path()).filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
        }));
    }
    candidates
}

unsafe fn update_shortcut_icon_if_target_matches(
    shortcut_path: &Path,
    current_exe: &Path,
    icon_path: &Path,
) -> windows::core::Result<bool> {
    let initialize_result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let should_uninitialize = initialize_result.is_ok();
    if initialize_result.is_err() && initialize_result != RPC_E_CHANGED_MODE {
        return Err(windows::core::Error::from_hresult(initialize_result));
    }

    let result = (|| unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        let persist_file: IPersistFile = shell_link.cast()?;
        let shortcut_string = HSTRING::from(shortcut_path.to_string_lossy().as_ref());
        persist_file.Load(&shortcut_string, STGM_READWRITE)?;

        let mut target_buffer = vec![0u16; 32_768];
        shell_link.GetPath(
            &mut target_buffer,
            std::ptr::null_mut(),
            SLGP_RAWPATH.0 as u32,
        )?;
        let target_length = target_buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(target_buffer.len());
        let target_path = PathBuf::from(OsString::from_wide(&target_buffer[..target_length]));
        if !paths_match(&target_path, current_exe) {
            return Ok(false);
        }

        let icon_string = HSTRING::from(icon_path.to_string_lossy().as_ref());
        shell_link.SetIconLocation(&icon_string, 0)?;
        persist_file.Save(&shortcut_string, true)?;

        let shortcut_wide = shortcut_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        SHChangeNotify(
            SHCNE_UPDATEITEM,
            SHCNF_PATHW,
            Some(shortcut_wide.as_ptr().cast()),
            None,
        );
        Ok(true)
    })();

    if should_uninitialize {
        unsafe { CoUninitialize() };
    }
    result
}

fn paths_match(left: &Path, right: &Path) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_three_resolved_icon_variants() {
        assert_eq!(
            ApplicationIcon::parse("light").unwrap(),
            ApplicationIcon::Light
        );
        assert_eq!(
            ApplicationIcon::parse("dark").unwrap(),
            ApplicationIcon::Dark
        );
        assert_eq!(
            ApplicationIcon::parse("mono").unwrap(),
            ApplicationIcon::Mono
        );
        assert!(ApplicationIcon::parse("system").is_err());
    }

    #[test]
    fn bundled_taskbar_icons_are_full_size_rgba_images() {
        for icon in [
            ApplicationIcon::Light,
            ApplicationIcon::Dark,
            ApplicationIcon::Mono,
        ] {
            let image = Image::from_bytes(icon.bytes()).expect("taskbar icon must decode");
            assert_eq!((image.width(), image.height()), (512, 512));
            assert!(image.rgba().chunks_exact(4).any(|pixel| pixel[3] == 0));
            assert!(image.rgba().chunks_exact(4).any(|pixel| pixel[3] > 0));
        }
    }

    #[test]
    fn bundled_taskbar_icons_include_shell_compatible_ico_files() {
        for icon in [
            ApplicationIcon::Light,
            ApplicationIcon::Dark,
            ApplicationIcon::Mono,
        ] {
            assert!(icon.ico_bytes().starts_with(&[0, 0, 1, 0]));
            assert!(icon.ico_bytes().len() > 4_096);
        }
    }

    #[test]
    fn path_matching_is_case_insensitive_on_windows() {
        assert!(paths_match(
            Path::new(r"C:\Program Files\OriaTunnel\oria-tunnel.exe"),
            Path::new(r"c:\program files\oriaaide\ORIA-AIDE.EXE"),
        ));
        assert!(!paths_match(
            Path::new(r"C:\Program Files\OriaTunnel\oria-tunnel.exe"),
            Path::new(r"C:\Program Files\OtherApp\oria-tunnel.exe"),
        ));
    }

    #[test]
    fn light_taskbar_icon_keeps_its_white_background_tile() {
        let image = Image::from_bytes(LIGHT_ICON).expect("light taskbar icon must decode");
        assert!(image.rgba().chunks_exact(4).any(|pixel| {
            pixel[3] >= 240 && pixel[0] >= 240 && pixel[1] >= 240 && pixel[2] >= 240
        }));
    }
}
