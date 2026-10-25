// Migrated from OriaAide; only shortcuts targeting this executable are changed.
use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    sync::Mutex,
};
use windows_sys::Win32::{
    Foundation::HWND,
    UI::{
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        WindowsAndMessaging::{
            DestroyIcon, LoadImageW, SendMessageW, ICON_BIG, IMAGE_ICON, LR_LOADFROMFILE,
            SM_CXICON, SM_CYICON, WM_SETICON,
        },
    },
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
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

// WM_SETICON does not own its HICON. Retain our large icons for the app's
// lifetime; never destroy handles owned by Tao's small-icon state or the class.
struct OwnedTaskbarIcon(isize);
impl Drop for OwnedTaskbarIcon {
    fn drop(&mut self) {
        unsafe { DestroyIcon(self.0 as _) };
    }
}
#[derive(Default)]
struct TaskbarIcons(Mutex<HashMap<(ApplicationIcon, u32), OwnedTaskbarIcon>>);

pub async fn set<R: Runtime>(app: &AppHandle<R>, icon: ApplicationIcon) -> Result<(), String> {
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
    let icon_path =
        persist_icon(app, icon).map_err(|_| crate::native_message::plain("iconPersist"))?;
    let shortcut_result = synchronize_installed_shortcut_icon(app, &icon_path).map_err(|error| {
        eprintln!("Cannot synchronize the installed Windows shortcut icon: {error}");
        crate::native_message::plain("iconPersist")
    });

    app.manage(TaskbarIcons::default());
    let app_handle = app.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            window.set_icon(image).map_err(window_icon_error)?;
            let hwnd = window.hwnd().map_err(window_icon_error)?;
            // Tauri 2.12's SetIcon dispatch only updates ICON_SMALL. Explorer
            // can keep using ICON_BIG, so explicitly update it on the UI thread.
            set_large_icon(
                hwnd.0 as _,
                icon,
                &icon_path,
                &app_handle.state::<TaskbarIcons>(),
            )
            .map_err(window_icon_error)?;
            shortcut_result
        })();
        let _ = sender.send(result);
    })
    .map_err(window_icon_error)?;
    receiver
        .await
        .map_err(|_| crate::native_message::plain("iconCancelled"))?
}

fn set_large_icon(
    hwnd: HWND,
    icon: ApplicationIcon,
    path: &Path,
    cache: &TaskbarIcons,
) -> Result<isize, std::io::Error> {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| std::io::Error::other("Icon cache unavailable"))?;
    let handle = match cache.entry((icon, dpi)) {
        std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
        std::collections::hash_map::Entry::Vacant(entry) => {
            let path = path
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let handle = unsafe {
                LoadImageW(
                    std::ptr::null_mut(),
                    path.as_ptr(),
                    IMAGE_ICON,
                    GetSystemMetricsForDpi(SM_CXICON, dpi),
                    GetSystemMetricsForDpi(SM_CYICON, dpi),
                    LR_LOADFROMFILE,
                )
            };
            if handle.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            entry.insert(OwnedTaskbarIcon(handle as isize))
        }
    };
    unsafe { SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, handle.0) };
    Ok(handle.0)
}

fn window_icon_error(error: impl std::fmt::Display) -> String {
    crate::native_message::message(
        "iconWindowsUpdate",
        serde_json::json!({"error":error.to_string()}),
    )
}

fn persist_icon<R: Runtime>(app: &AppHandle<R>, icon: ApplicationIcon) -> Result<PathBuf, String> {
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
    Ok(icon_path)
}

fn synchronize_installed_shortcut_icon<R: Runtime>(
    app: &AppHandle<R>,
    icon_path: &Path,
) -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("Cannot resolve the running executable: {error}"))?;

    let mut failure = None;
    let product_name = app.config().product_name.as_deref().unwrap_or("OriaTunnel");
    for shortcut in installed_shortcut_candidates(product_name) {
        if !shortcut.is_file() {
            continue;
        }
        if let Err(error) =
            unsafe { update_shortcut_icon_if_target_matches(&shortcut, &current_exe, icon_path) }
        {
            failure.get_or_insert_with(|| format!("Cannot update {}: {error}", shortcut.display()));
        }
    }
    failure.map_or(Ok(()), Err)
}

