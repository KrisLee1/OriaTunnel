//! Local-window IPC adapter. Configuration transactions and credentials stay in AppState.
use super::*;
use crate::commands::{Event, Run, Service};
use tauri::ipc::Channel;

pub(crate) fn local(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("unauthorizedWindow".into());
    }
    let url = window.url().map_err(|_| "unauthorizedWindow")?;
    let allowed = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
            && url.port() == Some(1420));
    if !allowed {
        return Err("unauthorizedWindow".into());
    }
    Ok(())
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceLink {
    pub id: String,
    pub revision: String,
    pub selected: bool,
}
// Mutate only the caller's cloned config; persistence of the forward and links is atomic.
pub(super) fn bind_rule_services(
    config: &mut crate::model::Config,
    rule_id: &str,
    links: &[ServiceLink],
) -> Result<Vec<String>, String> {
    if links.len() > 256 {
        return Err("invalidService".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for link in links {
        if !ids.insert(&link.id) {
            return Err("invalidService".into());
        }
        let service = config
            .services
            .iter()
            .find(|s| s.id == link.id)
            .ok_or("serviceMissing")?;
        if service.revision != link.revision {
            return Err("staleAction".into());
        }
    }
    if config
        .services
        .iter()
        .any(|s| s.rule_ids.iter().any(|id| id == rule_id) && !ids.contains(&s.id))
    {
        return Err("staleAction".into());
    }
    let mut changed = Vec::new();
    for link in links {
        let service = config
            .services
            .iter_mut()
            .find(|s| s.id == link.id)
            .ok_or("serviceMissing")?;
        if service.rule_ids.iter().any(|id| id == rule_id) != link.selected {
            service.rule_ids.retain(|id| id != rule_id);
            if link.selected {
                service.rule_ids.push(rule_id.into());
            }
            service.revision = uuid::Uuid::new_v4().to_string();
            service.validate()?;
            changed.push(service.id.clone());
        }
    }
    Ok(changed)
}

#[tauri::command]
pub async fn save_service_profile(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    service: Service,
) -> Result<Snapshot, String> {
    local(&window)?;
    let _launch = state.workers.lock().await;
    state.allow_launch()?;
    let result = save_profile(&state, service)?;
    state.publish(&app);
    Ok(result)
}
fn save_profile(state: &AppState, mut service: Service) -> Result<Snapshot, String> {
    service.execution_host_id.clear();
    service.validate()?;
    if state.terminals.busy(&service.id) {
        return Err("serviceBusy".into());
    }
    let snapshot = state.snapshot();
    service.rule_ids = if service.id.is_empty() {
        Vec::new()
    } else {
        snapshot
            .services
            .iter()
            .find(|s| s.id == service.id)
            .ok_or("serviceMissing")?
            .rule_ids
            .iter()
            .filter(|id| snapshot.rules.iter().any(|r| &r.id == *id))
            .cloned()
            .collect()
    };
    if service
        .rule_ids
        .iter()
        .any(|id| !snapshot.rules.iter().any(|r| &r.id == id))
    {
        return Err("ruleMissing".into());
    }
    if state
        .commands
        .list()
        .iter()
        .any(|r| r.service_id == service.id && r.active())
    {
        return Err("serviceBusy".into());
    }
    let mut config = state.config.lock().unwrap();
    let mut next = config.clone();
    if service.id.is_empty() {
        if next.services.len() >= 256 {
            return Err("commandLimit".into());
        }
        service.id = uuid::Uuid::new_v4().to_string();
    } else {
        let saved = next
            .services
            .iter()
            .find(|s| s.id == service.id)
            .ok_or("serviceMissing")?;
        if saved.revision != service.revision {
            return Err("staleAction".into());
        }
    }
    service.execution_enabled = next
        .services
        .iter()
        .find(|s| s.id == service.id)
        .map(|s| s.execution_enabled)
        .unwrap_or(service.execution_enabled);
    service.revision = uuid::Uuid::new_v4().to_string();
    next.services.retain(|s| s.id != service.id);
    next.services.push(service);
    for rule in snapshot
        .rules
        .iter()
        .filter(|r| next.services.last().unwrap().rule_ids.contains(&r.id))
    {
        if let Some(host) = snapshot.hosts.iter().find(|h| h.id == rule.host_id) {
            next.host_snapshots.insert(host.id.clone(), host.clone());
        }
    }
    if let Some(host) = snapshot
        .hosts
        .iter()
        .find(|h| h.id == next.services.last().unwrap().execution_host_id)
    {
        next.host_snapshots.insert(host.id.clone(), host.clone());
    }
    state.persist(&next)?;
    *config = next;
    drop(config);
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn set_service_execution(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    revision: String,
    enabled: bool,
    reviewed: bool,
) -> Result<Snapshot, String> {
    local(&window)?;
    let _launch = state.workers.lock().await;
    state.allow_launch()?;
    set_execution(&state, &id, &revision, enabled, reviewed)?;
    state.publish(&app);
    Ok(state.snapshot())
}
fn set_execution(
    state: &AppState,
    id: &str,
    revision: &str,
    enabled: bool,
    reviewed: bool,
) -> Result<(), String> {
    if enabled && !reviewed {
        return Err("confirmationRequired".into());
    }
    if state.terminals.busy(id)
        || state
            .commands
            .list()
            .iter()
            .any(|r| r.service_id == id && r.active())
    {
        return Err("serviceBusy".into());
    }
    let mut config = state.config.lock().unwrap();
    let mut next = config.clone();
    let service = next
        .services
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or("serviceMissing")?;
    if service.revision != revision {
        return Err("staleAction".into());
    }
    service.validate()?;
    service.execution_enabled = enabled;
    service.revision = uuid::Uuid::new_v4().to_string();
    state.persist(&next)?;
    *config = next;
    Ok(())
}

#[tauri::command]
pub async fn delete_service_profile(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    revision: String,
) -> Result<Snapshot, String> {
    local(&window)?;
    let _launch = state.workers.lock().await;
    state.allow_launch()?;
    let result = delete_profile(&state, &id, &revision)?;
    state.publish(&app);
    Ok(result)
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceRevision {
    pub id: String,
    pub revision: String,
}

#[tauri::command]
pub async fn delete_service_profiles(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    services: Vec<ServiceRevision>,
) -> Result<Snapshot, String> {
    local(&window)?;
    let _launch = state.workers.lock().await;
    state.allow_launch()?;
    let result = delete_profiles(&state, &services)?;
    state.publish(&app);
    Ok(result)
}
fn delete_profile(state: &AppState, id: &str, revision: &str) -> Result<Snapshot, String> {
    delete_profiles(
        state,
        &[ServiceRevision {
            id: id.into(),
            revision: revision.into(),
        }],
    )
}
fn delete_profiles(state: &AppState, services: &[ServiceRevision]) -> Result<Snapshot, String> {
    let ids: std::collections::HashSet<_> =
        services.iter().map(|service| service.id.as_str()).collect();
    if services.is_empty() || services.len() > 256 || ids.len() != services.len() {
        return Err("invalidService".into());
    }
    if services
        .iter()
        .any(|service| state.terminals.busy(&service.id))
        || state
            .commands
            .list()
            .iter()
            .any(|run| ids.contains(run.service_id.as_str()) && run.active())
    {
        return Err("serviceBusy".into());
    }
    let mut config = state.config.lock().unwrap();
    for service in services {
        let saved = config
            .services
            .iter()
            .find(|saved| saved.id == service.id)
            .ok_or("serviceMissing")?;
        if saved.revision != service.revision {
            return Err("staleAction".into());
        }
    }
    let mut next = config.clone();
    next.services
        .retain(|service| !ids.contains(service.id.as_str()));
    state.persist(&next)?;
    *config = next;
    drop(config);
    Ok(state.snapshot())
}

#[tauri::command]
pub fn command_runs(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
) -> Result<Vec<Run>, String> {
    local(&window)?;
    Ok(state.commands.list())
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    service_id: String,
    action_id: String,
    #[serde(default)]
    rule_id: Option<String>,
    revision: String,
    request_id: String,
    confirmed: bool,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
    #[serde(default)]
    remember_host_ids: Vec<String>,
}
#[tauri::command]
pub async fn start_command(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Start,
) -> Result<Run, String> {
    local(&window)?;
    launch_command(state.inner().clone(), app, request).await
}
async fn launch_command(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    request: Start,
) -> Result<Run, String> {
    service_api::start(
        state,
        app,
        service_api::Start {
            service_id: request.service_id,
            action_id: Some(request.action_id),
            revision: request.revision,
            request_id: request.request_id,
            confirmed: request.confirmed,
            secrets: request.secrets,
            remember_host_ids: request.remember_host_ids,
            operation: crate::service_control::Operation::Action,
            rule_id: request.rule_id,
        },
    )
    .await
}
#[tauri::command]
pub fn attach_command(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    on_event: Channel<Event>,
) -> Result<(), String> {
    local(&window)?;
    state.commands.attach(&id, on_event)
}
#[tauri::command]
pub fn ack_command(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    revision: u64,
) -> Result<(), String> {
    local(&window)?;
    state.commands.ack(&id, revision)
}
#[tauri::command]
pub fn detach_command(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    local(&window)?;
    state.commands.detach(&id);
    Ok(())
}
#[tauri::command]
pub fn cancel_command(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    local(&window)?;
    state.commands.cancel(&id)
}

#[tauri::command]
pub fn preview_service_template(
    window: tauri::WebviewWindow,
    kind: String,
    resource: String,
) -> Result<crate::service_templates::Template, String> {
    local(&window)?;
    crate::service_templates::build(&kind, &resource)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands;
    fn service(host: &str) -> Service {
        Service {
            category: None,
            color: None,
            icon: None,
            execution_enabled: true,
            control: Default::default(),
            id: "".into(),
            name: "worker".into(),
            execution_host_id: host.into(),
            rule_ids: vec![],
            revision: "".into(),
            no_local_environment: true,
            actions: vec![commands::Action {
                invocation: None,
                mode: Default::default(),
                id: "start".into(),
                kind: "start".into(),
                label: "start".into(),
                command: "SCRIPT_CANARY".into(),
                timeout_secs: 60,
                success_codes: vec![0],
                confirm: false,
            }],
        }
    }
    #[test]
    fn batch_service_deletion_is_atomic_for_stale_busy_and_failed_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let state = AppState::isolated(path.clone());
        save_profile(&state, service("")).unwrap();
        save_profile(&state, service("")).unwrap();
        let snapshot = state.snapshot();
        let mut targets: Vec<_> = snapshot
            .services
            .iter()
            .map(|service| ServiceRevision {
                id: service.id.clone(),
                revision: service.revision.clone(),
            })
            .collect();
        let original = std::fs::read(&path).unwrap();
        targets[1].revision = "stale".into();
        assert_eq!(
            delete_profiles(&state, &targets).err().unwrap(),
            "staleAction"
        );
        assert_eq!(state.snapshot().services.len(), 2);
        assert_eq!(std::fs::read(&path).unwrap(), original);
        targets[1].revision = snapshot.services[1].revision.clone();
        let run: Run = serde_json::from_value(serde_json::json!({"id":"isolated-batch","requestId":"r","serviceId":targets[1].id,"actionId":"a","serviceRevision":targets[1].revision,"hostId":"h","hostName":"fixture","endpoint":"fixture","actionLabel":"fixture","phase":"running","submitted":true,"exitCode":null,"exitSignal":null,"error":null,"startedAt":1,"finishedAt":null,"fingerprint":null,"verificationEndpoint":null,"revision":1,"truncated":false})).unwrap();
        state.commands.register(run).unwrap();
        assert_eq!(
            delete_profiles(&state, &targets).err().unwrap(),
            "serviceBusy"
        );
        assert_eq!(state.snapshot().services.len(), 2);
        state.commands.finish("isolated-batch", "succeeded", None);
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        assert!(delete_profiles(&state, &targets).is_err());
        assert_eq!(state.snapshot().services.len(), 2);
        assert_eq!(std::fs::read(&path).unwrap(), original);
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        assert!(delete_profiles(&state, &targets)
            .unwrap()
            .services
            .is_empty());
        assert!(AppState::isolated(path).snapshot().services.is_empty());
    }
    #[test]
    fn forward_and_service_binding_save_reload_and_failed_save_are_atomic() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let state = AppState::isolated(path.clone());
        let host = Host {
            id: "h".into(),
            name: "fixture".into(),
            address: "127.0.0.1".into(),
            user: "fixture".into(),
            port: 22,
            ..Default::default()
        };
        state.upsert_host(host).unwrap();
        let saved = save_profile(&state, service("h")).unwrap().services[0].clone();
        let rule = crate::model::Rule {
            id: "r".into(),
            name: "forward".into(),
            host_id: "h".into(),
            bind_port: 12345,
            target_port: 8080,
            target_host: "127.0.0.1".into(),
            ..Default::default()
        };
        let link = |revision: String, selected: bool| {
            vec![ServiceLink {
                id: saved.id.clone(),
                revision,
                selected,
            }]
        };
        super::super::save_rule_profile(
            &state,
            rule.clone(),
            Some(link(saved.revision.clone(), true)),
        )
        .unwrap();
        let restored = AppState::isolated(path.clone()).snapshot();
        assert_eq!(restored.rules[0].id, "r");
        assert_eq!(restored.services[0].rule_ids, vec!["r"]);
        let file = std::fs::read(&path).unwrap();
        let mut edited = rule.clone();
        edited.name = "must not persist".into();
        assert!(
            super::super::save_rule_profile(&state, edited, Some(link(saved.revision, false)))
                .is_err()
        );
        assert_eq!(std::fs::read(&path).unwrap(), file);
        assert_eq!(state.snapshot().rules[0].name, "forward");
        let current = state.snapshot().services[0].revision.clone();
        super::super::save_rule_profile(&state, rule, Some(link(current, false))).unwrap();
        assert!(AppState::isolated(path).snapshot().services[0]
            .rule_ids
            .is_empty());
        assert!(state.commands.list().is_empty());
        assert!(state.terminals.list().is_empty());
    }
    #[test]
    fn forward_service_links_are_revision_checked_and_preserve_other_links() {
        let mut config = crate::model::Config::default();
        let mut first = service("host");
        first.id = "first".into();
        first.revision = "v1".into();
        first.rule_ids = vec!["other".into()];
        let mut second = first.clone();
        second.id = "second".into();
        second.rule_ids = vec!["forward".into()];
        config.services = vec![first, second];
        let links = vec![
            ServiceLink {
                id: "first".into(),
                revision: "v1".into(),
                selected: true,
            },
            ServiceLink {
                id: "second".into(),
                revision: "v1".into(),
                selected: false,
            },
        ];
        assert_eq!(
            bind_rule_services(&mut config, "forward", &links)
                .unwrap()
                .len(),
            2
        );
        assert_eq!(config.services[0].rule_ids, vec!["other", "forward"]);
        assert!(config.services[1].rule_ids.is_empty());
        let current = config.services[0].revision.clone();
        assert!(bind_rule_services(&mut config, "forward", &links).is_err());
        assert_eq!(config.services[0].revision, current);
        assert!(bind_rule_services(&mut config, "forward", &[]).is_err());
        let before = serde_json::to_vec(&config).unwrap();
        let duplicate = vec![
            ServiceLink {
                id: "first".into(),
                revision: current.clone(),
                selected: false,
            },
            ServiceLink {
                id: "first".into(),
                revision: current,
                selected: true,
            },
        ];
        assert!(bind_rule_services(&mut config, "forward", &duplicate).is_err());
        assert_eq!(serde_json::to_vec(&config).unwrap(), before);
    }
    #[test]
    fn service_transactions_backup_reload_stale_and_failed_save_never_launch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let state = AppState::isolated(path.clone());
        state
            .upsert_host(Host {
                id: "".into(),
                name: "isolated".into(),
                address: "127.0.0.1".into(),
                port: 22,
                user: "tester".into(),
                ..Default::default()
            })
            .unwrap();
        let host = state.snapshot().hosts[0].id.clone();
        let old = std::fs::read(&path).unwrap();
        let snapshot = save_profile(&state, service(&host)).unwrap();
        let saved = snapshot.services[0].clone();
        let mut portable = snapshot.clone();
        portable.rules.push(Rule {
            id: "export-fixture".into(),
            name: "forward".into(),
            host_id: host.clone(),
            ..Default::default()
        });
        let exported = crate::config_export::package(&portable, &["export-fixture".into()], false)
            .unwrap()
            .to_string();
        assert!(!exported.contains("SCRIPT_CANARY"));
        assert!(!exported.contains("services"));

        assert_eq!(
            std::fs::read(path.with_extension("pre-commands.json")).unwrap(),
            old
        );
        assert!(state.commands.list().is_empty());
        assert!(state.command_workers.try_lock().unwrap().is_empty());
        let reloaded = AppState::isolated(path.clone());
        assert_eq!(
            reloaded.snapshot().services[0].actions[0].command,
            "SCRIPT_CANARY"
        );
        assert!(reloaded.commands.list().is_empty());
        let mut changed = saved.clone();
        changed.name = "updated".into();
        save_profile(&state, changed).unwrap();
        assert_eq!(save_profile(&state, saved).err().unwrap(), "staleAction");
        let current = state.snapshot().services[0].clone();
        let file = std::fs::read(&path).unwrap();
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        assert!(delete_profile(&state, &current.id, &current.revision).is_err());
        assert_eq!(state.snapshot().services.len(), 1);
        assert_eq!(std::fs::read(&path).unwrap(), file);
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        assert!(state.remove_host(&host, &[]).is_ok());
        assert_eq!(state.snapshot().services.len(), 1);
        delete_profile(&state, &current.id, &current.revision).unwrap();
        assert!(state.snapshot().services.is_empty());
    }
    #[tokio::test]
    async fn cleanup_cancels_command_jobs_and_update_counts_finishing_transports() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(AppState::isolated(dir.path().join("config.json")));
        let cancel = CancellationToken::new();
        let worker_cancel = cancel.clone();
        let finished = Arc::new(tokio::sync::Notify::new());
        let release = finished.clone();
        state.command_workers.lock().await.insert(
            "command:isolated".into(),
            tokio::spawn(async move {
                worker_cancel.cancelled().await;
                release.notified().await;
            }),
        );
        // Register a model record only to exercise shared cancellation; the transport job above is the cleanup authority.
        let r:Run=serde_json::from_value(serde_json::json!({"id":"command:isolated","requestId":"r","serviceId":"s","actionId":"a","serviceRevision":"v","hostId":"h","hostName":"test","endpoint":"test","actionLabel":"test","phase":"running","submitted":true,"exitCode":null,"exitSignal":null,"error":null,"startedAt":1,"finishedAt":null,"fingerprint":null,"verificationEndpoint":null,"revision":1,"truncated":false})).unwrap();
        let (_, token, _) = state.commands.register(r).unwrap();
        let preparing = {
            let state = state.clone();
            tokio::spawn(async move { state.prepare_update(&["command:isolated".into()]).await })
        };
        token.cancelled().await;
        assert!(state.allow_launch().is_err());
        assert!(!preparing.is_finished());
        cancel.cancel();
        finished.notify_one();
        preparing.await.unwrap().unwrap();
        state.finish_update_attempt();
        assert!(state.allow_launch().is_ok());
        assert!(state.active_work_ids().await.is_empty());
    }
    #[test]
    fn copied_disabled_service_stays_disabled_and_existing_permission_cannot_be_changed_by_saving()
    {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::isolated(dir.path().join("config.json"));
        let mut draft = service("");
        draft.execution_enabled = false;
        let original = save_profile(&state, draft).unwrap().services[0].clone();
        let mut copy = original.clone();
        copy.id.clear();
        copy.revision.clear();
        copy.rule_ids.clear();
        let saved = save_profile(&state, copy).unwrap();
        assert_eq!(saved.services.len(), 2);
        assert!(saved
            .services
            .iter()
            .all(|service| !service.execution_enabled));
        let mut edited = original;
        edited.execution_enabled = true;
        assert!(save_profile(&state, edited)
            .unwrap()
            .services
            .iter()
            .all(|service| !service.execution_enabled));
    }
    #[test]
    fn execution_permission_requires_current_review_and_survives_reload_without_save_bypass() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let state = AppState::isolated(path.clone());
        state
            .upsert_host(Host {
                name: "isolated".into(),
                port: 22,
                address: "127.0.0.1".into(),
                user: "tester".into(),
                ..Default::default()
            })
            .unwrap();
        let h = state.snapshot().hosts[0].id.clone();
        let saved = save_profile(&state, service(&h)).unwrap().services[0].clone();
        // Legacy services keep permission. Import paths explicitly revoke it.
        let mut legacy = serde_json::to_value(&saved).unwrap();
        legacy.as_object_mut().unwrap().remove("executionEnabled");
        assert!(
            serde_json::from_value::<Service>(legacy.clone())
                .unwrap()
                .execution_enabled
        );
        let mut old: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        old["services"][0] = legacy;
        let bytes = serde_json::to_vec_pretty(&old).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        set_execution(&state, &saved.id, &saved.revision, false, false).unwrap();
        assert_eq!(
            std::fs::read(path.with_extension("pre-service-sharing.json")).unwrap(),
            bytes
        );
        let disabled = state.snapshot().services[0].clone();
        assert_eq!(disabled.require_execution().unwrap_err(), "serviceDisabled");
        assert!(!AppState::isolated(path.clone()).snapshot().services[0].execution_enabled);
        let mut forged = disabled.clone();
        forged.execution_enabled = true;
        let updated = save_profile(&state, forged).unwrap().services[0].clone();
        assert!(!updated.execution_enabled);
        assert_eq!(
            set_execution(&state, &updated.id, &updated.revision, true, false).unwrap_err(),
            "confirmationRequired"
        );
        assert_eq!(
            set_execution(&state, &updated.id, &disabled.revision, true, true).unwrap_err(),
            "staleAction"
        );
        let before = std::fs::read(&path).unwrap();
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        assert!(set_execution(&state, &updated.id, &updated.revision, true, true).is_err());
        assert!(!state.snapshot().services[0].execution_enabled);
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        set_execution(&state, &updated.id, &updated.revision, true, true).unwrap();
        assert!(state.snapshot().services[0].require_execution().is_ok());
        assert!(AppState::isolated(path).snapshot().services[0].execution_enabled);
        assert!(state.commands.list().is_empty());
        assert!(state.terminals.list().is_empty());
        assert!(state.command_workers.try_lock().unwrap().is_empty());
        assert!(state.terminal_workers.try_lock().unwrap().is_empty());
    }
    #[test]
    fn service_import_is_atomic_disabled_and_never_launches_or_changes_existing_permission() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::isolated(dir.path().join("connections.json"));
        state
            .upsert_host(Host {
                name: "loopback".into(),
                port: 22,
                address: "127.0.0.1".into(),
                user: "tester".into(),
                ..Default::default()
            })
            .unwrap();
        let h = state.snapshot().hosts[0].id.clone();
        let saved = save_profile(&state, service(&h)).unwrap().services[0].clone();
        let value = crate::config_export::package_with_services(
            &state.snapshot(),
            &[],
            std::slice::from_ref(&saved.id),
            false,
        )
        .unwrap();
        let preview = state
            .stage_import(&serde_json::to_vec(&value).unwrap(), "test.json".into())
            .unwrap();
        let choices = crate::config_import::Choices {
            service_ids: vec![saved.id.clone()],
            ..Default::default()
        };
        std::fs::create_dir(state.path.with_extension("tmp")).unwrap();
        assert!(state.apply_import(&preview.token, &choices).is_err());
        assert_eq!(state.snapshot().services.len(), 1);
        std::fs::remove_dir(state.path.with_extension("tmp")).unwrap();
        state.apply_import(&preview.token, &choices).unwrap();
        let snapshot = state.snapshot();
        assert_eq!(snapshot.services.len(), 2);
        assert!(snapshot.services[0].execution_enabled);
        assert!(!snapshot.services[1].execution_enabled);
        assert!(state.apply_import(&preview.token, &choices).is_err());
        assert!(state.commands.list().is_empty());
        assert!(state.terminals.list().is_empty());
        assert!(state.workers.try_lock().unwrap().is_empty());
        assert!(state.command_workers.try_lock().unwrap().is_empty());
        let restored = AppState::isolated(state.path.clone());
        assert!(!restored.snapshot().services[1].execution_enabled);
    }
}
