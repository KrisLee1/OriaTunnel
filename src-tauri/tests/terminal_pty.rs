#![cfg(any(unix, windows))]
#[path = "common/terminal_server.rs"]
mod server;
use oria_tunnel_lib::{
    model::{timestamp, AuthMethod, Host},
    terminal::{self, Manager, Session},
    tunnel,
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::mpsc;
fn summary(id: &str) -> Session {
    Session {
        rule_id: None,
        id: id.into(),
        request_id: format!("request-{id}"),
        client_id: "client".into(),
        host_id: "host".into(),
        route_host_ids: vec!["host".into()],
        host_name: "test".into(),
        endpoint: "isolated".into(),
        service_id: None,
        action_id: None,
        label: "test".into(),
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
        cols: 80,
        rows: 24,
    }
}
fn request(port: u16) -> terminal::Request {
    terminal::Request {
        hops: vec![tunnel::HopRequest {
            host: Host {
                id: "host".into(),
                name: "test".into(),
                address: "127.0.0.1".into(),
                port,
                user: "tester".into(),
                auth_method: AuthMethod::Password,
                ..Default::default()
            },
            secret: "isolated-test-only".into(),
            expected: None,
        }],
        command: None,
        timeout_secs: None,
        success_codes: vec![0],
        notify: Arc::new(|_| {}),
        prompt: Arc::new(|_, _, tx| {
            let _ = tx.send(true);
        }),
        observer: None,
        validate: Arc::new(|| true),
        changed: Arc::new(|| {}),
    }
}
async fn wait_session(
    manager: &Manager,
    id: &str,
    predicate: impl Fn(&Session) -> bool,
) -> Session {
    tokio::time::timeout(Duration::from_secs(12), async {
        loop {
            if let Some(s) = manager
                .list()
                .into_iter()
                .find(|s| s.id == id && predicate(s))
            {
                return s;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("terminal lifecycle")
}
async fn wait_text(bytes: &Arc<Mutex<Vec<u8>>>, start: usize, text: &str) {
    tokio::time::timeout(
        Duration::from_secs(if cfg!(windows) { 25 } else { 10 }),
        async {
            loop {
                if String::from_utf8_lossy(&bytes.lock().unwrap()[start..]).contains(text) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        },
    )
    .await
    .unwrap_or_else(|_| {
        panic!(
            "missing {text:?}: {}",
            String::from_utf8_lossy(&bytes.lock().unwrap())
        )
    });
}
fn consume(manager: Arc<Manager>, id: &str) -> (Arc<Mutex<Vec<u8>>>, tokio::task::JoinHandle<()>) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    manager
        .attach(
            id,
            "client",
            tauri::ipc::Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                    let _ = tx.send(serde_json::from_str::<serde_json::Value>(&json).unwrap());
                }
                Ok(())
            }),
        )
        .unwrap();
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let captured = bytes.clone();
    let id = id.to_string();
    let job = tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            captured.lock().unwrap().extend(
                frame["bytes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|b| b.as_u64().unwrap() as u8),
            );
            manager
                .ack(&id, "client", frame["sequence"].as_u64().unwrap())
                .unwrap();
        }
    });
    (bytes, job)
}
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn real_pty_supports_utf8_resize_line_editing_interrupt_job_control_and_eof() {
    let fixture = server::Fixture::default();
    let sizes = fixture.sizes.clone();
    let (port, server) = server::start(fixture).await;
    let manager = Arc::new(Manager::default());
    let (s, c, input) = manager.register(summary("shell")).unwrap();
    let (bytes, consumer) = consume(manager.clone(), &s.id);
    let job = tokio::spawn(terminal::execute(
        manager.clone(),
        s.id.clone(),
        c,
        input.unwrap(),
        request(port),
    ));
    wait_text(&bytes, 0, "oria-e2> ").await;
    wait_session(&manager, &s.id, |s| s.phase == "running").await;
    manager
        .input(
            &s.id,
            "client",
            1,
            "printf 'unicode:%s\\n' '中文'\r".as_bytes().to_vec(),
        )
        .unwrap();
    wait_text(&bytes, 0, "unicode:中文").await;
    manager.resize(&s.id, "client", 101, 37).unwrap();
    manager
        .input(&s.id, "client", 2, b"stty size\r".to_vec())
        .unwrap();
    wait_text(&bytes, 0, "37 101").await;
    assert!(sizes.lock().unwrap().contains(&(101, 37)));
    let mark = bytes.lock().unwrap().len();
    manager
        .input(&s.id, "client", 3, b"echo SHOULD_NOT_RUN".to_vec())
        .unwrap();
    manager.input(&s.id, "client", 4, vec![21]).unwrap();
    manager
        .input(&s.id, "client", 5, b"printf 'edited\\n'\r".to_vec())
        .unwrap();
    wait_text(&bytes, mark, "edited\r\n").await;
    let mark = bytes.lock().unwrap().len();
    manager
        .input(&s.id, "client", 6, b"sleep 30\r".to_vec())
        .unwrap();
    wait_text(&bytes, mark, "sleep 30").await;
    manager.input(&s.id, "client", 7, vec![3]).unwrap();
    wait_text(&bytes, mark, "oria-e2> ").await;
    let mark = bytes.lock().unwrap().len();
    manager
        .input(&s.id, "client", 8, b"sleep 30\r".to_vec())
        .unwrap();
    wait_text(&bytes, mark, "sleep 30").await;
    manager.input(&s.id, "client", 9, vec![26]).unwrap();
    wait_text(&bytes, mark, "Stopped").await;
    let resumed = bytes.lock().unwrap().len();
    manager
        .input(&s.id, "client", 10, b"fg\r".to_vec())
        .unwrap();
    wait_text(&bytes, resumed, "sleep 30").await;
    let mark = bytes.lock().unwrap().len();
    manager.input(&s.id, "client", 11, vec![3]).unwrap();
    wait_text(&bytes, mark, "oria-e2> ").await;
    manager.input(&s.id, "client", 12, vec![4]).unwrap();
    tokio::time::timeout(Duration::from_secs(5), job)
        .await
        .unwrap()
        .unwrap();
    let result = wait_session(&manager, &s.id, |s| !s.active()).await;
    assert_eq!(result.phase, "exited");
    assert_eq!(result.exit_code, Some(130));
    consumer.abort();
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn dedicated_exec_is_a_real_pty_and_honors_exit_codes_and_timeout() {
    let (port, server) = server::start(Default::default()).await;
    let manager = Arc::new(Manager::default());
    #[cfg(unix)]
    let cases = [
        (
            "exec",
            "test -t 0 && test -t 1 && printf 'real-pty\\n'; exit 7",
            "failed",
            5,
        ),
        ("timeout", "sleep 30", "timedOut", 1),
        (
            "unlimited",
            "sleep 0.05; printf 'unlimited-pty\\n'",
            "exited",
            0,
        ),
    ];
    #[cfg(windows)]
    let cases = [
        ("exec", "if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { exit 9 }; Write-Output 'real-pty'; exit 7", "failed", 15),
        ("timeout", "Start-Sleep -Seconds 30", "timedOut", 1),
        ("unlimited", "Start-Sleep -Milliseconds 50; Write-Output 'unlimited-pty'; exit 0", "exited", 0),
    ];
    for (id, command, phase, timeout) in cases {
        let (s, c, input) = manager.register(summary(id)).unwrap();
        let (bytes, consumer) = consume(manager.clone(), id);
        let mut req = request(port);
        req.command = Some(command.into());
        req.timeout_secs = Some(timeout);
        terminal::execute(manager.clone(), s.id.clone(), c, input.unwrap(), req).await;
        let result = wait_session(&manager, id, |s| !s.active()).await;
        assert_eq!(
            result.phase,
            phase,
            "{}",
            String::from_utf8_lossy(&bytes.lock().unwrap())
        );
        if id == "exec" {
            assert_eq!(result.exit_code, Some(7));
            wait_text(&bytes, 0, "real-pty").await;
        } else if id == "unlimited" {
            assert_eq!(result.exit_code, Some(0));
            wait_text(&bytes, 0, "unlimited-pty").await;
        }
        consumer.abort();
    }
    server.abort();
}
#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn windows_conpty_supports_utf8_resize_interrupt_and_foreground_service_cleanup() {
    let fixture = server::Fixture::default();
    let sizes = fixture.sizes.clone();
    let (port, server) = server::start(fixture).await;
    let manager = Arc::new(Manager::default());
    let mut session = summary("windows-shell");
    session.service_id = Some("service".into());
    session.action_id = Some("start".into());
    session.rule_id = Some("forward".into());
    let (session, cancel, input) = manager.register(session).unwrap();
    let (bytes, consumer) = consume(manager.clone(), &session.id);
    let worker = tokio::spawn(terminal::execute(
        manager.clone(),
        session.id.clone(),
        cancel,
        input.unwrap(),
        request(port),
    ));
    wait_text(&bytes, 0, "oria-e2> ").await;
    manager
        .input(
            &session.id,
            "client",
            1,
            "Write-Output 'unicode:中文'\r".as_bytes().to_vec(),
        )
        .unwrap();
    wait_text(&bytes, 0, "unicode:中文\r\n").await;
    manager.resize(&session.id, "client", 101, 37).unwrap();
    manager
        .input(
            &session.id,
            "client",
            2,
            b"Write-Output ('size:' + [Console]::WindowWidth + 'x' + [Console]::WindowHeight)\r"
                .to_vec(),
        )
        .unwrap();
    wait_text(&bytes, 0, "size:101x37").await;
    assert!(sizes.lock().unwrap().contains(&(101, 37)));
    let mark = bytes.lock().unwrap().len();
    manager
        .input(
            &session.id,
            "client",
            3,
            b"Write-Output 'SLEEP-READY'; Start-Sleep -Seconds 30\r".to_vec(),
        )
        .unwrap();
    wait_text(&bytes, mark, "SLEEP-READY\r\n").await;
    let interrupted_at = bytes.lock().unwrap().len();
    manager.input(&session.id, "client", 4, vec![3]).unwrap();
    wait_text(&bytes, interrupted_at, "oria-e2> ").await;
    manager
        .input(
            &session.id,
            "client",
            5,
            b"Write-Output 'interrupted-ok'\r".to_vec(),
        )
        .unwrap();
    wait_text(&bytes, mark, "interrupted-ok\r\n").await;
    manager.cancel(&session.id, "client").unwrap();
    tokio::time::timeout(Duration::from_secs(5), worker)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        wait_session(&manager, &session.id, |s| !s.active())
            .await
            .phase,
        "disconnected"
    );
    manager.forget(&session.id, "client").unwrap();
    assert!(manager.list().is_empty());
    consumer.abort();
    server.abort();
}
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn closing_a_foreground_service_terminal_finishes_and_forgets_the_session() {
    let (port, server) = server::start(Default::default()).await;
    let manager = Arc::new(Manager::default());
    let mut session = summary("foreground-service");
    session.service_id = Some("service".into());
    session.action_id = Some("start".into());
    session.rule_id = Some("forward".into());
    let (session, cancel, input) = manager.register(session).unwrap();
    let (bytes, consumer) = consume(manager.clone(), &session.id);
    let mut req = request(port);
    req.command = Some("printf 'PID:%s\\nREADY\\n' $$; exec sleep 30".into());
    req.timeout_secs = Some(0);
    let worker = tokio::spawn(terminal::execute(
        manager.clone(),
        session.id.clone(),
        cancel,
        input.unwrap(),
        req,
    ));
    wait_text(&bytes, 0, "READY").await;
    let text = String::from_utf8_lossy(&bytes.lock().unwrap()).into_owned();
    let pid = text
        .lines()
        .find_map(|line| line.strip_prefix("PID:"))
        .unwrap()
        .trim()
        .parse::<libc::pid_t>()
        .unwrap();
    manager.cancel(&session.id, "client").unwrap();
    tokio::time::timeout(Duration::from_secs(5), worker)
        .await
        .unwrap()
        .unwrap();
    let ended = wait_session(&manager, &session.id, |session| !session.active()).await;
    assert_eq!(ended.phase, "disconnected");
    manager.forget(&session.id, "client").unwrap();
    assert!(manager.list().is_empty());
    // Only inspect the PID emitted by this isolated fixture; never signal a user's process.
    tokio::time::timeout(Duration::from_secs(5), async {
        while unsafe { libc::kill(pid, 0) } == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("fixture foreground process exits after its PTY closes");
    consumer.abort();
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn pty_shell_auth_and_trust_failures_never_fall_back_to_a_fake_shell() {
    let manager = Arc::new(Manager::default());
    let mut no_pty = server::Fixture::default();
    no_pty.refuse_pty = true;
    let mut no_shell = server::Fixture::default();
    no_shell.refuse_shell = true;
    for (id, fixture) in [
        ("pty", no_pty),
        ("shell", no_shell),
        ("auth", Default::default()),
        ("trust", Default::default()),
    ] {
        let (port, server) = server::start(fixture).await;
        let (s, c, input) = manager.register(summary(id)).unwrap();
        let mut req = request(port);
        if id == "auth" {
            req.hops[0].secret = "incorrect-test-only".into();
        }
        if id == "trust" {
            req.prompt = Arc::new(|_, _, tx| {
                let _ = tx.send(false);
            });
        }
        terminal::execute(manager.clone(), s.id.clone(), c, input.unwrap(), req).await;
        let result = wait_session(&manager, id, |s| !s.active()).await;
        assert_eq!(result.phase, "failed");
        assert_eq!(
            result.error.as_deref(),
            Some(match id {
                "pty" => "ptyRejected",
                "shell" => "shellRejected",
                "auth" => "authentication",
                _ => "hostKey",
            })
        );
        server.abort();
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn multiple_sessions_and_multihop_remain_independent_after_close() {
    let (target, target_server) = server::start(Default::default()).await;
    let (jump, jump_server) = server::start(Default::default()).await;
    let manager = Arc::new(Manager::default());
    let mut jobs = Vec::new();
    let mut consumers = Vec::new();
    let mut buffers = Vec::new();
    for id in ["one", "two"] {
        let (s, c, input) = manager.register(summary(id)).unwrap();
        let (bytes, consumer) = consume(manager.clone(), id);
        let mut req = request(target);
        if id == "two" {
            let mut hop = req.hops[0].clone();
            hop.host.port = jump;
            hop.host.id = "jump".into();
            req.hops.insert(0, hop);
        }
        jobs.push(tokio::spawn(terminal::execute(
            manager.clone(),
            s.id,
            c,
            input.unwrap(),
            req,
        )));
        wait_text(&bytes, 0, "oria-e2> ").await;
        consumers.push(consumer);
        buffers.push(bytes);
    }
    manager.cancel("one", "client").unwrap();
    wait_session(&manager, "one", |s| !s.active()).await;
    #[cfg(unix)]
    let command = b"printf 'independent\\n'\r".to_vec();
    #[cfg(windows)]
    let command = b"Write-Output 'independent'\r".to_vec();
    manager.input("two", "client", 1, command).unwrap();
    wait_text(&buffers[1], 0, "independent\r\n").await;
    manager.cancel_all();
    for j in jobs {
        j.await.unwrap();
    }
    for j in consumers {
        j.abort();
    }
    target_server.abort();
    jump_server.abort();
}
