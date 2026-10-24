#[path = "common/command_server.rs"]
mod server;
use oria_tunnel_lib::{
    commands::{self, Action, Manager, Run},
    model::{timestamp, AuthMethod, Host},
    tunnel,
};
use std::{
    sync::{atomic::Ordering, Arc, Mutex},
    time::Duration,
};
fn run(id: &str) -> Run {
    Run {
        id: id.into(),
        request_id: format!("request-{id}"),
        service_id: format!("service-{id}"),
        action_id: "action".into(),
        service_revision: "v1".into(),
        host_id: "target".into(),
        host_name: "isolated".into(),
        endpoint: "tester@127.0.0.1".into(),
        action_label: "test".into(),
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
fn request(port: u16, command: &str, timeout: u64) -> commands::Request {
    commands::Request {
        hops: vec![tunnel::HopRequest {
            host: host(port),
            secret: "isolated-test-only".into(),
            expected: None,
        }],
        action: Action {
            invocation: None,
            mode: Default::default(),
            id: "action".into(),
            kind: "custom".into(),
            label: "test".into(),
            command: command.into(),
            timeout_secs: timeout,
            success_codes: vec![0],
            confirm: true,
        },
        notify: Arc::new(|_| {}),
        prompt: Arc::new(|_, _, tx| {
            let _ = tx.send(true);
        }),
        observer: None,
        validate: Arc::new(|| true),
    }
}
async fn wait(manager: &Manager, id: &str, predicate: impl Fn(&Run) -> bool) -> Run {
    tokio::time::timeout(Duration::from_secs(12), async {
        loop {
            if let Some(run) = manager
                .list()
                .into_iter()
                .find(|r| r.id == id && predicate(r))
            {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("command progress")
}
#[tokio::test(flavor = "multi_thread")]
async fn real_exec_streams_and_reports_stdout_stderr_exit_codes_and_signals() {
    let (port, calls, server) = server::start().await;
    let m = Arc::new(Manager::default());
    let events = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let saved = events.clone();
    let (r, c, _) = m.register(run("stream")).unwrap();
    m.attach(
        &r.id,
        tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                saved
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        }),
    )
    .unwrap();
    let job = tokio::spawn(commands::execute(
        m.clone(),
        r.id.clone(),
        c,
        request(port, "fixture-stream", 5),
    ));
    // Explicit consumer ACK exercises real-time output instead of inspecting only a final buffer.
    let mut saw_early = false;
    loop {
        let event = events.lock().unwrap().pop();
        if let Some(event) = event {
            let output = event["output"].as_array().unwrap();
            if output
                .iter()
                .any(|c| c["bytes"].as_array().unwrap().iter().any(|b| b == 102))
                && event["run"]["finishedAt"].is_null()
            {
                saw_early = true;
            }
            m.ack(&r.id, event["run"]["revision"].as_u64().unwrap())
                .unwrap();
        }
        if job.is_finished() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    job.await.unwrap();
    assert!(saw_early);
    assert_eq!(wait(&m, &r.id, |r| !r.active()).await.phase, "succeeded");
    let final_output = Arc::new(Mutex::new(None));
    let capture = final_output.clone();
    m.attach(
        &r.id,
        tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                *capture.lock().unwrap() =
                    Some(serde_json::from_str::<serde_json::Value>(&json).unwrap());
            }
            Ok(())
        }),
    )
    .unwrap();
    let snapshot = final_output.lock().unwrap().clone().unwrap();
    assert!(snapshot["output"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["stream"] == "stderr"));
    for (id, command, phase, code) in [
        ("fail", "fixture-fail", "failed", Some(7)),
        ("signal", "fixture-signal", "failed", None),
        ("unknown", "fixture-unknown", "unknown", None),
        ("reject", "fixture-reject", "failed", None),
    ] {
        let (r, c, _) = m.register(run(id)).unwrap();
        commands::execute(m.clone(), r.id.clone(), c, request(port, command, 5)).await;
        let result = wait(&m, id, |r| !r.active()).await;
        assert_eq!(result.phase, phase);
        assert_eq!(result.exit_code, code);
        if id == "signal" {
            assert!(result.exit_signal.is_some());
        }
    }
    assert_eq!(calls.load(Ordering::SeqCst), 5);
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn timeout_cancel_and_failed_auth_never_claim_a_stopped_remote_service() {
    let (port, calls, server) = server::start().await;
    let m = Arc::new(Manager::default());
    let (r, c, _) = m.register(run("timeout")).unwrap();
    commands::execute(m.clone(), r.id.clone(), c, request(port, "fixture-hang", 1)).await;
    let result = wait(&m, &r.id, |r| !r.active()).await;
    assert_eq!(result.phase, "timedOut");
    assert!(result.submitted);
    assert_eq!(result.error.as_deref(), Some("remoteUnknown"));
    let (r, c, _) = m.register(run("cancel")).unwrap();
    let job = tokio::spawn(commands::execute(
        m.clone(),
        r.id.clone(),
        c,
        request(port, "fixture-hang", 30),
    ));
    wait(&m, &r.id, |r| r.phase == "running").await;
    m.cancel(&r.id).unwrap();
    tokio::time::timeout(Duration::from_secs(5), job)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(wait(&m, &r.id, |r| !r.active()).await.phase, "cancelled");
    let (r, c, _) = m.register(run("auth")).unwrap();
    let mut req = request(port, "fixture-stream", 5);
    req.hops[0].secret = "wrong-isolated-value".into();
    commands::execute(m.clone(), r.id.clone(), c, req).await;
    let result = wait(&m, &r.id, |r| !r.active()).await;
    assert!(!result.submitted);
    assert_eq!(result.error.as_deref(), Some("authentication"));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn trust_cancel_reject_changed_identity_and_configuration_never_execute() {
    let (port, calls, server) = server::start().await;
    let m = Arc::new(Manager::default());
    for id in ["reject-key", "changed-key", "cancel-trust", "stale"] {
        let (r, c, _) = m.register(run(id)).unwrap();
        let mut req = request(port, "fixture-stream", 5);
        match id {
            "reject-key" => {
                req.prompt = Arc::new(|_, _, tx| {
                    let _ = tx.send(false);
                })
            }
            "changed-key" => req.hops[0].expected = Some("SHA256:wrong".into()),
            "cancel-trust" => {
                let cancel = c.clone();
                req.prompt = Arc::new(move |_, _, _| cancel.cancel());
            }
            _ => req.validate = Arc::new(|| false),
        }
        commands::execute(m.clone(), r.id.clone(), c, req).await;
        let result = wait(&m, &r.id, |r| !r.active()).await;
        assert!(!result.submitted);
        assert_ne!(result.phase, "succeeded");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn multi_hop_exec_uses_shared_authentication_and_closes_without_forward_listeners() {
    let (target, calls, target_server) = server::start().await;
    let (jump, _, jump_server) = server::start().await;
    let m = Arc::new(Manager::default());
    let (r, c, _) = m.register(run("jump")).unwrap();
    let mut req = request(target, "fixture-stream", 5);
    req.hops.insert(
        0,
        tunnel::HopRequest {
            host: host(jump),
            secret: "isolated-test-only".into(),
            expected: None,
        },
    );
    commands::execute(m.clone(), r.id.clone(), c, req).await;
    assert_eq!(wait(&m, &r.id, |r| !r.active()).await.phase, "succeeded");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    target_server.abort();
    jump_server.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn cancelling_a_command_keeps_an_independent_forward_on_the_same_host_working() {
    use oria_tunnel_lib::model::Rule;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (port, _, server) = server::start().await;
    let echo = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = echo.local_addr().unwrap().port();
    let echo_job = tokio::spawn(async move {
        let (mut client, _) = echo.accept().await.unwrap();
        let (mut r, mut w) = client.split();
        tokio::io::copy(&mut r, &mut w).await.unwrap();
    });
    let reservation = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bind = reservation.local_addr().unwrap().port();
    drop(reservation);
    let forward_cancel = tokio_util::sync::CancellationToken::new();
    let ready = Arc::new(tokio::sync::Notify::new());
    let observed = ready.clone();
    let forward = tokio::spawn(tunnel::run(
        tunnel::RunRequest {
            host: host(port),
            rule: Rule {
                id: "forward".into(),
                name: "isolated".into(),
                host_id: host(port).id,
                bind_port: bind,
                target_host: "127.0.0.1".into(),
                target_port: target,
                ..Default::default()
            },
            secret: "isolated-test-only".into(),
            expected: None,
            run_id: "forward-run".into(),
            jumps: vec![],
            test_only: false,
        },
        forward_cancel.clone(),
        Arc::new(move |r| {
            if r.status == "listening" {
                observed.notify_one();
            }
        }),
        Arc::new(|_, _, tx| {
            let _ = tx.send(true);
        }),
    ));
    tokio::time::timeout(Duration::from_secs(10), ready.notified())
        .await
        .unwrap();
    let m = Arc::new(Manager::default());
    let (r, c, _) = m.register(run("independent")).unwrap();
    let job = tokio::spawn(commands::execute(
        m.clone(),
        r.id.clone(),
        c,
        request(port, "fixture-hang", 30),
    ));
    wait(&m, &r.id, |r| r.phase == "running").await;
    m.cancel(&r.id).unwrap();
    job.await.unwrap();
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", bind))
        .await
        .unwrap();
    stream.write_all(b"still forwarded").await.unwrap();
    let mut data = [0; 15];
    tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut data))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&data, b"still forwarded");
    drop(stream);
    echo_job.await.unwrap();
    forward_cancel.cancel();
    forward.await.unwrap();
    server.abort();
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn sustained_real_ssh_output_keeps_retained_bytes_bounded_and_drains_detached_jobs() {
    let (port, calls, server) = server::start().await;
    let m = Arc::new(Manager::default());
    let started = std::time::Instant::now();
    let mut rounds = 0;
    let peak_rss = || {
        let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
        // getrusage initializes the entire struct on success; only read that case.
        let result = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
        assert_eq!(result, 0);
        let rss = unsafe { usage.assume_init() }.ru_maxrss as u64;
        if cfg!(target_os = "macos") {
            rss
        } else {
            rss * 1024
        }
    };
    let mut warm_peak = 0;
    // At least one minute and 64 independent real SSH execs (>=192 MiB), no viewer attached.
    while started.elapsed() < Duration::from_secs(60) || rounds < 64 {
        let id = format!("pressure-{rounds}");
        let (r, c, _) = m.register(run(&id)).unwrap();
        tokio::time::timeout(
            Duration::from_secs(15),
            commands::execute(
                m.clone(),
                r.id.clone(),
                c,
                request(port, "fixture-large", 10),
            ),
        )
        .await
        .unwrap();
        let done = m.list().into_iter().find(|r| r.id == id).unwrap();
        assert_eq!(done.phase, "succeeded");
        assert_eq!(done.output_bytes, commands::OUTPUT_LIMIT);
        assert_eq!(done.discarded_bytes, 1024 * 1024);
        assert!(m.retained_output_bytes() <= commands::TOTAL_OUTPUT_LIMIT);
        rounds += 1;
        if rounds == 128 {
            warm_peak = peak_rss();
        }
        // Preserve room under the deliberate 4096-request tombstone cap on fast machines.
        if rounds >= 1024 {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
    eprintln!(
        "E4 RSS peak after 128 jobs: {} MiB; final: {} MiB (includes fixture in same process)",
        warm_peak / 1048576,
        peak_rss() / 1048576
    );
    assert_eq!(calls.load(Ordering::SeqCst), rounds);
    assert_eq!(m.retained_output_bytes(), commands::TOTAL_OUTPUT_LIMIT);
    eprintln!(
        "E4 pressure: {rounds} SSH executions, {} MiB received, {} MiB retained, {:.1}s",
        rounds * 3,
        m.retained_output_bytes() / 1024 / 1024,
        started.elapsed().as_secs_f32()
    );
    server.abort();
}
