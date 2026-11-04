//! Bounded filesystem access. Remote paths never pass through a local shell.
use russh_sftp::{
    client::{error::Error, RawSftpSession},
    protocol::{FileAttributes, OpenFlags, StatusCode},
};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn display_path(path: &str) -> String {
    if let Some(path) = path.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{path}");
    }
    path.strip_prefix("\\\\?\\").unwrap_or(path).to_owned()
}
pub fn roots() -> Vec<String> {
    #[cfg(windows)]
    {
        let bits = unsafe { windows::Win32::Storage::FileSystem::GetLogicalDrives() };
        (0..26)
            .filter(|i| bits & (1 << i) != 0)
            .map(|i| format!("{}:\\", (b'A' + i) as char))
            .collect()
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSFileManager, NSVolumeEnumerationOptions};
        objc2::rc::autoreleasepool(|_| {
            let mut paths = vec!["/".to_owned()];
            if let Some(volumes) = NSFileManager::defaultManager()
                .mountedVolumeURLsIncludingResourceValuesForKeys_options(
                    None,
                    NSVolumeEnumerationOptions::SkipHiddenVolumes,
                )
            {
                paths.extend(
                    volumes
                        .iter()
                        .filter_map(|url| url.path().map(|p| p.to_string())),
                );
            }
            paths.sort();
            paths.dedup();
            paths
        })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        vec!["/".into()]
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub kind: String,
    #[serde(default)]
    pub hidden: bool,
    pub size: u64,
    pub modified: u64,
    pub permissions: Option<u32>,
}
#[derive(Clone)]
pub enum Fs {
    Local,
    Remote(Arc<Remote>),
}
pub struct Remote {
    pub raw: RawSftpSession,
    pub extensions: std::collections::HashMap<String, String>,
    pub(crate) _connection: crate::tunnel::Connection,
}
pub fn name_ok(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\', '\0'])
}
pub fn local_name_ok(s: &str) -> bool {
    if !name_ok(s) {
        return false;
    }
    if cfg!(windows) {
        let stem = s.split('.').next().unwrap_or("").to_uppercase();
        if s.ends_with(['.', ' '])
            || s.contains(['<', '>', ':', '"', '|', '?', '*'])
            || s.chars().any(|c| c < ' ')
            || [
                "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
                "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
                "LPT9",
            ]
            .contains(&stem.as_str())
        {
            return false;
        }
    }
    true
}
impl Fs {
    pub fn join(&self, parent: &str, name: &str) -> Result<String> {
        if !name_ok(name) || (matches!(self, Self::Local) && !local_name_ok(name)) {
            return Err("invalidName".into());
        }
        Ok(match self {
            Self::Local => Path::new(parent)
                .join(name)
                .to_str()
                .ok_or("invalidName")?
                .to_owned(),
            Self::Remote(_) => format!("{}/{}", parent.trim_end_matches('/'), name),
        })
    }
    pub async fn canonical(&self, p: &str) -> Result<String> {
        match self {
            Self::Local => tokio::fs::canonicalize(p)
                .await
                .map_err(err)?
                .to_str()
                .map(str::to_owned)
                .ok_or("invalidName".into()),
            Self::Remote(r) => r
                .raw
                .realpath(p)
                .await
                .map_err(err)?
                .files
                .first()
                .map(|f| f.filename.clone())
                .ok_or("invalidPath".into()),
        }
    }
    pub async fn meta(&self, p: &str) -> Result<Option<Meta>> {
        match self {
            Self::Local => match tokio::fs::symlink_metadata(p).await {
                Ok(m) => {
                    let link = m.file_type().is_symlink();
                    #[cfg(windows)]
                    let link = {
                        use std::os::windows::fs::MetadataExt;
                        link || m.file_attributes() & 0x400 != 0
                    };
                    Ok(Some(Meta {
                        hidden: {
                            #[cfg(windows)]
                            {
                                use std::os::windows::fs::MetadataExt;
                                m.file_attributes() & (0x2 | 0x4) != 0
                            }
                            #[cfg(target_os = "macos")]
                            {
                                use std::os::macos::fs::MetadataExt;
                                m.st_flags() & libc::UF_HIDDEN != 0
                            }
                            #[cfg(not(any(windows, target_os = "macos")))]
                            {
                                false
                            }
                        },
                        kind: if link {
                            "link"
                        } else if m.is_dir() {
                            "directory"
                        } else if m.is_file() {
                            "file"
                        } else {
                            "other"
                        }
                        .into(),
                        size: m.len(),
                        modified: m
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|t| t.as_millis() as u64)
                            .unwrap_or(0),
                        permissions: {
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::PermissionsExt;
                                Some(m.permissions().mode() & 0o7777)
                            }
                            #[cfg(not(unix))]
                            {
                                None
                            }
                        },
                    }))
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(err(e)),
            },
            Self::Remote(r) => match r.raw.lstat(p).await {
                Ok(a) => Ok(Some(remote_meta(a.attrs))),
                Err(Error::Status(s)) if s.status_code == StatusCode::NoSuchFile => Ok(None),
                Err(e) => Err(err(e)),
            },
        }
    }
    pub async fn list(&self, p: &str) -> Result<Vec<(String, Meta)>> {
        let mut result = Vec::new();
        match self {
            Self::Local => {
                let mut rd = tokio::fs::read_dir(p).await.map_err(err)?;
                while let Some(e) = rd.next_entry().await.map_err(err)? {
                    let n = e.file_name().into_string().map_err(|_| "invalidName")?;
                    let path = self.join(p, &n)?;
                    if let Some(m) = self.meta(&path).await? {
                        result.push((n, m));
                    }
                    if result.len() > 20_000 {
                        return Err("directoryLimit".into());
                    }
                }
            }
            Self::Remote(r) => {
                let h = r.raw.opendir(p).await.map_err(err)?.handle;
                let outcome = async {
                    loop {
                        match r.raw.readdir(&h).await {
                            Ok(page) => {
                                for f in page.files {
                                    if f.filename == "." || f.filename == ".." {
                                        continue;
                                    }
                                    if !name_ok(&f.filename) {
                                        return Err("invalidName".into());
                                    }
                                    result.push((f.filename, remote_meta(f.attrs)));
                                    if result.len() > 20_000 {
                                        return Err("directoryLimit".into());
                                    }
                                }
                            }
                            Err(Error::Status(s)) if s.status_code == StatusCode::Eof => break,
                            Err(e) => return Err(err(e)),
                        }
                    }
                    Ok(())
                }
                .await;
                let _ = r.raw.close(h).await;
                outcome?;
            }
        }
        result.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(result)
    }
    pub async fn mkdir(&self, p: &str) -> Result<()> {
        match self {
            Self::Local => tokio::fs::create_dir(p).await.map_err(err),
            Self::Remote(r) => r
                .raw
                .mkdir(p, FileAttributes::default())
                .await
                .map(|_| ())
                .map_err(err),
        }
    }
    pub async fn remove(&self, p: &str, dir: bool) -> Result<()> {
        match self {
            Self::Local => if dir {
                tokio::fs::remove_dir(p).await
            } else {
                tokio::fs::remove_file(p).await
            }
            .map_err(err),
            Self::Remote(r) => if dir {
                r.raw.rmdir(p).await
            } else {
                r.raw.remove(p).await
            }
            .map(|_| ())
            .map_err(err),
        }
    }
    pub async fn rename(&self, old: &str, new: &str, replace: bool) -> Result<()> {
        match self {
            Self::Local => {
                if replace {
                    tokio::fs::rename(old, new).await.map_err(err)
                } else {
                    tokio::fs::hard_link(old, new).await.map_err(err)?;
                    tokio::fs::remove_file(old).await.map_err(err)
                }
            }
            Self::Remote(r) => {
                if replace {
                    if !r.extensions.contains_key("posix-rename@openssh.com") {
                        return Err("replaceUnsupported".into());
                    }
                    let mut bytes = Vec::new();
                    for s in [old, new] {
                        bytes.extend_from_slice(&(s.len() as u32).to_be_bytes());
                        bytes.extend_from_slice(s.as_bytes());
                    }
                    match r
                        .raw
                        .extended("posix-rename@openssh.com", bytes)
                        .await
                        .map_err(err)?
                    {
                        russh_sftp::protocol::Packet::Status(s)
                            if s.status_code == StatusCode::Ok =>
                        {
                            Ok(())
                        }
                        _ => Err("commitUnknown".into()),
                    }
                } else {
                    r.raw.rename(old, new).await.map(|_| ()).map_err(err)
                }
            }
        }
    }
    pub async fn reader(&self, p: &str) -> Result<Reader> {
        match self {
            Self::Local => {
                if self.meta(p).await?.is_none_or(|m| m.kind != "file") {
                    return Err("unsupportedTransfer".into());
                }
                let mut options = tokio::fs::OpenOptions::new();
                options.read(true);
                #[cfg(windows)]
                options.custom_flags(0x00200000); // Open the reparse point itself; never follow it.
                #[cfg(target_os = "macos")]
                options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
                let f = options.open(p).await.map_err(err)?;
                let metadata = f.metadata().await.map_err(err)?;
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("unsupportedTransfer".into());
                    }
                }
                if !metadata.is_file() {
                    return Err("unsupportedTransfer".into());
                }
                Ok(Reader::Local(f))
            }
            Self::Remote(r) => Ok(Reader::Remote(
                r.clone(),
                r.raw
                    .open(p, OpenFlags::READ, FileAttributes::default())
                    .await
                    .map_err(err)?
                    .handle,
            )),
        }
    }
    pub async fn writer(&self, p: &str) -> Result<Writer> {
        match self {
            Self::Local => {
                let mut opts = tokio::fs::OpenOptions::new();
                opts.write(true).create_new(true);
                #[cfg(unix)]
                opts.mode(0o600);
                Ok(Writer::Local(opts.open(p).await.map_err(err)?))
            }
            Self::Remote(r) => Ok(Writer::Remote(
                r.clone(),
                r.raw
                    .open(
                        p,
                        OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
                        FileAttributes {
                            permissions: Some(0o600),
                            ..Default::default()
                        },
                    )
                    .await
                    .map_err(err)?
                    .handle,
            )),
        }
    }
}
fn remote_meta(a: FileAttributes) -> Meta {
    Meta {
        hidden: false,
        kind: if a.is_symlink() {
            "link"
        } else if a.is_dir() {
            "directory"
        } else if a.is_regular() {
            "file"
        } else {
            "other"
        }
        .into(),
        size: a.size.unwrap_or(0),
        modified: a.mtime.unwrap_or(0) as u64 * 1000,
        permissions: a.permissions,
    }
}
pub enum Reader {
    Local(tokio::fs::File),
    Remote(Arc<Remote>, String),
}
// READ and a WRITE of identical bytes to the same exclusive temporary handle and
// offset are replay-safe. Never apply this policy to rename/remove/open/create.
async fn retry_timeout<T, F, Fut>(mut operation: F) -> std::result::Result<T, Error>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = std::result::Result<T, Error>>,
{
    for delay in [1, 3, 10] {
        match operation().await {
            Err(Error::Timeout) => tokio::time::sleep(std::time::Duration::from_secs(delay)).await,
            result => return result,
        }
    }
    operation().await
}
impl Reader {
    pub async fn read(&mut self, offset: u64) -> Result<Vec<u8>> {
        match self {
            Self::Local(f) => {
                let mut b = vec![0; 32768];
                let n = f.read(&mut b).await.map_err(err)?;
                b.truncate(n);
                Ok(b)
            }
            Self::Remote(r, h) => {
                match retry_timeout(|| r.raw.read(h.clone(), offset, 32768)).await {
                    Ok(d) => Ok(d.data),
                    Err(Error::Status(s)) if s.status_code == StatusCode::Eof => Ok(vec![]),
                    Err(e) => Err(err(e)),
                }
            }
        }
    }
    pub async fn close(self) -> Result<()> {
        if let Self::Remote(r, h) = self {
            r.raw.close(h).await.map_err(err)?;
        }
        Ok(())
    }
}
pub enum Writer {
    Local(tokio::fs::File),
    Remote(Arc<Remote>, String),
}
impl Writer {
    pub async fn write(&mut self, offset: u64, b: Vec<u8>) -> Result<()> {
        match self {
            Self::Local(f) => f.write_all(&b).await.map_err(err),
            Self::Remote(r, h) => retry_timeout(|| r.raw.write(h.clone(), offset, b.clone()))
                .await
                .map(|_| ())
                .map_err(err),
        }
    }
    pub async fn close(mut self) -> Result<()> {
        match &mut self {
            Self::Local(f) => f.sync_all().await.map_err(err),
            Self::Remote(r, h) => {
                let synced = if r.extensions.contains_key("fsync@openssh.com") {
                    r.raw.fsync(h.clone()).await.map(|_| ()).map_err(err)
                } else {
                    Ok(())
                };
                let closed = r.raw.close(h.clone()).await.map(|_| ()).map_err(err);
                synced?;
                closed
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn macos_hidden_flags_permissions_and_links_use_native_metadata() {
        use std::os::{
            fd::AsRawFd,
            unix::fs::{symlink, PermissionsExt},
        };
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("ordinary-name.txt");
        let file = std::fs::File::create(&path).unwrap();
        file.set_permissions(std::fs::Permissions::from_mode(0o640))
            .unwrap();
        assert_eq!(
            unsafe { libc::fchflags(file.as_raw_fd(), libc::UF_HIDDEN) },
            0
        );
        std::fs::write(root.path().join("visible.txt"), b"visible").unwrap();
        symlink(&path, root.path().join("link.txt")).unwrap();
        let entries = Fs::Local.list(root.path().to_str().unwrap()).await.unwrap();
        let hidden = &entries
            .iter()
            .find(|(name, _)| name == "ordinary-name.txt")
            .unwrap()
            .1;
        assert!(hidden.hidden);
        assert_eq!(hidden.permissions, Some(0o640));
        assert!(
            !entries
                .iter()
                .find(|(name, _)| name == "visible.txt")
                .unwrap()
                .1
                .hidden
        );
        assert_eq!(
            entries
                .iter()
                .find(|(name, _)| name == "link.txt")
                .unwrap()
                .1
                .kind,
            "link"
        );
        assert!(Fs::Local
            .reader(root.path().join("link.txt").to_str().unwrap())
            .await
            .is_err());
        assert_eq!(serde_json::to_value(hidden).unwrap()["hidden"], true);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_roots_include_the_current_mounted_volume_without_duplicates() {
        use std::os::unix::fs::MetadataExt;
        let paths = roots();
        assert_eq!(paths.first().map(String::as_str), Some("/"));
        assert!(paths.windows(2).all(|pair| pair[0] < pair[1]));
        let device = std::fs::metadata(std::env::current_dir().unwrap())
            .unwrap()
            .dev();
        assert!(paths
            .iter()
            .any(|path| std::fs::metadata(path).is_ok_and(|meta| meta.dev() == device)));
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn windows_hidden_and_system_attributes_are_exposed_without_name_heuristics() {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{
                SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
            },
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ordinary-name");
        std::fs::create_dir(&path).unwrap();
        let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            SetFileAttributesW(
                PCWSTR(wide.as_ptr()),
                FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM,
            )
            .unwrap();
        }
        std::fs::write(dir.path().join("$normal"), b"visible").unwrap();
        let meta = Fs::Local
            .meta(path.to_str().unwrap())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(meta.kind, "directory");
        assert!(meta.hidden);
        let entries = Fs::Local.list(dir.path().to_str().unwrap()).await.unwrap();
        assert!(
            entries
                .iter()
                .find(|(name, _)| name == "ordinary-name")
                .unwrap()
                .1
                .hidden
        );
        assert!(
            !entries
                .iter()
                .find(|(name, _)| name == "$normal")
                .unwrap()
                .1
                .hidden
        );
        assert_eq!(serde_json::to_value(&meta).unwrap()["hidden"], true);
    }
    #[test]
    fn names_reject_traversal() {
        for n in ["", ".", "..", "a/b", "a\\b", "a\0b"] {
            assert!(!name_ok(n));
        }
        assert!(name_ok("中文 file.txt"));
    }
    #[test]
    fn internal_windows_prefix_is_not_a_display_path() {
        assert_eq!(display_path(r"\\?\C:\Users\example"), r"C:\Users\example");
        assert_eq!(display_path(r"\\?\UNC\server\share"), r"\\server\share");
        assert_eq!(display_path("/home/example"), "/home/example");
    }
    #[tokio::test]
    async fn exclusive_publish_does_not_replace() {
        let t = tempfile::tempdir().unwrap();
        let fs = Fs::Local;
        let a = t.path().join("a").to_str().unwrap().to_owned();
        let b = t.path().join("b").to_str().unwrap().to_owned();
        tokio::fs::write(&a, b"new").await.unwrap();
        tokio::fs::write(&b, b"original").await.unwrap();
        assert!(fs.rename(&a, &b, false).await.is_err());
        assert_eq!(tokio::fs::read(&b).await.unwrap(), b"original");
    }
}
