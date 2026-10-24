//! Interactive SSH channels. Output has lossless bounded flow control; input never enters snapshots.
use crate::{
    model::{timestamp, FailureKind, Runtime},
    tunnel,
};
use russh::{ChannelMsg, Pty};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::sync::{mpsc, watch, Notify};
use tokio_util::sync::CancellationToken;
const OUTPUT_LIMIT: usize = 256 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub rule_id: Option<String>,
    pub id: String,
    pub request_id: String,
    pub client_id: String,
    pub host_id: String,
    pub route_host_ids: Vec<String>,
    pub host_name: String,
    pub endpoint: String,
    pub service_id: Option<String>,
    pub action_id: Option<String>,
    pub label: String,
    pub phase: String,
    pub revision: u64,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub submitted: bool,
    pub exit_code: Option<u32>,
    pub exit_signal: Option<String>,
    pub error: Option<String>,
    pub fingerprint: Option<String>,
    pub verification_endpoint: Option<String>,
    pub cols: u32,
    pub rows: u32,
}
impl Session {
    pub fn active(&self) -> bool {
        self.finished_at.is_none()
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub id: String,
    pub sequence: u64,
    pub bytes: Vec<u8>,
}
pub enum Input {
    Data(Vec<u8>),
    Resize(u32, u32),
}
struct Entry {
    session: Session,
    cancel: CancellationToken,
    input: mpsc::Sender<Input>,
    queue: VecDeque<Frame>,
    bytes: usize,
    sequence: u64,
    sent: Option<u64>,
    channel: Option<Channel<Frame>>,
    credit: Arc<Notify>,
    input_sequence: u64,
    dimensions: watch::Sender<(u32, u32)>,
}
#[derive(Default)]
pub struct Manager {
    entries: Mutex<BTreeMap<String, Entry>>,
    requests: Mutex<BTreeMap<String, String>>,
}
impl Manager {
    pub fn list(&self) -> Vec<Session> {
        self.entries
            .lock()
            .unwrap()
            .values()
            .map(|e| e.session.clone())
            .collect()
    }
    pub fn busy(&self, service: &str) -> bool {
        self.list()
            .iter()
            .any(|s| s.active() && s.service_id.as_deref() == Some(service))
    }
    pub fn existing(
        &self,
        request: &str,
        client: &str,
        host: &str,
        service: &Option<String>,
        action: &Option<String>,
    ) -> Result<Option<Session>, String> {
        let entries = self.entries.lock().unwrap();
        let requests = self.requests.lock().unwrap();
        let Some(id) = requests.get(request) else {
            return Ok(None);
        };
        let e = entries.get(id).ok_or("requestExpired")?;
        if e.session.client_id != client
            || e.session.host_id != host
            || &e.session.service_id != service
            || &e.session.action_id != action
        {
            return Err("staleSession".into());
        }
        Ok(Some(e.session.clone()))
    }
    pub fn register(
        &self,
        session: Session,
    ) -> Result<(Session, CancellationToken, Option<mpsc::Receiver<Input>>), String> {
        let mut entries = self.entries.lock().unwrap();
        let mut requests = self.requests.lock().unwrap();
        if let Some(id) = requests.get(&session.request_id) {
            let e = entries.get(id).ok_or("requestExpired")?;
            if e.session.client_id != session.client_id
                || e.session.host_id != session.host_id
                || e.session.service_id != session.service_id
                || e.session.action_id != session.action_id
            {
                return Err("staleSession".into());
            }
            return Ok((e.session.clone(), e.cancel.clone(), None));
        }
        if entries.values().filter(|e| e.session.active()).count() >= 8 || requests.len() >= 4096 {
            return Err("terminalLimit".into());
        }
        if entries.len() >= 64 {
            let old = entries
                .iter()
                .filter(|(_, e)| !e.session.active())
                .min_by_key(|(_, e)| e.session.started_at)
                .map(|(id, _)| id.clone())
                .ok_or("terminalLimit")?;
            entries.remove(&old);
        }
        let (cancel, (input, receiver)) = (CancellationToken::new(), mpsc::channel(64));
        requests.insert(session.request_id.clone(), session.id.clone());
        entries.insert(
            session.id.clone(),
            Entry {
                session: session.clone(),
                cancel: cancel.clone(),
                input,
                queue: VecDeque::new(),
                bytes: 0,
                sequence: 0,
                sent: None,
                channel: None,
                credit: Arc::new(Notify::new()),
                input_sequence: 0,
                dimensions: watch::channel((session.cols, session.rows)).0,
            },
        );
        Ok((session, cancel, Some(receiver)))
    }
    pub fn change(&self, id: &str, update: impl FnOnce(&mut Session)) {
        if let Some(e) = self.entries.lock().unwrap().get_mut(id) {
            update(&mut e.session);
            e.session.revision += 1;
        }
    }
    pub fn finish(&self, id: &str, phase: &str, error: Option<String>) {
        self.change(id, |s| {
            s.phase = phase.into();
            s.error = error;
            s.finished_at = Some(timestamp());
            s.fingerprint = None;
            s.verification_endpoint = None;
        });
    }
    fn owner<'a>(
        entries: &'a mut BTreeMap<String, Entry>,
        id: &str,
        client: &str,
    ) -> Result<&'a mut Entry, String> {
        let e = entries.get_mut(id).ok_or("sessionMissing")?;
        if e.session.client_id != client {
            return Err("staleSession".into());
        }
        Ok(e)
    }
    fn pump(e: &mut Entry) {
        if e.sent.is_none() {
            if let (Some(channel), Some(frame)) = (&e.channel, e.queue.front()) {
                if channel.send(frame.clone()).is_ok() {
                    e.sent = Some(frame.sequence);
                } else {
                    e.channel = None;
                    e.cancel.cancel();
                }
            }
        }
    }
    pub fn attach(&self, id: &str, client: &str, channel: Channel<Frame>) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        let e = Self::owner(&mut entries, id, client)?;
        if e.channel.is_some() {
            return Err("alreadyAttached".into());
        }
        e.channel = Some(channel);
        e.sent = None;
        Self::pump(e);
        Ok(())
    }
    pub fn ack(&self, id: &str, client: &str, sequence: u64) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        let e = Self::owner(&mut entries, id, client)?;
        if e.sent == Some(sequence) {
            if let Some(frame) = e.queue.pop_front() {
                e.bytes -= frame.bytes.len();
            }
            e.sent = None;
            e.credit.notify_one();
            Self::pump(e);
        }
        Ok(())
    }
    pub async fn output(&self, id: &str, bytes: &[u8], cancel: &CancellationToken) -> bool {
        for part in bytes.chunks(16384) {
            loop {
                let credit = {
                    let mut entries = self.entries.lock().unwrap();
                    let Some(e) = entries.get_mut(id) else {
                        return false;
                    };
                    if e.bytes + part.len() <= OUTPUT_LIMIT {
                        e.sequence += 1;
                        e.queue.push_back(Frame {
                            id: id.into(),
                            sequence: e.sequence,
                            bytes: part.to_vec(),
                        });
                        e.bytes += part.len();
                        Self::pump(e);
                        None
                    } else {
                        Some(e.credit.clone())
                    }
                };
                if let Some(credit) = credit {
                    tokio::select! {_=cancel.cancelled()=>return false,_=credit.notified()=>{}}
                } else {
                    break;
                }
            }
        }
        true
    }
    pub fn input(
        &self,
        id: &str,
        client: &str,
        sequence: u64,
        bytes: Vec<u8>,
    ) -> Result<(), String> {
        if bytes.is_empty() || bytes.len() > 4096 {
            return Err("inputLimit".into());
        }
        let mut entries = self.entries.lock().unwrap();
        let e = Self::owner(&mut entries, id, client)?;
        if e.session.phase != "running" || !e.session.active() {
            return Err("notRunning".into());
        }
        if sequence <= e.input_sequence {
            return Ok(());
        }
        if sequence != e.input_sequence + 1 {
            return Err("inputSequence".into());
        }
        e.input
            .try_send(Input::Data(bytes))
            .map_err(|_| "inputBusy")?;
        e.input_sequence = sequence;
        Ok(())
    }
    pub fn resize(&self, id: &str, client: &str, cols: u32, rows: u32) -> Result<(), String> {
        dimensions(cols, rows)?;
        let mut entries = self.entries.lock().unwrap();
        let e = Self::owner(&mut entries, id, client)?;
        if !e.session.active() {
            return Ok(());
        }
        if e.session.cols == cols && e.session.rows == rows {
            return Ok(());
        }
        e.dimensions.send_replace((cols, rows));
        e.session.cols = cols;
        e.session.rows = rows;
        Ok(())
    }
    fn size_receiver(&self, id: &str) -> Option<watch::Receiver<(u32, u32)>> {
        self.entries
            .lock()
            .unwrap()
            .get(id)
            .map(|e| e.dimensions.subscribe())
    }
    pub fn cancel(&self, id: &str, client: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        let e = Self::owner(&mut entries, id, client)?;
        e.cancel.cancel();
        Ok(())
    }
    pub fn detach(&self, id: &str, client: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        let e = Self::owner(&mut entries, id, client)?;
        e.channel = None;
        e.sent = None;
        e.cancel.cancel();
        e.credit.notify_one();
        Ok(())
    }
    pub fn cancel_all(&self) {
        for e in self.entries.lock().unwrap().values() {
            e.cancel.cancel();
            e.credit.notify_one();
        }
    }
    pub fn forget(&self, id: &str, client: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        let Some(e) = entries.get(id) else {
            return Ok(());
        };
        if e.session.active() {
            if e.session.client_id != client {
                return Err("staleSession".into());
            }
            return Err("stillRunning".into());
        }
        entries.remove(id);
        Ok(())
    }
}
pub fn dimensions(cols: u32, rows: u32) -> Result<(), String> {
    if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
        Err("invalidSize".into())
    } else {
        Ok(())
    }
}
pub type Changed = Arc<dyn Fn() + Send + Sync>;
pub struct Request {
    pub hops: Vec<tunnel::HopRequest>,
    pub command: Option<String>,
    pub timeout_secs: Option<u64>,
    pub success_codes: Vec<u32>,
    pub notify: tunnel::Notify,
    pub prompt: tunnel::TrustPrompt,
    pub observer: Option<tunnel::PasswordObserver>,
    pub validate: Arc<dyn Fn() -> bool + Send + Sync>,
    pub changed: Changed,
}
pub async fn execute(
    manager: Arc<Manager>,
    id: String,
    cancel: CancellationToken,
    mut input: mpsc::Receiver<Input>,
    request: Request,
) {
    let runtime = Arc::new(Mutex::new(Runtime::default()));
    let connection = match tunnel::connect(
        request.hops,
        None,
        &cancel,
        &request.notify,
        request.prompt,
        &runtime,
        request.observer,
    )
    .await
    {
        Ok(Some(c)) => c,
        Ok(None) => {
            manager.finish(&id, "disconnected", Some("notExecuted".into()));
            (request.changed)();
            return;
        }
        Err(e) => {
            manager.finish(
                &id,
                "failed",
                Some(
                    match e.kind {
                        FailureKind::Authentication => "authentication",
                        FailureKind::HostKey => "hostKey",
                        FailureKind::Timeout => "connectionTimeout",
                        _ => "connectionFailed",
                    }
                    .into(),
                ),
            );
            (request.changed)();
            return;
        }
    };
    let result = async {
        if !(request.validate)() {
            return ("failed", Some("staleSession".into()));
        }
        let opened = tokio::time::timeout(Duration::from_secs(15), connection.open_session()).await;
        let Ok(Ok(mut channel)) = opened else {
            return ("failed", Some("channelRejected".into()));
        };
        let size = manager
            .list()
            .into_iter()
            .find(|s| s.id == id)
            .map(|s| (s.cols, s.rows))
            .unwrap_or((80, 24));
        manager.change(&id, |s| s.phase = "opening-pty".into());
        (request.changed)();
        let negotiate = async {
            channel
                .request_pty(
                    true,
                    "xterm-256color",
                    size.0,
                    size.1,
                    0,
                    0,
                    &[
                        (Pty::ECHO, 1),
                        (Pty::ICANON, 1),
                        (Pty::ISIG, 1),
                        (Pty::IUTF8, 1),
                    ],
                )
                .await
                .map_err(|_| "ptyRejected")?;
            loop {
                match channel.wait().await {
                    Some(ChannelMsg::Success) => break,
                    Some(ChannelMsg::Failure) | None => return Err("ptyRejected"),
                    _ => {}
                }
            }
            if !(request.validate)() {
                return Err("staleSession");
            }
            manager.change(&id, |s| s.submitted = true);
            if let Some(command) = &request.command {
                channel
                    .exec(true, command.as_bytes().to_vec())
                    .await
                    .map_err(|_| "remoteUnknown")?;
            } else {
                channel
                    .request_shell(true)
                    .await
                    .map_err(|_| "shellRejected")?;
            }
            let mut early = Vec::new();
            loop {
                match channel.wait().await {
                    Some(ChannelMsg::Success) => return Ok(early),
                    Some(ChannelMsg::Failure) | None => {
                        return Err(if request.command.is_some() {
                            "execRejected"
                        } else {
                            "shellRejected"
                        })
                    }
                    Some(ChannelMsg::Data { data }) => {
                        if early.len() + data.len() > OUTPUT_LIMIT {
                            return Err("negotiationOverflow");
                        }
                        early.extend_from_slice(&data);
                    }
                    _ => {}
                }
            }
        };
        let early = match tokio::time::timeout(Duration::from_secs(15), negotiate).await {
            Ok(Ok(early)) => early,
            Ok(Err(e)) => return ("failed", Some(e.into())),
            Err(_) => return ("failed", Some("sessionTimeout".into())),
        };
        manager.change(&id, |s| s.phase = "running".into());
        (request.changed)();
        let (mut reader, writer) = channel.split();
        let read = async {
            if !manager.output(&id, &early, &cancel).await {
                return ("disconnected", Some("remoteUnknown".into()));
            }
            let mut code = None;
            let mut signal = None;
            loop {
                match reader.wait().await {
                    Some(ChannelMsg::Data { data })
                    | Some(ChannelMsg::ExtendedData { data, .. }) => {
                        if !manager.output(&id, &data, &cancel).await {
                            return ("disconnected", Some("remoteUnknown".into()));
                        }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        code = Some(exit_status);
                        manager.change(&id, |s| s.exit_code = code);
                    }
                    Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                        signal = Some(format!("{signal_name:?}"));
                        manager.change(&id, |s| s.exit_signal = signal.clone());
                    }
                    Some(ChannelMsg::Close) | None => {
                        return if signal.is_some() {
                            ("failed", Some("exitSignal".into()))
                        } else if let Some(code) = code {
                            if request.command.is_none() || request.success_codes.contains(&code) {
                                ("exited", None)
                            } else {
                                ("failed", Some("exitCode".into()))
                            }
                        } else {
                            ("interrupted", Some("remoteUnknown".into()))
                        }
                    }
                    _ => {}
                }
            }
        };
        let mut sizes = manager.size_receiver(&id).unwrap();
        let write = async {
            let size = *sizes.borrow_and_update();
            if writer.window_change(size.0, size.1, 0, 0).await.is_err() {
                return ("interrupted", Some("remoteUnknown".into()));
            }
            loop {
                let event = tokio::select! {
                    event=input.recv()=>match event {Some(event)=>event,None=>return ("disconnected",None)},
                    changed=sizes.changed()=>{if changed.is_err() {return ("disconnected",None);}let size=*sizes.borrow_and_update();Input::Resize(size.0,size.1)}
                };
                let result = match event {
                    Input::Data(bytes) => writer.data_bytes(bytes).await,
                    Input::Resize(cols, rows) => writer.window_change(cols, rows, 0, 0).await,
                };
                if result.is_err() {
                    return ("interrupted", Some("remoteUnknown".into()));
                }
            }
        };
        let deadline = async {
            if let Some(seconds) = request.timeout_secs.filter(|seconds| *seconds > 0) {
                tokio::time::sleep(Duration::from_secs(seconds)).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::select! {result=read=>result,result=write=>result,_=deadline=>("timedOut",Some("remoteUnknown".into()))}
    };
    let (phase, error) = tokio::select! {biased;_=cancel.cancelled()=>("disconnected",Some("remoteUnknown".into())),result=result=>result};
    connection.close().await;
    manager.finish(&id, phase, error);
    (request.changed)();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session(id: &str) -> Session {
        Session {
            rule_id: None,
            id: id.into(),
            request_id: format!("request-{id}"),
            client_id: "owner".into(),
            host_id: "host".into(),
            route_host_ids: vec!["host".into()],
            host_name: "test".into(),
            endpoint: "test".into(),
            service_id: None,
            action_id: None,
            label: "test".into(),
            phase: "running".into(),
            revision: 1,
            started_at: 1,
            finished_at: None,
            submitted: true,
            exit_code: None,
            exit_signal: None,
            error: None,
            fingerprint: None,
            verification_endpoint: None,
            cols: 80,
            rows: 24,
        }
    }
    #[tokio::test]
    async fn lossless_backpressure_bounds_output_and_does_not_block_input_or_cancel() {
        let manager = Arc::new(Manager::default());
        let (_, cancel, mut input) = manager.register(session("bounded")).unwrap();
        let payload: Vec<_> = (0..OUTPUT_LIMIT + 65536).map(|i| (i % 251) as u8).collect();
        let expected = payload.clone();
        let writer = {
            let m = manager.clone();
            let c = cancel.clone();
            tokio::spawn(async move { m.output("bounded", &payload, &c).await })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.entries.lock().unwrap()["bounded"].bytes < OUTPUT_LIMIT {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(!writer.is_finished());
        manager
            .input("bounded", "owner", 1, b"\x03".to_vec())
            .unwrap();
        assert!(
            matches!(input.as_mut().unwrap().recv().await,Some(Input::Data(bytes))if bytes==[3])
        );
        let (tx, mut rx) = mpsc::unbounded_channel();
        manager
            .attach(
                "bounded",
                "owner",
                Channel::new(move |body| {
                    if let tauri::ipc::InvokeResponseBody::Json(s) = body {
                        let _ = tx.send(serde_json::from_str::<serde_json::Value>(&s).unwrap());
                    }
                    Ok(())
                }),
            )
            .unwrap();
        let mut received = Vec::new();
        while received.len() < expected.len() {
            let event = tokio::time::timeout(Duration::from_secs(2), rx.recv())
                .await
                .unwrap()
                .unwrap();
            received.extend(
                event["bytes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|b| b.as_u64().unwrap() as u8),
            );
            manager
                .ack("bounded", "owner", event["sequence"].as_u64().unwrap())
                .unwrap();
        }
        assert_eq!(received, expected);
        assert!(writer.await.unwrap());
        let writer = {
            let m = manager.clone();
            let c = cancel.clone();
            tokio::spawn(async move { m.output("bounded", &vec![0; OUTPUT_LIMIT * 2], &c).await })
        };
        tokio::task::yield_now().await;
        manager.cancel_all();
        assert!(!tokio::time::timeout(Duration::from_secs(2), writer)
            .await
            .unwrap()
            .unwrap());
    }
    #[tokio::test]
    async fn input_ownership_sequences_dedup_and_limits_never_replay_a_session() {
        let manager = Manager::default();
        let original = session("one");
        let (_, _, mut receiver) = manager.register(original.clone()).unwrap();
        assert!(manager.register(original.clone()).unwrap().2.is_none());
        assert_eq!(
            manager
                .input("one", "different", 1, b"CANARY_SECRET".to_vec())
                .unwrap_err(),
            "staleSession"
        );
        assert_eq!(
            manager
                .input("one", "owner", 2, b"invalid".to_vec())
                .unwrap_err(),
            "inputSequence"
        );
        manager
            .input("one", "owner", 1, b"CANARY_SECRET".to_vec())
            .unwrap();
        manager
            .input("one", "owner", 1, b"duplicate".to_vec())
            .unwrap();
        assert!(
            matches!(receiver.as_mut().unwrap().recv().await,Some(Input::Data(bytes)) if bytes==b"CANARY_SECRET")
        );
        assert!(receiver.as_mut().unwrap().try_recv().is_err());
        assert!(!serde_json::to_string(&manager.list())
            .unwrap()
            .contains("CANARY_SECRET"));
        for i in 2..=8 {
            manager.register(session(&i.to_string())).unwrap();
        }
        assert_eq!(
            manager.register(session("nine")).err().unwrap(),
            "terminalLimit"
        );
        manager.finish("one", "exited", None);
        manager.forget("one", "owner").unwrap();
        assert_eq!(
            manager
                .existing(&original.request_id, "owner", "host", &None, &None)
                .unwrap_err(),
            "requestExpired"
        );
        assert!(manager.input("2", "owner", 1, vec![0; 4097]).is_err());
    }
}
