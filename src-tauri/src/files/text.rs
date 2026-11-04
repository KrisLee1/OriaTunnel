//! Bounded text editing through existing entry capabilities and mutation leases.
use super::*;
use sha2::{Digest, Sha256};

pub const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocument {
    pub text: String,
    pub version: String,
    pub encoding: String,
    pub line_ending: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSaveError {
    pub code: String,
    pub temporary: Option<String>,
}
impl From<String> for TextSaveError {
    fn from(code: String) -> Self {
        Self {
            code,
            temporary: None,
        }
    }
}
fn version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn decode(bytes: &[u8], meta: &Meta) -> Result<TextDocument> {
    let (content, encoding) =
        if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
            if !bytes.len().is_multiple_of(2) {
                return Err("editUnsupported".into());
            }
            let little = bytes[0] == 0xff;
            let units: Vec<u16> = bytes[2..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| {
                    if little {
                        u16::from_le_bytes([b[0], b[1]])
                    } else {
                        u16::from_be_bytes([b[0], b[1]])
                    }
                })
                .collect();
            (
                String::from_utf16(&units).map_err(|_| "editUnsupported")?,
                if little { "UTF-16LE" } else { "UTF-16BE" },
            )
        } else {
            let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
            (
                std::str::from_utf8(if bom { &bytes[3..] } else { bytes })
                    .map_err(|_| "editUnsupported")?
                    .to_owned(),
                if bom { "UTF-8 BOM" } else { "UTF-8" },
            )
        };
    if content.contains('\0') {
        return Err("editUnsupported".into());
    }
    let line_ending = if content.contains("\r\n") {
        "CRLF"
    } else if content.contains('\r') {
        "CR"
    } else {
        "LF"
    };
    Ok(TextDocument {
        text: content.replace("\r\n", "\n").replace('\r', "\n"),
        version: version(bytes),
        encoding: encoding.into(),
        line_ending: line_ending.into(),
        size: meta.size,
        modified: meta.modified,
    })
}
fn encode(text: &str, document: &TextDocument) -> Result<Vec<u8>> {
    if text.len() > MAX_TEXT_BYTES * 2 || text.contains('\0') {
        return Err("editLimit".into());
    }
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let text = match document.line_ending.as_str() {
        "CRLF" => normalized.replace('\n', "\r\n"),
        "CR" => normalized.replace('\n', "\r"),
        _ => normalized,
    };
    let mut bytes = Vec::new();
    match document.encoding.as_str() {
        "UTF-16LE" | "UTF-16BE" => {
            let little = document.encoding == "UTF-16LE";
            bytes.extend_from_slice(if little { &[0xff, 0xfe] } else { &[0xfe, 0xff] });
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
        }
        _ => {
            if document.encoding == "UTF-8 BOM" {
                bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            bytes.extend_from_slice(text.as_bytes());
        }
    }
    if bytes.len() > MAX_TEXT_BYTES {
        return Err("editLimit".into());
    }
    Ok(bytes)
}
async fn snapshot(entry: &Entry) -> Result<(Vec<u8>, Meta)> {
    let before = entry.fs.meta(&entry.path).await?.ok_or("missing")?;
    if before.kind != "file" {
        return Err("editUnsupported".into());
    }
    if before.size > MAX_TEXT_BYTES as u64 {
        return Err("editLimit".into());
    }
    let mut reader = entry.fs.reader(&entry.path).await?;
    let mut bytes = Vec::new();
    let read: Result<()> = async {
        loop {
            let chunk = reader.read(bytes.len() as u64).await?;
            if chunk.is_empty() {
                break;
            }
            if bytes.len() + chunk.len() > MAX_TEXT_BYTES {
                return Err("editLimit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(())
    }
    .await;
    let closed = reader.close().await;
    read?;
    closed?;
    if bytes.len() as u64 != before.size
        || entry.fs.meta(&entry.path).await?.as_ref() != Some(&before)
    {
        return Err("editChanged".into());
    }
    Ok((bytes, before))
}
async fn preflight(entry: &Entry) -> Result<()> {
    match &entry.fs {
        Fs::Local => {
            let mut options = tokio::fs::OpenOptions::new();
            options.write(true);
            #[cfg(windows)]
            options.custom_flags(0x00200000);
            let file = options.open(&entry.path).await.map_err(err)?;
            let metadata = file.metadata().await.map_err(err)?;
            if !metadata.is_file() || metadata.permissions().readonly() {
                return Err("editReadonly".into());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err("editUnsupported".into());
                }
            }
        }
        Fs::Remote(remote) => {
            if !remote.extensions.contains_key("posix-rename@openssh.com") {
                return Err("replaceUnsupported".into());
            }
            let handle = remote
                .raw
                .open(
                    &entry.path,
                    russh_sftp::protocol::OpenFlags::WRITE,
                    Default::default(),
                )
                .await
                .map_err(err)?
                .handle;
            remote.raw.close(handle).await.map_err(err)?;
        }
    }
    Ok(())
}
async fn permissions(entry: &Entry, temporary: &str) -> Result<()> {
    match &entry.fs {
        Fs::Local => {
            let meta = tokio::fs::symlink_metadata(&entry.path)
                .await
                .map_err(err)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                std::os::unix::fs::chown(temporary, Some(meta.uid()), Some(meta.gid()))
                    .map_err(err)?;
            }
            tokio::fs::set_permissions(temporary, meta.permissions())
                .await
                .map_err(err)
        }
        Fs::Remote(remote) => {
            let original = remote.raw.lstat(&entry.path).await.map_err(err)?.attrs;
            remote
                .raw
                .setstat(
                    temporary,
                    russh_sftp::protocol::FileAttributes {
                        uid: original.uid,
                        gid: original.gid,
                        permissions: original.permissions.map(|p| p & 0o7777),
                        ..Default::default()
                    },
                )
                .await
                .map(|_| ())
                .map_err(err)
        }
    }
}
async fn commit(entry: &Entry, temporary: &str) -> Result<()> {
    #[cfg(windows)]
    if matches!(entry.fs, Fs::Local) {
        let path = entry.path.clone();
        let temporary = temporary.to_owned();
        return tokio::task::spawn_blocking(move || {
            use windows::{
                core::PCWSTR,
                Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS},
            };
            let path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
            let temporary: Vec<u16> = temporary.encode_utf16().chain(Some(0)).collect();
            // Preserve the original Windows ACL and attributes when replacing content.
            unsafe {
                ReplaceFileW(
                    PCWSTR(path.as_ptr()),
                    PCWSTR(temporary.as_ptr()),
                    PCWSTR::null(),
                    REPLACE_FILE_FLAGS(0),
                    None,
                    None,
                )
            }
            .map_err(err)
        })
        .await
        .map_err(err)?;
    }
    entry.fs.rename(temporary, &entry.path, true).await
}
impl Manager {
    pub async fn read_text(&self, id: &str) -> Result<TextDocument> {
        if self.closing.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let entry = self.entry(id)?;
        if !entry.mutable {
            return Err("editUnsupported".into());
        }
        let lease = format!("mutation:{}", uuid::Uuid::new_v4());
        self.lease(&lease, std::slice::from_ref(&entry))?;
        let result = async {
            let (bytes, meta) = snapshot(&entry).await?;
            preflight(&entry).await?;
            decode(&bytes, &meta)
        }
        .await;
        self.leases.lock().unwrap().remove(&lease);
        result
    }
    pub async fn write_text(
        &self,
        id: &str,
        expected: &str,
        text: &str,
    ) -> std::result::Result<TextDocument, TextSaveError> {
        if self.closing.load(Ordering::SeqCst) {
            return Err("cancelled".to_owned().into());
        }
        if expected.len() != 64
            || !expected.bytes().all(|c| c.is_ascii_hexdigit())
            || text.len() > MAX_TEXT_BYTES * 2
        {
            return Err("editLimit".to_owned().into());
        }
        let entry = self.entry(id)?;
        if !entry.mutable || entry.meta.kind != "file" {
            return Err("editUnsupported".to_owned().into());
        }
        let lease = format!("mutation:{}", uuid::Uuid::new_v4());
        self.lease(&lease, std::slice::from_ref(&entry))?;
        let result = self.write_text_leased(&entry, expected, text).await;
        self.leases.lock().unwrap().remove(&lease);
        result
    }
    async fn write_text_leased(
        &self,
        entry: &Entry,
        expected: &str,
        text: &str,
    ) -> std::result::Result<TextDocument, TextSaveError> {
        let (original, meta) = snapshot(entry).await?;
        if version(&original) != expected {
            return Err("editChanged".to_owned().into());
        }
        preflight(entry).await?;
        let document = decode(&original, &meta)?;
        let bytes = encode(text, &document)?;
        if bytes == original {
            return Ok(document);
        }
        let parent = if entry.session.is_some() {
            entry
                .path
                .rsplit_once('/')
                .map(|(parent, _)| if parent.is_empty() { "/" } else { parent })
                .ok_or_else(|| "invalidPath".to_owned())?
                .to_owned()
        } else {
            std::path::Path::new(&entry.path)
                .parent()
                .and_then(|p| p.to_str())
                .ok_or_else(|| "invalidPath".to_owned())?
                .to_owned()
        };
        let temporary = entry
            .fs
            .join(&parent, &format!(".oria-edit-{}.tmp", uuid::Uuid::new_v4()))?;
        let mut writer = match entry.fs.writer(&temporary).await {
            Ok(writer) => writer,
            Err(code) => {
                let cleanup = match entry.fs.meta(&temporary).await {
                    Ok(None) => Ok(()),
                    Ok(Some(_)) => entry.fs.remove(&temporary, false).await,
                    Err(error) => Err(error),
                };
                return Err(if cleanup.is_ok() {
                    code.into()
                } else {
                    TextSaveError {
                        code: "cleanupFailed".into(),
                        temporary: Some(temporary),
                    }
                });
            }
        };
        let prepared: Result<()> = async {
            for (index, chunk) in bytes.chunks(32768).enumerate() {
                if self.closing.load(Ordering::SeqCst) {
                    return Err("cancelled".into());
                }
                writer.write((index * 32768) as u64, chunk.to_vec()).await?;
            }
            Ok(())
        }
        .await;
        let closed = writer.close().await;
        let prepared: Result<()> = async {
            prepared?;
            closed?;
            permissions(entry, &temporary).await?;
            let (current, current_meta) = snapshot(entry).await?;
            if current != original || current_meta != meta {
                return Err("editChanged".into());
            }
            if self.closing.load(Ordering::SeqCst) {
                return Err("cancelled".into());
            }
            Ok(())
        }
        .await;
        if let Err(code) = prepared {
            return Err(match entry.fs.remove(&temporary, false).await {
                Ok(()) => code.into(),
                Err(_) => TextSaveError {
                    code: "cleanupFailed".into(),
                    temporary: Some(temporary),
                },
            });
        }
        let committed = commit(entry, &temporary).await;
        let current = snapshot(entry).await;
        match current {
            Ok((current, current_meta)) if current == bytes => {
                // A lost rename reply can still be verified without replaying the mutation.
                if committed.is_err() {
                    if let Ok(Some(_)) = entry.fs.meta(&temporary).await {
                        let _ = entry.fs.remove(&temporary, false).await;
                    }
                }
                for saved in self.refs.lock().unwrap().values_mut() {
                    if saved.session == entry.session && saved.path == entry.path {
                        saved.meta = current_meta.clone();
                    }
                }
                let mut saved = decode(&current, &current_meta)?;
                saved.line_ending = document.line_ending;
                Ok(saved)
            }
            Ok((current, _)) if committed.is_err() && current == original => {
                let code = committed.unwrap_err();
                match entry.fs.remove(&temporary, false).await {
                    Ok(()) => Err(code.into()),
                    Err(_) => Err(TextSaveError {
                        code: "cleanupFailed".into(),
                        temporary: Some(temporary),
                    }),
                }
            }
            _ => Err(TextSaveError {
                code: "commitUnknown".into(),
                temporary: Some(temporary),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn file(root: &std::path::Path, bytes: &[u8]) -> (Manager, String, PathBuf) {
        let path = root.join("编辑资料.txt");
        tokio::fs::write(&path, bytes).await.unwrap();
        let manager = Manager::new(root.join("journal.json"));
        let directory = manager
            .directory(None, root.to_str().unwrap().into())
            .await
            .unwrap();
        let id = directory
            .entries
            .iter()
            .find(|e| e.name == "编辑资料.txt")
            .unwrap()
            .id
            .clone();
        (manager, id, path)
    }
    #[tokio::test]
    async fn save_preserves_encoding_bom_crlf_and_can_save_twice() {
        for encoding in ["UTF-8", "UTF-8 BOM", "UTF-16LE", "UTF-16BE"] {
            let root = tempfile::tempdir().unwrap();
            let model = TextDocument {
                text: String::new(),
                version: String::new(),
                encoding: encoding.into(),
                line_ending: "CRLF".into(),
                size: 0,
                modified: 0,
            };
            let original = encode("原始\n文本😀\n", &model).unwrap();
            let (manager, id, path) = file(root.path(), &original).await;
            let document = manager.read_text(&id).await.unwrap();
            assert_eq!(document.text, "原始\n文本😀\n");
            assert_eq!(document.encoding, encoding);
            assert_eq!(document.line_ending, "CRLF");
            let saved = manager
                .write_text(&id, &document.version, "更新😀\n内容\n")
                .await
                .unwrap();
            assert_eq!(
                tokio::fs::read(&path).await.unwrap(),
                encode("更新😀\n内容\n", &model).unwrap()
            );
            assert_eq!(saved.text, "更新😀\n内容\n");
            assert_ne!(saved.version, document.version);
            let empty = manager.write_text(&id, &saved.version, "").await.unwrap();
            assert!(empty.text.is_empty());
            assert_eq!(
                tokio::fs::read(path).await.unwrap(),
                encode("", &model).unwrap()
            );
            assert!(manager.active_ids().is_empty());
            assert!(!std::fs::read_dir(root.path()).unwrap().any(|e| e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".oria-edit-")));
        }
    }
    #[tokio::test]
    async fn external_changes_of_the_same_size_cannot_be_overwritten() {
        let root = tempfile::tempdir().unwrap();
        let (manager, id, path) = file(root.path(), b"original").await;
        let document = manager.read_text(&id).await.unwrap();
        tokio::fs::write(&path, b"external").await.unwrap();
        assert_eq!(
            manager
                .write_text(&id, &document.version, "mine")
                .await
                .err()
                .unwrap()
                .code,
            "editChanged"
        );
        assert_eq!(tokio::fs::read(path).await.unwrap(), b"external");
        assert!(manager.active_ids().is_empty());
    }
    #[tokio::test]
    async fn new_text_files_are_empty_editable_and_do_not_replace_existing_files() {
        let root = tempfile::tempdir().unwrap();
        let manager = Manager::new(root.path().join("journal.json"));
        let directory = manager
            .directory(None, root.path().to_str().unwrap().into())
            .await
            .unwrap();
        manager
            .mutate("createText", &directory.id, "新建文本文件.txt")
            .await
            .unwrap();
        let directory = manager
            .directory(None, root.path().to_str().unwrap().into())
            .await
            .unwrap();
        let entry = directory
            .entries
            .iter()
            .find(|e| e.name == "新建文本文件.txt")
            .unwrap();
        let document = manager.read_text(&entry.id).await.unwrap();
        assert!(document.text.is_empty());
        manager
            .write_text(&entry.id, &document.version, "写入内容")
            .await
            .unwrap();
        let directory = manager
            .directory(None, root.path().to_str().unwrap().into())
            .await
            .unwrap();
        assert_eq!(
            manager
                .mutate("createText", &directory.id, "新建文本文件.txt")
                .await
                .unwrap_err(),
            "conflict"
        );
        assert!(manager
            .mutate("createText", &directory.id, "../outside.txt")
            .await
            .is_err());
        assert_eq!(
            std::fs::read(root.path().join("新建文本文件.txt")).unwrap(),
            "写入内容".as_bytes()
        );
    }
    #[tokio::test]
    async fn binary_large_readonly_and_busy_files_are_rejected_without_writes() {
        let root = tempfile::tempdir().unwrap();
        let (manager, id, path) = file(root.path(), b"\0binary").await;
        assert_eq!(
            manager.read_text(&id).await.err().unwrap(),
            "editUnsupported"
        );
        tokio::fs::write(&path, vec![b'a'; MAX_TEXT_BYTES + 1])
            .await
            .unwrap();
        assert_eq!(manager.read_text(&id).await.err().unwrap(), "editLimit");
        tokio::fs::write(&path, b"small").await.unwrap();
        let document = manager.read_text(&id).await.unwrap();
        assert_eq!(
            manager
                .write_text(&id, &document.version, &"x".repeat(MAX_TEXT_BYTES + 1))
                .await
                .err()
                .unwrap()
                .code,
            "editLimit"
        );
        let entry = manager.entry(&id).unwrap();
        manager.lease("test-transfer", &[entry]).unwrap();
        assert_eq!(
            manager
                .write_text(&id, &document.version, "new")
                .await
                .err()
                .unwrap()
                .code,
            "pathBusy"
        );
        manager.leases.lock().unwrap().remove("test-transfer");
        let original_permissions = std::fs::metadata(&path).unwrap().permissions();
        let mut readonly = original_permissions.clone();
        readonly.set_readonly(true);
        std::fs::set_permissions(&path, readonly).unwrap();
        assert!(manager.read_text(&id).await.is_err());
        std::fs::set_permissions(&path, original_permissions).unwrap();
        assert_eq!(tokio::fs::read(path).await.unwrap(), b"small");
    }
}
