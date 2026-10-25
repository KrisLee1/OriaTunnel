//! One desired session owns cancellation, bounded retry and all ephemeral credentials.
use crate::{
    model::{timestamp, FailureKind, MetricPoint, Runtime},
    tunnel::{self, Notify, RunRequest, TrustPrompt},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{oneshot, watch};
use tokio_util::sync::CancellationToken;

pub type Validate = Arc<dyn Fn() -> bool + Send + Sync>;
struct Metrics {
    started: tokio::time::Instant,
    sent: u64,
    received: u64,
    sampled: tokio::time::Instant,
    sample_sent: u64,
    sample_received: u64,
    history: Vec<MetricPoint>,
}
impl Metrics {
    fn enrich(&mut self, r: &mut Runtime) {
        r.sent = r.sent.saturating_add(self.sent);
        r.received = r.received.saturating_add(self.received);
        r.uptime_secs = self.started.elapsed().as_secs();
        let elapsed = self.sampled.elapsed();
        if elapsed >= Duration::from_millis(400) {
            let sent =
                ((r.sent.saturating_sub(self.sample_sent)) as f64 / elapsed.as_secs_f64()) as u64;
            let received = ((r.received.saturating_sub(self.sample_received)) as f64
                / elapsed.as_secs_f64()) as u64;
            self.history.push(MetricPoint {
                timestamp: timestamp(),
                sent_per_second: sent,
                received_per_second: received,
            });
            if self.history.len() > 120 {
                self.history.remove(0);
            }
            self.sampled = tokio::time::Instant::now();
            self.sample_sent = r.sent;
            self.sample_received = r.received;
        }
        if let Some(point) = self.history.last() {
            r.sent_per_second = Some(point.sent_per_second);
            r.received_per_second = Some(point.received_per_second);
        }
        r.history = self.history.clone();
    }
}

pub async fn run(
    request: RunRequest,
    cancel: CancellationToken,
    wake: watch::Receiver<u64>,
    notify: Notify,
    prompt: TrustPrompt,
    validate: Validate,
) {
    run_with_password_observer(request, cancel, wake, notify, prompt, validate, None).await;
}
pub async fn run_with_password_observer(
    mut request: RunRequest,
    cancel: CancellationToken,
    mut wake: watch::Receiver<u64>,
    notify: Notify,
    prompt: TrustPrompt,
    validate: Validate,
    observer: Option<tunnel::PasswordObserver>,
) {
    let policy = request.rule.reconnect.clone();
    let test_only = request.test_only;
    let trusted = Arc::new(Mutex::new(BTreeMap::new()));
    let metrics = Arc::new(Mutex::new(Metrics {
        started: tokio::time::Instant::now(),
        sent: 0,
        received: 0,
        sampled: tokio::time::Instant::now(),
        sample_sent: 0,
        sample_received: 0,
        history: Vec::new(),
    }));
    let mut retries = 0;
    let mut consecutive = 0;
    loop {
        let attempt_cancel = cancel.child_token();
        // An expired attempt cannot emit late state or open a new trust prompt.
        let active = Arc::new(Mutex::new(true));
        let listening_since = Arc::new(Mutex::new(None::<tokio::time::Instant>));
        let last = Arc::new(Mutex::new(Runtime {
            rule_id: request.rule.id.clone(),
            run_id: request.run_id.clone(),
            ..Default::default()
        }));
        let output: Notify = {
            let active = active.clone();
            let last = last.clone();
            let metrics = metrics.clone();
            let notify = notify.clone();
            let listening_since = listening_since.clone();
            Arc::new(move |mut r| {
                let live = active.lock().unwrap();
                if !*live {
                    return;
                }
                r.retry_count = retries;
                r.desired_running = true;
                if r.status == "listening" {
                    listening_since
                        .lock()
                        .unwrap()
                        .get_or_insert_with(tokio::time::Instant::now);
                }
                metrics.lock().unwrap().enrich(&mut r);
                *last.lock().unwrap() = r.clone();
                if !matches!(r.status.as_str(), "stopped" | "failed" | "tested") {
                    notify(r);
                }
            })
        };
        let trust: TrustPrompt = {
            let active = active.clone();
            let trusted = trusted.clone();
            let prompt = prompt.clone();
            let c = attempt_cancel.clone();
            Arc::new(move |endpoint, fingerprint, reply| {
                let live = active.lock().unwrap();
                if !*live {
                    return;
                }
                let (tx, rx) = oneshot::channel();
                prompt(endpoint.clone(), fingerprint.clone(), tx);
                let trusted = trusted.clone();
                let c = c.clone();
                tokio::spawn(async move {
                    let accepted =
                        tokio::select! {biased; _=c.cancelled()=>false,r=rx=>r.unwrap_or(false)};
                    if accepted {
                        trusted.lock().unwrap().insert(endpoint, fingerprint);
                    }
                    let _ = reply.send(accepted);
                });
            })
        };
        {
            let keys = trusted.lock().unwrap();
            if let Some(key) = keys.get(&format!("{}:{}", request.host.address, request.host.port))
            {
                request.expected = Some(key.clone());
            }
            for hop in &mut request.jumps {
                if let Some(key) = keys.get(&format!("{}:{}", hop.host.address, hop.host.port)) {
                    hop.expected = Some(key.clone());
                }
            }
        }
        let attempt = tunnel::run_with_password_observer(
            request.clone(),
            attempt_cancel.clone(),
            output,
            trust,
            observer.clone(),
        );
        tokio::pin!(attempt);
        let resumed = tokio::select! {biased;
            _=cancel.cancelled()=>{attempt_cancel.cancel();attempt.await;false},
            _=wake.changed()=>{attempt_cancel.cancel();attempt.await;true},
            _=&mut attempt=>false,
        };
        *active.lock().unwrap() = false;
        let mut r = last.lock().unwrap().clone();
        r.connections = 0;
        if cancel.is_cancelled() {
            r.status = "stopped".into();
            r.message.clear();
            r.error_kind = None;
            r.desired_running = false;
            r.retry_at = None;
            r.sent_per_second = r.sent_per_second.map(|_| 0);
            r.received_per_second = r.received_per_second.map(|_| 0);
            notify(r);
            break;
        }
        if resumed {
            r.error_kind = Some(FailureKind::Network);
            r.message = crate::native_message::plain("runtimeWake");
        }
        if test_only || (!resumed && r.status == "tested") {
            r.desired_running = false;
            notify(r);
            break;
        }
        if (resumed || r.error_kind.is_some_and(FailureKind::retryable))
            && !request.rule.no_remote_command
            && !request.rule.repeat_command_on_reconnect
        {
            r.status = "needs-attention".into();
            r.desired_running = false;
            r.retry_at = None;
            r.error_kind = Some(FailureKind::RemoteCommand);
            r.message = crate::native_message::plain("runtimeCommandReconnect");
            notify(r);
            break;
        }
        // A stable connection starts a fresh failure budget. Repeated system wakes
        // do not exhaust the network-failure budget over days of normal use.
        if listening_since
            .lock()
            .unwrap()
            .is_some_and(|since| since.elapsed() >= Duration::from_secs(60))
        {
            consecutive = 0;
        }
        let retry = policy.enabled
            && r.error_kind.is_some_and(FailureKind::retryable)
            && (resumed || consecutive < policy.max_attempts);
        if !retry {
            r.status = "needs-attention".into();
            r.desired_running = false;
            r.retry_at = None;
            r.sent_per_second = r.sent_per_second.map(|_| 0);
            r.received_per_second = r.received_per_second.map(|_| 0);
            notify(r);
            break;
        }
        retries += 1;
        if !resumed {
            consecutive += 1;
        }
        {
            let mut m = metrics.lock().unwrap();
            m.sent = r.sent;
            m.received = r.received;
        }
        let delay = if resumed {
            Duration::ZERO
        } else {
            policy.delay(consecutive)
        };
        r.status = "reconnecting".into();
        r.retry_count = retries;
        r.retry_at = Some(timestamp().saturating_add(delay.as_millis() as u64));
        r.sent_per_second = r.sent_per_second.map(|_| 0);
        r.received_per_second = r.received_per_second.map(|_| 0);
        notify(r.clone());
        tokio::select! {biased;
            _=cancel.cancelled()=>{r.status="stopped".into();r.desired_running=false;r.retry_at=None;r.message.clear();notify(r);break;},
            _=wake.changed()=>{},
            _=tokio::time::sleep(delay)=>{},
        }
        if !validate() {
            r.status = "needs-attention".into();
            r.desired_running = false;
            r.retry_at = None;
            r.error_kind = Some(FailureKind::Configuration);
            r.message = crate::native_message::plain("runtimeConfigChanged");
            notify(r);
            break;
        }
        request.run_id = uuid::Uuid::new_v4().to_string();
    }
}
