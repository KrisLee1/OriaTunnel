//! User opt-in OS integration; loading the app never changes login registration.
pub const AUTOSTART_SUPPORTED: bool = cfg!(any(windows, target_os = "macos")) && !cfg!(dev);
#[cfg(target_os = "macos")]
#[path = "macos_lifecycle.rs"]
mod platform;
#[cfg(windows)]
mod platform {
    use std::{ffi::c_void, sync::OnceLock};
    use tokio::sync::watch;
    use windows_sys::Win32::{
        System::{Power::*, Registry::*},
        UI::WindowsAndMessaging::{DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC},
    };
    static WAKE: OnceLock<watch::Sender<u64>> = OnceLock::new();
    pub struct PowerSubscription {
        handle: isize,
        _parameters: Box<DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS>,
    }
    // Parameters are immutable, with a null context and a process-lifetime callback.
    // Keep their allocation alive until unregistration even if Windows retains it.
    unsafe impl Send for PowerSubscription {}
    unsafe impl Sync for PowerSubscription {}
    impl Drop for PowerSubscription {
        fn drop(&mut self) {
            unsafe {
                PowerUnregisterSuspendResumeNotification(self.handle);
            }
        }
    }
    unsafe extern "system" fn callback(_: *const c_void, event: u32, _: *const c_void) -> u32 {
        if event == PBT_APMRESUMEAUTOMATIC {
            if let Some(wake) = WAKE.get() {
                wake.send_modify(|revision| *revision = revision.wrapping_add(1));
            }
        }
        0
    }
    pub fn subscribe(wake: watch::Sender<u64>) -> Result<PowerSubscription, String> {
        WAKE.set(wake)
            .map_err(|_| "电源恢复通知已注册".to_string())?;
        // No raw context points into application state. The process-lifetime sender is safe
        // even if a callback races shutdown/unregistration.
        let mut parameters = Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(callback),
            Context: std::ptr::null_mut(),
        });
        let mut handle = std::ptr::null_mut();
        let code = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                (parameters.as_mut() as *mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS).cast(),
                &mut handle,
            )
        };
        if code != 0 {
            return Err("无法注册系统唤醒通知".into());
        }
        Ok(PowerSubscription {
            handle: handle as isize,
            _parameters: parameters,
        })
    }
    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }
    pub fn read() -> Result<bool, String> {
        read_at(
            KEY,
            &super::startup_command(&std::env::current_exe().map_err(|_| "无法读取应用路径")?)?,
        )
    }
    fn read_at(key: &str, expected: &str) -> Result<bool, String> {
        let mut value = vec![0u16; 1024];
        let mut length = (value.len() * 2) as u32;
        let result = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                wide(key).as_ptr(),
                wide("OriaTunnel").as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                value.as_mut_ptr().cast(),
                &mut length,
            )
        };
        if result == 2 {
            return Ok(false);
        }
        if result != 0 {
            return Err("无法读取当前用户的登录启动设置".into());
        }
        let actual = String::from_utf16_lossy(&value[..(length as usize / 2).saturating_sub(1)]);
        Ok(actual == expected)
    }
    pub fn set(enabled: bool) -> Result<(), String> {
        let command =
            super::startup_command(&std::env::current_exe().map_err(|_| "无法读取应用路径")?)?;
        set_at(KEY, &command, enabled)
    }
    fn set_at(key: &str, command: &str, enabled: bool) -> Result<(), String> {
        let data = wide(command);
        let result = unsafe {
            if enabled {
                let mut handle = std::ptr::null_mut();
                let created = RegCreateKeyW(HKEY_CURRENT_USER, wide(key).as_ptr(), &mut handle);
                if created != 0 {
                    return Err("无法创建当前用户的登录启动设置".into());
                }
                RegCloseKey(handle);
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    wide(key).as_ptr(),
                    wide("OriaTunnel").as_ptr(),
                    REG_SZ,
                    data.as_ptr().cast(),
                    (data.len() * 2) as u32,
                )
            } else {
                RegDeleteKeyValueW(
                    HKEY_CURRENT_USER,
                    wide(key).as_ptr(),
                    wide("OriaTunnel").as_ptr(),
                )
            }
        };
        if result == 0 || (!enabled && result == 2) {
            Ok(())
        } else {
            Err("无法修改当前用户的登录启动设置".into())
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn isolated_registry_adapter_roundtrip_never_touches_run_key() {
            struct Fixture(String);
            impl Drop for Fixture {
                fn drop(&mut self) {
                    unsafe {
                        RegDeleteKeyW(HKEY_CURRENT_USER, wide(&self.0).as_ptr());
                    }
                }
            }
            // This UUID key is not an OS startup location. Never write the real Run key.
            let fixture = Fixture(format!(
                r"Software\OriaTunnel.Validation.{}",
                uuid::Uuid::new_v4()
            ));
            assert_ne!(fixture.0, KEY);
            let command = r#""C:\isolated-fixture\OriaTunnel.exe" --background"#;
            assert!(!read_at(&fixture.0, command).unwrap());
            set_at(&fixture.0, command, true).unwrap();
            assert!(read_at(&fixture.0, command).unwrap());
            assert!(!read_at(&fixture.0, "different executable").unwrap());
            set_at(&fixture.0, command, false).unwrap();
            assert!(!read_at(&fixture.0, command).unwrap());
        }
        #[test]
        fn native_resume_callback_notifies_without_suspending_computer() {
            let (tx, mut rx) = watch::channel(0);
            let subscription = subscribe(tx).unwrap();
            unsafe {
                callback(std::ptr::null(), 4, std::ptr::null());
            }
            assert!(!rx.has_changed().unwrap());
            unsafe {
                callback(std::ptr::null(), PBT_APMRESUMEAUTOMATIC, std::ptr::null());
            }
            assert!(rx.has_changed().unwrap());
            assert_eq!(*rx.borrow_and_update(), 1);
            drop(subscription);
        }
    }
}
#[cfg(any(windows, target_os = "macos"))]
pub use platform::{read, set, subscribe};
#[cfg(not(any(windows, target_os = "macos")))]
pub fn read() -> Result<bool, String> {
    Ok(false)
}
#[cfg(not(any(windows, target_os = "macos")))]
pub fn set(_: bool) -> Result<(), String> {
    Err("当前平台尚未支持登录启动".into())
}
#[cfg(any(windows, test))]
pub fn startup_command(path: &std::path::Path) -> Result<String, String> {
    let path = path.to_str().ok_or("应用路径无法用于登录启动")?;
    if path.contains(['"', '\0', '\n', '\r']) {
        return Err("应用路径无法用于登录启动".into());
    }
    let command = format!("\"{path}\" --background");
    if command.encode_utf16().count() > 260 {
        return Err("登录启动命令超出 Windows 的长度限制".into());
    }
    Ok(command)
}
#[cfg(test)]
mod tests {
    #[test]
    fn quoted_executable_has_fixed_background_argument() {
        assert_eq!(
            super::startup_command(std::path::Path::new(r"C:\Program Files\OriaTunnel.exe"))
                .unwrap(),
            r#""C:\Program Files\OriaTunnel.exe" --background"#
        );
        assert!(super::startup_command(std::path::Path::new("bad\"path")).is_err());
    }
}
