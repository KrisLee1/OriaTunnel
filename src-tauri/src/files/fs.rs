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
// Both names are in the destination directory. Never fall back to a copy or overwrite.
#[cfg(windows)]
fn move_exclusive(old: &str, new: &str) -> std::io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    if old.contains('\0') || new.contains('\0') {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    let old: Vec<_> = old.encode_utf16().chain(Some(0)).collect();
    let new: Vec<_> = new.encode_utf16().chain(Some(0)).collect();
    if unsafe { MoveFileExW(old.as_ptr(), new.as_ptr(), 0) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn move_exclusive(old: &str, new: &str) -> std::io::Result<()> {
    let old = std::ffi::CString::new(old)?;
    let new = std::ffi::CString::new(new)?;
    if unsafe { libc::renamex_np(old.as_ptr(), new.as_ptr(), libc::RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn move_exclusive(old: &str, new: &str) -> std::io::Result<()> {
    let mut temp = tempfile::TempPath::try_from_path(old)?;
    temp.disable_cleanup(true);
    temp.persist_noclobber(new).map_err(|e| e.error)
}

fn local_rename_error(error: std::io::Error) -> String {
    use std::io::ErrorKind;
    match error.kind() {
        ErrorKind::AlreadyExists => "conflict".into(),
        ErrorKind::PermissionDenied
        | ErrorKind::InvalidInput
        | ErrorKind::NotFound
        | ErrorKind::Unsupported
        | ErrorKind::ReadOnlyFilesystem
        | ErrorKind::StorageFull => err(error),
        // Local paths can name network shares. A lost reply requires verification.
        _ => "commitUnknown".into(),
    }
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
pub(super) struct DirectoryChild {
    pub name: String,
    pub meta: Meta,
    pub created: Option<u64>,
}
#[derive(Clone)]
pub enum Fs {
    Local,
    Remote(Arc<Remote>),
}
pub struct Remote {
    pub raw: RawSftpSession,
    pub extensions: std::collections::HashMap<String, String>,
    read_size: u32,
    pub(crate) _connection: crate::tunnel::Connection,
}
impl Remote {
    pub(crate) async fn open(
        connection: crate::tunnel::Connection,
        cancel: &tokio_util::sync::CancellationToken,
        deadline: std::time::Duration,
        request_timeout_secs: u64,
    ) -> Result<Self> {
        let initialize = async move {
            let channel = connection.open_session().await.map_err(err)?;
            channel.request_subsystem(true, "sftp").await.map_err(err)?;
            // Directory NAME pages may be much larger than an individual file READ.
            let raw = RawSftpSession::new_with_config(
                channel.into_stream(),
                russh_sftp::client::Config {
                    max_packet_len: 4 * 1024 * 1024,
                    ..Default::default()
                },
            );
            raw.set_timeout(request_timeout_secs);
            let version = raw.init().await.map_err(|_| "sftpUnavailable".to_owned())?;
            let read_size = if version
                .extensions
                .get("limits@openssh.com")
                .map(String::as_str)
                == Some("1")
            {
                match raw.limits().await {
                    Ok(limits) => {
                        let mut size = 256 * 1024_u64;
                        if limits.max_read_len > 0 {
                            size = size.min(limits.max_read_len);
                        }
                        if limits.max_packet_len > 0 {
                            size = size.min(limits.max_packet_len.saturating_sub(13));
                        }
                        if size == 0 {
                            return Err("sftpUnavailable".to_owned());
                        }
                        size as u32
                    }
                    // Some servers advertise the extension but disallow this optional request.
                    Err(Error::Status(_)) => 32768,
                    Err(e) => return Err(err(e)),
                }
            } else {
                32768
            };
            Ok(Self {
                raw,
                extensions: version.extensions,
                read_size,
                _connection: connection,
            })
        };
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err("cancelled".into()),
            result = tokio::time::timeout(deadline, initialize) =>
                result.map_err(|_| "connectionTimeout".to_owned())?,
        }
    }
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
    pub(super) async fn is_windows_directory_link(&self, path: &str) -> Result<bool> {
        let Self::Remote(remote) = self else {
            return Ok(false);
        };
        let volume = path.strip_prefix('/').unwrap_or(path);
        if !volume
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
            || volume.as_bytes().get(1..3) != Some(b":/")
            || volume.len() == 3
        {
            return Ok(false);
        }
        // Win32-OpenSSH can advertise an NTFS junction as a plain directory in
        // both READDIR and LSTAT. READLINK distinguishes it from a normal folder.
        match remote.raw.readlink(path).await {
            Ok(_) => Ok(true),
            Err(Error::Status(s)) if s.status_code == StatusCode::BadMessage => {
                // POSIX servers can return BAD_MESSAGE (EINVAL) for every non-link.
                // Compare with the drive root before applying the Windows convention.
                let drive_root = &path[..path.len() - volume.len() + 3];
                Ok(matches!(remote.raw.readlink(drive_root).await,
                    Err(Error::Status(status)) if status.status_code == StatusCode::Failure))
            }
            Err(Error::Status(s))
                if matches!(
                    s.status_code,
                    StatusCode::Failure | StatusCode::OpUnsupported | StatusCode::PermissionDenied
                ) =>
            {
                Ok(false)
            }
            Err(e) => Err(format!("SFTP READLINK {path}: {e}")),
        }
    }

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
                Ok(m) => Ok(Some(local_meta(m))),
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
    pub(super) async fn list(&self, p: &str) -> Result<Vec<DirectoryChild>> {
        let mut result = Vec::new();
        self.visit_directory(p, &tokio_util::sync::CancellationToken::new(), |entry| {
            if result.len() >= 20_000 {
                return Err("directoryLimit".into());
            }
            result.push(entry);
            Ok(())
        })
        .await?;
        result.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(result)
    }

    pub(super) async fn visit_directory(
        &self,
        p: &str,
        cancel: &tokio_util::sync::CancellationToken,
        mut visit: impl FnMut(DirectoryChild) -> Result<()>,
    ) -> Result<()> {
        match self {
            Self::Local => {
                let path = p.to_owned();
                let mut entries = tokio::task::spawn_blocking(move || std::fs::read_dir(path))
                    .await
                    .map_err(err)?
                    .map_err(err)?;
                loop {
                    let token = cancel.clone();
                    let (next, page) = tokio::task::spawn_blocking(move || {
                        let mut page = Vec::with_capacity(256);
                        for _ in 0..256 {
                            if token.is_cancelled() {
                                return Err("cancelled".to_owned());
                            }
                            let Some(entry) = entries.next() else {
                                return Ok((None, page));
                            };
                            let entry = entry.map_err(err)?;
                            let name =
                                entry.file_name().into_string().map_err(|_| "invalidName")?;
                            if !local_name_ok(&name) {
                                return Err("invalidName".into());
                            }
                            // DirEntry metadata does not follow links and is cached by Windows enumeration.
                            match entry.metadata() {
                                Ok(metadata) => page.push(DirectoryChild {
                                    name,
                                    created: metadata
                                        .created()
                                        .ok()
                                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                        .map(|duration| duration.as_millis() as u64),
                                    meta: local_meta(metadata),
                                }),
                                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                                Err(e) => return Err(err(e)),
                            }
                        }
                        Ok((Some(entries), page))
                    })
                    .await
                    .map_err(err)??;
                    for entry in page {
                        visit(entry)?;
                    }
                    let Some(cursor) = next else {
                        break;
                    };
                    entries = cursor;
                }
                Ok(())
            }
            Self::Remote(r) => {
                let h = r
                    .raw
                    .opendir(p)
                    .await
                    .map_err(|e| format!("SFTP OPENDIR {p}: {e}"))?
                    .handle;
                let outcome = async {
                    loop {
                        let page = tokio::select! {
                            biased;
                            _ = cancel.cancelled() => return Err("cancelled".into()),
                            page = r.raw.readdir(h.as_slice()) => page,
                        };
                        match page {
                            Ok(page) => {
                                for f in page.files {
                                    if f.filename == "." || f.filename == ".." {
                                        continue;
                                    }
                                    if !name_ok(&f.filename) {
                                        return Err("invalidName".into());
                                    }
                                    visit(DirectoryChild {
                                        name: f.filename,
                                        meta: remote_meta(f.attrs),
                                        created: None,
                                    })?;
                                }
                            }
                            Err(Error::Status(s)) if s.status_code == StatusCode::Eof => break,
                            Err(e) => return Err(format!("SFTP READDIR {p}: {e}")),
                        }
                    }
                    Ok(())
                }
                .await;
                let closed = r
                    .raw
                    .close(h)
                    .await
                    .map_err(|e| format!("SFTP CLOSE {p}: {e}"));
                outcome?;
                closed.map(|_| ())
            }
        }
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
                    tokio::fs::rename(old, new)
                        .await
                        .map_err(local_rename_error)
                } else {
                    let (old, new) = (old.to_owned(), new.to_owned());
                    tokio::task::spawn_blocking(move || move_exclusive(&old, &new))
                        .await
                        .map_err(|_| "commitUnknown".to_owned())?
                        .map_err(local_rename_error)
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
fn local_meta(m: std::fs::Metadata) -> Meta {
    let link = m.file_type().is_symlink();
    #[cfg(windows)]
    let link = {
        use std::os::windows::fs::MetadataExt;
        link || m.file_attributes() & 0x400 != 0
    };
    Meta {
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
    }
}

pub(super) fn remote_meta(a: FileAttributes) -> Meta {
    Meta {
        hidden: false,
        kind: match a.permissions.unwrap_or(0) & 0o170000 {
            0o120000 => "link",
            0o040000 => "directory",
            0o100000 => "file",
            _ => "other",
        }
        .into(),
        size: a.size.unwrap_or(0),
        modified: a.mtime.unwrap_or(0) as u64 * 1000,
        permissions: a.permissions,
    }
}
pub enum Reader {
    Local(tokio::fs::File),
    Remote(Arc<Remote>, Vec<u8>),
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
        self.read_at_most(offset, 32768).await
    }
    pub async fn read_at_most(&mut self, offset: u64, remaining: u64) -> Result<Vec<u8>> {
        match self {
            Self::Local(f) => {
                let mut b = vec![0; remaining.min(32768) as usize];
                let n = f.read(&mut b).await.map_err(err)?;
                b.truncate(n);
                Ok(b)
            }
            Self::Remote(r, h) => {
                let len = remaining.min(r.read_size.into()) as u32;
                match retry_timeout(|| r.raw.read(h.clone(), offset, len)).await {
                    Ok(d) if d.data.len() <= len as usize => Ok(d.data),
                    Ok(_) => Err("SFTP READ returned more data than requested".into()),
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
    Remote(Arc<Remote>, Vec<u8>),
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
            .find(|entry| entry.name == "ordinary-name.txt")
            .unwrap()
            .meta;
        assert!(hidden.hidden);
        assert_eq!(hidden.permissions, Some(0o640));
        assert!(
            !entries
                .iter()
                .find(|entry| entry.name == "visible.txt")
                .unwrap()
                .meta
                .hidden
        );
        assert_eq!(
            entries
                .iter()
                .find(|entry| entry.name == "link.txt")
                .unwrap()
                .meta
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
                .find(|entry| entry.name == "ordinary-name")
                .unwrap()
                .meta
                .hidden
        );
        assert!(
            !entries
                .iter()
                .find(|entry| entry.name == "$normal")
                .unwrap()
                .meta
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
        assert_eq!(
            local_rename_error(std::io::ErrorKind::TimedOut.into()),
            "commitUnknown"
        );
        let t = tempfile::tempdir().unwrap();
        let fs = Fs::Local;
        let a = t.path().join("a").to_str().unwrap().to_owned();
        let b = t.path().join("b").to_str().unwrap().to_owned();
        tokio::fs::write(&a, b"new").await.unwrap();
        tokio::fs::write(&b, b"original").await.unwrap();
        assert_eq!(fs.rename(&a, &b, false).await.unwrap_err(), "conflict");
        let fresh = t.path().join("published");
        // A malformed persisted path must never be truncated at a native API boundary.
        assert!(fs
            .rename(&format!("{a}\0suffix"), fresh.to_str().unwrap(), false)
            .await
            .is_err());
        assert!(!fresh.exists());
        fs.rename(&a, fresh.to_str().unwrap(), false).await.unwrap();
        assert!(!Path::new(&a).exists());
        assert_eq!(tokio::fs::read(fresh).await.unwrap(), b"new");
        assert_eq!(tokio::fs::read(&b).await.unwrap(), b"original");
    }
}
