use super::*;
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};

// The main journal commits the byte offset only after the appended paths are durable.
// A crash can leave a longer file. Its uncommitted suffix is ignored on replay.
#[derive(Default, Clone, Serialize, Deserialize)]
pub struct CompletionArchive {
    key: String,
    bytes: u64,
    pub roots: BTreeMap<String, usize>,
}

impl Manager {
    fn archive_path(&self, key: &str) -> Result<PathBuf> {
        let key = uuid::Uuid::parse_str(key).map_err(|_| "journalDamaged")?;
        Ok(self
            .journal
            .with_extension("completed")
            .join(key.to_string()))
    }

    pub(super) fn completed_paths(&self, task: &Task) -> Result<HashSet<String>> {
        let mut paths: HashSet<_> = task.completed.iter().cloned().collect();
        if let Some(archive) = &task.completed_archive {
            let file = std::fs::File::open(self.archive_path(&archive.key)?)
                .map_err(|_| "journalDamaged")?;
            if file.metadata().map_err(err)?.len() < archive.bytes {
                return Err("journalDamaged".into());
            }
            let mut count = 0;
            for line in BufReader::new(file.take(archive.bytes)).lines() {
                paths.insert(
                    serde_json::from_str(&line.map_err(err)?).map_err(|_| "journalDamaged")?,
                );
                count += 1;
            }
            if count != archive.roots.values().sum::<usize>() {
                return Err("journalDamaged".into());
            }
        }
        Ok(paths)
    }

    pub(super) fn archive_completed(&self, id: &str) -> Result<()> {
        let _save = self.journal_lock.lock().unwrap();
        // Selected roots stay inline for batch details. Keep the latest commit
        // inline too, so the interrupted-rename recovery check can see it.
        let (sources, completed, previous) = {
            let tasks = self.tasks.lock().unwrap();
            let task = tasks.get(id).ok_or("missing")?;
            if task.completed.len() <= task.sources.len() + 128 {
                return Ok(());
            }
            (
                task.sources.clone(),
                task.completed.clone(),
                task.completed_archive.clone(),
            )
        };
        let roots: HashMap<_, _> = sources
            .iter()
            .map(|root| (root.trim_end_matches(['/', '\\']), root.as_str()))
            .collect();
        let new_archive = previous.is_none();
        let mut archive = previous.unwrap_or_else(|| CompletionArchive {
            key: uuid::Uuid::new_v4().to_string(),
            ..Default::default()
        });
        let path = self.archive_path(&archive.key)?;
        std::fs::create_dir_all(path.parent().unwrap()).map_err(err)?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true);
        if new_archive {
            options.create_new(true);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path).map_err(err)?;
        self.archive_keys
            .lock()
            .unwrap()
            .insert(archive.key.clone());
        if file.metadata().map_err(err)?.len() < archive.bytes {
            return Err("journalDamaged".into());
        }
        file.seek(SeekFrom::Start(archive.bytes)).map_err(err)?;
        let mut writer = BufWriter::new(file);
        let mut inline = vec![];
        for (index, path) in completed.iter().enumerate() {
            let root = path
                .rmatch_indices(['/', '\\'])
                .find_map(|(i, _)| roots.get(&path[..i]).copied());
            if let Some(root) =
                root.filter(|_| index + 1 < completed.len() && !roots.contains_key(path.as_str()))
            {
                serde_json::to_writer(&mut writer, path).map_err(err)?;
                writer.write_all(b"\n").map_err(err)?;
                *archive.roots.entry(root.to_owned()).or_default() += 1;
            } else {
                inline.push(path.clone());
            }
        }
        if inline.len() == completed.len() {
            return Ok(());
        }
        writer.flush().map_err(err)?;
        archive.bytes = writer.stream_position().map_err(err)?;
        writer.get_ref().sync_all().map_err(err)?;
        let mut tasks = self.tasks.lock().unwrap();
        let task = tasks.get_mut(id).ok_or("missing")?;
        task.completed = inline;
        task.completed_archive = Some(archive);
        Ok(())
    }

    pub(super) fn prune_archives(&self, retained: &[Task]) {
        let mut keys = self.archive_keys.lock().unwrap();
        if keys.is_empty() {
            return;
        }
        let live: HashSet<_> = retained
            .iter()
            .filter_map(|task| task.completed_archive.as_ref().map(|a| &a.key))
            .collect();
        keys.retain(|key| {
            if live.contains(key) {
                return true;
            }
            self.archive_path(key)
                .is_ok_and(|path| match std::fs::remove_file(path) {
                    Ok(()) => false,
                    Err(e) => e.kind() != std::io::ErrorKind::NotFound,
                })
        });
    }
}