fn installed_shortcut_candidates(product_name: &str) -> Vec<PathBuf> {
    let Some(app_data) = std::env::var_os("APPDATA") else {
        return Vec::new();
    };
    let app_data = PathBuf::from(app_data);
    let start_menu_shortcut = app_data
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join(format!("{product_name}.lnk"));
    let pinned_directory = app_data
        .join("Microsoft")
        .join("Internet Explorer")
        .join("Quick Launch")
        .join("User Pinned")
        .join("TaskBar");
    let mut candidates = vec![start_menu_shortcut];
    // Known Folder resolution includes redirected/OneDrive desktops. Do not
    // assume USERPROFILE\Desktop or modify the executable's signed resources.
    for directory in std::iter::once(pinned_directory).chain(dirs::desktop_dir()) {
        if let Ok(entries) = fs::read_dir(directory) {
            candidates.extend(entries.flatten().map(|entry| entry.path()).filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
            }));
        }
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
    fn taskbar_large_icon_tracks_rapid_changes_and_keeps_owned_handles_alive() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, IsWindowVisible, ICON_SMALL, WM_GETICON,
            WS_OVERLAPPEDWINDOW,
        };
        let directory = tempfile::tempdir().unwrap();
        let cache = TaskbarIcons::default();
        struct FixtureWindow(HWND);
        impl Drop for FixtureWindow {
            fn drop(&mut self) {
                unsafe {
                    SendMessageW(self.0, WM_SETICON, ICON_BIG as usize, 0);
                    SendMessageW(self.0, WM_SETICON, ICON_SMALL as usize, 0);
                    DestroyWindow(self.0);
                }
            }
        }
        let class = "STATIC\0".encode_utf16().collect::<Vec<_>>();
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                200,
                100,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        assert!(!hwnd.is_null());
        let window = FixtureWindow(hwnd);
        for _ in 0..12 {
            for icon in [
                ApplicationIcon::Light,
                ApplicationIcon::Dark,
                ApplicationIcon::Mono,
            ] {
                let path = directory.path().join(format!("{}.ico", icon.file_stem()));
                fs::write(&path, icon.ico_bytes()).unwrap();
                let handle = set_large_icon(window.0, icon, &path, &cache).unwrap();
                assert_ne!(handle, 0);
                assert_eq!(
                    unsafe { SendMessageW(window.0, WM_GETICON, ICON_BIG as usize, 0) },
                    handle
                );
                assert_eq!(unsafe { IsWindowVisible(window.0) }, 0);
            }
        }
        assert_eq!(cache.0.lock().unwrap().len(), 3);
    }

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
            assert!(image
                .rgba()
                .as_chunks::<4>()
                .0
                .iter()
                .any(|pixel| pixel[3] == 0));
            assert!(image
                .rgba()
                .as_chunks::<4>()
                .0
                .iter()
                .any(|pixel| pixel[3] > 0));
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
            Path::new(r"c:\program files\oriatunnel\ORIA-TUNNEL.EXE"),
        ));
        assert!(!paths_match(
            Path::new(r"C:\Program Files\OriaTunnel\oria-tunnel.exe"),
            Path::new(r"C:\Program Files\OtherApp\oria-tunnel.exe"),
        ));
    }

    #[test]
    fn shortcut_icon_persists_without_retargeting_or_changing_other_app_shortcuts() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("fixture.exe");
        let shortcut = directory.path().join("fixture.lnk");
        let old_icon = directory.path().join("old.ico");
        let selected_icon = directory.path().join("selected.ico");
        fs::write(&executable, b"not an executable; shortcut target only").unwrap();
        fs::write(&old_icon, LIGHT_ICO).unwrap();
        fs::write(&selected_icon, DARK_ICO).unwrap();
        let observed = unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            let result = (|| -> windows::core::Result<_> {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                let file: IPersistFile = link.cast()?;
                let shortcut_string = HSTRING::from(shortcut.to_string_lossy().as_ref());
                link.SetPath(&HSTRING::from(executable.to_string_lossy().as_ref()))?;
                link.SetArguments(&HSTRING::from("--fixture-only"))?;
                link.SetIconLocation(&HSTRING::from(old_icon.to_string_lossy().as_ref()), 0)?;
                file.Save(&shortcut_string, true)?;
                let wrong = update_shortcut_icon_if_target_matches(
                    &shortcut,
                    &directory.path().join("other.exe"),
                    &selected_icon,
                )?;
                file.Load(&shortcut_string, STGM_READWRITE)?;
                let mut before = vec![0u16; 32_768];
                let mut index = 0;
                link.GetIconLocation(&mut before, &mut index)?;
                let matching =
                    update_shortcut_icon_if_target_matches(&shortcut, &executable, &selected_icon)?;
                file.Load(&shortcut_string, STGM_READWRITE)?;
                let mut after = vec![0u16; 32_768];
                link.GetIconLocation(&mut after, &mut index)?;
                let mut arguments = vec![0u16; 1024];
                link.GetArguments(&mut arguments)?;
                Ok((wrong, matching, before, after, arguments))
            })();
            CoUninitialize();
            result.unwrap()
        };
        let text = |buffer: &[u16]| {
            String::from_utf16_lossy(&buffer[..buffer.iter().position(|v| *v == 0).unwrap()])
        };
        assert!(!observed.0);
        assert!(observed.1);
        assert!(paths_match(Path::new(&text(&observed.2)), &old_icon));
        assert!(paths_match(Path::new(&text(&observed.3)), &selected_icon));
        assert_eq!(text(&observed.4), "--fixture-only");
    }

    #[test]
    fn light_taskbar_icon_keeps_its_white_background_tile() {
        let image = Image::from_bytes(LIGHT_ICON).expect("light taskbar icon must decode");
        assert!(image.rgba().as_chunks::<4>().0.iter().any(|pixel| {
            pixel[3] >= 240 && pixel[0] >= 240 && pixel[1] >= 240 && pixel[2] >= 240
        }));
    }
}
