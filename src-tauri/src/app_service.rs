//! Service operations share the command task registry, credentials and update/exit gate.
use super::*;
use crate::{
    commands::{self, Run},
    service_control::{self as control, Observation, Operation},
};
use std::time::Duration;
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    pub service_id: String,
    pub revision: String,
    pub request_id: String,
    pub operation: Operation,
    #[serde(default)]
    pub action_id: Option<String>,
    #[serde(default)]
    pub rule_id: Option<String>,
    pub confirmed: bool,
    #[serde(default)]
    pub secrets: BTreeMap<String, String>,
    #[serde(default)]
    pub remember_host_ids: Vec<String>,
}
#[tauri::command]
pub async fn run_service_operation(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Start,
) -> Result<Run, String> {
    command_api::local(&window)?;
    start(state.inner().clone(), app, request).await
}
#[tauri::command]
pub fn service_observations(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
) -> Result<Vec<Observation>, String> {
    command_api::local(&window)?;
    Ok(observations(&state))
}
fn route(snapshot: &Snapshot, id: &str) -> Result<Vec<Host>, String> {
    let host = snapshot
        .hosts
        .iter()
        .find(|h| h.id == id)
        .ok_or("hostMissing")?;
    let mut route = resolve_jumps(&snapshot.hosts, host)?;
    route.push(host.clone());
    Ok(route)
}
fn observations(state: &AppState) -> Vec<Observation> {
    let s = state.snapshot();
    s.services
        .iter()
        .flat_map(|service| {
            let rules: Vec<_> = s
                .rules
                .iter()
                .filter(|r| service.rule_ids.contains(&r.id))
                .collect();
            let targets: Vec<_> = if rules.is_empty() {
                vec![(None, "")]
            } else {
                rules
                    .iter()
                    .map(|r| (Some(r.id.clone()), r.host_id.as_str()))
                    .collect()
            };
            targets
                .into_iter()
                .map(|(rule_id, host)| {
                    let identity = route(&s, host)
                        .map(|r| control::identity(&r))
                        .unwrap_or_default();
                    let mut o = state.observations.view(service, &identity, timestamp());
                    o.rule_id = rule_id;
                    o
                })
                .collect::<Vec<_>>()
        })
        .collect()
}
fn publish(state: &AppState, app: &tauri::AppHandle) {
    let _ = app.emit("command://runs", state.commands.list());
    let _ = app.emit("service://observations", observations(state));
    crate::desktop::update_service_tray(app);
}
pub(super) async fn start(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    request: Start,
) -> Result<Run, String> {
    let _launch = state.workers.lock().await;
    state.allow_launch()?;
    if uuid::Uuid::parse_str(&request.request_id).is_err()
        || request.secrets.len() > 32
        || request.secrets.values().any(|s| s.len() > 65536)
    {
        return Err("invalidAction".into());
    }
    let snapshot = state.snapshot();
    let service = snapshot
        .services
        .iter()
        .find(|s| s.id == request.service_id)
        .ok_or("serviceMissing")?
        .clone();
    service.validate()?;
    service.require_execution()?;
    if service.revision != request.revision {
        return Err("staleAction".into());
    }
    let target_rule = service
        .target_rule(&snapshot, request.rule_id.as_deref())?
        .cloned();
    let operation_key = match request.operation {
        Operation::Action => request.action_id.clone().ok_or("actionMissing")?,
        Operation::CheckStatus => "$status".into(),
        Operation::CheckHealth => "$health".into(),
        Operation::Connect => format!(
            "$connect:{}",
            request.rule_id.as_deref().ok_or("ruleMissing")?
        ),
    };
    if let Some(run) = state.commands.existing(
        &request.request_id,
        &service.id,
        &operation_key,
        &service.revision,
    )? {
        if run.workflow_rule_id.as_deref() != target_rule.as_ref().map(|r| r.id.as_str()) {
            return Err("staleAction".into());
        }
        return Ok(run);
    }
    if state.terminals.busy(&service.id) {
        return Err("serviceBusy".into());
    }
    let action = if request.operation == Operation::Action {
        let a = service
            .actions
            .iter()
            .find(|a| Some(&a.id) == request.action_id.as_ref())
            .ok_or("actionMissing")?
            .clone();
        if a.mode == commands::ExecutionMode::Terminal {
            return Err("terminalRequired".into());
        }
        if a.confirm && !request.confirmed {
            return Err("confirmationRequired".into());
        }
        Some(a)
    } else {
        None
    };
    if request.operation != Operation::Action && request.action_id.is_some() {
        return Err("invalidAction".into());
    }
    if request.operation == Operation::Connect && !request.confirmed {
        return Err("confirmationRequired".into());
    }
    if request.operation == Operation::CheckStatus && service.control.status_probe.is_none() {
        return Err("statusProbeMissing".into());
    }
    if request.operation == Operation::CheckHealth && service.control.health_probe.is_none() {
        return Err("healthProbeMissing".into());
    }
    let target_host = target_rule
        .as_ref()
        .map(|r| r.host_id.as_str())
        .ok_or("serviceUnbound")?;
    let mut frozen = route(&snapshot, target_host)?;
    let identity = control::identity(&frozen);
    let host = frozen.last().unwrap().clone();
    if frozen.iter().any(|h| !h.diagnostics.is_empty()) {
        return Err("hostBlocked".into());
    }
    if frozen.iter().any(|h| {
        h.unsupported_session_options
            .iter()
            .any(|o| o != "SendEnv" || !service.no_local_environment)
    }) {
        return Err("sessionOptions".into());
    }
    let forward_rule = if request.operation == Operation::Connect {
        let r = snapshot
            .rules
            .iter()
            .find(|r| Some(&r.id) == request.rule_id.as_ref() && service.rule_ids.contains(&r.id))
            .ok_or("ruleMissing")?
            .clone();
        if !r.no_remote_command {
            return Err("forwardRemoteCommand".into());
        }
        if service
            .control
            .status_probe
            .as_ref()
            .is_some_and(|p| p.mode == "output")
        {
            return Err("statusUnknown".into());
        }
        if service.control.start_action_id.is_none() {
            return Err("startActionMissing".into());
        }
        let target_route = route(&snapshot, &r.host_id)?;
        if target_route.iter().any(|h| !h.diagnostics.is_empty()) {
            return Err("hostBlocked".into());
        }
        frozen.extend(target_route);
        Some(r)
    } else {
        None
    };
    let id = format!("command:{}", uuid::Uuid::new_v4());
    let run = Run {
        id: id.clone(),
        request_id: request.request_id,
        service_id: service.id.clone(),
        action_id: operation_key,
        service_revision: service.revision.clone(),
        host_id: host.id.clone(),
        host_name: host.name.clone(),
        endpoint: format!("{}@{}:{}", host.user, host.address, host.port),
        action_label: action.as_ref().map(|a| a.label.clone()).unwrap_or_else(|| {
            match request.operation {
                Operation::CheckStatus => "$checkStatus",
                Operation::CheckHealth => "$checkHealth",
                _ => "$connect",
            }
            .into()
        }),
        phase: "connecting".into(),
        submitted: false,
        exit_code: None,
        exit_signal: None,
        error: None,
        started_at: timestamp(),
        finished_at: None,
        fingerprint: None,
        verification_endpoint: None,
        revision: 1,
        truncated: false,
        output_bytes: 0,
        discarded_bytes: 0,
        route_host_ids: frozen.iter().map(|h| h.id.clone()).collect(),
        steps: vec![],
        workflow_rule_id: target_rule.as_ref().map(|r| r.id.clone()),
        workflow_forward_created: false,
        workflow_forward_run_id: None,
    };
    let active_manager = state.commands.clone();
    let active_id = id.clone();
    let active: sessions::Active = Arc::new(move || {
        active_manager
            .list()
            .iter()
            .any(|r| r.id == active_id && r.active())
    });
    let (hops, observer) = sessions::credentials(
        state.clone(),
        app.clone(),
        &route(&snapshot, &host.id)?,
        &request.secrets,
        &request.remember_host_ids,
        active.clone(),
    )?;
    let (run, cancel, created) = state.commands.register(run)?;
    if !created {
        return Ok(run);
    }
    let changed_state = state.clone();
    let changed_app = app.clone();
    let changed: control::Changed = Arc::new(move || publish(&changed_state, &changed_app));
    let manager = state.commands.clone();
    let job = id.clone();
    let event = changed.clone();
    let notify: tunnel::Notify = Arc::new(move |r| {
        manager.change(&job, |run| {
            run.phase = r.status;
            run.fingerprint = None;
            run.verification_endpoint = None;
        });
        event();
    });
    let manager = state.commands.clone();
    let job = id.clone();
    let event = changed.clone();
    let prompt = sessions::prompt(
        state.clone(),
        id.clone(),
        active,
        Arc::new(move |endpoint, fingerprint| {
            manager.change(&job, |r| {
                r.phase = "verifying-host".into();
                r.fingerprint = Some(fingerprint);
                r.verification_endpoint = Some(endpoint);
            });
            event();
        }),
    );
    let check_state = state.clone();
    let revision = service.revision.clone();
    let service_id = service.id.clone();
    let rule = target_rule.clone();
    let validate: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(move || {
        let now = check_state.snapshot();
        check_state.allow_launch().is_ok()
            && now
                .services
                .iter()
                .any(|s| s.id == service_id && s.revision == revision)
            && frozen.iter().all(|before| {
                now.hosts.iter().any(|after| {
                    after.id == before.id
                        && after.diagnostics.is_empty()
                        && after.same_connection(before)
                })
            })
            && rule.as_ref().is_none_or(|r| {
                now.rules
                    .iter()
                    .any(|saved| saved.id == r.id && saved.same_connection(r))
            })
    });
    let forward = forward_rule.map(|rule| {
        let context = ForwardContext {
            expected_route: route(&snapshot, &rule.host_id).unwrap(),
            rule,
            values: request
                .secrets
                .into_iter()
                .map(|(id, s)| (id, s.into()))
                .collect(),
            remember: request.remember_host_ids.into_iter().collect(),
            job: id.clone(),
            validate: validate.clone(),
            changed: changed.clone(),
        };
        let state = state.clone();
        let app = app.clone();
        Arc::new(move |cancel: CancellationToken| {
            Box::pin(connect_forward(
                state.clone(),
                app.clone(),
                context.clone(),
                cancel,
            ))
                as std::pin::Pin<
                    Box<
                        dyn std::future::Future<Output = Result<control::ForwardResult, String>>
                            + Send,
                    >,
                >
        }) as control::Forward
    });
    let task_state = state.clone();
    let job = id.clone();
    let join = tokio::spawn(async move {
        control::execute(
            task_state.commands.clone(),
            task_state.observations.clone(),
            job.clone(),
            cancel,
            control::Request {
                service,
                action,
                operation: request.operation,
                hops,
                notify,
                prompt,
                observer: Some(observer),
                validate,
                changed,
                identity,
                forward,
            },
        )
        .await;
        task_state.trust.lock().unwrap().remove(&job);
    });
    let mut workers = state.command_workers.lock().await;
    workers.retain(|_, job| !job.is_finished());
    workers.insert(id, join);
    publish(&state, &app);
    Ok(run)
}

