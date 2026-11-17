//! Explicitly saved terminal commands are user documents, separate from SSH
//! configuration, credentials, session history and exports.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{ErrorKind, Write},
    path::PathBuf,
    sync::Mutex,
};
use tauri::{Emitter, State, WebviewWindow};

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    id: String,
    command: String,
    keywords: Vec<String>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Library {
    revision: u64,
    entries: Vec<Entry>,
}

pub struct Store {
    path: PathBuf,
    lock: Mutex<()>,
}

impl Store {
    pub fn new(directory: &std::path::Path) -> Self {
        Self {
            path: directory.join("saved-terminal-commands.json"),
            lock: Mutex::new(()),
        }
    }

    fn read(&self) -> Result<Library, String> {
        match fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "libraryReadError".into()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(Library::default()),
            Err(_) => Err("libraryReadError".into()),
        }
    }

    fn change(&self, previous: Option<Entry>, next: Option<Entry>) -> Result<Library, String> {
        let _guard = self.lock.lock().unwrap();
        let mut library = self.read()?;
        let id = previous
            .as_ref()
            .or(next.as_ref())
            .ok_or("libraryInvalid")?
            .id
            .clone();
        if uuid::Uuid::parse_str(&id).is_err() {
            return Err("libraryInvalid".into());
        }
        let index = library.entries.iter().position(|entry| entry.id == id);
        if index.map(|i| &library.entries[i]) != previous.as_ref() {
            return Err("libraryConflict".into());
        }
        if let Some(entry) = next {
            if entry.id != id
                || entry.command.trim().is_empty()
                || entry.command.len() > 180 * 1024
                || entry
                    .command
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t')
                || entry.keywords.is_empty()
                || entry
                    .keywords
                    .iter()
                    .any(|k| k.trim().is_empty() || k.chars().any(char::is_control))
            {
                return Err("libraryInvalid".into());
            }
            if let Some(i) = index {
                library.entries[i] = entry;
            } else {
                library.entries.insert(0, entry);
            }
        } else if let Some(i) = index {
            library.entries.remove(i);
        }
        library.revision += 1;
        let save = || -> std::io::Result<()> {
            let dir = self.path.parent().unwrap();
            fs::create_dir_all(dir)?;
            let mut file = tempfile::NamedTempFile::new_in(dir)?;
            serde_json::to_writer(&mut file, &library)?;
            file.flush()?;
            file.as_file().sync_all()?;
            file.persist(&self.path)?;
            Ok(())
        };
        save().map_err(|_| "libraryWriteError")?;
        Ok(library)
    }
}

#[tauri::command]
pub fn saved_terminal_commands(
    window: WebviewWindow,
    store: State<Store>,
) -> Result<Library, String> {
    crate::workspace::scope(&window)?;
    store.read()
}
#[tauri::command]
pub fn change_saved_terminal_command(
    window: WebviewWindow,
    store: State<Store>,
    previous: Option<Entry>,
    next: Option<Entry>,
) -> Result<Library, String> {
    crate::workspace::scope(&window)?;
    let result = store.change(previous, next)?;
    let _ = window.emit("terminal://saved-commands-changed", result.revision);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reopens_saved_commands_and_rejects_stale_edits() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let original = Entry {
            id: uuid::Uuid::new_v4().to_string(),
            command: "pwd".into(),
            keywords: vec!["目录".into()],
        };
        store.change(None, Some(original.clone())).unwrap();
        let reopened = Store::new(dir.path());
        assert!(reopened.read().unwrap().entries == [original.clone()]);
        let edited = Entry {
            keywords: vec!["cwd".into()],
            ..original.clone()
        };
        reopened
            .change(Some(original.clone()), Some(edited.clone()))
            .unwrap();
        assert!(matches!(store.change(Some(original), None), Err(e) if e == "libraryConflict"));
        store.change(Some(edited), None).unwrap();
        assert!(reopened.read().unwrap().entries.is_empty());
    }
}
