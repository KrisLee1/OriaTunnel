#[path = "app_commands.rs"]
pub mod command_api;
#[path = "app_service.rs"]
pub mod service_api;
#[path = "app_sessions.rs"]
mod sessions;
#[path = "app_terminal.rs"]
pub mod terminal_api;
use crate::{model::*, ssh_config, tunnel};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};
use tokio::{sync::oneshot, task::JoinHandle};
use tokio_util::sync::CancellationToken;

struct Worker {
    rule: Rule,
    cancel: CancellationToken,
    join: JoinHandle<()>,
}
struct PendingTrust {
    run_id: String,
    fingerprint: String,
    endpoint: String,
    reply: oneshot::Sender<bool>,
}
struct PendingImport {
    token: String,
    base: Vec<u8>,
    package: crate::config_import::Package,
}
struct DeletedHost {
    id: String,
    manual: Option<Host>,
    metadata: Option<HostMetadata>,
    snapshot: Option<Host>,
    hidden: bool,
}
struct DeletedEntry {
    rules: Vec<Rule>,
    host: Option<DeletedHost>,
}
#[derive(Default)]
struct LoginCredentials {
    secret: tunnel::Secret,
    jumps: BTreeMap<String, tunnel::Secret>,
    remember: std::collections::BTreeSet<String>,
}
pub struct AppState {
    commands: Arc<crate::commands::Manager>,
    observations: Arc<crate::service_control::Observations>,
    terminals: Arc<crate::terminal::Manager>,
    terminal_workers: tokio::sync::Mutex<BTreeMap<String, JoinHandle<()>>>,
    command_workers: tokio::sync::Mutex<BTreeMap<String, JoinHandle<()>>>,
    vault: crate::credentials::Vault,
    credential_errors: Mutex<BTreeMap<String, String>>,
    config: Mutex<Config>,
    discovery: Mutex<ssh_config::Discovery>,
    runtimes: Mutex<BTreeMap<String, Runtime>>,
    runtime_rules: Mutex<BTreeMap<String, Rule>>,
    workers: tokio::sync::Mutex<BTreeMap<String, Worker>>,
    trust: Mutex<BTreeMap<String, PendingTrust>>,
    revision: std::sync::atomic::AtomicU64,
    path: PathBuf,
    shutting_down: std::sync::atomic::AtomicBool,
    update_installing: std::sync::atomic::AtomicBool,
    generations: Mutex<BTreeMap<String, String>>,
    wake: tokio::sync::watch::Sender<u64>,
    activity: Mutex<crate::activity::Activity>,
    deleted: Mutex<Vec<DeletedEntry>>,
    import: Mutex<Option<PendingImport>>,
    autostart: Mutex<Result<bool, String>>,
    power_missing: std::sync::atomic::AtomicBool,
}
impl AppState {
    #[cfg(test)]
    pub(crate) fn isolated(path: PathBuf) -> Self {
        Self::load_with_discovery(path, Default::default()).unwrap()
    }
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let state = Self::load_with_discovery(path, Default::default())?;
        let sources = state.config.lock().unwrap().source_files.clone();
        state.reconcile_hosts(ssh_config::discover_with(&sources))?;
        Ok(state)
    }
    fn load_with_discovery(
        path: PathBuf,
        discovery: ssh_config::Discovery,
    ) -> Result<Self, String> {
        let mut config: Config = if path.exists() {
            serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?).map_err(
                |e| {
                    crate::native_message::message(
                        "configRead",
                        serde_json::json!({"e": (e).to_string()}),
                    )
                },
            )?
        } else {
            Config::default()
        };
        // Existing forward references already authorize these service/host pairs.
        for service in &mut config.services {
            if service.host_ids.is_empty() {
                service.host_ids = config
                    .rules
                    .iter()
                    .filter(|r| service.rule_ids.contains(&r.id))
                    .map(|r| r.host_id.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
            }
            if service.port.is_none() {
                let ports: BTreeSet<_> = config
                    .rules
                    .iter()
                    .filter(|r| service.rule_ids.contains(&r.id) && r.kind != ForwardKind::D)
                    .map(|r| {
                        if r.kind == ForwardKind::L {
                            r.target_port
                        } else {
                            r.bind_port
                        }
                    })
                    .collect();
                if ports.len() == 1 {
                    service.port = ports.into_iter().next();
                }
            }
        }
        let state = Self {
            commands: Arc::new(Default::default()),
            observations: Arc::new(Default::default()),
            terminals: Arc::new(Default::default()),
            terminal_workers: Default::default(),
            command_workers: Default::default(),
            vault: crate::credentials::Vault::new(&path),
            credential_errors: Mutex::new(BTreeMap::new()),
            config: Mutex::new(config),
            discovery: Mutex::new(discovery),
            runtimes: Mutex::new(BTreeMap::new()),
            runtime_rules: Mutex::new(BTreeMap::new()),
            workers: tokio::sync::Mutex::new(BTreeMap::new()),
            trust: Mutex::new(BTreeMap::new()),
            revision: 0.into(),
            activity: Mutex::new(crate::activity::Activity::open(path.with_file_name("logs"))),
            wake: tokio::sync::watch::channel(0).0,
            deleted: Mutex::new(Vec::new()),
            import: Mutex::new(None),
            autostart: Mutex::new(crate::long_running::read()),
            power_missing: false.into(),
            path,
            shutting_down: false.into(),
            update_installing: false.into(),
            generations: Mutex::new(BTreeMap::new()),
        };
        Ok(state)
    }
    fn persist(&self, config: &Config) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?
        }
        if self.path.exists() {
            let original = std::fs::read(&self.path).map_err(|_| "backupFailed")?;
            let value: serde_json::Value =
                serde_json::from_slice(&original).map_err(|_| "backupFailed")?;
            let legacy = value["services"].as_array().is_some_and(|services| {
                services
                    .iter()
                    .any(|s| s.get("hostIds").is_none() || s.get("port").is_none())
            });
            let backup = self.path.with_extension("pre-host-services.json");
            if legacy && !backup.exists() {
                use std::io::Write;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(backup)
                    .map_err(|_| "backupFailed")?;
                file.write_all(&original)
                    .and_then(|_| file.sync_all())
                    .map_err(|_| "backupFailed")?;
            }
        }
        if !config.services.is_empty() && self.path.exists() {
            let backup = self.path.with_extension("pre-commands.json");
            if !backup.exists() {
                use std::io::Write;
                let original = std::fs::read(&self.path).map_err(|_| "backupFailed")?;
                let result = (|| -> std::io::Result<()> {
                    let mut file = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&backup)?;
                    file.write_all(&original)?;
                    file.sync_all()
                })();
                if result.is_err() {
                    let _ = std::fs::remove_file(&backup);
                    return Err("backupFailed".into());
                }
            }
        }
        if self.path.exists() && !config.services.is_empty() {
            let original = std::fs::read(&self.path).map_err(|_| "backupFailed")?;
            let old: serde_json::Value =
                serde_json::from_slice(&original).map_err(|_| "backupFailed")?;
            let legacy = old
                .get("services")
                .and_then(|s| s.as_array())
                .is_some_and(|services| services.iter().any(|s| s.get("control").is_none()));
            let backup = self.path.with_extension("pre-service-checks.json");
            if legacy && !backup.exists() {
                use std::io::Write;
                let saved = (|| -> std::io::Result<()> {
                    let mut file = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&backup)?;
                    file.write_all(&original)?;
                    file.sync_all()
                })();
                if saved.is_err() {
                    let _ = std::fs::remove_file(&backup);
                    return Err("backupFailed".into());
                }
            }
        }
        if self.path.exists() && !config.services.is_empty() {
            let original = std::fs::read(&self.path).map_err(|_| "backupFailed")?;
            let old: serde_json::Value =
                serde_json::from_slice(&original).map_err(|_| "backupFailed")?;
            let legacy = old
                .get("services")
                .and_then(|s| s.as_array())
                .is_some_and(|services| {
                    services.iter().any(|s| s.get("executionEnabled").is_none())
                });
            let backup = self.path.with_extension("pre-service-sharing.json");
            if legacy && !backup.exists() {
                use std::io::Write;
                let saved = (|| -> std::io::Result<()> {
                    let mut file = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&backup)?;
                    file.write_all(&original)?;
                    file.sync_all()
                })();
                if saved.is_err() {
                    let _ = std::fs::remove_file(&backup);
                    return Err("backupFailed".into());
                }
            }
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(config).unwrap())
            .map_err(|e| e.to_string())?;
        std::fs::rename(tmp, &self.path).map_err(|e| e.to_string())
    }
    fn stage_import(
        &self,
        bytes: &[u8],
        file_name: String,
    ) -> Result<crate::config_import::Preview, String> {
        let package = crate::config_import::parse(bytes)?;
        let base = serde_json::to_vec(&*self.config.lock().unwrap())
            .map_err(|_| crate::native_message::plain("configPreview"))?;
        let snapshot = self.snapshot();
        if base
            != serde_json::to_vec(&*self.config.lock().unwrap())
                .map_err(|_| crate::native_message::plain("configPreview"))?
        {
            return Err(crate::native_message::plain("configChanged"));
        }
        let token = uuid::Uuid::new_v4().to_string();
        let preview = package.preview(&snapshot, token.clone(), file_name);
        *self.import.lock().unwrap() = Some(PendingImport {
            token,
            base,
            package,
        });
        Ok(preview)
    }
    fn apply_import(
        &self,
        token: &str,
        choices: &crate::config_import::Choices,
    ) -> Result<(), String> {
        let snapshot = self.snapshot();
        let mut pending = self.import.lock().unwrap();
        let import = pending
            .as_ref()
            .filter(|p| p.token == token)
            .ok_or(crate::native_message::plain("importExpired"))?;
        let plan = import.package.prepare(&snapshot, choices)?;
        let mut current = self.config.lock().unwrap();
        if import.base
            != serde_json::to_vec(&*current)
                .map_err(|_| crate::native_message::plain("configCompare"))?
        {
            return Err(crate::native_message::plain("importChanged"));
        }
        let mut next = current.clone();
        next.hosts.extend(plan.hosts);
        next.rules.extend(plan.rules);
        next.services.extend(plan.services);
        self.persist(&next)?;
        *current = next;
        *pending = None;
        Ok(())
    }
    fn add_discovered_hosts(&self, ids: &[String]) -> Result<(), String> {
        if ids.is_empty() {
            return Err(crate::native_message::plain("selectHosts"));
        }
        let hosts = self.snapshot().hosts;
        // Validate the entire selection before writing a single transaction.
        let selected = ids
            .iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(|id| {
                hosts
                    .iter()
                    .find(|h| &h.id == id && h.source == "config")
                    .cloned()
                    .ok_or(crate::native_message::plain("hostsDisappeared"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut config = self.config.lock().unwrap();
        let mut next = config.clone();
        for host in selected {
            next.host_metadata
                .entry(host.id.clone())
                .or_insert_with(|| HostMetadata {
                    name: host.name.clone(),
                    tags: host.tags.clone(),
                });
            next.host_snapshots.insert(host.id.clone(), host);
        }
        self.persist(&next)?;
        *config = next;
        Ok(())
    }
    fn upsert_host(&self, mut host: Host) -> Result<(), String> {
        host.connection.validate()?;
        crate::ssh_algorithms::preferred(&host.algorithms)?;
        host.identity_files.retain(|path| !path.trim().is_empty());
        host.tags = host
            .tags
            .into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect();
        if host.name.trim().is_empty()
            || host.address.trim().is_empty()
            || host.user.trim().is_empty()
            || host.port == 0
        {
            return Err(crate::native_message::plain("hostFields"));
        }
        if host.id.starts_with("ssh:") || host.id.starts_with("ssh-jump:") {
            return Err(crate::native_message::plain("editSourceHost"));
        }
        if host.id.is_empty() {
            host.id = uuid::Uuid::new_v4().to_string()
        }
        host.source = "manual".into();
        host.source_file = None;
        host.diagnostics.clear();
        let mut hosts = self.snapshot().hosts;
        hosts.retain(|h| h.id != host.id);
        hosts.push(host.clone());
        resolve_jumps(&hosts, &host)?;
        let mut config = self.config.lock().unwrap();
        let mut next = config.clone();
        next.hosts.retain(|h| h.id != host.id);
        next.hosts.push(host);
        self.persist(&next)?;
        *config = next;
        Ok(())
    }
    pub fn snapshot(&self) -> Snapshot {
        let config = self.config.lock().unwrap();
        let discovery = self.discovery.lock().unwrap();
        let mut hosts = discovery.hosts.clone();
        hosts.extend(config.hosts.clone());
        for (id, saved) in &config.host_snapshots {
            if (config.rules.iter().any(|r| &r.host_id == id)
                || config.host_metadata.contains_key(id))
                && !hosts.iter().any(|h| &h.id == id)
            {
                let mut h = saved.clone();
                h.diagnostics
                    .push(crate::native_message::plain("hostSourceLost"));
                hosts.push(h);
            }
        }
        for host in &mut hosts {
            host.hidden = config.hidden_hosts.contains(&host.id);
            if let Some(metadata) = config.host_metadata.get(&host.id) {
                host.name = metadata.name.clone();
                host.tags = metadata.tags.clone();
            }
        }
        let candidates = hosts.clone();
        for host in &mut hosts {
            if let Err(error) = resolve_jumps(&candidates, host) {
                if !host.diagnostics.contains(&error) {
                    host.diagnostics.push(error);
                }
            }
        }
        let mut runtimes: Vec<_> = self.runtimes.lock().unwrap().values().cloned().collect();
        for runtime in &mut runtimes {
            runtime.configuration_changed = runtime.configuration_changed
                || self
                    .runtime_rules
                    .lock()
                    .unwrap()
                    .get(&runtime.rule_id)
                    .is_some_and(|before| {
                        config
                            .rules
                            .iter()
                            .find(|after| after.id == before.id)
                            .is_none_or(|after| !after.same_connection(before))
                    })
                || runtime
                    .host_snapshot
                    .iter()
                    .chain(runtime.jump_snapshots.iter())
                    .any(|before| {
                        hosts
                            .iter()
                            .find(|h| h.id == before.id)
                            .is_none_or(|after| !after.same_connection(before))
                    });
        }
        let startup = self.autostart.lock().unwrap().clone();
        let mut added_host_ids: std::collections::BTreeSet<String> = config
            .hosts
            .iter()
            .map(|host| host.id.clone())
            .chain(config.host_metadata.keys().cloned())
            .chain(config.rules.iter().map(|rule| rule.host_id.clone()))
            .collect();
        let mut pending: Vec<_> = added_host_ids.iter().cloned().collect();
        while let Some(id) = pending.pop() {
            if let Some(route) = hosts
                .iter()
                .find(|host| host.id == id)
                .and_then(|host| host.proxy_jump.as_deref())
            {
                for jump in route.split(',').map(str::trim) {
                    if hosts.iter().any(|host| host.id == jump)
                        && added_host_ids.insert(jump.into())
                    {
                        pending.push(jump.into());
                    }
                }
            }
        }
        Snapshot {
            services: config.services.clone(),
            hosts,
            added_host_ids: added_host_ids.into_iter().collect(),
            rules: config.rules.clone(),
            runtimes,
            diagnostics: {
                let mut diagnostics = discovery.diagnostics.clone();
                if self.activity.lock().unwrap().write_failed {
                    diagnostics.push(crate::native_message::plain("activityWrite"));
                }
                if self
                    .power_missing
                    .load(std::sync::atomic::Ordering::Relaxed)
                {
                    diagnostics.push(crate::native_message::plain("wakeUnavailable"));
                }
                diagnostics
            },
            revision: self.revision.load(std::sync::atomic::Ordering::SeqCst),
            close_to_tray: config.close_to_tray,
            agent_supported: cfg!(any(windows, target_os = "macos")),
            source_files: config.source_files.clone(),
            auto_sync_hosts: config.auto_sync_hosts,
            activity: self.activity.lock().unwrap().records(),
            undo_count: self.deleted.lock().unwrap().len(),
            autostart: startup.as_ref().copied().unwrap_or(false),
            autostart_supported: crate::long_running::AUTOSTART_SUPPORTED,
            autostart_error: startup.err(),
        }
    }
    pub fn publish(&self, app: &tauri::AppHandle) {
        self.revision
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let snapshot = self.snapshot();
        crate::desktop::update_tray(app, &snapshot);
        let _ = app.emit("tunnel://snapshot", snapshot);
    }
    pub(crate) fn tray_service_activity(&self) -> crate::desktop::TrayServiceActivity {
        let mut activity = crate::desktop::TrayServiceActivity::default();
        for run in self.commands.list().into_iter().filter(|run| run.active()) {
            activity.busy.insert(run.service_id);
        }
        for session in self
            .terminals
            .list()
            .into_iter()
            .filter(|session| session.active())
        {
            if let Some(service) = session.service_id {
                activity.busy.insert(service.clone());
                if let (Some(rule), Some(action)) = (session.rule_id, session.action_id) {
                    activity.terminals.insert((service, rule, action));
                }
            }
        }
        activity
    }
    pub async fn shutdown(&self) {
        self.shutting_down
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.stop_all().await;
    }
    pub fn update_installing(&self) -> bool {
        self.update_installing
            .load(std::sync::atomic::Ordering::SeqCst)
    }
    pub fn finish_update_attempt(&self) {
        self.update_installing
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }
    pub async fn active_work_ids(&self) -> Vec<String> {
        let mut ids: Vec<_> = self
            .workers
            .lock()
            .await
            .iter()
            .filter(|(_, worker)| !worker.join.is_finished())
            .map(|(id, _)| id.clone())
            .collect();
        ids.extend(
            self.command_workers
                .lock()
                .await
                .iter()
                .filter(|(_, job)| !job.is_finished())
                .map(|(id, _)| id.clone()),
        );
        ids.extend(
            self.terminal_workers
                .lock()
                .await
                .iter()
                .filter(|(_, job)| !job.is_finished())
                .map(|(id, _)| id.clone()),
        );
        ids
    }
    pub async fn prepare_update(&self, expected: &[String]) -> Result<(), String> {
        self.update_installing
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let expected: BTreeSet<_> = expected.iter().cloned().collect();
        let actual: BTreeSet<_> = self.active_work_ids().await.into_iter().collect();
        if actual != expected {
            return Err("activityChanged".into());
        }
        self.stop_all_checked().await
    }
    fn allow_launch(&self) -> Result<(), String> {
        if self.shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
            Err(crate::native_message::plain("exiting"))
        } else if self.update_installing() {
            Err("updateInstalling".into())
        } else {
            Ok(())
        }
    }
    pub fn wake_sender(&self) -> tokio::sync::watch::Sender<u64> {
        self.wake.clone()
    }
    pub fn power_unavailable(&self) {
        self.power_missing
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
    pub async fn auto_connect(self: &Arc<Self>, app: &tauri::AppHandle) {
        let rules = self.snapshot().rules;
        for rule in rules.into_iter().filter(|r| r.auto_connect) {
            if self.allow_launch().is_err() {
                break;
            }
            let id = rule.id.clone();
            if let Err(message) = launch(
                self.clone(),
                app.clone(),
                rule,
                false,
                false,
                Default::default(),
            )
            .await
            {
                let runtime = Runtime {
                    rule_id: id.clone(),
                    run_id: uuid::Uuid::new_v4().to_string(),
                    status: "needs-attention".into(),
                    error_kind: Some(FailureKind::Configuration),
                    message,
                    ..Default::default()
                };
                self.activity.lock().unwrap().observe(&runtime);
                self.runtimes.lock().unwrap().insert(id, runtime);
                self.publish(app);
            }
        }
    }
    pub async fn stop_all(&self) {
        let _ = self.stop_all_checked().await;
    }
    async fn stop_all_checked(&self) -> Result<(), String> {
        let mut workers = self.workers.lock().await;
        self.commands.cancel_all();
        self.terminals.cancel_all();
        let terminal_jobs = std::mem::take(&mut *self.terminal_workers.lock().await);
        let command_jobs = std::mem::take(&mut *self.command_workers.lock().await);
        let jobs = std::mem::take(&mut *workers);
        for worker in jobs.values() {
            worker.cancel.cancel();
        }
        let mut failed = false;
        for (_, worker) in jobs {
            failed |= worker.join.await.is_err();
        }
        for (_, job) in terminal_jobs {
            failed |= job.await.is_err();
        }
        for (_, job) in command_jobs {
            failed |= job.await.is_err();
        }
        self.trust.lock().unwrap().clear();
        let ids = self
            .runtimes
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        self.settle_stopped(&ids);
        if failed {
            Err("cleanup".into())
        } else {
            Ok(())
        }
    }
    pub fn interrupt_terminals(&self) {
        self.terminals.cancel_all();
    }
    pub fn close_to_tray(&self) -> bool {
        self.config.lock().unwrap().close_to_tray
    }
    pub async fn cancel_host_tests_on_hide(&self) {
        let mut workers = self.workers.lock().await;
        let ids: Vec<_> = workers
            .keys()
            .filter(|id| id.starts_with("host-test:"))
            .cloned()
            .collect();
        let mut jobs = Vec::new();
        for id in &ids {
            if let Some(worker) = workers.remove(id) {
                worker.cancel.cancel();
                jobs.push(worker);
            }
            self.trust.lock().unwrap().remove(id);
        }
        for worker in jobs {
            let _ = worker.join.await;
        }
        self.settle_stopped(&ids);
    }
    fn settle_stopped(&self, ids: &[String]) {
        for id in ids {
            self.generations.lock().unwrap().remove(id);
            let updated = {
                let mut runtimes = self.runtimes.lock().unwrap();
                runtimes.get_mut(id).map(|r| {
                    let changed = r.status != "stopped";
                    r.status = "stopped".into();
                    r.desired_running = false;
                    r.retry_at = None;
                    r.error_kind = None;
                    r.message.clear();
                    r.connections = 0;
                    if r.sent_per_second.is_some() {
                        r.sent_per_second = Some(0);
                    }
                    if r.received_per_second.is_some() {
                        r.received_per_second = Some(0);
                    }
                    (changed, r.clone())
                })
            };
            if let Some((true, runtime)) = updated {
                self.activity.lock().unwrap().observe(&runtime);
            }
        }
    }
    fn remove_rule(&self, id: &str) -> Result<(), String> {
        self.remove_rules(&[id.to_string()])
    }
    fn remember_deletion(&self, entry: DeletedEntry) {
        let mut deleted = self.deleted.lock().unwrap();
        deleted.push(entry);
        if deleted.len() > 20 {
            deleted.remove(0);
        }
    }
    fn remove_rules(&self, ids: &[String]) -> Result<(), String> {
        let ids: std::collections::BTreeSet<_> = ids.iter().collect();
        if ids.is_empty() {
            return Err(crate::native_message::plain("selectDeleteRules"));
        }
        let mut c = self.config.lock().unwrap();
        let mut next = c.clone();
        let removed: Vec<_> = next
            .rules
            .iter()
            .filter(|r| ids.contains(&r.id))
            .cloned()
            .collect();
        if removed.len() != ids.len() {
            return Err(crate::native_message::plain("rulesDisappeared"));
        }
        next.rules.retain(|r| !ids.contains(&r.id));
        self.persist(&next)?;
        *c = next;
        self.remember_deletion(DeletedEntry {
            rules: removed,
            host: None,
        });
        Ok(())
    }
    fn remove_host(&self, id: &str, expected_rule_ids: &[String]) -> Result<Vec<String>, String> {
        if self
            .commands
            .list()
            .iter()
            .any(|r| r.active() && r.route_host_ids.iter().any(|h| h == id))
        {
            return Err("hostUsedByService".into());
        }
        if self
            .terminals
            .list()
            .iter()
            .any(|session| session.active() && session.route_host_ids.iter().any(|used| used == id))
        {
            return Err("hostUsedByTerminal".into());
        }
        let mut c = self.config.lock().unwrap();
        let mut hosts = self.discovery.lock().unwrap().hosts.clone();
        hosts.extend(c.hosts.clone());
        hosts.extend(c.host_snapshots.values().cloned());
        if hosts.iter().any(|host| {
            host.id != id
                && (c.hosts.iter().any(|saved| saved.id == host.id)
                    || c.host_metadata.contains_key(&host.id))
                && rule_uses_host(
                    &Rule {
                        host_id: host.id.clone(),
                        ..Default::default()
                    },
                    &hosts,
                    id,
                )
        }) {
            return Err(crate::native_message::plain("hostJumpInUse"));
        }
        if self
            .runtimes
            .lock()
            .unwrap()
            .get(&format!("host-test:{id}"))
            .is_some_and(|r| {
                !matches!(
                    r.status.as_str(),
                    "tested" | "failed" | "stopped" | "needs-attention"
                )
            })
        {
            return Err(crate::native_message::plain("hostTestRunning"));
        }
        let rules: Vec<_> = c
            .rules
            .iter()
            .filter(|r| rule_uses_host(r, &hosts, id))
            .cloned()
            .collect();
        let ids: Vec<_> = rules.iter().map(|r| r.id.clone()).collect();
        if ids.iter().collect::<std::collections::BTreeSet<_>>()
            != expected_rule_ids.iter().collect()
        {
            return Err(crate::native_message::plain("hostRulesChanged"));
        }
        if !c.hosts.iter().any(|h| h.id == id)
            && !c.host_metadata.contains_key(id)
            && rules.is_empty()
        {
            return Err(crate::native_message::plain("hostNotAdded"));
        }
        let host = DeletedHost {
            id: id.into(),
            manual: c.hosts.iter().find(|h| h.id == id).cloned(),
            metadata: c.host_metadata.get(id).cloned(),
            snapshot: c.host_snapshots.get(id).cloned(),
            hidden: c.hidden_hosts.iter().any(|h| h == id),
        };
        let mut next = c.clone();
        next.rules.retain(|r| !ids.contains(&r.id));
        next.hosts.retain(|h| h.id != id);
        next.host_snapshots.remove(id);
        next.host_metadata.remove(id);
        next.hidden_hosts.retain(|host_id| host_id != id);
        self.persist(&next)?;
        *c = next;
        self.remember_deletion(DeletedEntry {
            rules,
            host: Some(host),
        });
        Ok(ids)
    }
    fn restore_rule(&self) -> Result<(), String> {
        let mut config = self.config.lock().unwrap();
        let mut deleted = self.deleted.lock().unwrap();
        let entry = deleted
            .last()
            .ok_or(crate::native_message::plain("nothingToUndo"))?;
        if config
            .rules
            .iter()
            .any(|r| entry.rules.iter().any(|old| old.id == r.id))
        {
            return Err(crate::native_message::plain("ruleIdUsed"));
        }
        let mut next = config.clone();
        if let Some(host) = &entry.host {
            if next.hosts.iter().any(|h| h.id == host.id)
                || next.host_metadata.contains_key(&host.id)
            {
                return Err(crate::native_message::plain("hostIdUsed"));
            }
            if let Some(manual) = &host.manual {
                next.hosts.push(manual.clone());
            }
            if let Some(metadata) = &host.metadata {
                next.host_metadata.insert(host.id.clone(), metadata.clone());
            }
            if let Some(snapshot) = &host.snapshot {
                next.host_snapshots
                    .insert(host.id.clone(), snapshot.clone());
            }
            if host.hidden {
                next.hidden_hosts.push(host.id.clone());
            }
        }
        next.rules
            .extend(entry.rules.iter().cloned().map(|mut rule| {
                rule.auto_connect = false;
                rule
            }));
        self.persist(&next)?;
        *config = next;
        deleted.pop();
        Ok(())
    }
    fn reconcile_hosts(&self, mut next: ssh_config::Discovery) -> Result<bool, String> {
        let mut config = self.config.lock().unwrap();
        let mut current = self.discovery.lock().unwrap();
        if !next.diagnostics.is_empty() {
            for old in &current.hosts {
                if !next.hosts.iter().any(|h| h.id == old.id) {
                    let mut host = old.clone();
                    if !host.diagnostics.iter().any(|d| {
                        crate::native_message::key(d).as_deref() == Some("sourceSyncFailed")
                    }) {
                        host.diagnostics
                            .push(crate::native_message::plain("sourceSyncFailed"));
                    }
                    next.hosts.push(host);
                }
            }
        }
        let mut saved = config.clone();
        if next.diagnostics.is_empty() {
            for host in &next.hosts {
                if saved.rules.iter().any(|r| r.host_id == host.id)
                    || saved.host_metadata.contains_key(&host.id)
                {
                    saved.host_snapshots.insert(host.id.clone(), host.clone());
                }
            }
        }
        if saved.host_snapshots != config.host_snapshots {
            self.persist(&saved)?;
            *config = saved;
        }
        if next == *current {
            return Ok(false);
        }
        *current = next;
        Ok(true)
    }
    pub fn sync_hosts(&self, app: &tauri::AppHandle) {
        let sources = self.config.lock().unwrap().source_files.clone();
        match self.reconcile_hosts(ssh_config::discover_with(&sources)) {
            Ok(false) => return,
            Ok(true) => {}
            Err(error) => {
                let mut discovery = self.discovery.lock().unwrap();
                let message = crate::native_message::message(
                    "sourceSaveFailed",
                    serde_json::json!({"error": (error).to_string()}),
                );
                if discovery.diagnostics.contains(&message) {
                    return;
                }
                discovery.diagnostics.push(message);
            }
        }
        self.publish(app);
    }
    pub fn poll_hosts(&self, app: &tauri::AppHandle) {
        let enabled = self.config.lock().unwrap().auto_sync_hosts;
        if enabled {
            self.sync_hosts(app);
        }
    }
}
#[tauri::command]
pub fn set_host_sources(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    files: Vec<String>,
    auto_sync: bool,
) -> Result<Snapshot, String> {
    let files: Vec<_> = files
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect();
    if files.iter().any(|path| {
        !std::path::Path::new(path).is_absolute()
            && !path.starts_with("~/")
            && !path.starts_with("~\\")
    }) {
        return Err(crate::native_message::plain("sourceAbsolutePath"));
    }
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        next.source_files = files;
        next.auto_sync_hosts = auto_sync;
        state.persist(&next)?;
        *c = next;
    }
    state.sync_hosts(&app);
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn add_discovered_hosts(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Snapshot, String> {
    state.add_discovered_hosts(&ids)?;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn save_host_metadata(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    name: String,
    tags: Vec<String>,
) -> Result<Snapshot, String> {
    if name.trim().is_empty() {
        return Err(crate::native_message::plain("hostNameEmpty"));
    }
    let host = state
        .snapshot()
        .hosts
        .into_iter()
        .find(|h| h.id == id && h.source == "config")
        .ok_or(crate::native_message::plain("sourceMetadataOnly"))?;
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        next.host_snapshots.insert(id.clone(), host);
        next.host_metadata.insert(
            id,
            HostMetadata {
                name,
                tags: tags
                    .into_iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
            },
        );
        state.persist(&next)?;
        *c = next;
    }
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn snapshot(state: tauri::State<Arc<AppState>>) -> Snapshot {
    state.snapshot()
}
#[tauri::command]
pub fn refresh_hosts(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    manual: Option<bool>,
) -> Snapshot {
    if manual.unwrap_or(true) {
        state.sync_hosts(&app);
    } else {
        state.poll_hosts(&app);
    }
    state.snapshot()
}
#[tauri::command]
pub fn save_host(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    host: Host,
) -> Result<Snapshot, String> {
    state.upsert_host(host)?;
    state.publish(&app);
    Ok(state.snapshot())
}
fn save_rule_profile(
    state: &AppState,
    mut rule: Rule,
    service_links: Option<Vec<command_api::ServiceLink>>,
) -> Result<(), String> {
    rule.validate()?;
    let host = state
        .snapshot()
        .hosts
        .into_iter()
        .find(|h| h.id == rule.host_id)
        .ok_or(crate::native_message::plain("selectHostSource"))?;
    if !host.diagnostics.is_empty() {
        return Err(crate::native_message::combine(&host.diagnostics, "\n"));
    }
    if rule.id.is_empty() {
        rule.id = uuid::Uuid::new_v4().to_string()
    }
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        if let Some(links) = service_links {
            let changed =
                command_api::bind_rule_services(&mut next, &rule.id, &rule.host_id, &links)?;
            if changed.iter().any(|id| {
                state.terminals.busy(id)
                    || state
                        .commands
                        .list()
                        .iter()
                        .any(|r| &r.service_id == id && r.active())
            }) {
                return Err("serviceBusy".into());
            }
        }
        let bound: Vec<_> = next
            .services
            .iter()
            .filter(|s| s.rule_ids.contains(&rule.id))
            .collect();
        if bound.iter().any(|s| !s.host_ids.contains(&rule.host_id)) {
            return Err("serviceUnbound".into());
        }
        if rule.kind != ForwardKind::D && !bound.is_empty() {
            if bound.len() != 1 {
                return Err("invalidService".into());
            }
            let port = bound[0]
                .port
                .ok_or(crate::native_message::plain("servicePort"))?;
            if rule.kind == ForwardKind::L {
                rule.target_port = port;
            } else {
                rule.bind_port = port;
            }
        }
        next.host_snapshots.insert(host.id.clone(), host);
        next.rules.retain(|r| r.id != rule.id);
        next.rules.push(rule);
        state.persist(&next)?;
        *c = next;
    }
    Ok(())
}
#[tauri::command]
pub fn save_rule(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    rule: Rule,
    service_links: Option<Vec<command_api::ServiceLink>>,
) -> Result<Snapshot, String> {
    save_rule_profile(&state, rule, service_links)?;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub async fn start_rule(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    secret: String,
    jump_secrets: Option<BTreeMap<String, String>>,
    remember_host_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let rule = state
        .snapshot()
        .rules
        .into_iter()
        .find(|r| r.id == id)
        .ok_or(crate::native_message::plain("ruleMissing"))?;
    launch(
        state.inner().clone(),
        app,
        rule,
        false,
        true,
        LoginCredentials {
            secret: secret.into(),
            jumps: jump_secrets
                .unwrap_or_default()
                .into_iter()
                .map(|(id, s)| (id, s.into()))
                .collect(),
            remember: remember_host_ids.unwrap_or_default().into_iter().collect(),
        },
    )
    .await
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordStatus {
    id: String,
    supported: bool,
    saved: bool,
    error: Option<String>,
}
#[tauri::command]
pub fn password_status(
    state: tauri::State<Arc<AppState>>,
    ids: Vec<String>,
) -> Vec<PasswordStatus> {
    state
        .snapshot()
        .hosts
        .iter()
        .filter(|h| ids.contains(&h.id))
        .map(|host| {
            let result = state.vault.read(host);
            PasswordStatus {
                id: host.id.clone(),
                supported: crate::credentials::SUPPORTED,
                saved: result.as_ref().is_ok_and(|s| s.is_some()),
                error: result.err().or_else(|| {
                    state
                        .credential_errors
                        .lock()
                        .unwrap()
                        .get(&host.id)
                        .cloned()
                }),
            }
        })
        .collect()
}
#[tauri::command]
pub fn clear_password(state: tauri::State<Arc<AppState>>, id: String) -> Result<(), String> {
    let host = state
        .snapshot()
        .hosts
        .into_iter()
        .find(|h| h.id == id)
        .ok_or(crate::native_message::plain("hostMissing"))?;
    state.vault.forget(&host)?;
    state.credential_errors.lock().unwrap().remove(&id);
    Ok(())
}
// Product action: invoked only after the user clicks Test connection, never by discovery.
#[tauri::command]
pub async fn test_host(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    secret: String,
    jump_secrets: Option<BTreeMap<String, String>>,
    remember_host_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let rule = Rule {
        id: format!("host-test:{id}"),
        name: crate::native_message::plain("hostTestName"),
        host_id: id,
        bind_port: 1,
        target_host: "127.0.0.1".into(),
        target_port: 1,
        background: false,
        ..Default::default()
    };
    launch(
        state.inner().clone(),
        app,
        rule,
        true,
        true,
        LoginCredentials {
            secret: secret.into(),
            jumps: jump_secrets
                .unwrap_or_default()
                .into_iter()
                .map(|(id, s)| (id, s.into()))
                .collect(),
            remember: remember_host_ids.unwrap_or_default().into_iter().collect(),
        },
    )
    .await
}
async fn launch(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    rule: Rule,
    test_only: bool,
    interactive: bool,
    credentials: LoginCredentials,
) -> Result<(), String> {
    launch_impl(state, app, rule, test_only, interactive, credentials, None).await
}
async fn launch_impl(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    rule: Rule,
    test_only: bool,
    interactive: bool,
    credentials: LoginCredentials,
    expected_route: Option<Vec<Host>>,
) -> Result<(), String> {
    let id = rule.id.clone();
    let mut workers = state.workers.lock().await;
    state.allow_launch()?;
    if expected_route.is_some() {
        if let Some(old) = workers.get(&id).filter(|w| !w.join.is_finished()) {
            return Err(if old.rule.same_connection(&rule) {
                "forwardAlreadyActive"
            } else {
                "forwardChanged"
            }
            .into());
        }
        if !state
            .snapshot()
            .rules
            .iter()
            .any(|saved| saved.id == rule.id && saved.same_connection(&rule))
        {
            return Err("forwardChanged".into());
        }
    }
    if let Some(old) = workers.remove(&id) {
        old.cancel.cancel();
        let _ = old.join.await;
    }
    state.trust.lock().unwrap().remove(&id);
    let snapshot = state.snapshot();
    if !test_only && !snapshot.rules.iter().any(|saved| saved.id == rule.id) {
        return Err(crate::native_message::plain("ruleDeleted"));
    }
    let hosts = snapshot.hosts;
    let host = hosts
        .iter()
        .find(|h| h.id == rule.host_id)
        .cloned()
        .ok_or(crate::native_message::plain("hostSourceMissing"))?;
    if !host.diagnostics.is_empty() {
        return Err(crate::native_message::combine(&host.diagnostics, "\n"));
    }
    let host_key = format!("{}:{}", host.address, host.port);
    let jumps = resolve_jumps(&hosts, &host)?;
    if let Some(expected) = expected_route {
        let actual: Vec<_> = jumps.iter().chain(std::iter::once(&host)).collect();
        if actual.len() != expected.len()
            || actual
                .iter()
                .zip(&expected)
                .any(|(a, b)| a.id != b.id || !a.same_connection(b))
        {
            return Err("forwardChanged".into());
        }
    }
    if !interactive {
        let config = state.config.lock().unwrap();
        for h in jumps.iter().chain(std::iter::once(&host)) {
            if h.auth_method == AuthMethod::Password
                || !config
                    .trusted_keys
                    .contains_key(&format!("{}:{}", h.address, h.port))
            {
                return Err(crate::native_message::plain("autoConnectAuth"));
            }
        }
    }
    let mut saves = BTreeMap::new();
    let mut prepare = |host: &Host, secret: tunnel::Secret| -> Result<tunnel::Secret, String> {
        if credentials.remember.contains(&host.id)
            && !secret.is_empty()
            && matches!(host.auth_method, AuthMethod::Auto | AuthMethod::Password)
        {
            saves.insert(host.id.clone(), state.vault.epoch(&host.id));
        }
        if interactive
            && secret.is_empty()
            && matches!(host.auth_method, AuthMethod::Auto | AuthMethod::Password)
        {
            Ok(state.vault.read(host)?.unwrap_or_default())
        } else {
            Ok(secret)
        }
    };
    let secret = prepare(&host, credentials.secret)?;
    let jump_secrets = credentials.jumps;
    let jumps: Vec<tunnel::HopRequest> = jumps
        .into_iter()
        .map(|host| {
            let expected = state
                .config
                .lock()
                .unwrap()
                .trusted_keys
                .get(&format!("{}:{}", host.address, host.port))
                .cloned();
            let secret = prepare(
                &host,
                jump_secrets.get(&host.id).cloned().unwrap_or_default(),
            )?;
            Ok(tunnel::HopRequest {
                host,
                secret,
                expected,
            })
        })
        .collect::<Result<_, String>>()?;
    let expected = state
        .config
        .lock()
        .unwrap()
        .trusted_keys
        .get(&host_key)
        .cloned();
    let run_id = uuid::Uuid::new_v4().to_string();
    state
        .runtime_rules
        .lock()
        .unwrap()
        .insert(id.clone(), rule.clone());
    state
        .generations
        .lock()
        .unwrap()
        .insert(id.clone(), run_id.clone());
    let cancel = CancellationToken::new();
    let notify = {
        let state = state.clone();
        let app = app.clone();
        let job_id = run_id.clone();
        Arc::new(move |runtime: Runtime| {
            {
                let mut generations = state.generations.lock().unwrap();
                if generations.get(&runtime.rule_id) != Some(&job_id) {
                    return;
                }
                if matches!(
                    runtime.status.as_str(),
                    "stopped" | "failed" | "tested" | "needs-attention"
                ) {
                    generations.remove(&runtime.rule_id);
                }
                state.activity.lock().unwrap().observe(&runtime);
                state
                    .runtimes
                    .lock()
                    .unwrap()
                    .insert(runtime.rule_id.clone(), runtime);
            }
            state.publish(&app);
        }) as tunnel::Notify
    };
    let prompt = {
        let state = state.clone();
        let app = app.clone();
        let id = id.clone();
        let run = run_id.clone();
        Arc::new(
            move |endpoint: String, fingerprint: String, tx: oneshot::Sender<bool>| {
                let generations = state.generations.lock().unwrap();
                if generations.get(&id) != Some(&run) {
                    return;
                }
                let current_run = state
                    .runtimes
                    .lock()
                    .unwrap()
                    .get(&id)
                    .map(|r| r.run_id.clone())
                    .unwrap_or_else(|| run.clone());
                state.trust.lock().unwrap().insert(
                    id.clone(),
                    PendingTrust {
                        run_id: current_run.clone(),
                        fingerprint: fingerprint.clone(),
                        endpoint: endpoint.clone(),
                        reply: tx,
                    },
                );
                state.runtimes.lock().unwrap().insert(
                    id.clone(),
                    Runtime {
                        rule_id: id.clone(),
                        run_id: current_run,
                        status: "verifying-host".into(),
                        fingerprint: Some(fingerprint),
                        message: crate::native_message::plain("firstHostKey"),
                        verification_endpoint: Some(endpoint),
                        desired_running: true,
                        ..Default::default()
                    },
                );
                drop(generations);
                state.publish(&app);
            },
        ) as tunnel::TrustPrompt
    };
    let validate: crate::supervisor::Validate = {
        let frozen = std::iter::once(host.clone())
            .chain(jumps.iter().map(|h: &tunnel::HopRequest| h.host.clone()))
            .collect::<Vec<_>>();
        let state = state.clone();
        let frozen_rule = rule.clone();
        Arc::new(move || {
            let snapshot = state.snapshot();
            (test_only
                || snapshot
                    .rules
                    .iter()
                    .any(|r| r.id == frozen_rule.id && r.same_connection(&frozen_rule)))
                && frozen.iter().all(|before| {
                    snapshot.hosts.iter().any(|after| {
                        after.id == before.id
                            && after.diagnostics.is_empty()
                            && after.same_connection(before)
                    })
                })
        })
    };
    let observer: tunnel::PasswordObserver = {
        let state = state.clone();
        let app = app.clone();
        let id = id.clone();
        let run = run_id.clone();
        Arc::new(move |host, password, method| {
            let generations = state.generations.lock().unwrap();
            if generations.get(&id) != Some(&run) {
                return;
            }
            let Some(epoch) = saves.get(&host.id) else {
                return;
            };
            if !state.snapshot().hosts.iter().any(|current| {
                current.id == host.id
                    && current.diagnostics.is_empty()
                    && crate::credentials::binding(current) == crate::credentials::binding(host)
            }) {
                return;
            }
            let result = state.vault.save(host, password, method, *epoch);
            let mut errors = state.credential_errors.lock().unwrap();
            match result {
                Ok(()) => {
                    errors.remove(&host.id);
                }
                Err(message) => {
                    let _ = app.emit("tunnel://password-error", &message);
                    errors.insert(host.id.clone(), message);
                }
            }
        })
    };
    let active_rule = rule.clone();
    let join = tauri::async_runtime::spawn(crate::supervisor::run_with_password_observer(
        tunnel::RunRequest {
            host,
            rule,
            secret,
            expected,
            run_id,
            jumps,
            test_only,
        },
        cancel.clone(),
        state.wake.subscribe(),
        notify,
        prompt,
        validate,
        Some(observer),
    ));
    // Tauri returns its own JoinHandle, wrap it for a single task type.
    let join = tokio::spawn(async move {
        // Propagate task failure so update preparation cannot report successful cleanup.
        join.await.expect("SSH supervisor task failed");
    });
    workers.insert(
        id,
        Worker {
            rule: active_rule,
            cancel,
            join,
        },
    );
    Ok(())
}
// Use the existing native shell opener, with a dedicated fixed-scheme boundary.
#[allow(deprecated)]
#[tauri::command]
pub async fn open_service(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let workers = state.workers.lock().await;
    let worker = workers
        .get(&id)
        .ok_or(crate::native_message::plain("startForward"))?;
    let snapshot = state.snapshot();
    let rule = snapshot
        .rules
        .iter()
        .find(|r| r.id == id)
        .ok_or(crate::native_message::plain("forwardMissing"))?;
    if !rule.same_connection(&worker.rule) {
        return Err(crate::native_message::plain("forwardChanged"));
    }
    let runtime = snapshot
        .runtimes
        .iter()
        .find(|r| r.rule_id == id)
        .ok_or(crate::native_message::plain("startForward"))?;
    let host = runtime
        .host_snapshot
        .as_ref()
        .ok_or(crate::native_message::plain("runningHostMissing"))?;
    let url = crate::service::service_url(rule, host, runtime)?;
    app.shell().open(url, None).map_err(|e| {
        crate::native_message::message(
            "openServiceFailed",
            serde_json::json!({"e": (e).to_string()}),
        )
    })
}
#[tauri::command]
pub async fn open_proxy_browser(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    browser: crate::proxy_browser::Browser,
    service_id: Option<String>,
) -> Result<(), String> {
    let workers = state.workers.lock().await;
    let worker = workers
        .get(&id)
        .ok_or(crate::native_message::plain("startForward"))?;
    let snapshot = state.snapshot();
    let rule = snapshot
        .rules
        .iter()
        .find(|r| r.id == id)
        .ok_or(crate::native_message::plain("forwardMissing"))?;
    let runtime = snapshot
        .runtimes
        .iter()
        .find(|r| r.rule_id == id)
        .ok_or(crate::native_message::plain("startForward"))?;
    let proxy = crate::proxy_browser::endpoint(rule, &worker.rule, runtime)?;
    let directory = state
        .path
        .parent()
        .ok_or(crate::native_message::plain("proxyBrowserFailed"))?;
    let url = service_id
        .map(|id| {
            let service = snapshot
                .services
                .iter()
                .find(|s| {
                    s.id == id
                        && s.rule_ids.contains(&rule.id)
                        && s.host_ids.contains(&rule.host_id)
                })
                .ok_or("serviceUnbound")?;
            let port = service.port.ok_or("servicePort")?;
            Ok::<_, &str>(format!("http://127.0.0.1:{port}/"))
        })
        .transpose()?;
    crate::proxy_browser::launch(directory, runtime, &proxy, browser, url.as_deref())
}

#[tauri::command]
pub async fn stop_rule(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    state.commands.cancel_for_rule(&id);
    let mut workers = state.workers.lock().await;
    if let Some(worker) = workers.remove(&id) {
        worker.cancel.cancel();
        let _ = worker.join.await;
    }
    state.trust.lock().unwrap().remove(&id);
    state.settle_stopped(&[id]);
    state.publish(&app);
    Ok(())
}
#[tauri::command]
pub fn trust_host(
    state: tauri::State<Arc<AppState>>,
    id: String,
    run_id: String,
    fingerprint: String,
) -> Result<(), String> {
    let mut trust = state.trust.lock().unwrap();
    let pending = trust
        .get(&id)
        .ok_or(crate::native_message::plain("trustExpired"))?;
    if pending.run_id != run_id || pending.fingerprint != fingerprint || pending.reply.is_closed() {
        return Err(crate::native_message::plain("trustReconnect"));
    }
    let endpoint = pending.endpoint.clone();
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        next.trusted_keys.insert(endpoint, fingerprint);
        state.persist(&next)?;
        *c = next;
    }
    let pending = trust.remove(&id).unwrap();
    let _ = pending.reply.send(true);
    Ok(())
}
pub fn state(app: &tauri::AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}
#[tauri::command]
pub fn set_close_to_tray(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<Snapshot, String> {
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        next.close_to_tray = enabled;
        state.persist(&next)?;
        *c = next;
    }
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
#[tauri::command]
pub async fn delete_host(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    expected_rule_ids: Vec<String>,
) -> Result<Snapshot, String> {
    let mut workers = state.workers.lock().await;
    let mut ids = state.remove_host(&id, &expected_rule_ids)?;
    ids.push(format!("host-test:{id}"));
    clear_deleted_sessions(&state, &mut workers, &ids).await;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn hide_host(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    hidden: bool,
) -> Result<Snapshot, String> {
    {
        let mut c = state.config.lock().unwrap();
        let mut next = c.clone();
        next.hidden_hosts.retain(|h| h != &id);
        if hidden {
            next.hidden_hosts.push(id);
        }
        state.persist(&next)?;
        *c = next;
    }
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub async fn delete_rule(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<Snapshot, String> {
    let mut workers = state.workers.lock().await;
    state.remove_rule(&id)?;
    clear_deleted_sessions(&state, &mut workers, &[id]).await;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub async fn delete_rules(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Snapshot, String> {
    let mut workers = state.workers.lock().await;
    state.remove_rules(&ids)?;
    clear_deleted_sessions(&state, &mut workers, &ids).await;
    state.publish(&app);
    Ok(state.snapshot())
}
async fn clear_deleted_sessions(
    state: &AppState,
    workers: &mut BTreeMap<String, Worker>,
    ids: &[String],
) {
    let mut jobs = Vec::new();
    for id in ids {
        state.generations.lock().unwrap().remove(id);
        state.trust.lock().unwrap().remove(id);
        if let Some(worker) = workers.remove(id) {
            worker.cancel.cancel();
            jobs.push(worker);
        }
    }
    for worker in jobs {
        let _ = worker.join.await;
    }
    let mut runtimes = state.runtimes.lock().unwrap();
    for id in ids {
        runtimes.remove(id);
        state.runtime_rules.lock().unwrap().remove(id);
    }
}
#[tauri::command]
pub fn undo_delete(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<Snapshot, String> {
    state.restore_rule()?;
    state.publish(&app);
    Ok(state.snapshot())
}
use crate::batch::BatchResult;
#[tauri::command]
pub async fn start_batch(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    ids: Vec<String>,
    secrets: BTreeMap<String, String>,
    remember_host_ids: Option<Vec<String>>,
) -> Result<Vec<BatchResult>, String> {
    let secrets: BTreeMap<_, tunnel::Secret> = secrets
        .into_iter()
        .map(|(id, value)| (id, value.into()))
        .collect();
    let rules = state.snapshot().rules;
    let remember = remember_host_ids
        .unwrap_or_default()
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    let state = state.inner().clone();
    Ok(crate::batch::start(ids, |id| {
        let state = state.clone();
        let app = app.clone();
        let rule = rules.iter().find(|r| r.id == id).cloned();
        let secrets = &secrets;
        let remember = remember.clone();
        async move {
            if state
                .workers
                .lock()
                .await
                .get(&id)
                .is_some_and(|w| !w.join.is_finished())
            {
                return Ok(());
            }
            let rule = rule.ok_or(crate::native_message::plain("ruleMissing"))?;
            let secret = secrets.get(&rule.host_id).cloned().unwrap_or_default();
            launch(
                state,
                app,
                rule,
                false,
                true,
                LoginCredentials {
                    secret,
                    jumps: secrets.clone(),
                    remember,
                },
            )
            .await
        }
    })
    .await)
}
#[tauri::command]
pub async fn stop_batch(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Vec<BatchResult>, String> {
    let mut workers = state.workers.lock().await;
    let mut jobs = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut results = Vec::new();
    let ids = ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .collect::<Vec<_>>();
    for id in &ids {
        state.commands.cancel_for_rule(id);
        if let Some(worker) = workers.remove(id) {
            worker.cancel.cancel();
            jobs.push(worker);
        }
        state.trust.lock().unwrap().remove(id);
        results.push(BatchResult {
            id: id.clone(),
            accepted: true,
            error: None,
        });
    }
    for worker in jobs {
        let _ = worker.join.await;
    }
    state.settle_stopped(&ids);
    state.publish(&app);
    Ok(results)
}
#[tauri::command]
pub async fn export_config(
    state: tauri::State<'_, Arc<AppState>>,
    ids: Vec<String>,
    include_key_paths: bool,
    service_ids: Option<Vec<String>>,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    command_api::local(&window)?;
    let value = crate::config_export::package_with_services(
        &state.snapshot(),
        &ids,
        &service_ids.unwrap_or_default(),
        include_key_paths,
    )?;
    tokio::task::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title(crate::native_message::text(
                "saveConfigTitle",
                serde_json::json!({}),
            ))
            .add_filter("JSON", &["json"])
            .set_file_name("oria-tunnel.json")
            .save_file()
        else {
            return Ok(None);
        };
        crate::config_export::write(&path, &value)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| crate::native_message::plain("exportDialogFailed"))?
}
#[tauri::command]
pub async fn pick_identity_file() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title(crate::native_message::text(
                "pickIdentityTitle",
                serde_json::json!({}),
            ))
            .pick_file()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| crate::native_message::plain("pickIdentityFailed"))
}
#[tauri::command]
pub async fn pick_ssh_config_file() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title(crate::native_message::text(
                "pickConfigTitle",
                serde_json::json!({}),
            ))
            .pick_file()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| crate::native_message::plain("pickConfigFailed"))
}
#[tauri::command]
pub fn set_autostart(
    state: tauri::State<Arc<AppState>>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<Snapshot, String> {
    if !crate::long_running::AUTOSTART_SUPPORTED {
        return Err(crate::native_message::plain("autostartUnavailable"));
    }
    crate::long_running::set(enabled)?;
    let actual = crate::long_running::read();
    *state.autostart.lock().unwrap() = actual.clone();
    actual?;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub async fn preview_import_file(
    state: tauri::State<'_, Arc<AppState>>,
    source: crate::config_import::ImportSource,
    window: tauri::WebviewWindow,
) -> Result<crate::config_import::Preview, String> {
    command_api::local(&window)?;
    *state.import.lock().unwrap() = None;
    let (bytes, name) = tokio::task::spawn_blocking(move || source.read())
        .await
        .map_err(|_| crate::native_message::plain("selectedConfigRead"))??;
    state.stage_import(&bytes, name)
}
#[tauri::command]
pub async fn commit_import(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    token: String,
    choices: crate::config_import::Choices,
    window: tauri::WebviewWindow,
) -> Result<Snapshot, String> {
    command_api::local(&window)?;
    let _launch = state.workers.lock().await;
    state.allow_launch()?;
    state.apply_import(&token, &choices)?;
    state.publish(&app);
    Ok(state.snapshot())
}
#[tauri::command]
pub fn cancel_import(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    command_api::local(&window)?;
    *state.import.lock().unwrap() = None;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bulk_delete_is_atomic_and_undo_restores_the_whole_selection_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        state.config.lock().unwrap().rules = ["a", "b", "keep"]
            .into_iter()
            .map(|id| Rule {
                id: id.into(),
                auto_connect: true,
                ..Default::default()
            })
            .collect();
        assert!(state.remove_rules(&["a".into(), "missing".into()]).is_err());
        assert_eq!(state.snapshot().rules.len(), 3);
        assert_eq!(state.snapshot().undo_count, 0);
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state.remove_rules(&["a".into(), "b".into()]).is_err());
        assert_eq!(state.snapshot().rules.len(), 3);
        assert_eq!(state.snapshot().undo_count, 0);
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        state
            .remove_rules(&["a".into(), "b".into(), "a".into()])
            .unwrap();
        assert_eq!(state.snapshot().rules.len(), 1);
        assert_eq!(state.snapshot().rules[0].id, "keep");
        assert_eq!(state.snapshot().undo_count, 1);
        state.config.lock().unwrap().rules.push(Rule {
            id: "a".into(),
            ..Default::default()
        });
        assert!(state.restore_rule().is_err());
        assert_eq!(state.snapshot().undo_count, 1);
        state.config.lock().unwrap().rules.retain(|r| r.id != "a");
        state.restore_rule().unwrap();
        assert_eq!(state.snapshot().rules.len(), 3);
        assert!(state
            .snapshot()
            .rules
            .iter()
            .filter(|r| r.id != "keep")
            .all(|r| !r.auto_connect));
        assert!(
            state
                .snapshot()
                .rules
                .iter()
                .find(|r| r.id == "keep")
                .unwrap()
                .auto_connect
        );
        assert_eq!(state.snapshot().undo_count, 0);
    }
    #[tokio::test]
    async fn host_cascade_delete_checks_confirmation_and_cleans_only_related_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        {
            let mut config = state.config.lock().unwrap();
            config.hosts = ["host", "keep"]
                .into_iter()
                .map(|id| Host {
                    id: id.into(),
                    name: id.into(),
                    source: "manual".into(),
                    ..Default::default()
                })
                .collect();
            config.rules = ["a", "b", "keep"]
                .into_iter()
                .map(|id| Rule {
                    id: id.into(),
                    host_id: if id == "keep" { "keep" } else { "host" }.into(),
                    auto_connect: true,
                    ..Default::default()
                })
                .collect();
        }
        assert!(state.remove_host("host", &["a".into()]).is_err());
        assert_eq!(state.snapshot().rules.len(), 3);
        assert_eq!(state.snapshot().hosts.len(), 2);
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state
            .remove_host("host", &["a".into(), "b".into()])
            .is_err());
        assert_eq!(state.snapshot().undo_count, 0);
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        let mut tokens = Vec::new();
        for id in ["a", "b", "host-test:host", "keep"] {
            let cancel = CancellationToken::new();
            let waiting = cancel.clone();
            tokens.push(cancel.clone());
            state.workers.lock().await.insert(
                id.into(),
                Worker {
                    rule: Rule::default(),
                    cancel,
                    join: tokio::spawn(async move {
                        waiting.cancelled().await;
                    }),
                },
            );
            state.runtimes.lock().unwrap().insert(
                id.into(),
                Runtime {
                    rule_id: id.into(),
                    status: "stopped".into(),
                    ..Default::default()
                },
            );
            state
                .generations
                .lock()
                .unwrap()
                .insert(id.into(), "run".into());
            let (reply, _receiver) = oneshot::channel();
            state.trust.lock().unwrap().insert(
                id.into(),
                PendingTrust {
                    run_id: "run".into(),
                    fingerprint: "fixture".into(),
                    endpoint: "fixture".into(),
                    reply,
                },
            );
        }
        let mut ids = state
            .remove_host("host", &["a".into(), "b".into()])
            .unwrap();
        ids.push("host-test:host".into());
        {
            let mut workers = state.workers.lock().await;
            clear_deleted_sessions(&state, &mut workers, &ids).await;
            assert_eq!(workers.len(), 1);
            assert!(workers.contains_key("keep"));
        }
        assert!(tokens[..3].iter().all(CancellationToken::is_cancelled));
        assert!(!tokens[3].is_cancelled());
        assert_eq!(state.runtimes.lock().unwrap().len(), 1);
        assert_eq!(state.generations.lock().unwrap().len(), 1);
        assert_eq!(state.trust.lock().unwrap().len(), 1);
        assert_eq!(state.snapshot().rules.len(), 1);
        assert_eq!(state.snapshot().hosts.len(), 1);
        state.restore_rule().unwrap();
        assert_eq!(state.snapshot().rules.len(), 3);
        assert_eq!(state.snapshot().hosts.len(), 2);
        assert!(state
            .snapshot()
            .rules
            .iter()
            .filter(|r| r.id != "keep")
            .all(|r| !r.auto_connect));
        assert_eq!(state.workers.lock().await.len(), 1);
        state.stop_all().await;
    }
    #[test]
    fn config_host_delete_and_undo_preserve_source_and_added_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("ssh_config");
        std::fs::write(&source, b"Host fixture\n HostName example.invalid\n").unwrap();
        let host = Host {
            id: "ssh:fixture".into(),
            source: "config".into(),
            ..Default::default()
        };
        let discovery = ssh_config::Discovery {
            hosts: vec![host.clone()],
            ..Default::default()
        };
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), discovery).unwrap();
        {
            let mut config = state.config.lock().unwrap();
            config.host_metadata.insert(
                host.id.clone(),
                HostMetadata {
                    name: "Added".into(),
                    tags: vec!["tag".into()],
                },
            );
            config.host_snapshots.insert(host.id.clone(), host.clone());
            config.rules.push(Rule {
                id: "forward".into(),
                host_id: host.id.clone(),
                auto_connect: true,
                ..Default::default()
            });
        }
        state.remove_host(&host.id, &["forward".into()]).unwrap();
        assert!(state.snapshot().added_host_ids.is_empty());
        assert!(state.snapshot().rules.is_empty());
        assert!(state.config.lock().unwrap().host_metadata.is_empty());
        state.restore_rule().unwrap();
        assert_eq!(state.snapshot().added_host_ids, vec![host.id.clone()]);
        assert_eq!(state.snapshot().hosts[0].name, "Added");
        assert!(!state.snapshot().rules[0].auto_connect);
        assert_eq!(
            std::fs::read(&source).unwrap(),
            b"Host fixture\n HostName example.invalid\n"
        );
    }
    #[test]
    fn added_config_hosts_persist_without_promoting_all_discovered_candidates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let candidate = Host {
            id: "ssh:candidate".into(),
            name: "Candidate".into(),
            source: "config".into(),
            ..Default::default()
        };
        let jump = Host {
            id: "ssh:jump".into(),
            name: "Jump".into(),
            source: "config".into(),
            ..Default::default()
        };
        let discovery = ssh_config::Discovery {
            hosts: vec![candidate.clone(), jump],
            ..Default::default()
        };
        let state = AppState::load_with_discovery(path.clone(), discovery.clone()).unwrap();
        assert_eq!(state.snapshot().hosts.len(), 2);
        assert!(state.snapshot().added_host_ids.is_empty());
        {
            let mut config = state.config.lock().unwrap();
            config.host_metadata.insert(
                candidate.id.clone(),
                HostMetadata {
                    name: candidate.name.clone(),
                    tags: vec![],
                },
            );
            config
                .host_snapshots
                .insert(candidate.id.clone(), candidate.clone());
            state.persist(&config).unwrap();
        }
        assert_eq!(state.snapshot().added_host_ids, vec!["ssh:candidate"]);
        let restored = AppState::load_with_discovery(path, discovery).unwrap();
        assert_eq!(restored.snapshot().added_host_ids, vec!["ssh:candidate"]);
        assert!(restored.snapshot().runtimes.is_empty());
        assert!(restored.workers.try_lock().unwrap().is_empty());
        let missing =
            AppState::load_with_discovery(restored.path.clone(), Default::default()).unwrap();
        assert_eq!(missing.snapshot().hosts.len(), 1);
        assert_eq!(missing.snapshot().hosts[0].id, "ssh:candidate");
        assert!(!missing.snapshot().hosts[0].diagnostics.is_empty());
    }
    #[test]
    fn discovered_multi_add_is_atomic_persistent_and_never_creates_rules_or_connections() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("connections.json");
        let discovery = ssh_config::Discovery {
            hosts: ["first", "second", "untouched"]
                .into_iter()
                .map(|name| Host {
                    id: format!("ssh:{name}"),
                    name: name.into(),
                    source: "config".into(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        let state = AppState::load_with_discovery(path.clone(), discovery.clone()).unwrap();
        assert!(state.add_discovered_hosts(&[]).is_err());
        assert!(state
            .add_discovered_hosts(&["ssh:first".into(), "missing".into()])
            .is_err());
        assert!(state.snapshot().added_host_ids.is_empty());
        assert!(!path.exists());
        state
            .add_discovered_hosts(&["ssh:first".into(), "ssh:second".into(), "ssh:first".into()])
            .unwrap();
        assert_eq!(state.snapshot().added_host_ids, ["ssh:first", "ssh:second"]);
        let saved = std::fs::read(&path).unwrap();
        let restored = AppState::load_with_discovery(path.clone(), discovery).unwrap();
        assert_eq!(
            restored.snapshot().added_host_ids,
            ["ssh:first", "ssh:second"]
        );
        assert!(restored.snapshot().rules.is_empty());
        assert!(restored.snapshot().runtimes.is_empty());
        assert!(restored.add_discovered_hosts(&["missing".into()]).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), saved);
        // A failed write also leaves the in-memory selection unchanged.
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(restored
            .add_discovered_hosts(&["ssh:untouched".into()])
            .is_err());
        assert_eq!(
            restored.snapshot().added_host_ids,
            ["ssh:first", "ssh:second"]
        );
    }
    #[test]
    fn import_is_atomic_stopped_additive_single_use_and_rejects_changed_preview() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let existing = Host {
            id: "host".into(),
            name: "Host".into(),
            address: "127.0.0.1".into(),
            port: 22,
            user: "tester".into(),
            ..Default::default()
        };
        let rule = Rule {
            id: "rule".into(),
            name: "Forward".into(),
            host_id: "host".into(),
            bind_port: 1234,
            target_host: "localhost".into(),
            target_port: 80,
            auto_connect: true,
            ..Default::default()
        };
        state.config.lock().unwrap().hosts.push(existing);
        state.config.lock().unwrap().rules.push(rule);
        let value =
            crate::config_export::package(&state.snapshot(), &["rule".into()], false).unwrap();
        let bytes = serde_json::to_vec(&value).unwrap();
        let preview = state.stage_import(&bytes, "fixture.json".into()).unwrap();
        let choices = crate::config_import::Choices {
            rule_ids: vec!["rule".into()],
            ..Default::default()
        };
        assert_eq!(state.snapshot().rules.len(), 1);
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state.apply_import(&preview.token, &choices).is_err());
        assert_eq!(state.snapshot().rules.len(), 1);
        assert!(state.import.lock().unwrap().is_some());
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        state.apply_import(&preview.token, &choices).unwrap();
        let snapshot = state.snapshot();
        assert_eq!(snapshot.rules.len(), 2);
        assert_eq!(snapshot.hosts.len(), 2);
        assert!(snapshot.rules[0].auto_connect);
        assert!(!snapshot.rules[1].auto_connect);
        assert!(snapshot.runtimes.is_empty());
        assert!(state.workers.try_lock().unwrap().is_empty());
        assert!(snapshot.rules[0].id != snapshot.rules[1].id);
        assert_eq!(snapshot.rules[1].name, "Forward (2)");
        assert_eq!(snapshot.hosts[1].name, "Host (2)");
        assert!(state.apply_import(&preview.token, &choices).is_err());
        let preview = state.stage_import(&bytes, "fixture.json".into()).unwrap();
        state.config.lock().unwrap().close_to_tray = false;
        assert!(state.apply_import(&preview.token, &choices).is_err());
        assert_eq!(state.snapshot().rules.len(), 2);
        let restored =
            AppState::load_with_discovery(state.path.clone(), Default::default()).unwrap();
        assert_eq!(restored.snapshot().rules.len(), 2);
        assert!(restored.snapshot().runtimes.is_empty());
    }
    #[test]
    fn undo_restores_stopped_configuration_and_failed_writes_preserve_tombstone() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let rule = Rule {
            id: "fixture".into(),
            name: "fixture".into(),
            auto_connect: true,
            ..Default::default()
        };
        state.config.lock().unwrap().rules.push(rule.clone());
        state.remove_rule(&rule.id).unwrap();
        assert!(state.snapshot().rules.is_empty());
        assert_eq!(state.snapshot().undo_count, 1);
        // Force an atomic-save failure with a directory at the temp path.
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state.restore_rule().is_err());
        assert!(state.snapshot().rules.is_empty());
        assert_eq!(state.snapshot().undo_count, 1);
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        state.restore_rule().unwrap();
        let restored = state.snapshot();
        assert_eq!(restored.rules.len(), 1);
        assert_eq!(restored.rules[0].id, rule.id);
        assert!(!restored.rules[0].auto_connect);
        assert_eq!(restored.undo_count, 0);
        assert!(restored.runtimes.is_empty());
        assert!(state.workers.try_lock().unwrap().is_empty());
        let reloaded =
            AppState::load_with_discovery(state.path.clone(), Default::default()).unwrap();
        assert_eq!(reloaded.snapshot().rules.len(), 1);
        assert!(reloaded.snapshot().runtimes.is_empty());
    }
    #[test]
    fn rule_changes_remain_visible_after_supervisor_metrics_replace_the_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::isolated(dir.path().join("connections.json"));
        let rule = Rule {
            id: "fixture".into(),
            target_port: 3000,
            ..Default::default()
        };
        state.config.lock().unwrap().rules.push(rule.clone());
        state
            .runtime_rules
            .lock()
            .unwrap()
            .insert(rule.id.clone(), rule.clone());
        state.config.lock().unwrap().rules[0].target_port = 3689;
        for sent in [0, 100] {
            state.runtimes.lock().unwrap().insert(
                rule.id.clone(),
                Runtime {
                    rule_id: rule.id.clone(),
                    status: "listening".into(),
                    sent,
                    ..Default::default()
                },
            );
            assert!(state.snapshot().runtimes[0].configuration_changed);
        }
        state.runtime_rules.lock().unwrap().insert(
            rule.id.clone(),
            state.config.lock().unwrap().rules[0].clone(),
        );
        assert!(!state.snapshot().runtimes[0].configuration_changed);
    }
    #[test]
    fn explicit_stop_clears_terminal_attention_without_inventing_rate_samples() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        state.runtimes.lock().unwrap().insert(
            "fixture".into(),
            Runtime {
                rule_id: "fixture".into(),
                status: "needs-attention".into(),
                message: "needs manual authentication".into(),
                error_kind: Some(FailureKind::Authentication),
                ..Default::default()
            },
        );
        state.settle_stopped(&["fixture".into()]);
        let r = state.snapshot().runtimes.pop().unwrap();
        assert_eq!(r.status, "stopped");
        assert!(!r.desired_running);
        assert!(r.message.is_empty());
        assert!(r.error_kind.is_none());
        assert!(r.sent_per_second.is_none());
    }
    #[tokio::test]
    async fn update_preparation_waits_for_sessions_and_blocks_launch_until_released() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap(),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let token = CancellationToken::new();
        let cancelled = token.clone();
        let finish = Arc::new(tokio::sync::Notify::new());
        let finish_worker = finish.clone();
        state.workers.lock().await.insert(
            "forward".into(),
            Worker {
                rule: Rule::default(),
                cancel: token.clone(),
                join: tokio::spawn(async move {
                    cancelled.cancelled().await;
                    finish_worker.notified().await;
                    drop(listener);
                }),
            },
        );
        let preparing = {
            let state = state.clone();
            tokio::spawn(async move { state.prepare_update(&["forward".into()]).await })
        };
        token.cancelled().await;
        assert!(state.update_installing());
        assert_eq!(state.allow_launch().unwrap_err(), "updateInstalling");
        assert!(!preparing.is_finished());
        assert!(tokio::net::TcpListener::bind(address).await.is_err());
        finish.notify_one();
        preparing.await.unwrap().unwrap();
        let _listener = tokio::net::TcpListener::bind(address).await.unwrap();
        assert!(state.active_work_ids().await.is_empty());
        state.finish_update_attempt();
        assert!(state.allow_launch().is_ok());
        state.shutdown().await;
        state.finish_update_attempt();
        assert!(state.allow_launch().is_err());
    }
    #[tokio::test]
    async fn update_confirmation_changes_preserve_existing_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let token = CancellationToken::new();
        let worker = token.clone();
        state.workers.lock().await.insert(
            "host-test:fixture".into(),
            Worker {
                rule: Rule::default(),
                cancel: token.clone(),
                join: tokio::spawn(async move {
                    worker.cancelled().await;
                }),
            },
        );
        assert_eq!(
            state.prepare_update(&[]).await.unwrap_err(),
            "activityChanged"
        );
        assert!(!token.is_cancelled());
        state.finish_update_attempt();
        assert!(state.allow_launch().is_ok());
        state
            .prepare_update(&["host-test:fixture".into()])
            .await
            .unwrap();
        assert!(token.is_cancelled());
        state.finish_update_attempt();
    }
    #[tokio::test]
    async fn update_cleanup_failure_is_reported_and_does_not_set_permanent_shutdown() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        let worker = tokio::spawn(async {
            panic!("isolated worker failure");
        });
        while !worker.is_finished() {
            tokio::task::yield_now().await;
        }
        state.workers.lock().await.insert(
            "failed".into(),
            Worker {
                rule: Rule::default(),
                cancel: CancellationToken::new(),
                join: worker,
            },
        );
        assert_eq!(state.prepare_update(&[]).await.unwrap_err(), "cleanup");
        state.finish_update_attempt();
        assert!(state.allow_launch().is_ok());
        assert!(state.workers.lock().await.is_empty());
    }
    #[tokio::test]
    async fn hiding_keeps_all_forwards_and_cancels_host_tests_then_exit_cancels_all() {
        let dir = tempfile::tempdir().unwrap();
        let state =
            AppState::load_with_discovery(dir.path().join("connections.json"), Default::default())
                .unwrap();
        {
            let mut c = state.config.lock().unwrap();
            c.rules = vec![
                Rule {
                    id: "background".into(),
                    background: true,
                    ..Default::default()
                },
                Rule {
                    id: "foreground".into(),
                    background: false,
                    ..Default::default()
                },
            ];
        }
        let mut tokens = Vec::new();
        for id in ["background", "foreground", "host-test:fixture"] {
            let token = CancellationToken::new();
            tokens.push(token.clone());
            let c = token.clone();
            state.workers.lock().await.insert(
                id.into(),
                Worker {
                    rule: Rule::default(),
                    cancel: token,
                    join: tokio::spawn(async move {
                        c.cancelled().await;
                    }),
                },
            );
        }
        state.cancel_host_tests_on_hide().await;
        assert!(!tokens[0].is_cancelled());
        assert!(!tokens[1].is_cancelled());
        assert!(tokens[2].is_cancelled());
        assert_eq!(state.workers.lock().await.len(), 2);
        state.shutdown().await;
        assert!(tokens[0].is_cancelled());
        assert!(tokens[1].is_cancelled());
        assert!(state.workers.lock().await.is_empty());
        assert!(state
            .shutting_down
            .load(std::sync::atomic::Ordering::SeqCst));
    }
    #[test]
    fn source_changes_preserve_rules_and_distinguish_unreadable_from_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let old = Host {
            id: "ssh:test".into(),
            address: "127.0.0.1".into(),
            ..Default::default()
        };
        let state = AppState::load_with_discovery(
            path.clone(),
            ssh_config::Discovery {
                hosts: vec![old.clone()],
                diagnostics: vec![],
            },
        )
        .unwrap();
        {
            let mut c = state.config.lock().unwrap();
            c.rules.push(Rule {
                id: "r".into(),
                host_id: old.id.clone(),
                ..Default::default()
            });
        }
        let mut new = old.clone();
        new.port = 2222;
        state
            .reconcile_hosts(ssh_config::Discovery {
                hosts: vec![new.clone()],
                diagnostics: vec![],
            })
            .unwrap();
        assert_eq!(state.snapshot().hosts[0].port, 2222);
        state
            .reconcile_hosts(ssh_config::Discovery {
                hosts: vec![],
                diagnostics: vec!["permission denied".into()],
            })
            .unwrap();
        let failed = state.snapshot();
        assert_eq!(failed.hosts[0].port, 2222);
        assert!(failed.hosts[0].diagnostics[0].contains("同步失败"));
        assert!(!state
            .reconcile_hosts(ssh_config::Discovery {
                hosts: vec![],
                diagnostics: vec!["permission denied".into()]
            })
            .unwrap());
        state.reconcile_hosts(Default::default()).unwrap();
        let missing = state.snapshot();
        assert_eq!(missing.rules.len(), 1);
        assert_eq!(missing.hosts[0].port, 2222);
        assert!(missing.hosts[0].diagnostics[0].contains("来源已失效"));
        let restarted = AppState::load_with_discovery(path, Default::default())
            .unwrap()
            .snapshot();
        assert_eq!(restarted.rules.len(), 1);
        assert_eq!(restarted.hosts[0].port, 2222);
        assert!(restarted.runtimes.is_empty());
    }
    #[test]
    fn manual_host_save_edit_reload_and_source_protection() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profile/connections.json");
        let state = AppState::load_with_discovery(path.clone(), Default::default()).unwrap();
        let mut host = Host {
            name: "Manual".into(),
            address: "127.0.0.1".into(),
            port: 22,
            user: "tester".into(),
            ..Default::default()
        };
        state.upsert_host(host.clone()).unwrap();
        let saved = state.snapshot().hosts.remove(0);
        assert!(!saved.id.is_empty());
        assert_eq!(saved.source, "manual");
        host = saved;
        host.name = "Updated".into();
        state.upsert_host(host.clone()).unwrap();
        let reopened = AppState::load_with_discovery(path.clone(), Default::default()).unwrap();
        assert_eq!(reopened.snapshot().hosts.len(), 1);
        assert_eq!(reopened.snapshot().hosts[0].name, "Updated");
        assert!(reopened.snapshot().runtimes.is_empty());
        host.id = "ssh:protected".into();
        assert!(state.upsert_host(host).is_err());
        std::fs::write(&path, b"invalid config").unwrap();
        assert!(AppState::load_with_discovery(path.clone(), Default::default()).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"invalid config");
    }
}
