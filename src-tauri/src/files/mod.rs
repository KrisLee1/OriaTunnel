mod completion;
use completion::CompletionArchive;
mod direct;
mod manifest;
mod preparation;
use manifest::Manifest;
mod text;
pub use text::{TextDocument, TextSaveError};
pub mod fs;
#[cfg(test)]
mod resume_scale_test;
#[cfg(test)]
pub(crate) mod tests;
use fs::{err, Fs, Meta, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
#[derive(Clone)]
pub struct Entry {
    pub mutable: bool,
    pub fs: Fs,
    pub path: String,
    pub meta: Meta,
    pub session: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub created: Option<u64>,
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub meta: Meta,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Directory {
    pub id: String,
    pub path: String,
    pub parent: String,
    pub entries: Vec<FileEntry>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub host_id: String,
    pub host_name: String,
    pub phase: String,
    pub fingerprint: Option<String>,
    pub endpoint: Option<String>,
    pub error: Option<String>,
    pub route: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEndpoint {
    pub host_id: String,
    pub host_name: String,
    pub session_id: String,
    pub route_key: String,
    pub route: Vec<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ScanProgress {
    pub items: usize,
    pub bytes: u64,
    pub directory: String,
}

#[derive(Serialize, Deserialize)]
struct PlannedEntry {
    root: usize,
    path: String,
    destination: String,
    meta: Meta,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SourceDetails {
    pub destination: String,
    pub size: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub host_id: String,
    pub host_name: String,
    pub session_id: String,
    pub direction: String,
    #[serde(default)]
    pub transport: Option<String>,
    #[serde(default)]
    pub direct_pending: bool,
    #[serde(default)]
    pub direct_pid: Option<u32>,
    #[serde(default)]
    pub direct_pull: bool,
    #[serde(default)]
    pub source_remote: Option<RemoteEndpoint>,
    #[serde(default)]
    pub target_remote: Option<RemoteEndpoint>,
    pub sources: Vec<String>,
    #[serde(default)]
    pub source_kinds: Vec<String>,
    #[serde(default)]
    pub source_details: BTreeMap<String, SourceDetails>,
    pub target: String,
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default)]
    pub current_source: Option<String>,
    pub phase: String,
    pub bytes: u64,
    #[serde(default)]
    pub speed: Option<u64>,
    #[serde(default)]
    pub eta: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    pub total: u64,
    pub count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan: Option<ScanProgress>,
    pub completed: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_archive: Option<CompletionArchive>,
    pub skipped: usize,
    pub revision: u64,
    pub error: Option<String>,
    pub conflict: Option<String>,
    #[serde(default)]
    pub conflict_source: Option<String>,
    #[serde(default)]
    conflict_choices: Vec<ConflictChoice>,
    #[serde(default)]
    skipped_sources: BTreeSet<String>,
    pub policy: String,
    pub temp: Option<String>,
    pub started: u64,
    pub finished: Option<u64>,
    pub route_key: String,
    #[serde(default)]
    pub commit_target: Option<String>,
    #[serde(default)]
    pub commit_source: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConflictChoice {
    source: Option<String>,
    target: String,
    policy: String,
    #[serde(default)]
    kept: Option<String>,
}
impl Task {
    fn restore_after_restart(&mut self) {
        let unknown_commit = self.error.as_deref() == Some("commitUnknown");
        if self.phase == "committing" || unknown_commit {
            // Earlier writers cleared all three paths together with appending to
            // completed after rename succeeded. The oldest omitted current_source.
            let recorded = !self.direct_pending
                && self.temp.is_none()
                && self.commit_source.is_none()
                && self.commit_target.is_none()
                && !self.completed.is_empty()
                && self
                    .current_source
                    .as_ref()
                    .is_none_or(|p| self.completed.contains(p));
            self.error = (!recorded).then(|| "commitUnknown".into());
        }
        if self.active() || (self.phase == "interrupted" && unknown_commit) {
            self.phase = "interrupted".into();
            self.finished = None;
            self.speed = None;
            self.eta = None;
            if self.direct_pending {
                self.error = Some("directUnknown".into());
            } else if !matches!(
                self.error.as_deref(),
                Some("commitUnknown" | "directUnknown")
            ) {
                self.error = Some("interrupted".into());
            }
        }
    }
    fn needs_recovery(&self) -> bool {
        self.temp.is_some()
            || self.direct_pending
            || self.commit_source.is_some()
            || self.commit_target.is_some()
            || matches!(
                self.error.as_deref(),
                Some("commitUnknown" | "directUnknown")
            )
    }
    fn clearable_history(&self) -> bool {
        matches!(
            self.phase.as_str(),
            "completed" | "partial" | "failed" | "cancelled"
        ) && !self.needs_recovery()
    }
    pub fn active(&self) -> bool {
        !matches!(
            self.phase.as_str(),
            "completed"
                | "partial"
                | "failed"
                | "cancelled"
                | "paused"
                | "interrupted"
                | "conflict"
        )
    }
}
#[derive(Clone, Serialize)]
pub struct Snapshot {
    #[serde(rename = "conflictIds", skip_serializing_if = "Option::is_none")]
    pub conflict_ids: Option<Vec<String>>,
    pub revision: u64,
    pub sessions: Vec<Session>,
    pub tasks: Vec<Task>,
    pub warning: Option<String>,
}
struct Control {
    cancel: CancellationToken,
    pause: AtomicBool,
}
// Registered while the app launch gate is held. Slow filesystem work runs after
// releasing that gate, but shutdown and host removal can still cancel and join it.
pub(crate) struct PendingControl<'a> {
    manager: &'a Arc<Manager>,
    id: String,
    cancel: CancellationToken,
}
impl PendingControl<'_> {
    pub(crate) async fn apply(
        self,
        action: &str,
        session: Option<String>,
        source_session: Option<String>,
        apply_all: bool,
    ) -> Result<()> {
        self.manager
            .apply_control(
                &self.id,
                action,
                session,
                source_session,
                apply_all,
                &self.cancel,
            )
            .await
    }
}
impl Drop for PendingControl<'_> {
    fn drop(&mut self) {
        self.manager
            .leases
            .lock()
            .unwrap()
            .remove(&format!("recovery:{}", self.id));
        self.manager
            .pending_controls
            .lock()
            .unwrap()
            .remove(&self.id);
    }
}
type Changed = Arc<dyn Fn(Snapshot) + Send + Sync>;
pub struct Manager {
    pub preview_slots: Arc<Semaphore>,
    revision: std::sync::atomic::AtomicU64,
    pub session_cancels: Mutex<HashMap<String, CancellationToken>>,
    journal_lock: Mutex<()>,
    archive_keys: Mutex<HashSet<String>>,
    pub sessions: Mutex<BTreeMap<String, Session>>,
    pub remotes: Mutex<HashMap<String, Fs>>,
    pub route_keys: Mutex<HashMap<String, String>>,
    refs: Mutex<HashMap<String, Entry>>,
    ref_order: Mutex<std::collections::VecDeque<String>>,
    tasks: Mutex<BTreeMap<String, Task>>,
    controls: Mutex<HashMap<String, Arc<Control>>>,
    pending_controls: Mutex<HashMap<String, CancellationToken>>,
    jobs: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    changed: Mutex<Option<Changed>>,
    journal: PathBuf,
    warning: Mutex<Option<String>>,
    slots: Arc<Semaphore>,
    hosts: Mutex<HashMap<String, Arc<Semaphore>>>,
    leases: Mutex<HashMap<String, Vec<(String, String)>>>,
    pub closing: AtomicBool,
}
impl Manager {
    pub fn new(journal: PathBuf) -> Self {
        let mut warning = None;
        let mut tasks = BTreeMap::new();
        if journal.exists() {
            match std::fs::read(&journal)
                .ok()
                .and_then(|b| serde_json::from_slice::<Vec<Task>>(&b).ok())
            {
                Some(items) => {
                    for mut t in items {
                        t.restore_after_restart();
                        tasks.insert(t.id.clone(), t);
                    }
                }
                None => warning = Some("journalDamaged".into()),
            }
        }
        Self {
            preview_slots: Arc::new(Semaphore::new(2)),
            revision: 0.into(),
            session_cancels: Default::default(),
            journal_lock: Default::default(),
            archive_keys: Mutex::new(
                std::fs::read_dir(journal.with_extension("completed"))
                    .into_iter()
                    .flatten()
                    .flatten()
                    .filter_map(|entry| {
                        let key = entry.file_name().into_string().ok()?;
                        (uuid::Uuid::parse_str(&key).ok()?.to_string() == key).then_some(key)
                    })
                    .collect(),
            ),
            sessions: Default::default(),
            remotes: Default::default(),
            route_keys: Default::default(),
            refs: Default::default(),
            ref_order: Default::default(),
            tasks: Mutex::new(tasks),
            controls: Default::default(),
            pending_controls: Default::default(),
            jobs: Default::default(),
            changed: Default::default(),
            journal,
            warning: Mutex::new(warning),
            slots: Arc::new(Semaphore::new(4)),
            hosts: Default::default(),
            leases: Default::default(),
            closing: false.into(),
        }
    }
    pub fn track(&self, job: tokio::task::JoinHandle<()>) {
        self.jobs.lock().unwrap().push(job);
    }
    pub fn release_refs(&self, id: &str) {
        self.refs
            .lock()
            .unwrap()
            .retain(|_, e| e.session.as_deref() != Some(id));
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            conflict_ids: None,
            revision: self.revision.fetch_add(1, Ordering::SeqCst),
            sessions: self.sessions.lock().unwrap().values().cloned().collect(),
            tasks: self.tasks.lock().unwrap().values().rev().cloned().collect(),
            warning: self.warning.lock().unwrap().clone(),
        }
    }
    pub fn clear_history(&self) {
        {
            let pending = self.pending_controls.lock().unwrap();
            self.tasks
                .lock()
                .unwrap()
                .retain(|id, t| pending.contains_key(id) || !t.clearable_history());
        }
        self.save();
        self.publish();
    }
    pub fn local_target(&self, id: &str) -> Result<String> {
        let tasks = self.tasks.lock().unwrap();
        let task = tasks.get(id).ok_or("missing")?;
        if task.direction != "download" {
            return Err("invalidRequest".into());
        }
        if task.sources.len() > 1 {
            return Ok(task.target.clone());
        }
        if let Some(detail) = task
            .sources
            .first()
            .and_then(|source| task.source_details.get(source))
        {
            if task
                .source_kinds
                .first()
                .is_some_and(|kind| kind == "directory")
            {
                return Ok(detail.destination.clone());
            }
            return local_parent(&detail.destination);
        }
        Ok(task
            .destination
            .as_deref()
            .and_then(|p| std::path::Path::new(p).parent())
            .and_then(|p| p.to_str())
            .unwrap_or(&task.target)
            .to_owned())
    }
    pub fn local_transfer_folder(&self, id: &str, source: &str, side: &str) -> Result<String> {
        let tasks = self.tasks.lock().unwrap();
        let task = tasks.get(id).ok_or("missing")?;
        let index = task
            .sources
            .iter()
            .position(|path| path == source)
            .ok_or("invalidRequest")?;
        let path = match (side, task.direction.as_str()) {
            ("source", "upload") => source,
            ("target", "download") => task
                .source_details
                .get(source)
                .map(|detail| detail.destination.as_str())
                .ok_or("missing")?,
            _ => return Err("invalidRequest".into()),
        };
        if task
            .source_kinds
            .get(index)
            .is_some_and(|kind| kind == "directory")
        {
            Ok(path.into())
        } else {
            local_parent(path)
        }
    }
    pub fn set_changed(&self, c: Changed) {
        *self.changed.lock().unwrap() = Some(c);
    }
    pub fn publish(&self) {
        if let Some(c) = self.changed.lock().unwrap().clone() {
            c(self.snapshot());
        }
    }
    fn save(&self) {
        let _save = self.journal_lock.lock().unwrap();
        if self.warning.lock().unwrap().as_deref() == Some("journalDamaged") {
            return;
        }
        let list: Vec<_> = {
            let pending = self.pending_controls.lock().unwrap();
            let mut tasks = self.tasks.lock().unwrap();
            let now = crate::model::timestamp();
            let mut history: Vec<_> = tasks
                .values()
                .filter(|t| {
                    t.finished.is_some() && t.clearable_history() && !pending.contains_key(&t.id)
                })
                .map(|t| (t.finished.unwrap(), t.id.clone()))
                .collect();
            history.sort();
            let excess = history.len().saturating_sub(1000);
            for (index, (finished, id)) in history.into_iter().enumerate() {
                if index < excess || now.saturating_sub(finished) > 7 * 24 * 60 * 60 * 1000 {
                    tasks.remove(&id);
                }
            }
            tasks.values().cloned().collect()
        };
        let outcome = (|| -> std::io::Result<()> {
            use std::io::Write;
            std::fs::create_dir_all(self.journal.parent().unwrap())?;
            let tmp = self.journal.with_extension("tmp");
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut f = std::io::BufWriter::new(options.open(&tmp)?);
            serde_json::to_writer(&mut f, &list)?;
            f.flush()?;
            f.get_ref().sync_all()?;
            std::fs::rename(tmp, &self.journal)
        })();
        if outcome.is_err() {
            *self.warning.lock().unwrap() = Some("journalWriteFailed".into());
        } else {
            self.prune_archives(&list);
        }
    }
    fn update(&self, id: &str, f: impl FnOnce(&mut Task)) {
        if let Some(t) = self.tasks.lock().unwrap().get_mut(id) {
            f(t);
            t.revision += 1;
        }
    }
    pub fn change(&self, id: &str, f: impl FnOnce(&mut Task)) {
        self.update(id, f);
        self.publish();
    }

    // Every commit still checkpoints its exact recovery state. Coalesce only the
    // notifications sent to windows when many small files finish back to back.
    fn transfer_change(
        &self,
        id: &str,
        reported: &mut Option<std::time::Instant>,
        f: impl FnOnce(&mut Task),
    ) {
        self.update(id, f);
        if reported.is_none_or(|last| last.elapsed() >= std::time::Duration::from_millis(250)) {
            self.publish();
            *reported = Some(std::time::Instant::now());
        }
    }
    pub fn session_change(&self, id: &str, f: impl FnOnce(&mut Session)) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(id) {
            f(s);
        }
        self.publish();
    }
    pub fn entry(&self, id: &str) -> Result<Entry> {
        self.refs
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or("staleEntry".into())
    }
    fn register(&self, e: Entry) -> Result<String> {
        let mut refs = self.refs.lock().unwrap();
        let mut order = self.ref_order.lock().unwrap();
        while refs.len() >= 100_000 {
            if let Some(id) = order.pop_front() {
                refs.remove(&id);
            } else {
                break;
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        order.push_back(id.clone());
        refs.insert(id.clone(), e);
        Ok(id)
    }
    pub async fn directory(&self, session: Option<String>, path: String) -> Result<Directory> {
        if session.is_none() && path == ":computer:" {
            let mut entries = vec![];
            for path in fs::roots() {
                let meta = Meta {
                    kind: "directory".into(),
                    hidden: false,
                    size: 0,
                    modified: 0,
                    permissions: None,
                };
                let id = self.register(Entry {
                    mutable: false,
                    fs: Fs::Local,
                    path: path.clone(),
                    meta: meta.clone(),
                    session: None,
                })?;
                entries.push(FileEntry {
                    created: None,
                    id,
                    name: path,
                    meta,
                });
            }
            return Ok(Directory {
                id: String::new(),
                path: ":computer:".into(),
                parent: ":computer:".into(),
                entries,
            });
        }
        let fs = if let Some(id) = &session {
            self.remotes
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or("notConnected")?
        } else {
            Fs::Local
        };
        let path = if path.is_empty() {
            if session.is_some() {
                ".".into()
            } else {
                dirs::home_dir()
                    .ok_or("invalidPath")?
                    .to_str()
                    .ok_or("invalidName")?
                    .to_owned()
            }
        } else {
            path
        };
        let path = fs.canonical(&path).await?;
        let meta = fs.meta(&path).await?.ok_or("missing")?;
        if meta.kind != "directory" {
            return Err("notDirectory".into());
        }
        let id = self.register(Entry {
            mutable: false,
            fs: fs.clone(),
            path: path.clone(),
            meta,
            session: session.clone(),
        })?;
        let mut entries = Vec::new();
        let listing = fs.list(&path).await.map_err(|error| {
            if error == "directoryLimit" {
                "directoryBrowseLimit".to_owned()
            } else {
                error
            }
        })?;
        for fs::DirectoryChild {
            name,
            meta,
            created,
        } in listing
        {
            let p = fs.join(&path, &name)?;
            let id = self.register(Entry {
                mutable: true,
                fs: fs.clone(),
                path: p,
                meta: meta.clone(),
                session: session.clone(),
            })?;
            entries.push(FileEntry {
                id,
                name,
                meta,
                created,
            });
        }
        let parent = if session.is_some() {
            path.rsplit_once('/')
                .map(|(p, _)| if p.is_empty() { "/" } else { p })
                .unwrap_or("/")
                .into()
        } else {
            if std::path::Path::new(&path).parent().is_none() {
                ":computer:".into()
            } else {
                fs::display_path(
                    std::path::Path::new(&path)
                        .parent()
                        .and_then(|p| p.to_str())
                        .unwrap_or(&path),
                )
            }
        };
        Ok(Directory {
            id,
            path: if session.is_none() {
                fs::display_path(&path)
            } else {
                path
            },
            parent,
            entries,
        })
    }
    pub async fn ref_paths(&self, paths: Vec<String>) -> Result<Vec<String>> {
        if paths.len() > 1000 {
            return Err("selectionLimit".into());
        }
        let mut ids = vec![];
        for p in paths {
            if Fs::Local.meta(&p).await?.is_some_and(|m| m.kind == "link") {
                return Err("unsupportedTransfer".into());
            }
            let p = Fs::Local.canonical(&p).await?;
            let meta = Fs::Local.meta(&p).await?.ok_or("missing")?;
            ids.push(self.register(Entry {
                mutable: false,
                fs: Fs::Local,
                path: p,
                meta,
                session: None,
            })?);
        }
        Ok(ids)
    }
    pub fn host_activity(&self, id: &str) -> (Vec<String>, Vec<String>) {
        let sessions = self.sessions.lock().unwrap();
        let routed_sessions: std::collections::HashSet<_> = sessions
            .values()
            .filter(|s| s.route.iter().any(|h| h == id))
            .map(|s| s.id.clone())
            .collect();
        let connected = sessions
            .values()
            .filter(|s| {
                routed_sessions.contains(&s.id)
                    && !matches!(s.phase.as_str(), "disconnected" | "credentialsRequired")
            })
            .map(|s| s.id.clone())
            .collect();
        drop(sessions);
        let pending = self.pending_controls.lock().unwrap();
        let tasks = self
            .tasks
            .lock()
            .unwrap()
            .values()
            .filter(|t| {
                (t.active() || t.direct_pending || pending.contains_key(&t.id))
                    && (t.host_id == id
                        || [&t.source_remote, &t.target_remote]
                            .into_iter()
                            .flatten()
                            .any(|endpoint| {
                                endpoint.host_id == id
                                    || endpoint.route.iter().any(|host| host == id)
                            })
                        || routed_sessions.contains(&t.session_id))
            })
            .map(|t| t.id.clone())
            .collect();
        (connected, tasks)
    }
    pub fn busy_host(&self, id: &str) -> bool {
        let (sessions, tasks) = self.host_activity(id);
        !sessions.is_empty() || !tasks.is_empty()
    }
    pub async fn stop_host_transfers(&self, host: &str) -> Result<()> {
        let stop = async {
            loop {
                let (_, tasks) = self.host_activity(host);
                if tasks.is_empty() {
                    return Ok(());
                }
                for id in tasks {
                    if let Some(op) = self.pending_controls.lock().unwrap().get(&id) {
                        op.cancel();
                        continue;
                    }
                    if let Some(control) = self.controls.lock().unwrap().get(&id) {
                        control.pause.store(false, Ordering::SeqCst);
                        control.cancel.cancel();
                    } else if self
                        .tasks
                        .lock()
                        .unwrap()
                        .get(&id)
                        .is_some_and(|t| t.direct_pending)
                    {
                        return Err("directUnknown".into());
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        };
        tokio::time::timeout(std::time::Duration::from_secs(30), stop)
            .await
            .map_err(|_| "hostUsedByFiles".to_owned())?
    }
    pub fn active_ids(&self) -> Vec<String> {
        let pending = self.pending_controls.lock().unwrap();
        let mut ids: Vec<String> = self
            .tasks
            .lock()
            .unwrap()
            .values()
            .filter(|t| t.active() || t.direct_pending || pending.contains_key(&t.id))
            .map(|t| format!("files:{}", t.id))
            .collect();
        ids.extend(
            self.leases
                .lock()
                .unwrap()
                .keys()
                .filter(|id| id.starts_with("mutation:"))
                .cloned(),
        );
        ids
    }
    pub fn unresolved_direct(&self) -> bool {
        self.tasks
            .lock()
            .unwrap()
            .values()
            .any(|task| task.direct_pending)
    }
    fn endpoint(&self, session: Option<&str>) -> Result<Option<RemoteEndpoint>> {
        let Some(id) = session else {
            return Ok(None);
        };
        let s = self
            .sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or("notConnected")?;
        let usable = self
            .remotes
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|fs| match fs {
                Fs::Local => true,
                Fs::Remote(remote) => !remote.raw.is_closed(),
            });
        if s.phase != "connected" || !usable {
            return Err("notConnected".into());
        }
        Ok(Some(RemoteEndpoint {
            host_id: s.host_id,
            host_name: s.host_name,
            session_id: id.into(),
            route_key: self
                .route_keys
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or("notConnected")?,
            route: s.route,
        }))
    }
    fn resolve_endpoint(
        &self,
        endpoint: &mut Option<RemoteEndpoint>,
        replacement: Option<&str>,
    ) -> Result<Fs> {
        let Some(saved) = endpoint else {
            return Ok(Fs::Local);
        };
        let current = self
            .endpoint(Some(replacement.unwrap_or(&saved.session_id)))?
            .ok_or("notConnected")?;
        if current.host_id != saved.host_id || current.route_key != saved.route_key {
            return Err("routeChanged".into());
        }
        saved.session_id = current.session_id;
        self.remotes
            .lock()
            .unwrap()
            .get(&saved.session_id)
            .cloned()
            .ok_or_else(|| "notConnected".into())
    }
    fn lease(&self, id: &str, entries: &[Entry]) -> Result<()> {
        let paths: Vec<_> = entries
            .iter()
            .map(|e| {
                (
                    e.session
                        .as_ref()
                        .and_then(|id| self.route_keys.lock().unwrap().get(id).cloned())
                        .unwrap_or_else(|| "local".into()),
                    e.path.clone(),
                )
            })
            .collect();
        self.lease_paths(id, paths)
    }
    fn lease_paths(&self, id: &str, mut paths: Vec<(String, String)>) -> Result<()> {
        // SFTP gives no guarantee that differing case identifies distinct files.
        // Fold only the lease keys; submitted names and requests retain their spelling.
        for (route, path) in &mut paths {
            if route != "local" {
                *path = path.to_uppercase();
            }
        }
        let mut leases = self.leases.lock().unwrap();
        for occupied in leases.values() {
            for (a, p) in occupied {
                for (b, q) in &paths {
                    if a == b && overlap(p, q, a == "local") {
                        return Err("pathBusy".into());
                    }
                }
            }
        }
        leases.insert(id.into(), paths);
        Ok(())
    }
    pub async fn submit(
        self: &Arc<Self>,
        request: String,
        ids: Vec<String>,
        target: String,
    ) -> Result<String> {
        if uuid::Uuid::parse_str(&request).is_err()
            || ids.is_empty()
            || ids.len() > 1000
            || self.closing.load(Ordering::SeqCst)
        {
            return Err("invalidRequest".into());
        }
        if self.tasks.lock().unwrap().contains_key(&request) {
            return Ok(request);
        }
        let target = self.entry(&target)?;
        let mut sources = vec![];
        if target.meta.kind != "directory" {
            return Err("notDirectory".into());
        }
        for id in ids {
            let e = self.entry(&id)?;
            if e.session == target.session || e.meta.kind == "link" || e.meta.kind == "other" {
                return Err("unsupportedTransfer".into());
            }
            if sources.iter().any(|s: &Entry| {
                s.session == e.session && overlap(&s.path, &e.path, e.session.is_none())
            }) {
                continue;
            }
            sources.push(e);
        }
        let source_session = sources[0].session.clone();
        if sources.iter().any(|e| e.session != source_session) {
            return Err("invalidRequest".into());
        }
        let source_remote = self.endpoint(source_session.as_deref())?;
        let target_remote = self.endpoint(target.session.as_deref())?;
        if let (Some(source), Some(target)) = (&source_remote, &target_remote) {
            if source.host_id == target.host_id {
                return Err("unsupportedTransfer".into());
            }
        }
        let primary = target_remote
            .as_ref()
            .or(source_remote.as_ref())
            .ok_or("notConnected")?
            .clone();
        let session = primary.session_id.clone();
        let mut locked = sources.clone();
        let mut source_details = BTreeMap::new();
        for source in &sources {
            let name = source
                .path
                .trim_end_matches(['/', '\\'])
                .rsplit(['/', '\\'])
                .next()
                .ok_or("invalidPath")?;
            let destination = target.fs.join(&target.path, name)?;
            source_details.insert(
                source.path.clone(),
                SourceDetails {
                    destination: destination.clone(),
                    size: (source.meta.kind == "file").then_some(source.meta.size),
                },
            );
            locked.push(Entry {
                path: destination,
                ..target.clone()
            });
        }
        self.lease(&request, &locked)?;
        let is_relay = source_remote.is_some() && target_remote.is_some();
        let task = Task {
            id: request.clone(),
            host_id: primary.host_id,
            host_name: primary.host_name,
            session_id: session.clone(),
            direction: if source_remote.is_some() && target_remote.is_some() {
                "relay"
            } else if target.session.is_some() {
                "upload"
            } else {
                "download"
            }
            .into(),
            source_remote,
            target_remote,
            transport: Some(if is_relay { "checking" } else { "client" }.into()),
            direct_pending: false,
            direct_pid: None,
            direct_pull: false,
            sources: sources.iter().map(|s| s.path.clone()).collect(),
            source_kinds: sources.iter().map(|s| s.meta.kind.clone()).collect(),
            source_details,
            target: target.path.clone(),
            destination: None,
            current_source: None,
            phase: "queued".into(),
            bytes: 0,
            speed: None,
            eta: None,
            elapsed_ms: Some(0),
            total: 0,
            count: 0,
            scan: None,
            completed: vec![],
            completed_archive: None,
            skipped: 0,
            revision: 1,
            error: None,
            conflict: None,
            policy: "ask".into(),
            conflict_source: None,
            conflict_choices: vec![],
            skipped_sources: BTreeSet::new(),
            temp: None,
            started: crate::model::timestamp(),
            finished: None,
            commit_target: None,
            commit_source: None,
            route_key: self
                .route_keys
                .lock()
                .unwrap()
                .get(&session)
                .cloned()
                .unwrap_or_default(),
        };
        self.tasks.lock().unwrap().insert(request.clone(), task);
        self.save();
        self.spawn(request.clone(), sources, target);
        Ok(request)
    }
    fn spawn(self: &Arc<Self>, id: String, sources: Vec<Entry>, target: Entry) {
        let manager = self.clone();
        let c = Arc::new(Control {
            cancel: CancellationToken::new(),
            pause: false.into(),
        });
        self.controls.lock().unwrap().insert(id.clone(), c.clone());
        self.publish();
        let job = tokio::spawn(async move {
            let result = manager.run(&id, sources, target, &c).await;
            manager.leases.lock().unwrap().remove(&id);
            manager.controls.lock().unwrap().remove(&id);
            if let Err(mut e) = result {
                if e == "cancelled" && c.pause.load(Ordering::SeqCst) {
                    e = "paused".into();
                } else if e == "cancelled" && manager.closing.load(Ordering::SeqCst) {
                    e = "interrupted".into();
                }
                manager.change(&id, |t| {
                    t.phase = if e == "paused" {
                        "paused"
                    } else if e == "interrupted" {
                        "interrupted"
                    } else if e == "cancelled" {
                        "cancelled"
                    } else if e == "conflict" || e == "replaceUnsupported" {
                        "conflict"
                    } else {
                        "failed"
                    }
                    .into();
                    if ["failed", "cancelled"].contains(&t.phase.as_str()) {
                        t.finished = Some(crate::model::timestamp());
                    }
                    t.speed = None;
                    t.eta = None;
                    t.error = Some(e);
                });
            }
            manager.save();
            manager.publish();
        });
        let mut jobs = self.jobs.lock().unwrap();
        jobs.retain(|j| !j.is_finished());
        jobs.push(job);
    }
    fn conflict_policy(&self, id: &str, source: &str, target: &str) -> String {
        let mut tasks = self.tasks.lock().unwrap();
        let task = tasks.get_mut(id).unwrap();
        if let Some(choice) = task.conflict_choices.iter_mut().find(|choice| {
            choice.target == target
                && (choice.source.is_none() || choice.source.as_deref() == Some(source))
        }) {
            // Old journals may know only the destination: bind that choice once.
            choice.source = Some(source.into());
            return choice.policy.clone();
        }
        task.policy.clone()
    }
    fn mark_skipped(&self, id: &str, source: &str) {
        self.change(id, |task| {
            if task.skipped_sources.insert(source.into()) {
                task.skipped += 1;
            }
        });
    }
    fn record_conflict(&self, id: &str, source: &str, target: &str) {
        self.change(id, |task| {
            task.conflict = Some(target.into());
            task.conflict_source = Some(source.into());
        });
    }
    fn remember_kept_directory(&self, id: &str, source: &str, target: &str, kept: &str) {
        self.change(id, |task| {
            if let Some(choice) = task
                .conflict_choices
                .iter_mut()
                .find(|choice| choice.target == target && choice.source.as_deref() == Some(source))
            {
                choice.kept = Some(kept.into());
            } else {
                task.conflict_choices.push(ConflictChoice {
                    source: Some(source.into()),
                    target: target.into(),
                    policy: "keep".into(),
                    kept: Some(kept.into()),
                });
            }
        });
    }
    async fn run(&self, id: &str, sources: Vec<Entry>, target: Entry, c: &Control) -> Result<()> {
        let start = std::time::Instant::now();
        let prior_ms = self.tasks.lock().unwrap()[id].elapsed_ms.unwrap_or(0);
        let elapsed_ms = || prior_ms.saturating_add(start.elapsed().as_millis() as u64);
        let mut prior_sample: Option<(u64, u64)> = None;
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let work = self.copy(id, sources, target, c);
        tokio::pin!(work);
        loop {
            tokio::select! {
                result = &mut work => {
                    self.change(id, |t| {
                        t.elapsed_ms = Some(elapsed_ms());
                        if result.is_ok() {
                            t.phase = if t.skipped > 0 { "partial" } else { "completed" }.into();
                            t.finished = Some(crate::model::timestamp());
                            t.speed = None;
                            t.eta = None;
                            t.conflict = None;
                            t.conflict_source = None;
                        }
                    });
                    return result;
                }
                _ = tick.tick() => self.change(id, |t| {
                    let ms = elapsed_ms();
                    t.elapsed_ms = Some(ms);
                    if matches!(t.phase.as_str(), "transferring" | "committing") {
                        if let Some((bytes, when)) = prior_sample {
                            let seconds = (ms - when) as f64 / 1000.0;
                            if seconds > 0.0 {
                                let speed = (t.bytes.saturating_sub(bytes) as f64 / seconds).round() as u64;
                                t.speed = Some(speed);
                                t.eta = (speed > 0).then(|| t.total.saturating_sub(t.bytes).div_ceil(speed));
                            }
                        }
                        prior_sample = Some((t.bytes, ms));
                    } else {
                        prior_sample = None;
                    }
                }),
            }
        }
    }

    async fn copy(&self, id: &str, sources: Vec<Entry>, target: Entry, c: &Control) -> Result<()> {
        let preparation::Prepared {
            mut files,
            mut completed,
            direct_paths,
            mut conflict,
        } = self.prepare(id, &sources, &target, c).await?;
        let host_slots = {
            let tasks = self.tasks.lock().unwrap();
            let task = &tasks[id];
            let mut host_ids = vec![&task.host_id];
            if let Some(source) = &task.source_remote {
                host_ids.push(&source.host_id);
            }
            host_ids.sort();
            host_ids.dedup();
            let mut hosts = self.hosts.lock().unwrap();
            host_ids
                .into_iter()
                .map(|host| {
                    hosts
                        .entry(host.clone())
                        .or_insert_with(|| Arc::new(Semaphore::new(2)))
                        .clone()
                })
                .collect::<Vec<_>>()
        };
        let mut direct_plan = None;
        let mut direct_checked = false;
        let mut last_transfer_report = None;
        while let Some(item) = files.next()? {
            let mut dest = item.destination;
            let source = Entry {
                path: item.path,
                meta: item.meta,
                ..sources[item.root].clone()
            };
            check(c)?;
            if completed.contains(&source.path) {
                self.change(id, |t| t.bytes += source.meta.size);
                continue;
            }
            let before = target.fs.meta(&dest).await?;
            let mut replace = false;
            if let Some(meta) = &before {
                let policy = self.conflict_policy(id, &source.path, &dest);
                if policy == "skip" {
                    self.mark_skipped(id, &source.path);
                    continue;
                }
                if policy == "keep" {
                    dest = available_name(&target.fs, &dest, "file").await?;
                } else if policy == "replace" && meta.kind == "file" {
                    replace = true;
                } else {
                    if conflict.is_none() {
                        self.record_conflict(id, &source.path, &dest);
                        conflict = Some(if policy == "replace" {
                            "replaceUnsupported"
                        } else {
                            "conflict"
                        });
                    }
                    continue;
                }
            }
            if replace
                && matches!(&target.fs,Fs::Remote(r) if !r.extensions.contains_key("posix-rename@openssh.com"))
            {
                self.record_conflict(id, &source.path, &dest);
                return Err("replaceUnsupported".into());
            }
            let _global = tokio::select! {_=c.cancel.cancelled()=>return Err("cancelled".into()),p=self.slots.clone().acquire_owned()=>p.map_err(err)?};
            // A stable order prevents opposite-direction relays from deadlocking.
            let mut _host_permits = Vec::new();
            for slot in &host_slots {
                _host_permits.push(tokio::select! {_=c.cancel.cancelled()=>return Err("cancelled".into()),p=slot.clone().acquire_owned()=>p.map_err(err)?});
            }
            check(c)?;
            if !direct_checked {
                let relay = matches!((&source.fs, &target.fs), (Fs::Remote(_), Fs::Remote(_)));
                self.change(id, |task| {
                    task.transport = Some(if relay { "checking" } else { "client" }.into())
                });
                if relay && direct_paths {
                    direct_plan = direct::discover(&source.fs, &target.fs, &c.cancel).await?;
                }
                self.change(id, |task| {
                    task.transport = Some(
                        if direct_plan.is_some() {
                            "direct"
                        } else if relay {
                            "relay"
                        } else {
                            "client"
                        }
                        .into(),
                    );
                    task.direct_pull = direct_plan.as_ref().is_some_and(|plan| plan.pull);
                });
                direct_checked = true;
            }
            let parent = if target.session.is_some() {
                dest.rsplit_once('/').map(|p| p.0).unwrap_or("/").to_owned()
            } else {
                std::path::Path::new(&dest)
                    .parent()
                    .and_then(|p| p.to_str())
                    .ok_or("invalidPath")?
                    .to_owned()
            };
            let temp = target.fs.join(
                &parent,
                &format!(".oria-transfer-{}.part", uuid::Uuid::new_v4()),
            )?;
            self.transfer_change(id, &mut last_transfer_report, |t| {
                t.phase = "transferring".into();
                t.destination = Some(dest.clone());
                t.current_source = Some(source.path.clone());
                if let Some(detail) = t.source_details.get_mut(&source.path) {
                    detail.destination = dest.clone();
                }
                t.temp = Some(temp.clone());
            });
            self.save();
            let mut created = false;
            let result = async {
                let (offset, reported) = if let Some(plan) = &direct_plan {
                    let writer = target.fs.writer(&temp).await?;
                    created = true;
                    writer.close().await?;
                    self.change(id, |task| {task.direct_pending = true; task.direct_pid = None;});
                    self.save();
                    let base = self.tasks.lock().unwrap()[id].bytes;
                    let mut reported = 0; let mut known_pid = None;
                    let copied = plan.copy(&source.path, &target.fs, &temp, source.meta.size, &c.cancel,
                        |bytes, pid, stopped| {
                            let changed_pid = pid != known_pid; known_pid = pid; reported = bytes;
                            self.change(id, |task| {
                                task.bytes = base + bytes;
                                task.direct_pid = pid;
                                if stopped {task.direct_pending = false;}
                            });
                            if changed_pid || stopped {self.save();}
                        }).await;
                    if matches!(copied.as_ref().err().map(String::as_str), Some("connectionFailed" | "connectionTimeout")) { self.change(id, |task| task.direct_pending = false); }
                    copied?;
                    let meta = target.fs.meta(&temp).await?.ok_or("missing")?;
                    if meta.kind != "file" || meta.size != source.meta.size {return Err("directFailed".into());}
                    (source.meta.size, reported)
                } else {
                let mut reader = source.fs.reader(&source.path).await?;
                let mut writer = match target.fs.writer(&temp).await {
                    Ok(w) => w,
                    Err(e) => {
                        let _ = reader.close().await;
                        return Err(e);
                    }
                };
                created = true;
                let mut offset = 0;
                let mut last = std::time::Instant::now();
                let mut reported = 0;
                let copied: Result<()> = async {
                    while offset < source.meta.size {
                        check(c)?;
                        let remaining = source.meta.size - offset;
                        // A relay destination may accept smaller writes than its source's reads.
                        let length = if matches!(target.fs, Fs::Remote(_)) { remaining.min(32768) } else { remaining };
                        let bytes = tokio::select!{_=c.cancel.cancelled()=>return Err("cancelled".into()),bytes=reader.read_at_most(offset, length)=>bytes?};
                        if bytes.is_empty() {
                            break;
                        }
                        let len = bytes.len() as u64;
                        tokio::select!{_=c.cancel.cancelled()=>return Err("cancelled".into()),result=writer.write(offset,bytes)=>result?};
                        offset += len;
                        if last.elapsed().as_millis() >= 250 {
                            self.change(id, |t| t.bytes += offset - reported);
                            reported = offset;
                            last = std::time::Instant::now();
                        }
                    }
                    if offset != source.meta.size {
                        return Err("sourceChanged".into());
                    }
                    Ok(())
                }
                .await;
                let closed_reader = reader.close().await;
                let closed_writer = writer.close().await;
                copied?;
                closed_reader?;
                closed_writer?;
                    (offset, reported)
                };
                check(c)?;
                if source.fs.meta(&source.path).await?.as_ref() != Some(&source.meta) {
                    return Err("sourceChanged".into());
                }
                if replace && target.fs.meta(&dest).await? != before {
                    return Err("targetChanged".into());
                }
                self.transfer_change(id, &mut last_transfer_report, |t| {
                    t.phase = "committing".into();
                    t.commit_target = Some(dest.clone());
                    t.commit_source = Some(source.path.clone());
                });
                self.save();
                if let Err(error) = target.fs.rename(&temp, &dest, replace).await {
                    if !matches!(target.fs, Fs::Local) || error == "commitUnknown" {
                        return Err("commitUnknown".into());
                    }
                    self.change(id, |t| {
                        t.phase = "transferring".into();
                        t.commit_target = None;
                        t.commit_source = None;
                    });
                    if error == "conflict" {
                        self.record_conflict(id, &source.path, &dest);
                    }
                    return Err(error);
                }
                self.transfer_change(id, &mut last_transfer_report, |t| {
                    t.bytes += offset - reported;
                    t.completed.push(source.path.clone());
                    t.phase = "transferring".into();
                    t.temp = None;
                    t.commit_source = None;
                    t.commit_target = None;
                });
                Ok(())
            }
            .await;
            if result.is_err()
                && !matches!(
                    result.as_ref().err().map(String::as_str),
                    Some("commitUnknown" | "directUnknown")
                )
            {
                if !created || target.fs.remove(&temp, false).await.is_ok() {
                    self.change(id, |t| t.temp = None);
                } else {
                    self.change(id, |t| t.error = Some("cleanupFailed".into()));
                }
            }
            result?;
            completed.insert(source.path);
            self.archive_completed(id)?;
            self.save();
        }
        if let Some(reason) = conflict {
            return Err(reason.into());
        }
        Ok(())
    }
    pub async fn control(
        self: &Arc<Self>,
        id: &str,
        action: &str,
        session: Option<String>,
    ) -> Result<()> {
        self.control_between(id, action, session, None).await
    }
    pub async fn control_between(
        self: &Arc<Self>,
        id: &str,
        action: &str,
        session: Option<String>,
        source_session: Option<String>,
    ) -> Result<()> {
        self.control_scoped(id, action, session, source_session, true)
            .await
    }
    pub async fn control_scoped(
        self: &Arc<Self>,
        id: &str,
        action: &str,
        session: Option<String>,
        source_session: Option<String>,
        apply_all: bool,
    ) -> Result<()> {
        self.reserve_control(id)?
            .apply(action, session, source_session, apply_all)
            .await
    }
    pub(crate) fn reserve_control(self: &Arc<Self>, id: &str) -> Result<PendingControl<'_>> {
        let mut pending = self.pending_controls.lock().unwrap();
        if self.closing.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        if pending.contains_key(id) {
            return Err("taskBusy".into());
        }
        let cancel = CancellationToken::new();
        pending.insert(id.into(), cancel.clone());
        Ok(PendingControl {
            manager: self,
            id: id.into(),
            cancel,
        })
    }
    async fn apply_control(
        self: &Arc<Self>,
        id: &str,
        action: &str,
        session: Option<String>,
        source_session: Option<String>,
        apply_all: bool,
        cancel: &CancellationToken,
    ) -> Result<()> {
        if cancel.is_cancelled() {
            return Err("cancelled".into());
        }
        if let Some(c) = self.controls.lock().unwrap().get(id) {
            match action {
                "pause" => {
                    c.pause.store(true, Ordering::SeqCst);
                    c.cancel.cancel();
                    return Ok(());
                }
                "cancel" => {
                    c.pause.store(false, Ordering::SeqCst);
                    c.cancel.cancel();
                    return Ok(());
                }
                _ => return Err("taskBusy".into()),
            }
        }
        if action == "clear" {
            let mut t = self.tasks.lock().unwrap();
            if t.get(id).is_some_and(Task::active) {
                return Err("taskBusy".into());
            }
            if t.get(id).is_some_and(Task::needs_recovery) {
                return Err("cleanupFailed".into());
            }
            t.remove(id);
            drop(t);
            self.save();
            self.publish();
            return Ok(());
        }
        if action == "cancel" {
            if let Some(task) = self.tasks.lock().unwrap().get(id) {
                if task.direct_pending {
                    return Err("directUnknown".into());
                }
                if task.error.as_deref() == Some("commitUnknown") {
                    return Err("commitUnknown".into());
                }
            }
            self.change(id, |t| t.phase = "cancelled".into());
            self.save();
            return Ok(());
        }
        if ![
            "resume", "retry", "skip", "keep", "replace", "verify", "cleanup",
        ]
        .contains(&action)
        {
            return Err("invalidRequest".into());
        }
        let mut task = self
            .tasks
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or("missing")?;
        if task.direct_pending && action != "verify" {
            return Err("directUnknown".into());
        }
        if ["skip", "keep", "replace"].contains(&action) && task.phase != "conflict" {
            return Err("staleEntry".into());
        }
        if task.temp.is_some()
            && !task.direct_pending
            && !matches!(action, "cleanup" | "verify")
            && task.error.as_deref() != Some("commitUnknown")
        {
            return Err("cleanupFailed".into());
        }
        if task.error.as_deref() == Some("commitUnknown") && action != "verify" {
            return Err("commitUnknown".into());
        }
        if task.phase == "completed" {
            return Err("invalidRequest".into());
        }
        // Older local/remote history stores its single endpoint in the legacy fields.
        if task.source_remote.is_none() && task.target_remote.is_none() {
            let endpoint = RemoteEndpoint {
                host_id: task.host_id.clone(),
                host_name: task.host_name.clone(),
                session_id: task.session_id.clone(),
                route_key: task.route_key.clone(),
                route: vec![task.host_id.clone()],
            };
            if task.direction == "upload" {
                task.target_remote = Some(endpoint);
            } else if task.direction == "download" {
                task.source_remote = Some(endpoint);
            } else {
                return Err("invalidRequest".into());
            }
        }
        if matches!(action, "verify" | "cleanup") {
            let mut paths = Vec::new();
            for (endpoint, path) in [
                (&task.target_remote, &task.temp),
                (&task.target_remote, &task.commit_target),
                (&task.source_remote, &task.commit_source),
            ] {
                if let Some(path) = path {
                    let key = endpoint
                        .as_ref()
                        .map_or("local", |remote| &remote.route_key);
                    paths.push((key.into(), path.clone()));
                }
            }
            self.lease_paths(&format!("recovery:{id}"), paths)?;
        }
        let dst_fs = self.resolve_endpoint(&mut task.target_remote, session.as_deref())?;
        if action == "cleanup" {
            if let Some(temp) = &task.temp {
                let leaf = temp.rsplit(['/', '\\']).next().ok_or("invalidPath")?;
                let uuid = leaf
                    .strip_prefix(".oria-transfer-")
                    .and_then(|n| n.strip_suffix(".part"))
                    .ok_or("invalidPath")?;
                uuid::Uuid::parse_str(uuid).map_err(err)?;
                if let Some(meta) = cancellable(cancel, dst_fs.meta(temp)).await? {
                    if meta.kind != "file" {
                        return Err("cleanupFailed".into());
                    }
                    dst_fs.remove(temp, false).await?;
                }
            }
            self.change(id, |t| t.temp = None);
            self.save();
            return Ok(());
        }
        let src_fs = self.resolve_endpoint(
            &mut task.source_remote,
            if task.direction == "relay" {
                source_session.as_deref()
            } else {
                session.as_deref()
            },
        )?;
        if action == "verify" && task.direct_pending {
            let temp = task.temp.as_deref().ok_or("directUnknown")?;
            let executor = if task.direct_pull { &dst_fs } else { &src_fs };
            cancellable(
                cancel,
                direct::confirm_stopped(executor, task.direct_pid, temp),
            )
            .await?;
            if let Some(meta) = cancellable(cancel, dst_fs.meta(temp)).await? {
                if meta.kind != "file" {
                    return Err("cleanupFailed".into());
                }
                dst_fs.remove(temp, false).await?;
            }
            task.direct_pending = false;
            task.direct_pid = None;
            task.temp = None;
            task.phase = "paused".into();
            task.error = None;
            task.revision += 1;
            self.tasks.lock().unwrap().insert(id.into(), task);
            self.save();
            self.publish();
            return Ok(());
        }
        if action == "verify" {
            let source = task.commit_source.as_deref().ok_or("invalidRequest")?;
            let dest = task.commit_target.as_deref().ok_or("invalidRequest")?;
            let before = cancellable(cancel, src_fs.meta(source))
                .await?
                .ok_or("missing")?;
            let dest_meta = cancellable(cancel, dst_fs.meta(dest)).await?;
            if let Some(meta) = dest_meta {
                if meta.kind != "file"
                    || before.kind != "file"
                    || meta.size != before.size
                    || hash(&src_fs, source, cancel).await? != hash(&dst_fs, dest, cancel).await?
                    || cancellable(cancel, src_fs.meta(source)).await?.as_ref() != Some(&before)
                    || cancellable(cancel, dst_fs.meta(dest)).await?.as_ref() != Some(&meta)
                {
                    return Err("targetChanged".into());
                }
                if !self.completed_paths(&task)?.contains(source) {
                    task.completed.push(source.into());
                }
            }
            if let Some(temp) = &task.temp {
                if cancellable(cancel, dst_fs.meta(temp)).await?.is_some() {
                    dst_fs.remove(temp, false).await?;
                }
            }
            task.temp = None;
            task.commit_source = None;
            task.commit_target = None;
            task.error = None;
            task.phase = "paused".into();
            task.revision += 1;
            self.tasks.lock().unwrap().insert(id.into(), task);
            self.save();
            self.publish();
            return Ok(());
        }
        let mut sources = vec![];
        for path in &task.sources {
            sources.push(Entry {
                mutable: false,
                fs: src_fs.clone(),
                path: path.clone(),
                meta: cancellable(cancel, src_fs.meta(path))
                    .await?
                    .ok_or("missing")?,
                session: task
                    .source_remote
                    .as_ref()
                    .map(|endpoint| endpoint.session_id.clone()),
            });
        }
        let target = Entry {
            mutable: false,
            fs: dst_fs.clone(),
            path: task.target.clone(),
            meta: cancellable(cancel, dst_fs.meta(&task.target))
                .await?
                .ok_or("missing")?,
            session: task
                .target_remote
                .as_ref()
                .map(|endpoint| endpoint.session_id.clone()),
        };
        let mut locked = sources.clone();
        locked.push(target.clone());
        if ["skip", "keep", "replace"].contains(&action) {
            let target = task.conflict.clone().ok_or("staleEntry")?;
            task.policy = if apply_all { action } else { "ask" }.into();
            if let Some(choice) = task
                .conflict_choices
                .iter_mut()
                .find(|choice| choice.target == target && choice.source == task.conflict_source)
            {
                choice.policy = action.into();
                choice.kept = None;
            } else {
                task.conflict_choices.push(ConflictChoice {
                    source: task.conflict_source.clone(),
                    target,
                    policy: action.into(),
                    kept: None,
                });
            }
        }
        task.session_id = task
            .target_remote
            .as_ref()
            .or(task.source_remote.as_ref())
            .ok_or("notConnected")?
            .session_id
            .clone();
        task.finished = None;
        self.lease(id, &locked)?;
        task.phase = "queued".into();
        task.revision += 1;
        self.tasks.lock().unwrap().insert(id.into(), task);
        self.spawn(id.into(), sources, target);
        Ok(())
    }
    pub async fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        for c in self.session_cancels.lock().unwrap().values() {
            c.cancel();
        }
        for op in self.pending_controls.lock().unwrap().values() {
            op.cancel();
        }
        while !self.pending_controls.lock().unwrap().is_empty() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        for c in self.controls.lock().unwrap().values() {
            c.cancel.cancel();
        }
        let jobs = std::mem::take(&mut *self.jobs.lock().unwrap());
        for j in jobs {
            let _ = j.await;
        }
        while self
            .leases
            .lock()
            .unwrap()
            .keys()
            .any(|id| id.starts_with("mutation:"))
        {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        self.remotes.lock().unwrap().clear();
        self.refs.lock().unwrap().clear();
        self.save();
    }
    pub async fn mutate(&self, action: &str, id: &str, name: &str) -> Result<()> {
        if self.closing.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let entry = self.entry(id)?;
        if action != "mkdir" && action != "createText" && !entry.mutable {
            return Err("invalidRequest".into());
        }
        let lease = format!("mutation:{}", uuid::Uuid::new_v4());
        self.lease(&lease, std::slice::from_ref(&entry))?;
        let result = async {
            if entry.fs.meta(&entry.path).await?.as_ref() != Some(&entry.meta) {
                return Err("staleEntry".into());
            }
            match action {
                "createText" => {
                    if entry.meta.kind != "directory" {
                        return Err("notDirectory".into());
                    }
                    let path = entry.fs.join(&entry.path, name)?;
                    if entry.fs.meta(&path).await?.is_some() {
                        return Err("conflict".into());
                    }
                    let writer = entry.fs.writer(&path).await?;
                    writer.close().await
                }
                "mkdir" => entry.fs.mkdir(&entry.fs.join(&entry.path, name)?).await,
                "rename" => {
                    let parent = if entry.session.is_some() {
                        entry
                            .path
                            .rsplit_once('/')
                            .map(|s| s.0)
                            .unwrap_or("/")
                            .to_owned()
                    } else {
                        std::path::Path::new(&entry.path)
                            .parent()
                            .and_then(|p| p.to_str())
                            .ok_or("invalidPath")?
                            .to_owned()
                    };
                    let target = entry.fs.join(&parent, name)?;
                    if entry.fs.meta(&target).await?.is_some() {
                        return Err("conflict".into());
                    }
                    match &entry.fs {
                        Fs::Local => tokio::fs::rename(&entry.path, &target).await.map_err(err),
                        _ => entry.fs.rename(&entry.path, &target, false).await,
                    }
                }
                "delete" => {
                    if entry.session.is_none() {
                        let path = entry.path.clone();
                        return tokio::task::spawn_blocking(move || {
                            #[cfg(target_os = "macos")]
                            {
                                use trash::macos::{DeleteMethod, TrashContextExtMacos};
                                let mut context = trash::TrashContext::default();
                                // Native Trash needs no Finder automation permission.
                                context.set_delete_method(DeleteMethod::NsFileManager);
                                context.delete(path).map_err(err)
                            }
                            #[cfg(not(target_os = "macos"))]
                            trash::delete(path).map_err(err)
                        })
                        .await
                        .map_err(err)?;
                    }
                    let mut pending = vec![(entry.path.clone(), false)];
                    let mut count = 0;
                    while let Some((path, visited)) = pending.pop() {
                        count += 1;
                        if count > 50000 || self.closing.load(Ordering::SeqCst) {
                            return Err("directoryLimit".into());
                        }
                        let Some(m) = entry.fs.meta(&path).await? else {
                            continue;
                        };
                        if m.kind == "directory" && !visited {
                            pending.push((path.clone(), true));
                            for child in entry.fs.list(&path).await? {
                                pending.push((entry.fs.join(&path, &child.name)?, false));
                            }
                        } else {
                            entry.fs.remove(&path, m.kind == "directory").await?;
                        }
                    }
                    Ok(())
                }
                _ => Err("invalidRequest".into()),
            }
        }
        .await;
        self.leases.lock().unwrap().remove(&lease);
        result
    }
    pub async fn preview(&self, id: &str, limit: usize) -> Result<(Vec<u8>, bool)> {
        let e = self.entry(id)?;
        if e.meta.kind != "file" || limit > 20 * 1024 * 1024 {
            return Err("previewUnsupported".into());
        }
        let mut reader = e.fs.reader(&e.path).await?;
        let mut bytes = vec![];
        let result: Result<()> = async {
            while bytes.len() < limit {
                let b = reader.read(bytes.len() as u64).await?;
                if b.is_empty() {
                    break;
                }
                let n = b.len().min(limit - bytes.len());
                bytes.extend_from_slice(&b[..n]);
            }
            Ok(())
        }
        .await;
        reader.close().await?;
        result?;
        let truncated = (bytes.len() as u64) < e.meta.size;
        Ok((bytes, truncated))
    }
}
fn local_parent(path: &str) -> Result<String> {
    std::path::Path::new(path)
        .parent()
        .and_then(|parent| parent.to_str())
        .filter(|parent| !parent.is_empty())
        .map(str::to_owned)
        .ok_or("invalidPath".into())
}
fn check(c: &Control) -> Result<()> {
    if c.cancel.is_cancelled() {
        Err("cancelled".into())
    } else if c.pause.load(Ordering::SeqCst) {
        Err("paused".into())
    } else {
        Ok(())
    }
}
async fn cancellable<T>(
    cancel: &CancellationToken,
    operation: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("cancelled".into()),
        result = operation => result,
    }
}

async fn hash(fs: &Fs, path: &str, cancel: &CancellationToken) -> Result<Vec<u8>> {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    if cancel.is_cancelled() {
        return Err("cancelled".into());
    }
    // Await OPEN and CLOSE even on cancellation; only the reads may be abandoned.
    let mut r = fs.reader(path).await?;
    let mut offset = 0;
    let result: Result<()> = async {
        loop {
            let bytes = cancellable(cancel, r.read(offset)).await?;
            if bytes.is_empty() {
                break;
            }
            offset += bytes.len() as u64;
            h.update(bytes);
        }
        Ok(())
    }
    .await;
    r.close().await?;
    result?;
    Ok(h.finalize().to_vec())
}
fn numbered_name(name: &str, n: usize, kind: &str) -> String {
    let extension = (kind == "file")
        .then(|| name.rfind('.'))
        .flatten()
        .filter(|dot| *dot > 0 && *dot + 1 < name.len());
    let (stem, suffix) = extension
        .map(|dot| name.split_at(dot))
        .unwrap_or((name, ""));
    format!("{stem} ({n}){suffix}")
}
async fn available_name(fs: &Fs, path: &str, kind: &str) -> Result<String> {
    let start = match fs {
        Fs::Local => path.rfind(['/', '\\']),
        Fs::Remote(_) => path.rfind('/'),
    }
    .map_or(0, |at| at + 1);
    let (parent, name) = path.split_at(start);
    for n in 2..10000 {
        let candidate = format!("{parent}{}", numbered_name(name, n, kind));
        if fs.meta(&candidate).await?.is_none() {
            return Ok(candidate);
        }
    }
    Err("conflict".into())
}
fn overlap(a: &str, b: &str, local: bool) -> bool {
    let normalize = |s: &str| {
        if local && cfg!(windows) {
            s.trim_end_matches(['/', '\\'])
                .replace('\\', "/")
                .to_lowercase()
        } else {
            s.trim_end_matches('/').to_owned()
        }
    };
    let a = normalize(a);
    let b = normalize(b);
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}
