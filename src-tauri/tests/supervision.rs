//! All sockets/identities here are private loopback fixtures; never use a user host/agent.
use oria_tunnel_lib::{
    model::{AuthMethod, FailureKind, Host, Rule, Runtime},
    supervisor, tunnel,
};
use russh::{
    keys::{Algorithm, PrivateKey},
    server::{self, Auth, Server as _, Session},
    Channel,
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::watch,
};
use tokio_util::sync::CancellationToken;
#[derive(Clone)]
struct Server {
    drop: CancellationToken,
    sessions: Arc<Mutex<Vec<server::Handle>>>,
}
impl server::Server for Server {
    type Handler = Self;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
        self.clone()
    }
}
impl server::Handler for Server {
    type Error = russh::Error;
    async fn channel_open_session(
        &mut self,
        _: Channel<server::Msg>,
        reply: server::ChannelOpenHandle,
        _: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }
    async fn exec_request(
        &mut self,
        channel: russh::ChannelId,
        command: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if command == b"test-command" {
            session.channel_success(channel)?;
        } else {
            session.channel_failure(channel)?;
        }
        Ok(())
    }
    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if user == "tester" && password == "test-only" {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }
    async fn auth_succeeded(&mut self, session: &mut Session) -> Result<(), Self::Error> {
        let handle = session.handle();
        self.sessions.lock().unwrap().push(handle.clone());
        let cancel = self.drop.clone();
        tokio::spawn(async move {
            cancel.cancelled().await;
            let _ = handle
                .disconnect(
                    russh::Disconnect::ByApplication,
                    "fixture drop".into(),
                    "en".into(),
                )
                .await;
        });
        Ok(())
    }
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<server::Msg>,
        host: &str,
        port: u32,
        _: &str,
        _: u32,
        reply: server::ChannelOpenHandle,
        _: &mut Session,
    ) -> Result<(), Self::Error> {
        if host != "127.0.0.1" {
            reply
                .reject(russh::ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        }
        if let Ok(mut tcp) = TcpStream::connect((host, port as u16)).await {
            reply.accept().await;
            tokio::spawn(async move {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
            });
        } else {
            reply.reject(russh::ChannelOpenFailure::ConnectFailed).await;
        }
        Ok(())
    }
}
async fn server_at(
    listener: TcpListener,
    key: PrivateKey,
    drop: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut server = Server {
            drop,
            sessions: Default::default(),
        };
        let _ = server
            .run_on_socket(
                Arc::new(server::Config {
                    keys: vec![key],
                    auth_rejection_time: Duration::ZERO,
                    ..Default::default()
                }),
                &listener,
            )
            .await;
    })
}
async fn wait(events: &Arc<Mutex<Vec<Runtime>>>, predicate: impl Fn(&Runtime) -> bool) -> Runtime {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if let Some(r) = events
                .lock()
                .unwrap()
                .iter()
                .rev()
                .find(|r| predicate(r))
                .cloned()
            {
                return r;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}
async fn request(port: u16, fingerprint: String) -> tunnel::RunRequest {
    let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bind_port = reserve.local_addr().unwrap().port();
    drop(reserve);
    tunnel::RunRequest {
        host: Host {
            id: "fixture".into(),
            name: "fixture".into(),
            address: "127.0.0.1".into(),
            port,
            user: "tester".into(),
            auth_method: AuthMethod::Password,
            ..Default::default()
        },
        rule: Rule {
            id: "rule".into(),
            name: "fixture".into(),
            host_id: "fixture".into(),
            bind_port,
            target_host: "127.0.0.1".into(),
            target_port: 1,
            reconnect: oria_tunnel_lib::model::ReconnectPolicy {
                initial_delay_secs: 1,
                max_delay_secs: 1,
                max_attempts: 2,
                enabled: true,
            },
            ..Default::default()
        },
        secret: "test-only".into(),
        expected: Some(fingerprint),
        run_id: "initial".into(),
        jumps: vec![],
        test_only: false,
    }
}
fn output(events: Arc<Mutex<Vec<Runtime>>>) -> tunnel::Notify {
    Arc::new(move |r| events.lock().unwrap().push(r))
}
#[tokio::test(flavor = "multi_thread")]
async fn loopback_metrics_real_bytes_and_trust_cache_across_resume() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = echo.local_addr().unwrap().port();
    let echo_task = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = echo.accept().await {
            tokio::spawn(async move {
                let (mut r, mut w) = tcp.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
            });
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let server = server_at(listener, key, CancellationToken::new()).await;
    let mut request = request(port, String::new()).await;
    request.expected = None;
    request.rule.target_port = target;
    let bind = request.rule.bind_port;
    let events = Arc::new(Mutex::new(Vec::new()));
    let cancel = CancellationToken::new();
    let (wake, rx) = watch::channel(0);
    let prompts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = prompts.clone();
    let task = tokio::spawn(supervisor::run(
        request,
        cancel.clone(),
        rx,
        output(events.clone()),
        Arc::new(move |_, _, reply| {
            count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let _ = reply.send(true);
        }),
        Arc::new(|| true),
    ));
    wait(&events, |r| r.status == "listening").await;
    let payload = vec![0x51; 128 * 1024];
    let mut tcp = TcpStream::connect(("127.0.0.1", bind)).await.unwrap();
    tcp.write_all(&payload).await.unwrap();
    let mut received = vec![0; payload.len()];
    tcp.read_exact(&mut received).await.unwrap();
    assert_eq!(received, payload);
    drop(tcp);
    let measured = wait(&events, |r| {
        r.sent == 128 * 1024 && r.received == 128 * 1024 && r.sent_per_second.is_some_and(|n| n > 0)
    })
    .await;
    assert!(!measured.history.is_empty());
    assert_eq!(measured.auth_method_used, Some(AuthMethod::Password));
    assert_eq!(measured.target_health.state.as_deref(), Some("reachable"));
    wake.send(1).unwrap();
    let resumed = wait(&events, |r| {
        r.status == "listening" && r.run_id != "initial"
    })
    .await;
    assert_eq!(resumed.sent, measured.sent);
    assert_eq!(resumed.received, measured.received);
    assert!(resumed.target_health.state.is_none());
    assert_eq!(prompts.load(std::sync::atomic::Ordering::SeqCst), 1);
    cancel.cancel();
    task.await.unwrap();
    server.abort();
    echo_task.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn loopback_remote_command_repetition_requires_explicit_opt_in() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let server = server_at(listener, key, CancellationToken::new()).await;
    for allow in [false, true] {
        let mut request = request(port, fingerprint.clone()).await;
        request.rule.no_remote_command = false;
        request.rule.remote_command = "test-command".into();
        request.rule.repeat_command_on_reconnect = allow;
        let bind = request.rule.bind_port;
        let events = Arc::new(Mutex::new(Vec::new()));
        let cancel = CancellationToken::new();
        let (wake, rx) = watch::channel(0);
        let task = tokio::spawn(supervisor::run(
            request,
            cancel.clone(),
            rx,
            output(events.clone()),
            Arc::new(|_, _, _| panic!("known fixture key")),
            Arc::new(|| true),
        ));
        wait(&events, |r| r.status == "listening").await;
        wake.send(1).unwrap();
        if allow {
            wait(&events, |r| {
                r.status == "listening" && r.run_id != "initial"
            })
            .await;
            cancel.cancel();
        } else {
            let r = wait(&events, |r| r.status == "needs-attention").await;
            assert_eq!(r.error_kind, Some(FailureKind::RemoteCommand));
            assert!(!events
                .lock()
                .unwrap()
                .iter()
                .any(|r| r.status == "reconnecting"));
        }
        task.await.unwrap();
        let _released = TcpListener::bind(("127.0.0.1", bind)).await.unwrap();
    }
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn loopback_batch_partial_failure_does_not_block_an_independent_listener() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let server = server_at(listener, key, CancellationToken::new()).await;
    let mut good = request(port, fingerprint.clone()).await;
    good.rule.id = "good".into();
    let good_port = good.rule.bind_port;
    let mut bad = request(port, fingerprint).await;
    bad.rule.id = "bad-auth".into();
    bad.secret = "WRONG".into();
    let mut requests = std::collections::BTreeMap::from([
        ("good".to_string(), good),
        ("bad-auth".to_string(), bad),
    ]);
    let events = Arc::new(Mutex::new(Vec::new()));
    let (_wake, rx) = watch::channel(0);
    let mut jobs = Vec::new();
    let result = oria_tunnel_lib::batch::start(
        vec![
            "missing".into(),
            "bad-auth".into(),
            "good".into(),
            "good".into(),
        ],
        |id| {
            let outcome = if let Some(request) = requests.remove(&id) {
                let cancel = CancellationToken::new();
                let task = tokio::spawn(supervisor::run(
                    request,
                    cancel.clone(),
                    rx.clone(),
                    output(events.clone()),
                    Arc::new(|_, _, _| panic!("known fixture key")),
                    Arc::new(|| true),
                ));
                jobs.push((cancel, task));
                Ok(())
            } else {
                Err("missing fixture".into())
            };
            std::future::ready(outcome)
        },
    )
    .await;
    assert_eq!(result.len(), 3);
    assert!(!result[0].accepted);
    assert!(result[1].accepted);
    assert!(result[2].accepted);
    wait(&events, |r| {
        r.rule_id == "bad-auth" && r.status == "needs-attention"
    })
    .await;
    wait(&events, |r| r.rule_id == "good" && r.status == "listening").await;
    assert!(TcpStream::connect(("127.0.0.1", good_port)).await.is_ok());
    for (cancel, _) in &jobs {
        cancel.cancel();
    }
    for (_, task) in jobs {
        task.await.unwrap();
    }
    let _released = TcpListener::bind(("127.0.0.1", good_port)).await.unwrap();
    server.abort();
}
#[tokio::test(flavor = "multi_thread")]
async fn loopback_disconnect_reconnect_wake_new_generation_target_failure_and_cancel() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let drop = CancellationToken::new();
    let server = server_at(listener, key.clone(), drop.clone()).await;
    let request = request(port, fingerprint).await;
    let bind = request.rule.bind_port;
    let events = Arc::new(Mutex::new(Vec::new()));
    let cancel = CancellationToken::new();
    let (wake, rx) = watch::channel(0);
    let task = tokio::spawn(supervisor::run(
        request,
        cancel.clone(),
        rx,
        output(events.clone()),
        Arc::new(|_, _, _| panic!("known fixture key")),
        Arc::new(|| true),
    ));
    wait(&events, |r| r.status == "listening").await;
    // A refused target changes only target health, never the active listener status.
    let mut client = TcpStream::connect(("127.0.0.1", bind)).await.unwrap();
    use tokio::io::AsyncReadExt;
    let mut b = [0; 1];
    let _ = client.read(&mut b).await;
    let unhealthy = wait(&events, |r| {
        r.target_health.state.as_deref() == Some("unreachable")
    })
    .await;
    assert_eq!(unhealthy.status, "listening");
    assert_eq!(unhealthy.target_health.side.as_deref(), Some("remote"));
    drop.cancel();
    server.abort();
    wait(&events, |r| r.status == "reconnecting").await;
    let new_listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    let second = server_at(new_listener, key, CancellationToken::new()).await;
    let restored = wait(&events, |r| {
        r.status == "listening" && r.run_id != "initial"
    })
    .await;
    assert_eq!(restored.retry_count, 1);
    assert!(restored.desired_running);
    let first_generation = restored.run_id;
    wake.send(1).unwrap();
    let resumed = wait(&events, |r| {
        r.status == "listening" && r.run_id != "initial" && r.run_id != first_generation
    })
    .await;
    assert_eq!(resumed.retry_count, 2);
    cancel.cancel();
    tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap();
    let last = events.lock().unwrap().last().unwrap().clone();
    assert_eq!(last.status, "stopped");
    assert!(!last.desired_running);
    assert_eq!(last.connections, 0);
    let _released = TcpListener::bind(("127.0.0.1", bind)).await.unwrap();
    second.abort();
    let stopped = events.lock().unwrap().len();
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert_eq!(events.lock().unwrap().len(), stopped);
}
#[tokio::test(flavor = "multi_thread")]
async fn loopback_retry_limit_manual_cancel_and_changed_source_stop_retry() {
    for mode in ["limit", "cancel", "changed"] {
        let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reserve.local_addr().unwrap().port();
        drop(reserve);
        let mut request = request(port, "unused".into()).await;
        request.rule.reconnect.max_attempts = 1;
        let events = Arc::new(Mutex::new(Vec::new()));
        let cancel = CancellationToken::new();
        let (_wake, rx) = watch::channel(0);
        let valid = mode != "changed";
        let task = tokio::spawn(supervisor::run(
            request,
            cancel.clone(),
            rx,
            output(events.clone()),
            Arc::new(|_, _, _| panic!("no SSH server")),
            Arc::new(move || valid),
        ));
        wait(&events, |r| r.status == "reconnecting").await;
        if mode == "cancel" {
            cancel.cancel();
        }
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        let last = events.lock().unwrap().last().unwrap().clone();
        assert_eq!(
            last.status,
            if mode == "cancel" {
                "stopped"
            } else {
                "needs-attention"
            }
        );
        assert!(!last.desired_running);
        assert_eq!(
            last.error_kind,
            if mode == "changed" {
                Some(FailureKind::Configuration)
            } else {
                Some(FailureKind::Network)
            }
        );
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.status == "connecting")
                .count(),
            if mode == "limit" { 2 } else { 1 }
        );
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn loopback_auth_and_key_errors_are_terminal_without_retry() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let server = server_at(listener, key, CancellationToken::new()).await;
    for mode in ["auth", "key"] {
        let mut request = request(port, fingerprint.clone()).await;
        if mode == "auth" {
            request.secret = "WRONG_CANARY".into();
        } else {
            request.expected = Some("wrong".into());
        }
        let events = Arc::new(Mutex::new(Vec::new()));
        let (_wake, rx) = watch::channel(0);
        supervisor::run(
            request,
            CancellationToken::new(),
            rx,
            output(events.clone()),
            Arc::new(|_, _, _| panic!("expected fixture key")),
            Arc::new(|| true),
        )
        .await;
        let events = events.lock().unwrap();
        let last = events.last().unwrap();
        assert_eq!(last.status, "needs-attention");
        assert_eq!(last.retry_count, 0);
        assert_eq!(
            last.error_kind,
            Some(if mode == "auth" {
                FailureKind::Authentication
            } else {
                FailureKind::HostKey
            })
        );
        assert!(!format!("{last:?}").contains("WRONG_CANARY"));
        assert!(!events.iter().any(|r| r.status == "reconnecting"));
    }
    server.abort();
}
