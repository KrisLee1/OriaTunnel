use super::*;
use crate::terminal::{self, Frame, Session};
use tauri::ipc::Channel;
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Open {
    host_id: String,
    #[serde(default)]
    rule_id: Option<String>,
    request_id: String,
    client_id: String,
    cols: u32,
    rows: u32,
    #[serde(default)]
    no_local_environment: bool,
    #[serde(default)]
    service_id: Option<String>,
    #[serde(default)]
    action_id: Option<String>,
    #[serde(default)]
    revision: Option<String>,
    #[serde(default)]
    confirmed: bool,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
    #[serde(default)]
    remember_host_ids: Vec<String>,
}
#[tauri::command]
pub fn terminal_sessions(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
) -> Result<Vec<Session>, String> {
    command_api::local(&window)?;
    Ok(state.terminals.list())
}
#[tauri::command]
pub async fn open_terminal(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Open,
) -> Result<Session, String> {
    command_api::local(&window)?;
    launch(state.inner().clone(), app, request).await
}
async fn launch(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    request: Open,
) -> Result<Session, String> {
    let _launch = state.workers.lock().await;
    state.allow_launch()?;
    terminal::dimensions(request.cols, request.rows)?;
    if uuid::Uuid::parse_str(&request.request_id).is_err()
        || uuid::Uuid::parse_str(&request.client_id).is_err()
        || request.secrets.len() > 32
        || request.secrets.values().any(|s| s.len() > 65536)
    {
        return Err("invalidSession".into());
    }
    if let Some(session) = state.terminals.existing(
        &request.request_id,
        &request.client_id,
        &request.host_id,
        &request.service_id,
        &request.action_id,
    )? {
        return Ok(session);
    }
    let snapshot = state.snapshot();
    let host = snapshot
        .hosts
        .iter()
        .find(|h| h.id == request.host_id)
        .ok_or("hostMissing")?
        .clone();
    if !host.diagnostics.is_empty() {
        return Err("hostBlocked".into());
    }
    let profile = if let Some(id) = &request.service_id {
        let service = snapshot
            .services
            .iter()
            .find(|s| &s.id == id)
            .ok_or("serviceMissing")?
            .clone();
        service.validate()?;
        service.require_execution()?;
        let (_, target) = service.execution_target(
            &snapshot,
            request.rule_id.as_deref(),
            Some(&request.host_id),
        )?;
        if target.id != host.id || Some(&service.revision) != request.revision.as_ref() {
            return Err("staleAction".into());
        }
        let action = service
            .actions
            .iter()
            .find(|a| Some(&a.id) == request.action_id.as_ref())
            .ok_or("actionMissing")?
            .clone();
        if action.mode != crate::commands::ExecutionMode::Terminal {
            return Err("terminalRequired".into());
        }
        if action.confirm && !request.confirmed {
            return Err("confirmationRequired".into());
        }
        if state
            .commands
            .list()
            .iter()
            .any(|r| r.service_id == service.id && r.active())
            || state.terminals.busy(&service.id)
        {
            return Err("serviceBusy".into());
        }
        Some((service, action))
    } else {
        if request.action_id.is_some() || request.revision.is_some() {
            return Err("invalidSession".into());
        }
        None
    };
    let no_env = profile
        .as_ref()
        .map(|(s, _)| s.no_local_environment)
        .unwrap_or(request.no_local_environment);
    if host
        .unsupported_session_options
        .iter()
        .any(|o| o != "SendEnv" || !no_env)
    {
        return Err("sessionOptions".into());
    }
    let mut route = resolve_jumps(&snapshot.hosts, &host)?;
    route.push(host.clone());
    let frozen = route.clone();
    let id = format!("terminal:{}", uuid::Uuid::new_v4());
    let active_manager = state.terminals.clone();
    let active_id = id.clone();
    let active: sessions::Active = Arc::new(move || {
        active_manager
            .list()
            .iter()
            .any(|s| s.id == active_id && s.active())
    });
    let (hops, observer) = sessions::credentials(
        state.clone(),
        app.clone(),
        &route,
        &request.secrets,
        &request.remember_host_ids,
        active.clone(),
    )?;
    let summary = Session {
        rule_id: profile
            .as_ref()
            .map(|(s, _)| {
                s.execution_target(
                    &snapshot,
                    request.rule_id.as_deref(),
                    Some(&request.host_id),
                )
                .map(|(r, _)| r.map(|r| r.id.clone()))
            })
            .transpose()?
            .flatten(),
        id: id.clone(),
        request_id: request.request_id,
        client_id: request.client_id,
        host_id: host.id.clone(),
        route_host_ids: route.iter().map(|h| h.id.clone()).collect(),
        host_name: host.name.clone(),
        endpoint: format!("{}@{}:{}", host.user, host.address, host.port),
        service_id: profile.as_ref().map(|(s, _)| s.id.clone()),
        action_id: profile.as_ref().map(|(_, a)| a.id.clone()),
        label: profile
            .as_ref()
            .map(|(s, a)| format!("{} · {}", s.name, a.label))
            .unwrap_or(host.name.clone()),
        phase: "connecting".into(),
        revision: 1,
        started_at: timestamp(),
        finished_at: None,
        submitted: false,
        exit_code: None,
        exit_signal: None,
        error: None,
        fingerprint: None,
        verification_endpoint: None,
        cols: request.cols,
        rows: request.rows,
    };
    let (summary, cancel, input) = state.terminals.register(summary)?;
    let Some(input) = input else {
        return Ok(summary);
    };
    let changed_state = state.clone();
    let changed_app = app.clone();
    let changed: terminal::Changed = Arc::new(move || {
        let _ = changed_app.emit("terminal://sessions", changed_state.terminals.list());
        crate::desktop::update_service_tray(&changed_app);
    });
    let manager = state.terminals.clone();
    let job = id.clone();
    let status_changed = changed.clone();
    let notify: tunnel::Notify = Arc::new(move |r| {
        manager.change(&job, |s| {
            s.phase = r.status;
            s.fingerprint = None;
            s.verification_endpoint = None;
        });
        status_changed();
    });
    let trust_manager = state.terminals.clone();
    let job = id.clone();
    let trust_changed = changed.clone();
    let prompt = sessions::prompt(
        state.clone(),
        id.clone(),
        active,
        Arc::new(move |endpoint, fingerprint| {
            trust_manager.change(&job, |s| {
                s.phase = "verifying-host".into();
                s.fingerprint = Some(fingerprint);
                s.verification_endpoint = Some(endpoint);
            });
            trust_changed();
        }),
    );
    let frozen_rule = profile
        .as_ref()
        .map(|(s, _)| {
            s.execution_target(
                &snapshot,
                request.rule_id.as_deref(),
                Some(&request.host_id),
            )
            .map(|(r, _)| r.cloned())
        })
        .transpose()?
        .flatten();
    let check_state = state.clone();
    let service_version = profile
        .as_ref()
        .map(|(s, _)| (s.id.clone(), s.revision.clone()));
    let validate = Arc::new(move || {
        let current = check_state.snapshot();
        frozen.iter().all(|before| {
            current.hosts.iter().any(|after| {
                after.id == before.id
                    && after.diagnostics.is_empty()
                    && before.same_connection(after)
            })
        }) && frozen_rule.as_ref().is_none_or(|r| {
            current
                .rules
                .iter()
                .any(|saved| saved.id == r.id && saved.same_connection(r))
        }) && service_version.as_ref().is_none_or(|(id, revision)| {
            current
                .services
                .iter()
                .any(|s| &s.id == id && &s.revision == revision)
        })
    });
    if let Some((service, action)) = &profile {
        if ["start", "stop", "restart", "custom"].contains(&action.kind.as_str()) {
            state
                .observations
                .invalidate(service, &crate::service_control::identity(&route));
        }
    }
    let request = terminal::Request {
        hops,
        command: profile.as_ref().map(|(_, a)| a.command.clone()),
        timeout_secs: profile.as_ref().map(|(_, a)| a.timeout_secs),
        success_codes: profile
            .as_ref()
            .map(|(_, a)| a.success_codes.clone())
            .unwrap_or(vec![0]),
        notify,
        prompt,
        observer: Some(observer),
        validate,
        changed,
    };
    let job = id.clone();
    let task_state = state.clone();
    let join = tokio::spawn(async move {
        terminal::execute(
            task_state.terminals.clone(),
            job.clone(),
            cancel,
            input,
            request,
        )
        .await;
        task_state.trust.lock().unwrap().remove(&job);
    });
    let mut workers = state.terminal_workers.lock().await;
    workers.retain(|_, job| !job.is_finished());
    workers.insert(id, join);
    let _ = app.emit("terminal://sessions", state.terminals.list());
    crate::desktop::update_service_tray(&app);
    Ok(summary)
}
#[tauri::command]
pub fn attach_terminal(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    client_id: String,
    on_event: Channel<Frame>,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.terminals.attach(&id, &client_id, on_event)
}
#[tauri::command]
pub fn ack_terminal(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    client_id: String,
    sequence: u64,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.terminals.ack(&id, &client_id, sequence)
}
#[tauri::command]
pub fn terminal_input(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    client_id: String,
    sequence: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.terminals.input(&id, &client_id, sequence, bytes)
}
#[tauri::command]
pub fn resize_terminal(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    client_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.terminals.resize(&id, &client_id, cols, rows)
}
#[tauri::command]
pub async fn close_terminal(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    client_id: String,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.terminals.cancel(&id, &client_id)?;
    if let Some(job) = state.terminal_workers.lock().await.remove(&id) {
        job.await.map_err(|_| "cleanup")?;
    }
    Ok(())
}
#[tauri::command]
pub fn detach_terminal(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    client_id: String,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.terminals.detach(&id, &client_id)
}
#[tauri::command]
pub fn forget_terminal(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    client_id: String,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.terminals.forget(&id, &client_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn terminal_jobs_participate_in_update_cleanup_and_reload_cancels_without_replay() {
        let directory = tempfile::tempdir().unwrap();
        let state = Arc::new(AppState::isolated(
            directory.path().join("connections.json"),
        ));
        let session:Session=serde_json::from_value(serde_json::json!({"id":"terminal:test","requestId":"request","clientId":"client","hostId":"host","routeHostIds":["host","jump"],"hostName":"test","endpoint":"loopback","serviceId":null,"actionId":null,"label":"test","phase":"running","revision":1,"startedAt":1,"finishedAt":null,"submitted":true,"exitCode":null,"exitSignal":null,"error":null,"fingerprint":null,"verificationEndpoint":null,"cols":80,"rows":24})).unwrap();
        let (_, cancel, _) = state.terminals.register(session).unwrap();
        let worker_cancel = cancel.clone();
        let manager = state.terminals.clone();
        let release = Arc::new(tokio::sync::Notify::new());
        let worker_release = release.clone();
        state.terminal_workers.lock().await.insert(
            "terminal:test".into(),
            tokio::spawn(async move {
                worker_cancel.cancelled().await;
                worker_release.notified().await;
                manager.finish("terminal:test", "interrupted", Some("remoteUnknown".into()));
            }),
        );
        assert_eq!(state.active_work_ids().await, vec!["terminal:test"]);
        state.interrupt_terminals();
        cancel.cancelled().await;
        let preparing = {
            let state = state.clone();
            tokio::spawn(async move { state.prepare_update(&["terminal:test".into()]).await })
        };
        while !state.update_installing() {
            tokio::task::yield_now().await;
        }
        assert!(state.allow_launch().is_err());
        assert!(!preparing.is_finished());
        release.notify_one();
        preparing.await.unwrap().unwrap();
        state.stop_all().await;
        state.finish_update_attempt();
        assert!(state.active_work_ids().await.is_empty());
        assert!(state.allow_launch().is_ok());
        assert_eq!(state.terminals.list()[0].phase, "interrupted");
        assert!(state.commands.list().is_empty());
        assert!(!state.path.exists());
    }
}
