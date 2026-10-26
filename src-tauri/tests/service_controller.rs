#![cfg(any(unix, windows))]
#[path = "common/service_server.rs"]
mod server;
use oria_tunnel_lib::{
    commands::{Action, Manager, Run, Service},
    model::{timestamp, AuthMethod, Host, Rule},
    service_control::{self as control, Observations, Operation},
    tunnel,
};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
fn host(port: u16) -> Host {
    Host {
        id: format!("host-{port}"),
        name: "isolated".into(),
        address: "127.0.0.1".into(),
        port,
        user: "tester".into(),
        auth_method: AuthMethod::Password,
        ..Default::default()
    }
}
fn action(id: &str, kind: &str, command: &str) -> Action {
    Action {
        invocation: None,
        mode: Default::default(),
        id: id.into(),
        kind: kind.into(),
        label: id.into(),
        command: command.into(),
        timeout_secs: 5,
        success_codes: vec![0],
        confirm: false,
    }
}
fn service() -> Service {
    Service {
        category: None,
        color: None,
        icon: None,
        port: Some(3000),
        host_ids: vec!["execution".into()],
        id: "service".into(),
        name: "Model".into(),
        execution_host_id: "execution".into(),
        rule_ids: vec!["forward".into(), "other-forward".into()],
        revision: "v1".into(),
        no_local_environment: true,
        actions: vec![
            action("start", "start", "fixture-start"),
            action("status", "status", "fixture-status"),
            action("stop", "stop", "fixture-stop"),
        ],
        execution_enabled: true,
        control: control::Control {
            status_probe: Some(control::StatusProbe {
                action_id: "status".into(),
                mode: "exitCode".into(),
                running_codes: vec![0],
                stopped_codes: vec![3],
                failed_codes: vec![4],
            }),
            health_probe: Some(control::HealthProbe {
                command: "fixture-health".into(),
                ready_codes: vec![0],
                not_ready_codes: vec![22],
                repeatable: true,
                timeout_secs: 5,
                interval_secs: 1,
                budget_secs: 6,
            }),
            start_action_id: Some("start".into()),
            check_after_actions: false,
            ttl_secs: 60,
        },
    }
}
fn run(id: &str) -> Run {
    serde_json::from_value(serde_json::json!({"id":id,"requestId":format!("request-{id}"),"serviceId":"service","actionId":"$connect:forward","serviceRevision":"v1","hostId":"execution","hostName":"isolated","endpoint":"loopback","actionLabel":"test","phase":"connecting","submitted":false,"exitCode":null,"exitSignal":null,"error":null,"startedAt":timestamp(),"finishedAt":null,"fingerprint":null,"verificationEndpoint":null,"revision":1,"truncated":false})).unwrap()
}
fn request(port: u16, s: Service, operation: Operation) -> control::Request {
    control::Request {
        service: s,
        action: None,
        operation,
        hops: vec![tunnel::HopRequest {
            host: host(port),
            secret: "isolated-test-only".into(),
            expected: None,
        }],
        notify: Arc::new(|_| {}),
        prompt: Arc::new(|_, _, tx| {
            let _ = tx.send(true);
        }),
        observer: None,
        validate: Arc::new(|| true),
        changed: Arc::new(|| {}),
        identity: "identity".into(),
        forward: None,
    }
}
async fn execute(m: &Arc<Manager>, o: &Arc<Observations>, id: &str, r: control::Request) -> Run {
    let (_, cancel, created) = m.register(run(id)).unwrap();
    assert!(created);
    tokio::time::timeout(
        Duration::from_secs(15),
        control::execute(m.clone(), o.clone(), id.into(), cancel, r),
    )
    .await
    .unwrap();
    m.list().into_iter().find(|r| r.id == id).unwrap()
}
fn forward_counter(calls: Arc<AtomicUsize>) -> control::Forward {
    Arc::new(move |_| {
        let calls = calls.clone();
        Box::pin(async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("forwardFailed".into())
        })
    })
}
async fn phase(m: &Manager, id: &str, name: &str) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if m.list().iter().any(|r| r.id == id && r.phase == name) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn delayed_real_http_readiness_starts_once_then_forwards_real_bytes_on_another_ssh_host() {
    let (port, fixture, server) = server::start().await;
    let (forward_port, other, other_server) = server::start().await;
    let echo = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = echo.local_addr().unwrap().port();
    let echo_job = tokio::spawn(async move {
        let (mut s, _) = echo.accept().await.unwrap();
        let (mut rd, mut wr) = s.split();
        tokio::io::copy(&mut rd, &mut wr).await.unwrap();
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bind = listener.local_addr().unwrap().port();
    drop(listener);
    let cancel = CancellationToken::new();
    let joins = Arc::new(Mutex::new(Vec::new()));
    let invoked = Arc::new(AtomicUsize::new(0));
    let forward: control::Forward = {
        let cancel = cancel.clone();
        let joins = joins.clone();
        let invoked = invoked.clone();
        Arc::new(move |_| {
            let cancel = cancel.clone();
            let joins = joins.clone();
            let invoked = invoked.clone();
            Box::pin(async move {
                let created = invoked.fetch_add(1, Ordering::SeqCst) == 0;
                if created {
                    let ready = Arc::new(tokio::sync::Notify::new());
                    let observed = ready.clone();
                    let job = tokio::spawn(tunnel::run(
                        tunnel::RunRequest {
                            host: host(forward_port),
                            rule: Rule {
                                id: "forward".into(),
                                name: "isolated-forward".into(),
                                host_id: host(forward_port).id,
                                bind_port: bind,
                                target_host: "127.0.0.1".into(),
                                target_port: target,
                                ..Default::default()
                            },
                            secret: "isolated-test-only".into(),
                            expected: None,
                            run_id: "forward-generation".into(),
                            jumps: vec![],
                            test_only: false,
                        },
                        cancel,
                        Arc::new(move |r| {
                            if r.status == "listening" {
                                observed.notify_one();
                            }
                        }),
                        Arc::new(|_, _, tx| {
                            let _ = tx.send(true);
                        }),
                    ));
                    joins.lock().unwrap().push(job);
                    tokio::time::timeout(Duration::from_secs(5), ready.notified())
                        .await
                        .unwrap();
                }
                Ok(control::ForwardResult {
                    created,
                    run_id: "forward-generation".into(),
                })
            })
        })
    };
    let m = Arc::new(Manager::default());
    let o = Arc::new(Observations::default());
    let s = service();
    let mut r = request(port, s.clone(), Operation::Connect);
    r.forward = Some(forward.clone());
    let done = execute(&m, &o, "first", r).await;
    assert_eq!(done.phase, "succeeded", "probe steps: {:?}", done.steps);
    assert!(done.workflow_forward_created);
    assert!(done
        .steps
        .iter()
        .any(|s| s.kind == "health" && s.attempt >= 2));
    assert_eq!(o.view(&s, "identity", timestamp()).health.value, "ready");
    assert!(other.history.lock().unwrap().is_empty());
    let mut r = request(port, s.clone(), Operation::Connect);
    r.forward = Some(forward);
    let reused = execute(&m, &o, "second", r).await;
    assert_eq!(reused.phase, "succeeded");
    assert!(!reused.workflow_forward_created);
    assert!(!reused.steps.iter().any(|s| s.kind == "start"));
    assert_eq!(
        fixture
            .history
            .lock()
            .unwrap()
            .iter()
            .filter(|s| *s == "fixture-start")
            .count(),
        1
    );
    let mut blocked = service();
    let probe = blocked.control.health_probe.as_mut().unwrap();
    probe.command = "fixture-health-closed".into();
    probe.not_ready_codes = vec![7];
    probe.repeatable = false;
    let mut request = request(port, blocked, Operation::Connect);
    request.forward = Some(forward_counter(invoked.clone()));
    let failed = execute(&m, &o, "existing-preserved", request).await;
    assert_eq!(failed.error.as_deref(), Some("notReady"));
    assert_eq!(invoked.load(Ordering::SeqCst), 2);
    assert!(!m.register(run("first")).unwrap().2);
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", bind))
        .await
        .unwrap();
    stream.write_all(b"service-ready").await.unwrap();
    let mut bytes = [0; 13];
    tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&bytes, b"service-ready");
    drop(stream);
    echo_job.await.unwrap();
    cancel.cancel();
    let jobs = std::mem::take(&mut *joins.lock().unwrap());
    for job in jobs {
        job.await.unwrap();
    }
    fixture.shutdown.cancel();
    other.shutdown.cancel();
    server.abort();
    other_server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn closed_port_and_failed_forward_preserve_service_without_claiming_readiness_or_retrying_start(
) {
    let (port, fixture, server) = server::start().await;
    std::fs::write(fixture.home.path().join("started"), "").unwrap();
    let m = Arc::new(Manager::default());
    let o = Arc::new(Observations::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let mut s = service();
    let p = s.control.health_probe.as_mut().unwrap();
    p.command = "fixture-health-closed".into();
    p.not_ready_codes = vec![7];
    p.budget_secs = 2;
    let mut r = request(port, s.clone(), Operation::Connect);
    r.forward = Some(forward_counter(calls.clone()));
    let done = execute(&m, &o, "closed", r).await;
    assert_eq!(done.error.as_deref(), Some("readinessTimeout"));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let obs = o.view(&s, "identity", timestamp());
    assert_eq!(obs.status.value, "running");
    assert_eq!(obs.health.value, "notReady");
    s.control.health_probe = None;
    let mut r = request(port, s.clone(), Operation::Connect);
    r.forward = Some(forward_counter(calls.clone()));
    let done = execute(&m, &o, "forward-fail", r).await;
    assert_eq!(done.error.as_deref(), Some("forwardFailed"));
    assert_eq!(done.steps.last().unwrap().kind, "forward");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let history = fixture.history.lock().unwrap();
    assert!(!history
        .iter()
        .any(|s| s == "fixture-start" || s == "fixture-stop"));
    drop(history);
    fixture.shutdown.cancel();
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn invalid_unmapped_truncated_or_unknown_status_never_connects_or_starts() {
    let (port, fixture, server) = server::start().await;
    let m = Arc::new(Manager::default());
    let o = Arc::new(Observations::default());
    let calls = Arc::new(AtomicUsize::new(0));
    for (i, cmd) in [
        "fixture-unmapped",
        "fixture-bad-json",
        "fixture-unknown",
        "fixture-large",
    ]
    .iter()
    .enumerate()
    {
        let mut s = service();
        s.actions[1].command = (*cmd).into();
        if *cmd == "fixture-bad-json" {
            s.control.status_probe.as_mut().unwrap().mode = "json".into();
        }
        let mut r = request(port, s.clone(), Operation::Connect);
        r.forward = Some(forward_counter(calls.clone()));
        let done = execute(&m, &o, &format!("invalid-{i}"), r).await;
        assert_eq!(done.phase, "failed");
        assert_eq!(o.view(&s, "identity", timestamp()).status.value, "unknown");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(!fixture
        .history
        .lock()
        .unwrap()
        .iter()
        .any(|s| s == "fixture-start"));
    fixture.shutdown.cancel();
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn cancellation_and_configuration_change_during_wait_prevent_late_forward_and_serialize_shared_service(
) {
    let (port, fixture, server) = server::start().await;
    let m = Arc::new(Manager::default());
    let o = Arc::new(Observations::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let mut s = service();
    s.control.health_probe.as_mut().unwrap().command = "fixture-hang".into();
    let mut r = request(port, s.clone(), Operation::Connect);
    r.forward = Some(forward_counter(calls.clone()));
    let (_, cancel, _) = m.register(run("cancel")).unwrap();
    let job = tokio::spawn(control::execute(
        m.clone(),
        o.clone(),
        "cancel".into(),
        cancel,
        r,
    ));
    phase(&m, "cancel", "checking-health").await;
    assert_eq!(m.register(run("double-click")).unwrap_err(), "serviceBusy");
    m.cancel("cancel").unwrap();
    tokio::time::timeout(Duration::from_secs(3), job)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(m.list()[0].phase, "cancelled");
    assert_eq!(o.view(&s, "identity", timestamp()).status.value, "unknown");
    let valid = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let mut s = service();
    s.control.health_probe.as_mut().unwrap().command = "fixture-health-closed".into();
    s.control.health_probe.as_mut().unwrap().not_ready_codes = vec![7];
    let mut r = request(port, s, Operation::Connect);
    let gate = valid.clone();
    r.validate = Arc::new(move || gate.load(Ordering::SeqCst));
    r.forward = Some(forward_counter(calls.clone()));
    let (_, cancel, _) = m.register(run("change")).unwrap();
    let job = tokio::spawn(control::execute(
        m.clone(),
        o.clone(),
        "change".into(),
        cancel,
        r,
    ));
    phase(&m, "change", "checking-health").await;
    valid.store(false, Ordering::SeqCst);
    job.await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(m
        .list()
        .iter()
        .any(|r| r.id == "change" && r.error.as_deref() == Some("staleAction")));
    fixture.shutdown.cancel();
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn post_checks_preserve_successful_action_and_do_not_repeat_unapproved_probes_or_mutations() {
    let (port, fixture, server) = server::start().await;
    let m = Arc::new(Manager::default());
    let o = Arc::new(Observations::default());
    let mut s = service();
    s.control.check_after_actions = true;
    let p = s.control.health_probe.as_mut().unwrap();
    p.command = "fixture-health-closed".into();
    p.not_ready_codes = vec![7];
    p.repeatable = false;
    let mut r = request(port, s.clone(), Operation::Action);
    r.action = Some(s.actions[0].clone());
    let done = execute(&m, &o, "post", r).await;
    assert_eq!(
        done.error.as_deref(),
        Some("notReady"),
        "probe steps: {:?}",
        done.steps
    );
    assert_eq!(done.steps[0].phase, "succeeded");
    assert_eq!(done.steps[0].exit_code, Some(0));
    assert_eq!(done.steps.last().unwrap().attempt, 1);
    s.control.check_after_actions = false;
    let mut a = action("hang", "custom", "fixture-hang");
    a.timeout_secs = 1;
    let mut r = request(port, s, Operation::Action);
    r.action = Some(a);
    let done = execute(&m, &o, "timeout", r).await;
    assert_eq!(done.phase, "timedOut");
    assert_eq!(done.error.as_deref(), Some("remoteUnknown"));
    assert_eq!(
        fixture
            .history
            .lock()
            .unwrap()
            .iter()
            .filter(|s| *s == "fixture-start")
            .count(),
        1
    );
    fixture.shutdown.cancel();
    server.abort();
}
