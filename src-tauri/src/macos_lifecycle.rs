//! macOS wake observation and explicitly requested, per-user login startup.
use block2::RcBlock;
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};
use serde::{Deserialize, Serialize};
use std::{fs::OpenOptions, io::ErrorKind, os::unix::fs::OpenOptionsExt, path::Path};
use tokio::sync::watch;

pub struct PowerSubscription {
    center: Retained<NSNotificationCenter>,
    observer: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}
// NSNotificationCenter supports concurrent registration/removal. The opaque token is
// only passed back to that center; the retained callback captures a Send + Sync sender.
unsafe impl Send for PowerSubscription {}
unsafe impl Sync for PowerSubscription {}
impl Drop for PowerSubscription {
    fn drop(&mut self) {
        let observer: &objc2::runtime::AnyObject = (*self.observer).as_ref();
        // SAFETY: This is the live token returned by this center, owned until removal.
        unsafe { self.center.removeObserver(observer) };
    }
}
fn observe(center: Retained<NSNotificationCenter>, wake: watch::Sender<u64>) -> PowerSubscription {
    let callback = RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| {
        wake.send_modify(|revision| *revision = revision.wrapping_add(1));
    });
    // SAFETY: No object filter or operation queue. The callback only touches the
    // thread-safe watch sender. NotificationCenter copies/retains the block.
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidWakeNotification),
            None,
            None,
            &callback,
        )
    };
    PowerSubscription { center, observer }
}
pub fn subscribe(wake: watch::Sender<u64>) -> Result<PowerSubscription, String> {
    // Called from Tauri setup on the AppKit main thread.
    Ok(observe(
        NSWorkspace::sharedWorkspace().notificationCenter(),
        wake,
    ))
}

const LABEL: &str = "com.oria-tunnel.startup";
#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
struct LoginAgent {
    label: String,
    program_arguments: Vec<String>,
    run_at_load: bool,
    limit_load_to_session_type: String,
}
impl LoginAgent {
    fn new(executable: &Path) -> Result<Self, String> {
        let path = executable.to_str().ok_or("应用路径无法用于登录启动")?;
        if !executable.is_absolute() || path.chars().any(char::is_control) {
            return Err("应用路径无法用于登录启动".into());
        }
        Ok(Self {
            label: LABEL.into(),
            program_arguments: vec![path.into(), "--background".into()],
            run_at_load: true,
            limit_load_to_session_type: "Aqua".into(),
        })
    }
}
fn path() -> Result<std::path::PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or("无法定位当前用户的登录启动目录")?
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist")))
}
fn load(path: &Path) -> Result<Option<LoginAgent>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取当前用户的登录启动设置".into()),
    };
    plist::from_reader(file)
        .map(Some)
        .map_err(|_| "登录启动文件格式不可用，请检查 LaunchAgents 设置".into())
}
fn read_at(path: &Path, executable: &Path) -> Result<bool, String> {
    Ok(load(path)?
        .is_some_and(|agent| LoginAgent::new(executable).is_ok_and(|expected| agent == expected)))
}
fn set_at(path: &Path, executable: &Path, enabled: bool) -> Result<(), String> {
    let agent = LoginAgent::new(executable)?;
    if load(path)?.is_some_and(|old| old.label != LABEL) {
        return Err("登录启动路径已被其他任务使用".into());
    }
    if !enabled {
        return match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(_) => Err("无法移除当前用户的登录启动设置".into()),
        };
    }
    let directory = path.parent().ok_or("登录启动目录不可用")?;
    std::fs::create_dir_all(directory).map_err(|_| "无法创建当前用户的登录启动目录")?;
    let temporary = directory.join(format!(".oria-startup-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|_| "无法写入登录启动设置")?;
        plist::to_writer_xml(&mut file, &agent).map_err(|_| "无法写入登录启动设置")?;
        file.sync_all().map_err(|_| "无法保存登录启动设置")?;
        std::fs::rename(&temporary, path).map_err(|_| "无法替换登录启动设置")?;
        Ok(())
    })();
    let _ = std::fs::remove_file(temporary);
    result
}
pub fn read() -> Result<bool, String> {
    read_at(
        &path()?,
        &std::env::current_exe().map_err(|_| "无法读取应用路径")?,
    )
}
pub fn set(enabled: bool) -> Result<(), String> {
    // Only install/remove the next-login job. Never bootstrap it or start a second app now.
    set_at(
        &path()?,
        &std::env::current_exe().map_err(|_| "无法读取应用路径")?,
        enabled,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolated_notification_center_wakes_and_unsubscribes_without_sleeping() {
        let center = NSNotificationCenter::new();
        let (wake, mut rx) = watch::channel(0);
        let subscription = observe(center.clone(), wake);
        // SAFETY: No object or userInfo; this posts only to an isolated test center.
        unsafe { center.postNotificationName_object(NSWorkspaceDidWakeNotification, None) };
        assert!(rx.has_changed().unwrap());
        assert_eq!(*rx.borrow_and_update(), 1);
        drop(subscription);
        unsafe { center.postNotificationName_object(NSWorkspaceDidWakeNotification, None) };
        assert!(!rx.has_changed().unwrap_or(false));
    }
    #[test]
    fn login_agent_roundtrip_uses_arguments_and_never_touches_real_launch_agents() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("fixture.plist");
        let executable = Path::new("/Applications/Oria & Tunnel.app/Contents/MacOS/oria-tunnel");
        assert!(!read_at(&file, executable).unwrap());
        set_at(&file, executable, true).unwrap();
        assert!(read_at(&file, executable).unwrap());
        assert!(!read_at(&file, Path::new("/moved/app")).unwrap());
        let xml = std::fs::read_to_string(&file).unwrap();
        assert!(xml.contains("Oria &amp; Tunnel.app"));
        assert!(!xml.contains("KeepAlive"));
        assert!(std::process::Command::new("/usr/bin/plutil")
            .arg("-lint")
            .arg(&file)
            .output()
            .unwrap()
            .status
            .success());
        set_at(&file, executable, false).unwrap();
        set_at(&file, executable, false).unwrap();
        assert!(!file.exists());
        assert!(LoginAgent::new(Path::new("relative/app")).is_err());
    }
    #[test]
    fn malformed_or_foreign_login_job_is_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("fixture.plist");
        let executable = Path::new("/Applications/OriaTunnel.app/Contents/MacOS/oria-tunnel");
        std::fs::write(&file, b"not a plist").unwrap();
        assert!(set_at(&file, executable, true).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"not a plist");
        let mut other = LoginAgent::new(executable).unwrap();
        other.label = "other.job".into();
        plist::to_file_xml(&file, &other).unwrap();
        assert!(set_at(&file, executable, false).is_err());
        assert_eq!(load(&file).unwrap().unwrap(), other);
    }
}
