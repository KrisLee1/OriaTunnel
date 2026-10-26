//! Preset command model and bounded in-memory execution. Never serialize scripts into run records.
use crate::{
    model::{timestamp, FailureKind, Runtime},
    tunnel,
};
use russh::{ChannelMsg, Sig};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

pub const OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
pub const TOTAL_OUTPUT_LIMIT: usize = 16 * OUTPUT_LIMIT;
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionMode {
    #[default]
    Command,
    Terminal,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandArgument {
    pub name: String,
    pub value: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentVariable {
    pub name: String,
    pub value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Invocation {
    pub executable: String,
    pub arguments: Vec<CommandArgument>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub environment: Vec<EnvironmentVariable>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
}
impl Invocation {
    pub fn render(&self) -> Result<String, String> {
        let valid_text = |s: &str| s.len() <= 4096 && !s.contains(['\0', '\r', '\n']);
        if self.executable.trim().is_empty()
            || !valid_text(&self.executable)
            || self.arguments.len() > 128
            || self.environment.len() > 64
            || self.script.as_ref().is_some_and(|script| {
                self.executable != "sh"
                    || !self.arguments.is_empty()
                    || script.trim().is_empty()
                    || script.len() > 65536
                    || script.contains('\0')
            })
        {
            return Err("invalidAction".into());
        }
        let quote = |s: &str| format!("'{}'", s.replace('\'', "'\"'\"'"));
        let mut words = vec![quote(&self.executable)];
        let managed = self.executable.rsplit('/').next() == Some("systemd-run");
        let mut names = std::collections::HashSet::new();
        let mut assignments = Vec::new();
        for variable in &self.environment {
            let name = variable.name.as_bytes();
            if name.len() > 128
                || !name
                    .first()
                    .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_')
                || !name.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_')
                || !valid_text(&variable.value)
                || !names.insert(&variable.name)
            {
                return Err("invalidAction".into());
            }
            if managed {
                words.push(quote(&format!(
                    "--setenv={}={}",
                    variable.name, variable.value
                )));
            } else {
                assignments.push(format!("{}={}", variable.name, quote(&variable.value)));
            }
        }
        if let Some(script) = &self.script {
            return Ok(if assignments.is_empty() {
                script.clone()
            } else {
                format!("export {}\n{script}", assignments.join(" "))
            });
        }
        for arg in &self.arguments {
            if arg.name.len() > 128
                || (!arg.name.is_empty()
                    && (!arg.name.starts_with('-')
                        || !arg
                            .name
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))))
                || arg.value.as_ref().is_some_and(|v| !valid_text(v))
                || (arg.name.is_empty() && arg.value.is_none())
            {
                return Err("invalidAction".into());
            }
            if !arg.name.is_empty() {
                words.push(quote(&arg.name));
            }
            if let Some(value) = &arg.value {
                words.push(quote(value));
            }
        }
        if !assignments.is_empty() {
            assignments.push(words.join(" "));
            return Ok(assignments.join(" "));
        }
        Ok(words.join(" "))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Action {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invocation: Option<Invocation>,
    #[serde(default)]
    pub mode: ExecutionMode,
    pub id: String,
    pub kind: String,
    pub label: String,
    pub command: String,
    pub timeout_secs: u64,
    pub success_codes: Vec<u32>,
    pub confirm: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Service {
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<crate::model::RuleIcon>,
    pub id: String,
    pub name: String,
    // Read compatibility only; execution targets always come from a referencing forward.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub execution_host_id: String,
    #[serde(default)]
    pub host_ids: Vec<String>,
    pub rule_ids: Vec<String>,
    pub revision: String,
    pub no_local_environment: bool,
    pub actions: Vec<Action>,
    #[serde(default)]
    pub control: crate::service_control::Control,
    #[serde(default = "enabled_by_default")]
    pub execution_enabled: bool,
}
fn enabled_by_default() -> bool {
    true
}
impl Service {
    pub fn execution_target<'a>(
        &self,
        snapshot: &'a crate::model::Snapshot,
        rule_id: Option<&str>,
        host_id: Option<&str>,
    ) -> Result<(Option<&'a crate::model::Rule>, &'a crate::model::Host), String> {
        let rule = if rule_id.is_some() {
            self.target_rule(snapshot, rule_id)?
        } else {
            None
        };
        let host_id = match (rule, host_id) {
            (Some(rule), Some(host)) if rule.host_id != host => {
                return Err("serviceTargetRequired".into())
            }
            (Some(rule), _) => rule.host_id.as_str(),
            (None, Some(host)) => host,
            (None, None) => return Err("serviceTargetRequired".into()),
        };
        if !self.host_ids.iter().any(|id| id == host_id) {
            return Err("serviceUnbound".into());
        }
        let host = snapshot
            .hosts
            .iter()
            .find(|host| host.id == host_id && snapshot.added_host_ids.contains(&host.id))
            .ok_or("hostMissing")?;
        Ok((rule, host))
    }
    pub fn target_rule<'a>(
        &self,
        snapshot: &'a crate::model::Snapshot,
        rule_id: Option<&str>,
    ) -> Result<Option<&'a crate::model::Rule>, String> {
        if let Some(id) = rule_id {
            return snapshot
                .rules
                .iter()
                .find(|r| r.id == id && self.rule_ids.contains(&r.id))
                .map(Some)
                .ok_or_else(|| "ruleMissing".into());
        }
        let mut bound = snapshot
            .rules
            .iter()
            .filter(|r| self.rule_ids.contains(&r.id));
        if let Some(rule) = bound.next() {
            if bound.next().is_none() {
                return Ok(Some(rule));
            }
            return Err("serviceTargetRequired".into());
        }
        Err("serviceUnbound".into())
    }
    pub fn require_execution(&self) -> Result<(), String> {
        if self.execution_enabled {
            Ok(())
        } else {
            Err("serviceDisabled".into())
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if let Some(category) = &self.category {
            let allowed: Vec<String> = serde_json::from_str(include_str!(
                "../../src/features/commands/service-category-ids.json"
            ))
            .expect("embedded service categories");
            if category != "other" && !allowed.contains(category) {
                return Err("invalidService".into());
            }
        }
        if let Some(icon) = &self.icon {
            icon.validate()?;
        }
        if self.color.as_ref().is_some_and(|c| {
            c.len() != 7
                || !c.starts_with('#')
                || !c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        }) {
            return Err("invalidService".into());
        }
        if self.name.trim().is_empty()
            || self.name.len() > 256
            || (self.actions.is_empty() && self.control.health_probe.is_none())
            || self.actions.len() > 32
            || self.rule_ids.len() > 256
            || self.host_ids.len() > 500
            || self.port == Some(0)
            || self
                .host_ids
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.host_ids.len()
        {
            return Err("invalidService".into());
        }
        let mut ids = std::collections::BTreeSet::new();
        for a in &self.actions {
            if let Some(invocation) = &a.invocation {
                if invocation.render()? != a.command {
                    return Err("invalidAction".into());
                }
            }
            if !ids.insert(&a.id)
                || a.id.is_empty()
                || a.id.len() > 128
                || !["start", "stop", "restart", "status", "logs", "custom"]
                    .contains(&a.kind.as_str())
                || a.label.trim().is_empty()
                || a.label.len() > 256
                || a.command.trim().is_empty()
                || a.command.len() > 65536
                || a.command.contains('\0')
                || a.timeout_secs > 3600
                || (a.timeout_secs == 0 && a.mode != ExecutionMode::Terminal)
                || a.success_codes.is_empty()
                || a.success_codes.len() > 32
            {
                return Err("invalidAction".into());
            }
        }
        self.control.validate(&self.actions)?;
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub request_id: String,
    pub service_id: String,
    pub action_id: String,
    pub service_revision: String,
    pub host_id: String,
    pub host_name: String,
    pub endpoint: String,
    pub action_label: String,
    pub phase: String,
    pub submitted: bool,
    pub exit_code: Option<u32>,
    pub exit_signal: Option<String>,
    pub error: Option<String>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub fingerprint: Option<String>,
    pub verification_endpoint: Option<String>,
    pub revision: u64,
    pub truncated: bool,
    #[serde(default)]
    pub output_bytes: usize,
    #[serde(default)]
    pub discarded_bytes: u64,
    #[serde(default)]
    pub steps: Vec<crate::service_control::Step>,
    #[serde(default)]
    pub route_host_ids: Vec<String>,
    #[serde(default)]
    pub workflow_rule_id: Option<String>,
    #[serde(default)]
    pub workflow_forward_created: bool,
    #[serde(default)]
    pub workflow_forward_run_id: Option<String>,
}
impl Run {
    pub fn active(&self) -> bool {
        self.finished_at.is_none()
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub sequence: u64,
    pub stream: String,
    pub bytes: Vec<u8>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub run: Run,
    pub output: Vec<Output>,
    pub reset: bool,
}
struct Entry {
    run: Run,
    chunks: VecDeque<Output>,
    bytes: usize,
    sequence: u64,
    channel: Option<Channel<Event>>,
    sent: Option<u64>,
    cursor: u64,
    cancel: CancellationToken,
    needs_reset: bool,
}
#[derive(Default)]
pub struct Manager {
    entries: Mutex<BTreeMap<String, Entry>>,
}
impl Manager {
    pub fn list(&self) -> Vec<Run> {
        self.entries
            .lock()
            .unwrap()
            .values()
            .map(|e| e.run.clone())
            .collect()
    }
    pub fn existing(
        &self,
        request: &str,
        service: &str,
        action: &str,
        revision: &str,
    ) -> Result<Option<Run>, String> {
        let entries = self.entries.lock().unwrap();
        if let Some(e) = entries.values().find(|e| e.run.request_id == request) {
            if e.run.service_id != service
                || e.run.action_id != action
                || e.run.service_revision != revision
            {
                return Err("staleAction".into());
            }
            return Ok(Some(e.run.clone()));
        }
        Ok(None)
    }
    pub fn cancel_for_rule(&self, id: &str) {
        for e in self.entries.lock().unwrap().values() {
            if e.run.active() && e.run.workflow_rule_id.as_deref() == Some(id) {
                e.cancel.cancel();
            }
        }
    }
    pub fn active_ids(&self) -> Vec<String> {
        self.list()
            .into_iter()
            .filter(Run::active)
            .map(|r| r.id)
            .collect()
    }
    pub fn register(&self, run: Run) -> Result<(Run, CancellationToken, bool), String> {
        let mut entries = self.entries.lock().unwrap();
        if let Some(e) = entries
            .values()
            .find(|e| e.run.request_id == run.request_id)
        {
            if e.run.service_id != run.service_id
                || e.run.action_id != run.action_id
                || e.run.service_revision != run.service_revision
            {
                return Err("staleAction".into());
            }
            return Ok((e.run.clone(), e.cancel.clone(), false));
        }
        if entries
            .values()
            .any(|e| e.run.active() && e.run.service_id == run.service_id)
        {
            return Err("serviceBusy".into());
        }
        if entries.values().filter(|e| e.run.active()).count() >= 16
            || entries
                .values()
                .filter(|e| e.run.active() && e.run.host_id == run.host_id)
                .count()
                >= 4
        {
            return Err("commandLimit".into());
        }
        // Bound deduplication metadata without ever evicting a request and replaying it.
        if entries.len() >= 4096 {
            return Err("commandLimit".into());
        }
        let cancel = CancellationToken::new();
        entries.insert(
            run.id.clone(),
            Entry {
                run: run.clone(),
                chunks: VecDeque::new(),
                bytes: 0,
                sequence: 0,
                channel: None,
                sent: None,
                cursor: 0,
                cancel: cancel.clone(),
                needs_reset: false,
            },
        );
        Ok((run, cancel, true))
    }
    fn send(e: &mut Entry, reset: bool) {
        if e.sent.is_some() {
            return;
        }
        let Some(channel) = &e.channel else {
            return;
        };
        let reset = reset || e.needs_reset;
        let gap = e.chunks.front().is_some_and(|c| c.sequence > e.cursor + 1);
        let event = Event {
            run: e.run.clone(),
            output: e
                .chunks
                .iter()
                .filter(|c| reset || c.sequence > e.cursor)
                .cloned()
                .collect(),
            reset: reset || gap,
        };
        if channel.send(event).is_ok() {
            e.sent = Some(e.run.revision);
            e.cursor = e.sequence;
            e.needs_reset = false;
        } else {
            e.channel = None;
        }
    }
    pub fn attach(&self, id: &str, channel: Channel<Event>) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        let e = entries.get_mut(id).ok_or("runMissing")?;
        e.channel = Some(channel);
        e.sent = None;
        e.cursor = 0;
        Self::send(e, true);
        Ok(())
    }
    pub fn ack(&self, id: &str, revision: u64) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        let e = entries.get_mut(id).ok_or("runMissing")?;
        if e.sent == Some(revision) {
            e.sent = None;
            if e.run.revision > revision {
                Self::send(e, false);
            }
        }
        Ok(())
    }
    pub fn detach(&self, id: &str) {
        if let Some(e) = self.entries.lock().unwrap().get_mut(id) {
            e.channel = None;
            e.sent = None;
        }
    }
    pub fn change(&self, id: &str, change: impl FnOnce(&mut Run)) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(e) = entries.get_mut(id) {
            change(&mut e.run);
            e.run.revision += 1;
            Self::send(e, false);
        }
    }
    pub fn output(&self, id: &str, stream: &str, bytes: &[u8]) {
        let mut entries = self.entries.lock().unwrap();
        let Some(e) = entries.get_mut(id) else {
            return;
        };
        for part in bytes.chunks(16384) {
            e.sequence += 1;
            e.chunks.push_back(Output {
                sequence: e.sequence,
                stream: stream.into(),
                bytes: part.to_vec(),
            });
            e.bytes += part.len();
            while e.bytes > OUTPUT_LIMIT {
                if let Some(old) = e.chunks.pop_front() {
                    e.bytes -= old.bytes.len();
                    e.run.truncated = true;
                    e.run.discarded_bytes += old.bytes.len() as u64;
                }
            }
        }
        e.run.output_bytes = e.bytes;
        e.run.revision += 1;
        Self::send(e, false);
        while entries.values().map(|e| e.bytes).sum::<usize>() > TOTAL_OUTPUT_LIMIT {
            let victim = entries
                .iter()
                .filter(|(_, e)| !e.run.active() && e.bytes > 0)
                .min_by_key(|(_, e)| e.run.started_at)
                .map(|(id, _)| id.clone());
            let Some(victim) = victim else {
                break;
            };
            let old = entries.get_mut(&victim).unwrap();
            old.run.discarded_bytes += old.bytes as u64;
            // Release queue capacity as well as payload; tombstones retain no output allocation.
            old.chunks = VecDeque::new();
            old.bytes = 0;
            old.run.output_bytes = 0;
            old.run.truncated = true;
            old.run.revision += 1;
            old.needs_reset = true;
            Self::send(old, true);
        }
    }
    pub fn retained_output_bytes(&self) -> usize {
        self.entries.lock().unwrap().values().map(|e| e.bytes).sum()
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let entries = self.entries.lock().unwrap();
        let e = entries.get(id).ok_or("runMissing")?;
        e.cancel.cancel();
        Ok(())
    }
    pub fn cancel_all(&self) {
        for e in self.entries.lock().unwrap().values() {
            if e.run.active() {
                e.cancel.cancel();
            }
        }
    }
    pub fn finish(&self, id: &str, phase: &str, error: Option<String>) {
        self.change(id, |r| {
            r.phase = phase.into();
            r.error = error;
            r.finished_at = Some(timestamp());
            r.fingerprint = None;
            r.verification_endpoint = None;
        });
    }
}

pub struct Request {
    pub hops: Vec<tunnel::HopRequest>,
    pub action: Action,
    pub notify: tunnel::Notify,
    pub prompt: tunnel::TrustPrompt,
    pub observer: Option<tunnel::PasswordObserver>,
    pub validate: Arc<dyn Fn() -> bool + Send + Sync>,
}
// No retry: once exec may have been transmitted the remote result can be unknown.
pub async fn execute(
    manager: Arc<Manager>,
    id: String,
    cancel: CancellationToken,
    request: Request,
) {
    let runtime = Arc::new(Mutex::new(Runtime::default()));
    let connection = tunnel::connect(
        request.hops,
        None,
        &cancel,
        &request.notify,
        request.prompt,
        &runtime,
        request.observer,
    )
    .await;
    let connection = match connection {
        Ok(Some(c)) => c,
        Ok(None) => {
            manager.finish(&id, "cancelled", Some("notExecuted".into()));
            return;
        }
        Err(f) => {
            manager.finish(
                &id,
                if cancel.is_cancelled() {
                    "cancelled"
                } else {
                    "failed"
                },
                Some(
                    match f.kind {
                        FailureKind::Authentication => "authentication",
                        FailureKind::HostKey => "hostKey",
                        FailureKind::Timeout => "connectionTimeout",
                        _ => "connectionFailed",
                    }
                    .into(),
                ),
            );
            return;
        }
    };
    if cancel.is_cancelled() || !(request.validate)() {
        manager.finish(&id, "cancelled", Some("notExecuted".into()));
        connection.close().await;
        return;
    }
    let opened = tokio::select! {biased;_=cancel.cancelled()=>None,r=tokio::time::timeout(Duration::from_secs(15),connection.open_session())=>r.ok().and_then(Result::ok)};
    let Some(mut channel) = opened else {
        manager.finish(
            &id,
            if cancel.is_cancelled() {
                "cancelled"
            } else {
                "failed"
            },
            Some("notExecuted".into()),
        );
        connection.close().await;
        return;
    };
    let mut submitted = false;
    let result = tokio::time::timeout(Duration::from_secs(request.action.timeout_secs), async {
        if !(request.validate)() {
            return ("cancelled", Some("notExecuted".into()));
        }
        submitted = true;
        manager.change(&id, |r| {
            r.phase = "submitted".into();
            r.submitted = true;
        });
        if channel
            .exec(true, request.action.command.as_bytes().to_vec())
            .await
            .is_err()
        {
            return ("unknown", Some("remoteUnknown".into()));
        }
        let mut code = None;
        let mut signal = None;
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Success) => manager.change(&id, |r| r.phase = "running".into()),
                Some(ChannelMsg::Failure) => return ("failed", Some("execRejected".into())),
                Some(ChannelMsg::Data { data }) => manager.output(&id, "stdout", &data),
                Some(ChannelMsg::ExtendedData { data, .. }) => manager.output(&id, "stderr", &data),
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    code = Some(exit_status);
                    manager.change(&id, |r| r.exit_code = code);
                }
                Some(ChannelMsg::ExitSignal {
                    signal_name: exit_signal,
                    ..
                }) => {
                    signal = Some(format!("{exit_signal:?}"));
                    manager.change(&id, |r| r.exit_signal = signal.clone());
                }
                Some(ChannelMsg::Close) | None => {
                    return if signal.is_some() {
                        ("failed", Some("exitSignal".into()))
                    } else if let Some(code) = code {
                        if request.action.success_codes.contains(&code) {
                            ("succeeded", None)
                        } else {
                            ("failed", Some("exitCode".into()))
                        }
                    } else {
                        ("unknown", Some("remoteUnknown".into()))
                    }
                }
                _ => {}
            }
        }
    });
    let (phase, error) = tokio::select! {biased;_=cancel.cancelled()=>("cancelled",Some("remoteUnknown".into())),result=result=>match result {Ok(r)=>r,Err(_)=>("timedOut",Some("remoteUnknown".into()))}};
    if phase == "cancelled" || phase == "timedOut" {
        let _ = tokio::time::timeout(Duration::from_millis(500), channel.signal(Sig::TERM)).await;
    }
    let _ = tokio::time::timeout(Duration::from_millis(500), channel.close()).await;
    manager.finish(
        &id,
        phase,
        if !submitted && phase == "cancelled" {
            Some("notExecuted".into())
        } else {
            error
        },
    );
    connection.close().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_execution_requires_an_associated_added_host_and_never_a_fabricated_forward() {
        let service: Service = serde_json::from_value(serde_json::json!({"id":"s","name":"fixture","hostIds":["h"],"ruleIds":[],"revision":"v1","noLocalEnvironment":true,"actions":[{"id":"a","kind":"status","label":"status","command":"true","timeoutSecs":1,"successCodes":[0],"confirm":false}]})).unwrap();
        let snapshot = crate::model::Snapshot {
            hosts: vec![
                crate::model::Host {
                    id: "h".into(),
                    ..Default::default()
                },
                crate::model::Host {
                    id: "other".into(),
                    ..Default::default()
                },
            ],
            added_host_ids: vec!["h".into(), "other".into()],
            ..Default::default()
        };
        let (rule, host) = service
            .execution_target(&snapshot, None, Some("h"))
            .unwrap();
        assert!(rule.is_none());
        assert_eq!(host.id, "h");
        assert!(service
            .execution_target(&snapshot, None, Some("other"))
            .is_err());
        assert!(service.execution_target(&snapshot, None, None).is_err());
        assert!(service
            .execution_target(&snapshot, Some("missing"), Some("h"))
            .is_err());
        let mut removed = snapshot;
        removed.added_host_ids.clear();
        assert!(service.execution_target(&removed, None, Some("h")).is_err());
    }
    fn run(id: &str) -> Run {
        Run {
            id: id.into(),
            request_id: format!("request-{id}"),
            service_id: "service".into(),
            action_id: "action".into(),
            service_revision: "v1".into(),
            host_id: "host".into(),
            host_name: "host".into(),
            endpoint: "isolated".into(),
            action_label: "action".into(),
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
            route_host_ids: vec![],
            steps: vec![],
            workflow_rule_id: None,
            workflow_forward_created: false,
            workflow_forward_run_id: None,
        }
    }
    #[test]
    fn deduplication_keeps_completed_tombstones_and_serializes_same_service() {
        let m = Manager::default();
        let original = run("a");
        let (first, _, created) = m.register(original.clone()).unwrap();
        assert!(created);
        let (retry, _, created) = m.register(original.clone()).unwrap();
        assert!(!created);
        assert_eq!(first.id, retry.id);
        assert_eq!(m.register(run("b")).err().unwrap(), "serviceBusy");
        m.finish("a", "unknown", Some("remoteUnknown".into()));
        assert!(!m.register(original.clone()).unwrap().2);
        assert!(m.register(run("b")).unwrap().2);
        let mut changed = original;
        changed.service_revision = "v2".into();
        assert_eq!(m.register(changed).err().unwrap(), "staleAction");
    }
    #[test]
    fn output_is_bounded_while_detached_and_ack_limits_queued_ipc() {
        let m = Manager::default();
        m.register(run("a")).unwrap();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let captured = messages.clone();
        m.attach(
            "a",
            Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                    captured
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str::<serde_json::Value>(&json).unwrap());
                }
                Ok(())
            }),
        )
        .unwrap();
        for _ in 0..256 {
            m.output("a", "stdout", &[b'x'; 16384]);
        }
        assert_eq!(messages.lock().unwrap().len(), 1); // No ACK means at most one pending IPC message.
        let entries = m.entries.lock().unwrap();
        let entry = &entries["a"];
        assert!(entry.bytes <= OUTPUT_LIMIT);
        assert!(entry.run.truncated);
        drop(entries);
        m.ack("a", 1).unwrap();
        assert_eq!(messages.lock().unwrap().len(), 2);
        assert!(messages.lock().unwrap()[1]["reset"].as_bool().unwrap());
        m.detach("a");
        m.output("a", "stderr", b"still draining");
        assert_eq!(messages.lock().unwrap().len(), 2);
        m.finish("a", "succeeded", None);
        let record = serde_json::to_string(&m.list()).unwrap();
        assert!(!record.contains("still draining"));
        assert!(!record.contains("command\":"));
    }
    #[test]
    fn service_templates_resolve_only_referencing_forward_targets() {
        let mut service:Service=serde_json::from_value(serde_json::json!({"id":"template","name":"Template","executionHostId":"wrong-host","ruleIds":["a","b"],"revision":"v1","noLocalEnvironment":true,"actions":[{"id":"status","kind":"status","label":"Status","command":"status","timeoutSecs":5,"successCodes":[0],"confirm":false}]})).unwrap();
        let snapshot = crate::model::Snapshot {
            rules: vec![
                crate::model::Rule {
                    id: "a".into(),
                    host_id: "host-a".into(),
                    ..Default::default()
                },
                crate::model::Rule {
                    id: "b".into(),
                    host_id: "host-b".into(),
                    ..Default::default()
                },
                crate::model::Rule {
                    id: "other".into(),
                    host_id: "unrelated".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        assert_eq!(
            service
                .target_rule(&snapshot, Some("a"))
                .unwrap()
                .unwrap()
                .host_id,
            "host-a"
        );
        assert_eq!(
            service
                .target_rule(&snapshot, Some("b"))
                .unwrap()
                .unwrap()
                .host_id,
            "host-b"
        );
        assert!(service.target_rule(&snapshot, None).is_err());
        assert!(service.target_rule(&snapshot, Some("other")).is_err());
        service.rule_ids = vec!["a".into()];
        assert_eq!(
            service
                .target_rule(&snapshot, None)
                .unwrap()
                .unwrap()
                .host_id,
            "host-a"
        );
        service.rule_ids.clear();
        assert!(service.target_rule(&snapshot, None).is_err());
        service.execution_host_id.clear();
        assert!(service.validate().is_ok());
        let mut json = serde_json::to_value(&service).unwrap();
        json.as_object_mut().unwrap().remove("executionHostId");
        assert!(serde_json::from_value::<Service>(json).is_ok());
    }
    #[test]
    fn shell_script_environment_preserves_multiline_source_and_validates_shape() {
        let source = "# comment\nprintf '%s\\0' \"$ORIA_SCRIPT_TEST\"\nprintf '%s' \"${ORIA_EMPTY_TEST+x}\"\n";
        let mut invocation = Invocation {
            executable: "sh".into(),
            arguments: vec![],
            script: Some(source.into()),
            environment: vec![
                EnvironmentVariable {
                    name: "ORIA_SCRIPT_TEST".into(),
                    value: "' $HOME $(printf UNSAFE) 中文".into(),
                },
                EnvironmentVariable {
                    name: "ORIA_EMPTY_TEST".into(),
                    value: String::new(),
                },
            ],
        };
        let command = invocation.render().unwrap();
        #[cfg(unix)]
        {
            let output = std::process::Command::new("/bin/sh")
                .args(["-c", &command])
                .output()
                .unwrap();
            assert!(output.status.success());
            assert_eq!(output.stdout, "' $HOME $(printf UNSAFE) 中文\0x".as_bytes());
        }
        let restored: Invocation =
            serde_json::from_slice(&serde_json::to_vec(&invocation).unwrap()).unwrap();
        assert_eq!(restored.script.as_deref(), Some(source));
        assert_eq!(restored.render().unwrap(), command);
        invocation.arguments.push(CommandArgument {
            name: "--flag".into(),
            value: None,
        });
        assert!(invocation.render().is_err());
        invocation.arguments.clear();
        invocation.executable = "other-shell".into();
        assert!(invocation.render().is_err());
        invocation.executable = "sh".into();
        for invalid in ["".to_string(), "bad\0script".into(), "x".repeat(65537)] {
            invocation.script = Some(invalid);
            assert!(invocation.render().is_err());
        }
    }
    #[test]
    fn command_environment_is_literal_bounded_and_backward_compatible() {
        let mut invocation: Invocation = serde_json::from_value(serde_json::json!({
            "executable":"/bin/sh", "arguments":[{"name":"","value":"-c"},{"name":"","value":"printf '%s\\0%s' \"$ORIA_ENV_TEST\" \"${ORIA_EMPTY_TEST+x}\""}]
        })).unwrap();
        assert!(invocation.environment.is_empty());
        let literal = "a' b;$(printf UNSAFE)`id` $HOME 中文";
        invocation.environment = vec![
            EnvironmentVariable {
                name: "ORIA_ENV_TEST".into(),
                value: literal.into(),
            },
            EnvironmentVariable {
                name: "ORIA_EMPTY_TEST".into(),
                value: String::new(),
            },
        ];
        let command = invocation.render().unwrap();
        #[cfg(unix)]
        {
            let output = std::process::Command::new("/bin/sh")
                .args(["-c", &command])
                .output()
                .unwrap();
            assert!(output.status.success());
            assert_eq!(output.stdout, format!("{literal}\0x").as_bytes());
        }
        let reloaded: Invocation =
            serde_json::from_slice(&serde_json::to_vec(&invocation).unwrap()).unwrap();
        assert_eq!(reloaded.render().unwrap(), command);
        for name in ["", "0BAD", "A-B", "A B", "A;echo", "变量", "A=VALUE"] {
            let mut invalid = invocation.clone();
            invalid.environment[0].name = name.into();
            assert!(invalid.render().is_err());
        }
        for value in [
            "bad\0value".into(),
            "bad\nvalue".into(),
            "bad\rvalue".into(),
            "x".repeat(4097),
        ] {
            let mut invalid = invocation.clone();
            invalid.environment[0].value = value;
            assert!(invalid.render().is_err());
        }
        let mut invalid = invocation.clone();
        invalid.environment.push(invalid.environment[0].clone());
        assert!(invalid.render().is_err());
        invalid.environment = (0..65)
            .map(|i| EnvironmentVariable {
                name: format!("V{i}"),
                value: String::new(),
            })
            .collect();
        assert!(invalid.render().is_err());
    }
    #[test]
    fn managed_command_environment_targets_service_not_manager_client() {
        let invocation = Invocation {
            script: None,
            executable: "/usr/bin/systemd-run".into(),
            arguments: vec![
                CommandArgument {
                    name: "--user".into(),
                    value: None,
                },
                CommandArgument {
                    name: "--".into(),
                    value: None,
                },
                CommandArgument {
                    name: String::new(),
                    value: Some("dsh".into()),
                },
            ],
            environment: vec![
                EnvironmentVariable {
                    name: "LITERAL".into(),
                    value: "$HOME ' 中文".into(),
                },
                EnvironmentVariable {
                    name: "EMPTY".into(),
                    value: String::new(),
                },
            ],
        };
        assert_eq!(invocation.render().unwrap(), "'/usr/bin/systemd-run' '--setenv=LITERAL=$HOME '\"'\"' 中文' '--setenv=EMPTY=' '--user' '--' 'dsh'");
    }
    #[test]
    fn structured_commands_preserve_literal_arguments_and_validate_saved_script() {
        let invocation = Invocation {
            script: None,
            environment: Vec::new(),
            executable: "/usr/bin/printf".into(),
            arguments: vec![
                CommandArgument {
                    name: String::new(),
                    value: Some("%s\\0".into()),
                },
                CommandArgument {
                    name: String::new(),
                    value: Some("a' b;$(echo unsafe)中文".into()),
                },
                CommandArgument {
                    name: "--flag".into(),
                    value: None,
                },
                CommandArgument {
                    name: String::new(),
                    value: Some(String::new()),
                },
            ],
        };
        let script = invocation.render().unwrap();
        assert!(script.contains("--flag"));
        #[cfg(unix)]
        {
            let output = std::process::Command::new("/bin/sh")
                .args(["-c", &script])
                .output()
                .unwrap();
            assert!(output.status.success());
            assert_eq!(
                output.stdout,
                "a' b;$(echo unsafe)中文\0--flag\0\0".as_bytes()
            );
        }
        let mut invalid = invocation.clone();
        invalid.arguments[0].name = "--port;evil".into();
        assert!(invalid.render().is_err());
        invalid = invocation.clone();
        invalid.executable.push('\0');
        assert!(invalid.render().is_err());
        invalid = invocation.clone();
        invalid.arguments = vec![invalid.arguments[0].clone(); 129];
        assert!(invalid.render().is_err());
    }
    #[test]
    fn service_validation_rejects_unbounded_and_ambiguous_actions() {
        let mut s = Service {
            host_ids: vec![],
            port: None,
            category: None,
            color: None,
            icon: None,
            execution_enabled: true,
            control: Default::default(),
            id: "".into(),
            name: "service".into(),
            execution_host_id: "host".into(),
            rule_ids: vec![],
            revision: "".into(),
            no_local_environment: false,
            actions: vec![Action {
                invocation: None,
                mode: Default::default(),
                id: "a".into(),
                kind: "custom".into(),
                label: "run".into(),
                command: "printf ok".into(),
                timeout_secs: 60,
                success_codes: vec![0],
                confirm: true,
            }],
        };
        assert!(s.validate().is_ok());
        s.actions[0].timeout_secs = 0;
        assert!(s.validate().is_err());
        s.actions[0].mode = ExecutionMode::Terminal;
        assert!(s.validate().is_ok());
        let unlimited: Service = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
        assert_eq!(unlimited.actions[0].timeout_secs, 0);
        assert!(unlimited.validate().is_ok());
        s.actions[0].timeout_secs = 3601;
        assert!(s.validate().is_err());
        s.actions[0].timeout_secs = 60;
        s.actions[0].mode = ExecutionMode::Command;
        let legacy = serde_json::to_value(&s).unwrap();
        let mut old = legacy.clone();
        old.as_object_mut().unwrap().remove("color");
        old.as_object_mut().unwrap().remove("icon");
        assert!(serde_json::from_value::<Service>(old)
            .unwrap()
            .validate()
            .is_ok());
        s.color = Some("#67ad98".into());
        s.icon = Some(crate::model::RuleIcon::Builtin("brain".into()));
        let invocation = Invocation {
            script: None,
            environment: Vec::new(),
            executable: "printf".into(),
            arguments: vec![CommandArgument {
                name: String::new(),
                value: Some("literal '$HOME'".into()),
            }],
        };
        s.actions[0].command = invocation.render().unwrap();
        s.actions[0].invocation = Some(invocation);
        assert!(s.validate().is_ok());
        let restored: Service = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
        assert_eq!(restored.color, s.color);
        assert_eq!(restored.icon, s.icon);
        assert!(restored.validate().is_ok());
        s.actions[0].command.push('x');
        assert!(s.validate().is_err());
        s.actions[0].invocation = None;
        s.actions[0].command = "printf ok".into();
        s.color = Some("bad-color".into());
        assert!(s.validate().is_err());
        s.color = None;
        s.actions[0].command.push('\0');
        assert!(s.validate().is_err());
        s.actions[0].command = "printf ok".into();
        s.actions.push(s.actions[0].clone());
        assert!(s.validate().is_err());
    }
    #[test]
    fn global_output_budget_is_enforced_at_admission_after_all_jobs_are_registered() {
        let m = Manager::default();
        let payload = vec![b'x'; OUTPUT_LIMIT];
        for i in 0..16 {
            let id = format!("old-{i}");
            let mut r = run(&id);
            r.started_at = i;
            r.service_id = id.clone();
            m.register(r).unwrap();
            m.output(&id, "stdout", &payload);
            m.finish(&id, "succeeded", None);
        }
        assert_eq!(m.retained_output_bytes(), TOTAL_OUTPUT_LIMIT);
        // All new jobs register before producing output, the previous eviction boundary missed this.
        for i in 0..16 {
            let id = format!("new-{i}");
            let mut r = run(&id);
            r.service_id = id.clone();
            r.host_id = format!("host-{}", i / 4);
            m.register(r).unwrap();
        }
        for i in 0..16 {
            m.output(&format!("new-{i}"), "stdout", &payload);
            assert!(m.retained_output_bytes() <= TOTAL_OUTPUT_LIMIT);
        }
        let entries = m.entries.lock().unwrap();
        assert!(entries
            .iter()
            .filter(|(id, _)| id.starts_with("old"))
            .all(|(_, e)| e.bytes == 0
                && e.run.output_bytes == 0
                && e.run.discarded_bytes == OUTPUT_LIMIT as u64
                && e.chunks.capacity() == 0
                && e.run.truncated));
        assert!(entries
            .iter()
            .filter(|(id, _)| id.starts_with("new"))
            .all(|(_, e)| e.bytes == OUTPUT_LIMIT
                && e.run.output_bytes == OUTPUT_LIMIT
                && e.run.discarded_bytes == 0));
        drop(entries);
        for i in 0..16 {
            m.finish(&format!("new-{i}"), "succeeded", None);
        }
        assert!(
            !m.register(m.list().into_iter().find(|r| r.id == "old-0").unwrap())
                .unwrap()
                .2
        ); // Tombstone never replays evicted output.
    }
    #[test]
    fn empty_evicted_tail_resets_a_slow_viewer_after_its_pending_ack() {
        let m = Manager::default();
        m.register(run("old")).unwrap();
        m.output("old", "stdout", &vec![b'x'; OUTPUT_LIMIT]);
        m.finish("old", "succeeded", None);
        let messages = Arc::new(Mutex::new(Vec::new()));
        let capture = messages.clone();
        m.attach(
            "old",
            Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                    capture
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str::<serde_json::Value>(&json).unwrap());
                }
                Ok(())
            }),
        )
        .unwrap();
        let revision = messages.lock().unwrap()[0]["run"]["revision"]
            .as_u64()
            .unwrap();
        for i in 0..16 {
            let id = format!("job-{i}");
            let mut r = run(&id);
            r.service_id = id.clone();
            m.register(r).unwrap();
            m.output(&id, "stdout", &vec![b'x'; OUTPUT_LIMIT]);
            m.finish(&id, "succeeded", None);
        }
        assert_eq!(messages.lock().unwrap().len(), 1);
        m.ack("old", revision).unwrap();
        let events = messages.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1]["reset"], true);
        assert!(events[1]["output"].as_array().unwrap().is_empty());
        assert_eq!(events[1]["run"]["outputBytes"], 0);
    }
}