#[derive(Clone)]
struct ForwardContext {
    rule: Rule,
    expected_route: Vec<Host>,
    values: BTreeMap<String, tunnel::Secret>,
    remember: BTreeSet<String>,
    job: String,
    validate: Arc<dyn Fn() -> bool + Send + Sync>,
    changed: control::Changed,
}
fn runtime_route_matches(expected: &[Host], runtime: &Runtime) -> bool {
    let actual: Vec<_> = runtime
        .jump_snapshots
        .iter()
        .chain(runtime.host_snapshot.iter())
        .collect();
    !actual.is_empty()
        && actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(a, b)| a.id == b.id && a.same_connection(b))
}
async fn connect_forward(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    context: ForwardContext,
    cancel: CancellationToken,
) -> Result<control::ForwardResult, String> {
    let ForwardContext {
        rule,
        expected_route,
        values,
        remember,
        job,
        validate,
        changed,
    } = context;
    if cancel.is_cancelled() || !validate() {
        return Err("staleAction".into());
    }
    let launch = launch_impl(
        state.clone(),
        app,
        rule.clone(),
        false,
        true,
        LoginCredentials {
            secret: values.get(&rule.host_id).cloned().unwrap_or_default(),
            jumps: values,
            remember,
        },
        Some(expected_route.clone()),
    )
    .await;
    let created = match launch {
        Ok(()) => true,
        Err(e) if e == "forwardAlreadyActive" => false,
        Err(e) if e == "forwardChanged" => return Err(e),
        Err(_) => return Err("forwardFailed".into()),
    };
    let run_id = state
        .generations
        .lock()
        .unwrap()
        .get(&rule.id)
        .cloned()
        .or_else(|| {
            state
                .runtimes
                .lock()
                .unwrap()
                .get(&rule.id)
                .map(|r| r.run_id.clone())
        })
        .ok_or("forwardFailed")?;
    state.commands.change(&job, |r| {
        r.workflow_forward_created = created;
        r.workflow_forward_run_id = Some(run_id.clone());
    });
    changed();
    let mut budget = Duration::from_secs(60);
    let mut last = tokio::time::Instant::now();
    loop {
        if cancel.is_cancelled() {
            return Err("remoteUnknown".into());
        }
        if !validate() {
            return Err("staleAction".into());
        }
        let runtime = state.runtimes.lock().unwrap().get(&rule.id).cloned();
        if let Some(r) = runtime {
            if r.run_id != run_id {
                return Err("forwardChanged".into());
            }
            match r.status.as_str() {
                "listening" => {
                    if !runtime_route_matches(&expected_route, &r) {
                        return Err("forwardChanged".into());
                    }
                    return Ok(control::ForwardResult { created, run_id });
                }
                "failed" | "needs-attention" | "stopped" => return Err("forwardFailed".into()),
                _ => {}
            }
            if r.status != "verifying-host" {
                budget = budget.saturating_sub(last.elapsed());
            }
        } else {
            budget = budget.saturating_sub(last.elapsed());
        }
        last = tokio::time::Instant::now();
        if budget.is_zero() {
            return Err("forwardTimeout".into());
        }
        tokio::select! {biased;_=cancel.cancelled()=>return Err("remoteUnknown".into()),_=tokio::time::sleep(Duration::from_millis(50))=>{}}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(id: &str, service: &str, rule: &str) -> Run {
        serde_json::from_value(serde_json::json!({"id":id,"requestId":id,"serviceId":service,"actionId":"$connect","serviceRevision":"v1","hostId":"target","routeHostIds":["retired-jump","target"],"hostName":"isolated","endpoint":"loopback","actionLabel":"test","phase":"checking-health","submitted":true,"exitCode":null,"exitSignal":null,"error":null,"startedAt":timestamp(),"finishedAt":null,"fingerprint":null,"verificationEndpoint":null,"revision":1,"truncated":false,"workflowRuleId":rule})).unwrap()
    }
    #[test]
    fn cancelling_a_forward_cancels_only_its_combination_and_protects_frozen_hosts() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::isolated(dir.path().join("connections.json"));
        let (_, a, _) = state
            .commands
            .register(run("a", "service-a", "rule-a"))
            .unwrap();
        let (_, b, _) = state
            .commands
            .register(run("b", "service-b", "rule-b"))
            .unwrap();
        state.commands.cancel_for_rule("rule-a");
        assert!(a.is_cancelled());
        assert!(!b.is_cancelled());
        assert_eq!(
            state.remove_host("retired-jump", &[]).unwrap_err(),
            "hostUsedByService"
        );
        assert!(state
            .commands
            .existing("a", "service-a", "$connect", "v1")
            .unwrap()
            .is_some());
        assert!(state
            .commands
            .existing("a", "service-a", "$other", "v1")
            .is_err());
    }
    #[test]
    fn historical_result_cannot_stop_a_later_forward_generation() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::isolated(dir.path().join("connections.json"));
        state
            .commands
            .register(run("history", "service", "rule"))
            .unwrap();
        state.commands.change("history", |r| {
            r.workflow_forward_created = true;
            r.workflow_forward_run_id = Some("old-generation".into());
        });
        state
            .generations
            .lock()
            .unwrap()
            .insert("rule".into(), "old-generation".into());
        assert_eq!(created_forward_target(&state, "history").unwrap(), "rule");
        state
            .generations
            .lock()
            .unwrap()
            .insert("rule".into(), "new-generation".into());
        assert_eq!(
            created_forward_target(&state, "history").unwrap_err(),
            "forwardChanged"
        );
        state
            .commands
            .change("history", |r| r.workflow_forward_created = false);
        assert!(created_forward_target(&state, "history").is_err());
    }
    #[test]
    fn existing_forward_must_match_actual_target_and_jump_identities_before_reuse() {
        let target = Host {
            id: "target".into(),
            address: "127.0.0.1".into(),
            ..Default::default()
        };
        let jump = Host {
            id: "jump".into(),
            address: "::1".into(),
            ..Default::default()
        };
        let runtime = Runtime {
            host_snapshot: Some(target.clone()),
            jump_snapshots: vec![jump.clone()],
            ..Default::default()
        };
        assert!(runtime_route_matches(
            &[jump.clone(), target.clone()],
            &runtime
        ));
        let mut changed = target.clone();
        changed.address = "other".into();
        assert!(!runtime_route_matches(&[jump.clone(), changed], &runtime));
        let mut changed = jump;
        changed.user = "other".into();
        assert!(!runtime_route_matches(&[changed, target], &runtime));
        assert!(!runtime_route_matches(&[], &Runtime::default()));
    }
    #[test]
    fn old_service_profiles_default_safely_and_are_backed_up_before_new_fields_are_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let mut config = Config::default();
        let service:commands::Service=serde_json::from_value(serde_json::json!({"id":"service","name":"legacy","executionHostId":"host","ruleIds":[],"revision":"v1","noLocalEnvironment":true,"actions":[{"id":"start","kind":"start","label":"start","command":"SCRIPT_CANARY","timeoutSecs":60,"successCodes":[0],"confirm":false}]})).unwrap();
        config.services.push(service);
        let mut old = serde_json::to_value(&config).unwrap();
        old["services"][0]
            .as_object_mut()
            .unwrap()
            .remove("control");
        let original = serde_json::to_vec(&old).unwrap();
        std::fs::write(&path, &original).unwrap();
        let state = AppState::isolated(path.clone());
        let config = state.config.lock().unwrap().clone();
        assert!(config.services[0].control.status_probe.is_none());
        assert_eq!(config.services[0].control.ttl_secs, 60);
        state.persist(&config).unwrap();
        assert_eq!(
            std::fs::read(path.with_extension("pre-service-checks.json")).unwrap(),
            original
        );
        let saved = std::fs::read(&path).unwrap();
        assert!(String::from_utf8_lossy(&saved).contains("SCRIPT_CANARY"));
        assert!(state.commands.list().is_empty());
        assert!(observations(&state)[0].status.checked_at.is_none());
        state.persist(&config).unwrap();
        assert_eq!(
            std::fs::read(path.with_extension("pre-service-checks.json")).unwrap(),
            original
        );
    }
}

// A historical result may stop only the connection generation it actually created.
fn created_forward_target(state: &AppState, run_id: &str) -> Result<String, String> {
    let run = state
        .commands
        .list()
        .into_iter()
        .find(|r| r.id == run_id && r.workflow_forward_created)
        .ok_or("forwardChanged")?;
    let rule = run.workflow_rule_id.ok_or("forwardChanged")?;
    let expected = run.workflow_forward_run_id.ok_or("forwardChanged")?;
    if state.generations.lock().unwrap().get(&rule) != Some(&expected) {
        return Err("forwardChanged".into());
    }
    Ok(rule)
}
#[tauri::command]
pub async fn stop_service_forward(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    run_id: String,
) -> Result<(), String> {
    command_api::local(&window)?;
    let mut workers = state.workers.lock().await;
    let id = created_forward_target(&state, &run_id)?;
    state.commands.cancel_for_rule(&id);
    if let Some(worker) = workers.remove(&id) {
        worker.cancel.cancel();
        worker.join.await.map_err(|_| "cleanup")?;
    }
    state.trust.lock().unwrap().remove(&id);
    state.settle_stopped(&[id]);
    state.publish(&app);
    Ok(())
}
