use super::*;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, Write};

// A breadth-first stream of directory headers, children and end markers. Replaying
// in the same order needs no in-memory index, even for very wide trees.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct ScanCache {
    pub key: String,
    digest: [u8; 32],
}

struct Output {
    file: BufWriter<tempfile::NamedTempFile>,
    hash: Sha256,
    size: u64,
    key: String,
}

impl Output {
    fn append(&mut self, bytes: &[u8]) -> bool {
        self.size += bytes.len() as u64;
        if self.size > 2 * 1024 * 1024 * 1024 || self.file.write_all(bytes).is_err() {
            return false;
        }
        self.hash.update(bytes);
        true
    }
}

pub(super) struct Listings {
    input: Option<BufReader<std::fs::File>>,
    output: Option<Output>,
    line: Vec<u8>,
    rebuilding: bool,
    keep_previous_on_stop: bool,
    checkpoint: Option<(u64, Sha256)>,
}

impl Listings {
    pub fn replaying(&self) -> bool {
        self.input.is_some()
    }

    pub async fn open(
        manager: &Manager,
        saved: Option<ScanCache>,
        c: &Control,
        enabled: bool,
    ) -> Result<Self> {
        let mut listings = Self {
            input: None,
            output: None,
            line: vec![],
            rebuilding: false,
            keep_previous_on_stop: false,
            checkpoint: None,
        };
        if !enabled {
            return Ok(listings);
        }
        if let Some(saved) = saved {
            let path = manager.archive_path(&saved.key)?;
            let cancel = c.cancel.clone();
            listings.input = tokio::task::spawn_blocking(move || {
                let mut file = std::fs::File::open(path).ok()?;
                let mut hash = Sha256::new();
                let mut buf = [0; 65536];
                loop {
                    if cancel.is_cancelled() {
                        return None;
                    }
                    let n = file.read(&mut buf).ok()?;
                    if n == 0 {
                        break;
                    }
                    hash.update(&buf[..n]);
                }
                if <[u8; 32]>::from(hash.finalize()) != saved.digest {
                    return None;
                }
                file.rewind().ok()?;
                Some(BufReader::new(file))
            })
            .await
            .map_err(err)?;
            check(c)?;
        }
        listings.rebuilding = listings.input.is_none();
        listings.keep_previous_on_stop = listings.input.is_some();
        let key = uuid::Uuid::new_v4().to_string();
        let dir = manager.journal.with_extension("completed");
        if std::fs::create_dir_all(&dir).is_ok() {
            if let Ok(file) = tempfile::Builder::new()
                .prefix(&key)
                .rand_bytes(0)
                .tempfile_in(dir)
            {
                listings.output = Some(Output {
                    key,
                    file: BufWriter::new(file),
                    hash: Sha256::new(),
                    size: 0,
                });
            }
        }
        Ok(listings)
    }

    fn record(&mut self, value: &impl Serialize) {
        if !self.rebuilding || self.output.is_none() {
            return;
        }
        self.line.clear();
        if serde_json::to_writer(&mut self.line, value).is_err() {
            self.output = None;
            return;
        }
        self.line.push(b'\n');
        self.append_line();
    }

    fn append_line(&mut self) {
        if self.rebuilding
            && self
                .output
                .as_mut()
                .is_some_and(|output| !output.append(&self.line))
        {
            self.output = None;
        }
    }

    pub async fn visit(
        &mut self,
        source: &Entry,
        c: &Control,
        mut visit: impl FnMut(String, Meta, bool) -> Result<()>,
    ) -> Result<()> {
        // SFTP v3 mtimes are in whole seconds. Edits in the scan's own
        // timestamp tick cannot be distinguished on the next connection.
        let granularity = if matches!(source.fs, Fs::Remote(_)) {
            1000
        } else {
            1
        };
        let stamp = source.meta.modified;
        let stable = stamp.saturating_add(granularity) <= crate::model::timestamp();
        let header = (&source.path, if stable { stamp } else { 0 });
        let mut reuse = false;
        if let Some(input) = &mut self.input {
            let start = input.stream_position().map_err(err)?;
            self.line.clear();
            input.read_until(b'\n', &mut self.line).map_err(err)?;
            if self.line.is_empty() {
                self.keep_previous_on_stop = false;
            }
            let saved = serde_json::from_slice::<(String, u64)>(&self.line).ok();
            let aligned = saved.as_ref().is_some_and(|(path, _)| path == &source.path);
            reuse =
                aligned && saved.is_some_and(|(_, modified)| modified != 0 && modified == stamp);
            // An unchanged scan uses the original file in place. Only copy its
            // already matched prefix when a replacement actually becomes necessary.
            if !reuse && !self.rebuilding {
                self.rebuilding = true;
                if let Some(output) = &mut self.output {
                    let next = input.stream_position().map_err(err)?;
                    input.rewind().map_err(err)?;
                    let mut prefix = input.by_ref().take(start);
                    let mut buf = vec![0; 65536];
                    loop {
                        check(c)?;
                        let n = prefix.read(&mut buf).map_err(err)?;
                        if n == 0 {
                            break;
                        }
                        if !output.append(&buf[..n]) {
                            self.output = None;
                            break;
                        }
                        tokio::task::yield_now().await;
                    }
                    input.seek(std::io::SeekFrom::Start(next)).map_err(err)?;
                }
            }
            if !aligned {
                self.input = None;
            }
        }
        self.record(&header);
        if self.input.is_some() {
            let mut rows = 0;
            loop {
                if rows == 256 {
                    tokio::task::yield_now().await;
                    rows = 0;
                }
                rows += 1;
                check(c)?;
                self.line.clear();
                let n = self
                    .input
                    .as_mut()
                    .unwrap()
                    .read_until(b'\n', &mut self.line)
                    .map_err(err)?;
                if n == 0 {
                    return Err("journalDamaged".into());
                }
                if self.line == b"null\n" {
                    break;
                }
                if reuse {
                    let (name, meta): (String, Meta) =
                        serde_json::from_slice(&self.line).map_err(err)?;
                    self.append_line();
                    visit(name, meta, true)?;
                }
            }
        }
        if !reuse {
            source
                .fs
                .visit_directory(&source.path, &c.cancel, |child| {
                    self.record(&(&child.name, &child.meta));
                    visit(child.name, child.meta, false)
                })
                .await?;
        }
        self.record(&());
        if let Some(output) = &self.output {
            if self.rebuilding {
                self.checkpoint = Some((output.size, output.hash.clone()));
            }
        }
        Ok(())
    }

    pub fn finish(self, manager: &Manager, id: &str, complete: bool) {
        if !self.rebuilding {
            return;
        }
        let Some(mut output) = self.output else {
            return;
        };
        if output.file.flush().is_err() {
            return;
        }
        if !complete {
            // A later interruption during replay must retain the previous full
            // listing. On the first scan, keep only fully enumerated directories.
            if self.keep_previous_on_stop {
                return;
            }
            let Some((size, hash)) = self.checkpoint else {
                return;
            };
            if output.file.get_ref().as_file().set_len(size).is_err() {
                return;
            }
            output.hash = hash;
        }
        if output.file.get_ref().as_file().sync_all().is_err() {
            return;
        }
        let _guard = manager.journal_lock.lock().unwrap();
        let Ok(file) = output.file.into_inner() else {
            return;
        };
        if file.keep().is_err() {
            return;
        }
        manager
            .archive_keys
            .lock()
            .unwrap()
            .insert(output.key.clone());
        manager.update(id, |task| {
            task.scan_cache = Some(ScanCache {
                key: output.key,
                digest: output.hash.finalize().into(),
            })
        });
    }
}
