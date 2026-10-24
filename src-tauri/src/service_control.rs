//! Finite service operations. Only explicitly repeatable read-only probes may repeat.
use crate::{
    commands::{Action, ExecutionMode, Manager as Commands},
    model::{timestamp, FailureKind, Runtime},
    tunnel,
};
use russh::{ChannelMsg, Sig};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusProbe {
    pub action_id: String,
    pub mode: String,
    pub running_codes: Vec<u32>,
    pub stopped_codes: Vec<u32>,
    pub failed_codes: Vec<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthProbe {
    pub command: String,
    pub ready_codes: Vec<u32>,
    pub not_ready_codes: Vec<u32>,
    pub repeatable: bool,
    pub timeout_secs: u64,
    pub interval_secs: u64,
    pub budget_secs: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Control {
    pub status_probe: Option<StatusProbe>,
    pub health_probe: Option<HealthProbe>,
    pub start_action_id: Option<String>,
    pub check_after_actions: bool,
    pub ttl_secs: u64,
}
impl Default for Control {
    fn default() -> Self {
        Self {
            status_probe: None,
            health_probe: None,
            start_action_id: None,
            check_after_actions: false,
            ttl_secs: 60,
        }
    }
}
fn codes(groups: &[&[u32]]) -> bool {
    let mut seen = BTreeSet::new();
    groups
        .iter()
        .all(|g| g.len() <= 32 && g.iter().all(|v| seen.insert(*v)))
}
impl Control {
    pub fn validate(&self, actions: &[Action]) -> Result<(), String> {
        if !(1..=3600).contains(&self.ttl_secs) {
            return Err("invalidProbe".into());
        }
        if let Some(p) = &self.status_probe {
            if !["output", "exitCode", "json"].contains(&p.mode.as_str())
                || !actions.iter().any(|a| {
                    a.id == p.action_id
                        && a.kind == "status"
                        && a.mode == ExecutionMode::Command
                        && !a.confirm
                })
                || !codes(&[&p.running_codes, &p.stopped_codes, &p.failed_codes])
                || (p.mode == "exitCode"
                    && (p.running_codes.is_empty() || p.stopped_codes.is_empty()))
            {
                return Err("invalidProbe".into());
            }
        }
        if let Some(p) = &self.health_probe {
            if p.command.trim().is_empty()
                || p.command.len() > 65536
                || p.command.contains('\0')
                || p.ready_codes.is_empty()
                || !codes(&[&p.ready_codes, &p.not_ready_codes])
                || !(1..=30).contains(&p.timeout_secs)
                || !(1..=60).contains(&p.interval_secs)
                || !(1..=600).contains(&p.budget_secs)
            {
                return Err("invalidProbe".into());
            }
        }
        if self.start_action_id.as_ref().is_some_and(|id| {
            !actions
                .iter()
                .any(|a| &a.id == id && a.kind == "start" && a.mode == ExecutionMode::Command)
        }) {
            return Err("invalidProbe".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub kind: String,
    pub phase: String,
    pub attempt: u32,
    pub exit_code: Option<u32>,
    pub error: Option<String>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fact {
    pub value: String,
    pub checked_at: Option<u64>,
    pub valid_until: Option<u64>,
    pub source_run_id: Option<String>,
    pub expired: bool,
}
impl Fact {
    fn empty(value: &str) -> Self {
        Self {
            value: value.into(),
            checked_at: None,
            valid_until: None,
            source_run_id: None,
            expired: false,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    #[serde(default)]
    pub rule_id: Option<String>,
    pub service_id: String,
    pub service_revision: String,
    pub host_identity: String,
    pub status: Fact,
    pub health: Fact,
    pub revision: u64,
}
#[derive(Default)]
pub struct Observations {
    entries: Mutex<BTreeMap<(String, String), Observation>>,
}
impl Observations {
    pub fn view(
        &self,
        service: &crate::commands::Service,
        identity: &str,
        now: u64,
    ) -> Observation {
        let mut o = self
            .entries
            .lock()
            .unwrap()
            .get(&(service.id.clone(), identity.into()))
            .cloned()
            .unwrap_or_else(|| Observation {
                rule_id: None,
                service_id: service.id.clone(),
                service_revision: service.revision.clone(),
                host_identity: identity.into(),
                status: Fact::empty("unknown"),
                health: Fact::empty("unverified"),
                revision: 0,
            });
        let stale = o.service_revision != service.revision || o.host_identity != identity;
        for f in [&mut o.status, &mut o.health] {
            f.expired =
                f.checked_at.is_some() && (stale || f.valid_until.is_some_and(|t| now >= t));
        }
        o
    }
    fn store(&self, key: (String, String), observation: Observation) {
        let mut entries = self.entries.lock().unwrap();
        entries.insert(key, observation);
        while entries.len() > 1024 {
            if let Some(key) = entries.keys().next().cloned() {
                entries.remove(&key);
            }
        }
    }
    pub fn invalidate(&self, s: &crate::commands::Service, identity: &str) {
        let old = self.view(s, identity, timestamp());
        self.store(
            (s.id.clone(), identity.into()),
            Observation {
                rule_id: None,
                service_id: s.id.clone(),
                service_revision: s.revision.clone(),
                host_identity: identity.into(),
                status: Fact::empty("unknown"),
                health: Fact::empty("unverified"),
                revision: old.revision + 1,
            },
        );
    }
    pub fn record(
        &self,
        s: &crate::commands::Service,
        identity: &str,
        run: &str,
        health: bool,
        value: &str,
    ) {
        let mut o = self.view(s, identity, timestamp());
        if o.service_revision != s.revision || o.host_identity != identity {
            self.invalidate(s, identity);
            o = self.view(s, identity, timestamp());
        }
        let at = timestamp();
        let fact = Fact {
            value: value.into(),
            checked_at: Some(at),
            valid_until: Some(at + s.control.ttl_secs * 1000),
            source_run_id: Some(run.into()),
            expired: false,
        };
        if health {
            o.health = fact;
        } else {
            o.status = fact;
            if value != "running" {
                o.health = Fact::empty("unverified");
            }
        }
        o.revision += 1;
        self.store((s.id.clone(), identity.into()), o);
    }
}
pub fn identity(route: &[crate::model::Host]) -> String {
    let route: Vec<_> = route
        .iter()
        .map(|h| {
            (
                &h.id,
                &h.address,
                h.port,
                &h.user,
                &h.identity_files,
                &h.auth_method,
                &h.connection,
                &h.identity_agent,
                h.identities_only,
                &h.proxy_jump,
                &h.algorithms,
                &h.diagnostics,
                &h.unsupported_session_options,
            )
        })
        .collect();
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&route).unwrap_or_default())
    )
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    Action,
    CheckStatus,
    CheckHealth,
    Connect,
}
#[derive(Debug)]
pub struct Outcome {
    pub phase: &'static str,
    pub code: Option<u32>,
    pub signal: Option<String>,
    pub error: Option<String>,
    pub submitted: bool,
    pub stdout: Vec<u8>,
    pub truncated: bool,
}
impl Outcome {
    fn failed(error: &str) -> Self {
        Self {
            phase: "failed",
            code: None,
            signal: None,
            error: Some(error.into()),
            submitted: false,
            stdout: Vec::new(),
            truncated: false,
        }
    }
}
pub type Changed = Arc<dyn Fn() + Send + Sync>;
pub struct ForwardResult {
    pub created: bool,
    pub run_id: String,
}
pub type Forward = Arc<
    dyn Fn(CancellationToken) -> Pin<Box<dyn Future<Output = Result<ForwardResult, String>> + Send>>
        + Send
        + Sync,
>;
pub struct Request {
    pub service: crate::commands::Service,
    pub action: Option<Action>,
    pub operation: Operation,
    pub hops: Vec<tunnel::HopRequest>,
    pub notify: tunnel::Notify,
    pub prompt: tunnel::TrustPrompt,
    pub observer: Option<tunnel::PasswordObserver>,
    pub validate: Arc<dyn Fn() -> bool + Send + Sync>,
    pub changed: Changed,
    pub identity: String,
    pub forward: Option<Forward>,
}
// Capture a bounded complete probe response independently of the display tail.
async fn channel(
    connection: &tunnel::Connection,
    action: &Action,
    cancel: &CancellationToken,
    validate: &Arc<dyn Fn() -> bool + Send + Sync>,
    output: impl Fn(&str, &[u8]),
    submitted: impl Fn(),
) -> Outcome {
    let mut out = Outcome::failed("notExecuted");
    let opened = tokio::select! {biased;_=cancel.cancelled()=>None,r=tokio::time::timeout(Duration::from_secs(15),connection.open_session())=>r.ok().and_then(Result::ok)};
    let Some(mut ch) = opened else {
        if cancel.is_cancelled() {
            out.phase = "cancelled";
        }
        return out;
    };
    let result = async {
        if cancel.is_cancelled() || !validate() {
            return ("cancelled", Some("notExecuted".into()));
        }
        out.submitted = true;
        submitted();
        if ch
            .exec(true, action.command.as_bytes().to_vec())
            .await
            .is_err()
        {
            return ("unknown", Some("remoteUnknown".into()));
        }
        let mut count = 0usize;
        loop {
            match ch.wait().await {
                Some(ChannelMsg::Failure) => return ("failed", Some("execRejected".into())),
                Some(ChannelMsg::Data { data }) => {
                    count = count.saturating_add(data.len());
                    if out.stdout.len() + data.len() <= 65536 {
                        out.stdout.extend_from_slice(&data);
                    } else {
                        out.truncated = true;
                    }
                    output("stdout", &data);
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    count = count.saturating_add(data.len());
                    output("stderr", &data);
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => out.code = Some(exit_status),
                Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                    out.signal = Some(format!("{signal_name:?}"))
                }
                Some(ChannelMsg::Close) | None => {
                    out.truncated |= count > 65536;
                    return if out.signal.is_some() {
                        ("failed", Some("exitSignal".into()))
                    } else if let Some(code) = out.code {
                        if action.success_codes.contains(&code) {
                            ("succeeded", None)
                        } else {
                            ("failed", Some("exitCode".into()))
                        }
                    } else {
                        ("unknown", Some("remoteUnknown".into()))
                    };
                }
                _ => {}
            }
        }
    };
    let result = tokio::select! {biased;_=cancel.cancelled()=>("cancelled",Some("remoteUnknown".into())),r=tokio::time::timeout(Duration::from_secs(action.timeout_secs),result)=>r.unwrap_or(("timedOut",Some("remoteUnknown".into())))};
    if matches!(result.0, "cancelled" | "timedOut") {
        let _ = tokio::time::timeout(Duration::from_millis(500), ch.signal(Sig::TERM)).await;
    }
    let _ = tokio::time::timeout(Duration::from_millis(500), ch.close()).await;
    out.phase = result.0;
    out.error = result.1;
    out
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StatusJson {
    state: String,
    #[serde(default)]
    ready: Option<bool>,
    #[serde(default)]
    message: Option<String>,
}
pub fn status_value(p: &StatusProbe, out: &Outcome) -> Result<String, String> {
    if out.code.is_none()
        || out.signal.is_some()
        || out.truncated
        || !matches!(out.phase, "succeeded" | "failed")
        || out.error.as_deref().is_some_and(|e| e != "exitCode")
    {
        return Err("probeFailed".into());
    }
    let code = out.code.unwrap();
    match p.mode.as_str() {
        "output" => Ok("unknown".into()),
        "exitCode" => Ok(if p.running_codes.contains(&code) {
            "running"
        } else if p.stopped_codes.contains(&code) {
            "stopped"
        } else if p.failed_codes.contains(&code) {
            "failed"
        } else {
            return Err("unmappedStatus".into());
        }
        .into()),
        "json" => {
            if out.phase != "succeeded" {
                return Err("probeFailed".into());
            }
            let value: StatusJson =
                serde_json::from_slice(&out.stdout).map_err(|_| "invalidStatusJson")?;
            let _ = value.ready;
            if value.message.as_ref().is_some_and(|m| m.len() > 1024)
                || !["running", "stopped", "failed", "unknown"].contains(&value.state.as_str())
            {
                return Err("invalidStatusJson".into());
            }
            Ok(value.state)
        }
        _ => Err("invalidProbe".into()),
    }
}
struct Controller<'a> {
    manager: &'a Commands,
    observations: &'a Observations,
    id: &'a str,
    cancel: &'a CancellationToken,
    request: &'a Request,
    connection: &'a tunnel::Connection,
}
impl Controller<'_> {
    async fn step(&self, kind: &str, action: &Action, attempt: u32) -> Outcome {
        self.manager.change(self.id, |r| {
            r.phase = match kind {
                "status" => "checking-status",
                "health" => "checking-health",
                _ => "running",
            }
            .into();
            r.exit_code = None;
            r.exit_signal = None;
            if attempt == 1 {
                r.steps.push(Step {
                    kind: kind.into(),
                    phase: "running".into(),
                    attempt,
                    exit_code: None,
                    error: None,
                    started_at: timestamp(),
                    finished_at: None,
                });
            } else if let Some(s) = r.steps.last_mut() {
                s.attempt = attempt;
                s.phase = "running".into();
                s.error = None;
                s.finished_at = None;
            }
        });
        (self.request.changed)();
        self.manager
            .output(self.id, "stdout", format!("\n[{kind}]\n").as_bytes());
        let out = channel(
            self.connection,
            action,
            self.cancel,
            &self.request.validate,
            |stream, bytes| self.manager.output(self.id, stream, bytes),
            || self.manager.change(self.id, |r| r.submitted = true),
        )
        .await;
        self.manager.change(self.id, |r| {
            r.exit_code = out.code;
            r.exit_signal = out.signal.clone();
            if let Some(s) = r.steps.last_mut() {
                s.phase = out.phase.into();
                s.exit_code = out.code;
                s.error = out.error.clone();
                s.finished_at = Some(timestamp());
            }
        });
        (self.request.changed)();
        out
    }
    fn record(&self, health: bool, value: &str) {
        self.observations.record(
            &self.request.service,
            &self.request.identity,
            self.id,
            health,
            value,
        );
        (self.request.changed)();
    }
    fn stage_result(&self, phase: &str, error: Option<&str>) {
        self.manager.change(self.id, |r| {
            if let Some(step) = r.steps.last_mut() {
                step.phase = phase.into();
                step.error = error.map(str::to_string);
                step.finished_at = if phase == "running" {
                    None
                } else {
                    Some(timestamp())
                };
            }
        });
        (self.request.changed)();
    }
    async fn status(&self) -> Result<String, String> {
        let s = &self.request.service;
        let p = s
            .control
            .status_probe
            .as_ref()
            .ok_or("statusProbeMissing")?;
        let a = s
            .actions
            .iter()
            .find(|a| a.id == p.action_id)
            .ok_or("actionMissing")?;
        let out = self.step("status", a, 1).await;
        match status_value(p, &out) {
            Ok(value) => {
                self.manager.change(self.id, |r| {
                    if let Some(s) = r.steps.last_mut() {
                        s.phase = "succeeded".into();
                        s.error = None;
                    }
                });
                self.record(false, &value);
                Ok(value)
            }
            Err(e) => {
                self.stage_result("failed", Some(&e));
                self.record(false, "unknown");
                Err(e)
            }
        }
    }
    async fn health(&self, wait: bool) -> Result<(), String> {
        let p = self
            .request
            .service
            .control
            .health_probe
            .as_ref()
            .ok_or("healthProbeMissing")?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(p.budget_secs);
        let mut attempt = 0;
        loop {
            if !(self.request.validate)() {
                if attempt > 0 {
                    self.stage_result("failed", Some("staleAction"));
                }
                self.record(true, "unknown");
                return Err("staleAction".into());
            }
            attempt += 1;
            let a = Action {
                invocation: None,
                mode: ExecutionMode::Command,
                id: "health".into(),
                kind: "status".into(),
                label: "health".into(),
                command: p.command.clone(),
                timeout_secs: p.timeout_secs,
                success_codes: p.ready_codes.clone(),
                confirm: false,
            };
            let out = tokio::time::timeout_at(deadline, self.step("health", &a, attempt)).await;
            let Ok(out) = out else {
                self.stage_result("timedOut", Some("readinessTimeout"));
                self.record(true, "notReady");
                return Err("readinessTimeout".into());
            };
            if !(self.request.validate)() {
                self.stage_result("failed", Some("staleAction"));
                self.record(true, "unknown");
                return Err("staleAction".into());
            }
            if out.code.is_none()
                || out.signal.is_some()
                || out.truncated
                || !matches!(out.phase, "succeeded" | "failed")
                || out.error.as_deref().is_some_and(|e| e != "exitCode")
            {
                self.stage_result(
                    if out.phase == "timedOut" {
                        "timedOut"
                    } else {
                        "failed"
                    },
                    Some("probeFailed"),
                );
                self.record(true, "failed");
                return Err("probeFailed".into());
            }
            let code = out.code.unwrap();
            if p.ready_codes.contains(&code) {
                self.record(true, "ready");
                return Ok(());
            }
            if !p.not_ready_codes.contains(&code) {
                self.stage_result("failed", Some("unmappedHealth"));
                self.record(true, "failed");
                return Err("unmappedHealth".into());
            }
            self.record(true, "notReady");
            if !wait || !p.repeatable {
                self.stage_result("failed", Some("notReady"));
                return Err("notReady".into());
            }
            let next = tokio::time::Instant::now() + Duration::from_secs(p.interval_secs);
            if next >= deadline {
                self.stage_result("timedOut", Some("readinessTimeout"));
                return Err("readinessTimeout".into());
            }
            self.stage_result("running", None);
            tokio::select! {biased;_=self.cancel.cancelled()=>return Err("remoteUnknown".into()),_=tokio::time::sleep_until(next)=>{}}
        }
    }
    async fn action(&self, action: &Action) -> Result<(), String> {
        if ["start", "stop", "restart", "custom"].contains(&action.kind.as_str()) {
            self.observations
                .invalidate(&self.request.service, &self.request.identity);
            (self.request.changed)();
        }
        let out = self.step(&action.kind, action, 1).await;
        if out.phase == "succeeded" {
            Ok(())
        } else {
            Err(out.error.unwrap_or_else(|| "remoteUnknown".into()))
        }
    }
    async fn run(&self) -> Result<(), String> {
        let s = &self.request.service;
        match self.request.operation {
            Operation::CheckStatus => {
                self.status().await?;
            }
            Operation::CheckHealth => self.health(false).await?,
            Operation::Action => {
                let a = self.request.action.as_ref().ok_or("actionMissing")?;
                if s.control
                    .status_probe
                    .as_ref()
                    .is_some_and(|p| p.action_id == a.id)
                {
                    self.status().await?;
                } else {
                    self.action(a).await?;
                    if s.control.check_after_actions
                        && ["start", "restart", "stop", "custom"].contains(&a.kind.as_str())
                    {
                        if s.control.status_probe.is_some() {
                            self.status().await?;
                        }
                        if a.kind != "stop" && s.control.health_probe.is_some() {
                            self.health(true).await?;
                            if s.control.status_probe.is_some() {
                                self.status().await?;
                            }
                        }
                    }
                }
            }
            Operation::Connect => {
                let current = if s.control.status_probe.is_some() {
                    self.status().await?
                } else {
                    "unchecked".into()
                };
                let mut started = false;
                match current.as_str() {
                    "running" => {}
                    "stopped" | "unchecked" => {
                        let a = s
                            .actions
                            .iter()
                            .find(|a| Some(&a.id) == s.control.start_action_id.as_ref())
                            .ok_or("startActionMissing")?;
                        self.action(a).await?;
                        started = true;
                    }
                    _ => return Err("statusUnknown".into()),
                }
                if s.control.health_probe.is_some() {
                    self.health(true).await?;
                    if started
                        && s.control.status_probe.is_some()
                        && self.status().await? != "running"
                    {
                        return Err("statusUnknown".into());
                    }
                }
                if !(self.request.validate)() {
                    return Err("staleAction".into());
                }
                self.manager.change(self.id, |r| {
                    r.phase = "connecting-forward".into();
                    r.steps.push(Step {
                        kind: "forward".into(),
                        phase: "running".into(),
                        attempt: 1,
                        exit_code: None,
                        error: None,
                        started_at: timestamp(),
                        finished_at: None,
                    });
                });
                (self.request.changed)();
                let result =
                    (self.request.forward.as_ref().ok_or("ruleMissing")?)(self.cancel.clone())
                        .await;
                self.manager.change(self.id, |r| {
                    if let Some(step) = r.steps.last_mut() {
                        step.finished_at = Some(timestamp());
                        step.phase = if result.is_ok() {
                            "succeeded"
                        } else {
                            "failed"
                        }
                        .into();
                        step.error = result.as_ref().err().cloned();
                    }
                    if let Ok(f) = &result {
                        r.workflow_forward_created = f.created;
                        r.workflow_forward_run_id = Some(f.run_id.clone());
                    }
                });
                (self.request.changed)();
                result?;
            }
        }
        Ok(())
    }
}
pub async fn execute(
    manager: Arc<Commands>,
    observations: Arc<Observations>,
    id: String,
    cancel: CancellationToken,
    request: Request,
) {
    let runtime = Arc::new(Mutex::new(Runtime::default()));
    let connected = tunnel::connect(
        request.hops.clone(),
        None,
        &cancel,
        &request.notify,
        request.prompt.clone(),
        &runtime,
        request.observer.clone(),
    )
    .await;
    let connection = match connected {
        Ok(Some(c)) => c,
        other => {
            let error = match other {
                Err(e) => match e.kind {
                    FailureKind::Authentication => "authentication",
                    FailureKind::HostKey => "hostKey",
                    FailureKind::Timeout => "connectionTimeout",
                    _ => "connectionFailed",
                },
                _ => "notExecuted",
            };
            observations.invalidate(&request.service, &request.identity);
            manager.finish(
                &id,
                if cancel.is_cancelled() {
                    "cancelled"
                } else {
                    "failed"
                },
                Some(error.into()),
            );
            (request.changed)();
            return;
        }
    };
    let controller = Controller {
        manager: &manager,
        observations: &observations,
        id: &id,
        cancel: &cancel,
        request: &request,
        connection: &connection,
    };
    let result = tokio::select! {biased;_=cancel.cancelled()=>Err("remoteUnknown".into()),r=controller.run()=>r};
    connection.close().await;
    if cancel.is_cancelled() || result.as_ref().err().is_some_and(|e| e == "remoteUnknown") {
        observations.invalidate(&request.service, &request.identity);
    }
    let error = result.err();
    let phase = if cancel.is_cancelled() {
        "cancelled"
    } else if error.is_none() {
        "succeeded"
    } else if error.as_deref() == Some("readinessTimeout")
        || manager
            .list()
            .iter()
            .find(|r| r.id == id)
            .is_some_and(|r| r.steps.last().is_some_and(|s| s.phase == "timedOut"))
    {
        "timedOut"
    } else if error.as_deref() == Some("remoteUnknown") {
        "unknown"
    } else {
        "failed"
    };
    manager.change(&id, |r| {
        if let Some(step) = r.steps.last_mut().filter(|s| s.phase == "running") {
            step.phase = phase.into();
            step.error = error.clone();
            step.finished_at = Some(timestamp());
        }
    });
    manager.finish(&id, phase, error);
    (request.changed)();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn outcome(code: u32, stdout: &[u8]) -> Outcome {
        Outcome {
            phase: if code == 0 { "succeeded" } else { "failed" },
            code: Some(code),
            signal: None,
            error: if code == 0 {
                None
            } else {
                Some("exitCode".into())
            },
            submitted: true,
            stdout: stdout.to_vec(),
            truncated: false,
        }
    }
    fn probe() -> StatusProbe {
        StatusProbe {
            action_id: "status".into(),
            mode: "exitCode".into(),
            running_codes: vec![0],
            stopped_codes: vec![3],
            failed_codes: vec![4],
        }
    }
    fn service() -> crate::commands::Service {
        serde_json::from_value(serde_json::json!({"id":"service","name":"Test","executionHostId":"host","ruleIds":[],"revision":"v1","noLocalEnvironment":true,"actions":[{"id":"status","kind":"status","label":"status","command":"status","timeoutSecs":5,"successCodes":[0],"confirm":false}]})).unwrap()
    }
    #[test]
    fn strict_mapping_never_turns_faults_or_unmapped_output_into_stopped() {
        let mut p = probe();
        assert_eq!(
            status_value(&p, &outcome(3, b"not parsed")).unwrap(),
            "stopped"
        );
        assert!(status_value(&p, &outcome(9, b"stopped")).is_err());
        let mut out = outcome(3, b"stopped");
        out.truncated = true;
        assert!(status_value(&p, &out).is_err());
        out.truncated = false;
        out.phase = "unknown";
        assert!(status_value(&p, &out).is_err());
        p.mode = "json".into();
        assert_eq!(
            status_value(
                &p,
                &outcome(
                    0,
                    br#"{"state":"running","ready":false,"message":"loading"}"#
                )
            )
            .unwrap(),
            "running"
        );
        for bytes in [
            br#"{"state":"stopped","extra":true}"#.as_slice(),
            br#"{"state":"running","state":"stopped"}"#,
            br#"{"state":"other"}"#,
            b"\xff",
            b"running",
            br#"{"state":"running"} extra"#,
        ] {
            assert!(status_value(&p, &outcome(0, bytes)).is_err());
        }
        assert!(status_value(&p, &outcome(3, br#"{"state":"stopped"}"#)).is_err());
    }
    #[test]
    fn validation_requires_explicit_bounded_read_only_probes_and_noninteractive_start() {
        let mut s = service();
        s.control.status_probe = Some(probe());
        assert!(s.validate().is_ok());
        s.control.status_probe.as_mut().unwrap().stopped_codes = vec![0];
        assert_eq!(s.validate().unwrap_err(), "invalidProbe");
        s.control.status_probe = Some(probe());
        s.actions[0].confirm = true;
        assert!(s.validate().is_err());
        s.actions[0].confirm = false;
        s.actions[0].mode = ExecutionMode::Terminal;
        assert!(s.validate().is_err());
        s.actions[0].mode = ExecutionMode::Command;
        s.control.health_probe = Some(HealthProbe {
            command: "check".into(),
            ready_codes: vec![0],
            not_ready_codes: vec![1],
            repeatable: false,
            timeout_secs: 5,
            interval_secs: 2,
            budget_secs: 60,
        });
        assert!(s.validate().is_ok());
        s.control.health_probe.as_mut().unwrap().budget_secs = 601;
        assert!(s.validate().is_err());
        s.control.health_probe.as_mut().unwrap().budget_secs = 60;
        s.control.status_probe = None;
        s.actions.clear();
        assert!(s.validate().is_ok());
    }
    #[test]
    fn observations_expire_on_time_revision_or_identity_and_are_memory_only() {
        let s = service();
        let m = Observations::default();
        assert!(m
            .view(&s, "identity", timestamp())
            .status
            .checked_at
            .is_none());
        m.record(&s, "identity", "run", false, "running");
        m.record(&s, "identity", "run", true, "ready");
        let view = m.view(&s, "identity", timestamp());
        assert!(!view.health.expired);
        assert_eq!(view.status.source_run_id.as_deref(), Some("run"));
        assert!(
            m.view(&s, "identity", view.status.valid_until.unwrap())
                .status
                .expired
        );
        let mut edited = s.clone();
        edited.revision = "v2".into();
        assert!(m.view(&edited, "identity", timestamp()).status.expired);
        assert_eq!(m.view(&s, "other", timestamp()).health.value, "unverified");
        assert!(m.view(&s, "other", timestamp()).health.checked_at.is_none());
        m.record(&s, "other", "other-run", false, "failed");
        assert_eq!(m.view(&s, "identity", timestamp()).status.value, "running");
        assert_eq!(m.view(&s, "other", timestamp()).status.value, "failed");
        m.record(&s, "identity", "run2", false, "stopped");
        assert_eq!(
            m.view(&s, "identity", timestamp()).health.value,
            "unverified"
        );
        assert!(Observations::default()
            .view(&s, "identity", timestamp())
            .status
            .checked_at
            .is_none());
        let h = crate::model::Host {
            id: "host".into(),
            address: "127.0.0.1".into(),
            ..Default::default()
        };
        let hash = identity(std::slice::from_ref(&h));
        let mut renamed = h.clone();
        renamed.name = "renamed".into();
        assert_eq!(hash, identity(std::slice::from_ref(&renamed)));
        renamed.address = "::1".into();
        assert_ne!(hash, identity(&[renamed]));
    }
}
