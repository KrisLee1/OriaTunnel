use oria_tunnel_lib::{
    model::{ForwardKind, Host, Rule, Runtime},
    ssh_config, tunnel,
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
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tokio_util::sync::CancellationToken;
#[derive(Clone, Default)]
struct TestServer {
    listeners: Arc<Mutex<std::collections::BTreeMap<u32, CancellationToken>>>,
    destinations: Arc<Mutex<Vec<String>>>,
    commands: Arc<std::sync::atomic::AtomicUsize>,
    allowed_key: Option<russh::keys::PublicKey>,
}
impl Drop for TestServer {
    fn drop(&mut self) {
        for token in self.listeners.lock().unwrap().values() {
            token.cancel();
        }
    }
}
impl server::Server for TestServer {
    type Handler = Self;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
        Self {
            listeners: Default::default(),
            destinations: self.destinations.clone(),
            commands: self.commands.clone(),
            allowed_key: self.allowed_key.clone(),
        }
    }
}
impl server::Handler for TestServer {
    type Error = russh::Error;
    async fn auth_publickey(
        &mut self,
        user: &str,
        key: &russh::keys::PublicKey,
    ) -> Result<Auth, Self::Error> {
        Ok(
            if user == "tester" && self.allowed_key.as_ref() == Some(key) {
                Auth::Accept
            } else {
                Auth::reject()
            },
        )
    }
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
        self.commands
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if command == b"test-command" {
            session.channel_success(channel)?;
        } else {
            session.channel_failure(channel)?;
        }
        Ok(())
    }
    async fn tcpip_forward(
        &mut self,
        address: &str,
        port: &mut u32,
        session: &mut Session,
    ) -> Result<bool, Self::Error> {
        if address != "127.0.0.1" {
            return Ok(false);
        }
        let Ok(listener) = TcpListener::bind((address, *port as u16)).await else {
            return Ok(false);
        };
        let port_value = listener.local_addr()?.port() as u32;
        *port = port_value;
        let handle = session.handle();
        let cancel = CancellationToken::new();
        self.listeners
            .lock()
            .unwrap()
            .insert(port_value, cancel.clone());
        tokio::spawn(async move {
            let mut clients = tokio::task::JoinSet::new();
            loop {
                tokio::select! {biased;_=cancel.cancelled()=>break,incoming=listener.accept()=>{
                    let Ok((mut tcp,origin))=incoming else {break;};let handle=handle.clone();
                    clients.spawn(async move {if let Ok(channel)=handle.channel_open_forwarded_tcpip("127.0.0.1",port_value,origin.ip().to_string(),origin.port() as u32).await {let mut stream=channel.into_stream();let _=tokio::io::copy_bidirectional(&mut tcp,&mut stream).await;}});
                }}
            }
        });
        Ok(true)
    }
    async fn cancel_tcpip_forward(
        &mut self,
        _: &str,
        port: u32,
        _: &mut Session,
    ) -> Result<bool, Self::Error> {
        if let Some(token) = self.listeners.lock().unwrap().remove(&port) {
            token.cancel();
            return Ok(true);
        }
        Ok(false)
    }
    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if user == "tester" && password == "test-only" {
            Auth::Accept
        } else {
            Auth::Reject {
                proceed_with_methods: None,
                partial_success: false,
            }
        })
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
        if !matches!(host, "127.0.0.1" | "::1" | "only-on-ssh.test") {
            reply
                .reject(russh::ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        }
        self.destinations.lock().unwrap().push(host.into());
        let target = TcpStream::connect((
            if host == "only-on-ssh.test" {
                "127.0.0.1"
            } else {
                host
            },
            port as u16,
        ))
        .await;
        if let Ok(mut target) = target {
            reply.accept().await;
            tokio::spawn(async move {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut target, &mut stream).await;
            });
        } else {
            reply.reject(russh::ChannelOpenFailure::ConnectFailed).await;
        }
        Ok(())
    }
}
async fn wait_for(events: &Arc<Mutex<Vec<Runtime>>>, status: &str) -> Runtime {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Some(r) = events
                .lock()
                .unwrap()
                .iter()
                .rev()
                .find(|r| r.status == status)
                .cloned()
            {
                return r;
            }
            tokio::time::sleep(Duration::from_millis(25)).await
        }
    })
    .await
    .unwrap_or_else(|_| panic!("Missing status {status}: {:?}", events.lock().unwrap()))
}
#[tokio::test(flavor = "multi_thread")]
async fn discovered_alias_real_ssh_bytes_stop_and_port_release() {
    let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = echo.local_addr().unwrap();
    let echo_task = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = echo.accept().await {
            tokio::spawn(async move {
                let (mut r, mut w) = tcp.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
            });
        }
    });
    let ssh = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ssh_port = ssh.local_addr().unwrap().port();
    let config = Arc::new(server::Config {
        keys: vec![PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap()],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let server = tokio::spawn(async move {
        TestServer::default()
            .run_on_socket(config, &ssh)
            .await
            .unwrap()
    });
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("config");
    std::fs::write(
        &file,
        format!("Host loopback\n HostName 127.0.0.1\n Port {ssh_port}\n User tester\n IdentityAgent none\n IdentityFile {}/nonexistent-test-key\n",dir.path().display()),
    )
    .unwrap();
    let host = ssh_config::discover_files(&[file], dir.path())
        .hosts
        .remove(0);
    let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = reserve.local_addr().unwrap().port();
    drop(reserve);
    let rule = Rule {
        id: "test".into(),
        name: "Test forward".into(),
        host_id: host.id.clone(),
        bind_address: "127.0.0.1".into(),
        bind_port: port,
        target_host: "127.0.0.1".into(),
        target_port: target.port(),
        ..Default::default()
    };
    let events = Arc::new(Mutex::new(Vec::new()));
    let notify = {
        let e = events.clone();
        Arc::new(move |r| e.lock().unwrap().push(r)) as tunnel::Notify
    };
    let prompts = Arc::new(Mutex::new(Vec::new()));
    let prompt = {
        let p = prompts.clone();
        Arc::new(
            move |_: String, fingerprint: String, tx: tokio::sync::oneshot::Sender<bool>| {
                p.lock().unwrap().push(fingerprint);
                let _ = tx.send(true);
            },
        ) as tunnel::TrustPrompt
    };
    let cancel = CancellationToken::new();
    let task = tokio::spawn(tunnel::run(
        tunnel::RunRequest {
            host: host.clone(),
            rule: rule.clone(),
            secret: "test-only".into(),
            expected: None,
            run_id: "run-1".into(),
            jumps: Vec::new(),
            test_only: false,
        },
        cancel.clone(),
        notify,
        prompt,
    ));
    wait_for(&events, "listening").await;
    let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let payload = vec![42u8; 256 * 1024];
    client.write_all(&payload).await.unwrap();
    let mut response = vec![0; payload.len()];
    tokio::time::timeout(Duration::from_secs(10), client.read_exact(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response, payload);
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(events
        .lock()
        .unwrap()
        .iter()
        .any(|r| r.sent == payload.len() as u64 && r.received == payload.len() as u64));
    // A second independent rule must survive stopping the first.
    let reservation = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port2 = reservation.local_addr().unwrap().port();
    drop(reservation);
    let mut rule2 = rule.clone();
    rule2.id = "independent".into();
    rule2.bind_port = port2;
    let events2 = Arc::new(Mutex::new(Vec::new()));
    let notify2 = {
        let e = events2.clone();
        Arc::new(move |r| e.lock().unwrap().push(r)) as tunnel::Notify
    };
    let cancel2 = CancellationToken::new();
    let expected = Some(prompts.lock().unwrap()[0].clone());
    let task2 = tokio::spawn(tunnel::run(
        tunnel::RunRequest {
            host,
            rule: rule2,
            secret: "test-only".into(),
            expected,
            run_id: "run-2".into(),
            jumps: Vec::new(),
            test_only: false,
        },
        cancel2.clone(),
        notify2,
        Arc::new(|_, _, _| panic!("Known key must not prompt")),
    ));
    wait_for(&events2, "listening").await;
    cancel.cancel();
    tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(prompts.lock().unwrap().len(), 1);
    assert!(prompts.lock().unwrap()[0].starts_with("SHA256:"));
    assert_eq!(wait_for(&events, "stopped").await.status, "stopped");
    assert!(
        TcpListener::bind(("127.0.0.1", port)).await.is_ok(),
        "stop must release listener"
    );
    let mut byte = [0];
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), client.read(&mut byte)).await,
        Ok(Ok(0)) | Ok(Err(_))
    ));
    let mut independent = TcpStream::connect(("127.0.0.1", port2)).await.unwrap();
    independent.write_all(b"still alive").await.unwrap();
    let mut bytes = [0u8; 11];
    independent.read_exact(&mut bytes).await.unwrap();
    assert_eq!(&bytes, b"still alive");
    cancel2.cancel();
    task2.await.unwrap();
    assert!(TcpListener::bind(("127.0.0.1", port2)).await.is_ok());
    server.abort();
    echo_task.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn failed_trust_auth_bind_and_cancel_never_leak_listener() {
    use oria_tunnel_lib::model::Host;
    let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ssh_port = socket.local_addr().unwrap().port();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let config = Arc::new(server::Config {
        keys: vec![key],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let server = tokio::spawn(async move {
        TestServer::default()
            .run_on_socket(config, &socket)
            .await
            .unwrap()
    });
    let dir = tempfile::tempdir().unwrap();
    let host = Host {
        id: "failure".into(),
        name: "failure".into(),
        address: "127.0.0.1".into(),
        port: ssh_port,
        user: "tester".into(),
        identity_files: vec![dir.path().join("absent").to_string_lossy().into_owned()],
        auth_method: oria_tunnel_lib::model::AuthMethod::Password,
        ..Default::default()
    };
    for mode in ["mismatch", "auth", "occupied", "cancel"] {
        let reservation = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reservation.local_addr().unwrap().port();
        let reservation = if mode == "occupied" {
            Some(reservation)
        } else {
            drop(reservation);
            None
        };
        let rule = Rule {
            id: mode.into(),
            name: mode.into(),
            host_id: host.id.clone(),
            bind_address: "127.0.0.1".into(),
            bind_port: port,
            target_host: "127.0.0.1".into(),
            target_port: 9,
            ..Default::default()
        };
        let events = Arc::new(Mutex::new(Vec::new()));
        let notify = {
            let e = events.clone();
            Arc::new(move |r| e.lock().unwrap().push(r)) as tunnel::Notify
        };
        let pending = Arc::new(Mutex::new(None));
        let prompt = {
            let p = pending.clone();
            Arc::new(move |_: String, _: String, tx| *p.lock().unwrap() = Some(tx))
                as tunnel::TrustPrompt
        };
        let cancel = CancellationToken::new();
        let task = tokio::spawn(tunnel::run(
            tunnel::RunRequest {
                host: host.clone(),
                rule,
                secret: if mode == "auth" {
                    "incorrect".into()
                } else {
                    "test-only".into()
                },
                expected: if mode == "cancel" {
                    None
                } else {
                    Some(if mode == "mismatch" {
                        "wrong-key".into()
                    } else {
                        fingerprint.clone()
                    })
                },
                run_id: mode.into(),
                jumps: Vec::new(),
                test_only: false,
            },
            cancel.clone(),
            notify,
            prompt,
        ));
        if mode == "cancel" {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if pending.lock().unwrap().is_some() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await
                }
            })
            .await
            .unwrap();
            cancel.cancel();
            wait_for(&events, "stopped").await;
        } else {
            let failed = wait_for(&events, "failed").await;
            assert!(!failed.message.is_empty());
            assert!(pending.lock().unwrap().is_none());
        }
        tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        assert!(
            !events
                .lock()
                .unwrap()
                .iter()
                .any(|r| r.status == "listening"),
            "{mode} must not become ready"
        );
        drop(reservation);
        assert!(
            TcpListener::bind(("127.0.0.1", port)).await.is_ok(),
            "{mode} leaked a listener"
        );
    }
    server.abort();
}

// All listeners, SSH servers, passwords and names below belong to this test process.
#[tokio::test(flavor = "multi_thread")]
async fn isolated_loopback_remote_and_socks_bytes_dns_commands_and_release() {
    let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = echo.local_addr().unwrap();
    let echo_task = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = echo.accept().await {
            tokio::spawn(async move {
                let (mut r, mut w) = tcp.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
            });
        }
    });
    let ssh = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ssh_port = ssh.local_addr().unwrap().port();
    let server_state = TestServer::default();
    let destinations = server_state.destinations.clone();
    let commands = server_state.commands.clone();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let config = Arc::new(server::Config {
        keys: vec![key],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let ssh_task = tokio::spawn(async move {
        let mut server = server_state;
        server.run_on_socket(config, &ssh).await.unwrap();
    });
    let host = Host {
        id: "fixture".into(),
        name: "fixture".into(),
        address: "127.0.0.1".into(),
        port: ssh_port,
        user: "tester".into(),
        auth_method: oria_tunnel_lib::model::AuthMethod::Password,
        ..Default::default()
    };
    for kind in [ForwardKind::R, ForwardKind::D] {
        let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reserve.local_addr().unwrap().port();
        drop(reserve);
        let rule = Rule {
            id: format!("{kind:?}"),
            name: "fixture".into(),
            host_id: host.id.clone(),
            bind_port: port,
            target_host: "127.0.0.1".into(),
            target_port: target.port(),
            kind,
            ..Default::default()
        };
        let events = Arc::new(Mutex::new(Vec::new()));
        let e = events.clone();
        let cancel = CancellationToken::new();
        let task = tokio::spawn(tunnel::run(
            tunnel::RunRequest {
                host: host.clone(),
                rule,
                secret: "test-only".into(),
                expected: Some(fingerprint.clone()),
                run_id: "fixture-run".into(),
                jumps: vec![],
                test_only: false,
            },
            cancel.clone(),
            Arc::new(move |r| e.lock().unwrap().push(r)),
            Arc::new(|_, _, _| panic!("known key")),
        ));
        wait_for(&events, "listening").await;
        // An idle SOCKS client must not block other requests or stop.
        let _idle = if kind == ForwardKind::D {
            Some(TcpStream::connect(("127.0.0.1", port)).await.unwrap())
        } else {
            None
        };
        let mut tcp = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        if kind == ForwardKind::D {
            tcp.write_all(&[5, 1, 0]).await.unwrap();
            let mut auth = [0; 2];
            tcp.read_exact(&mut auth).await.unwrap();
            assert_eq!(auth, [5, 0]);
            let domain = b"only-on-ssh.test";
            let mut request = vec![5, 1, 0, 3, domain.len() as u8];
            request.extend_from_slice(domain);
            request.extend_from_slice(&target.port().to_be_bytes());
            tcp.write_all(&request).await.unwrap();
            let mut reply = [0; 10];
            tcp.read_exact(&mut reply).await.unwrap();
            assert_eq!(reply[1], 0);
        }
        let payload = vec![73; 256 * 1024];
        tcp.write_all(&payload).await.unwrap();
        tcp.shutdown().await.unwrap();
        let mut received = Vec::new();
        tokio::time::timeout(Duration::from_secs(10), tcp.read_to_end(&mut received))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(received, payload);
        let stats = wait_for(&events, "listening").await; // Wait for a metrics publication after EOF.
        let _ = stats;
        tokio::time::sleep(Duration::from_millis(550)).await;
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.sent == payload.len() as u64 && r.received == payload.len() as u64));
        cancel.cancel();
        tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if TcpListener::bind(("127.0.0.1", port)).await.is_ok() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }
    // In R, the local TCP stream is the target. Count a 2-byte request as received
    // and its 5-byte response as sent, regardless of the arrow on the canvas.
    let service = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let service_port = service.local_addr().unwrap().port();
    let service_task = tokio::spawn(async move {
        let (mut tcp, _) = service.accept().await.unwrap();
        let mut request = [0; 2];
        tcp.read_exact(&mut request).await.unwrap();
        assert_eq!(&request, b"in");
        tcp.write_all(b"reply").await.unwrap();
    });
    let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let remote_port = reserve.local_addr().unwrap().port();
    drop(reserve);
    let metrics = Arc::new(Mutex::new(Vec::new()));
    let m = metrics.clone();
    let cancel = CancellationToken::new();
    let remote_task = tokio::spawn(tunnel::run(
        tunnel::RunRequest {
            host: host.clone(),
            rule: Rule {
                id: "direction".into(),
                name: "direction".into(),
                host_id: host.id.clone(),
                kind: ForwardKind::R,
                bind_port: remote_port,
                target_host: "127.0.0.1".into(),
                target_port: service_port,
                ..Default::default()
            },
            secret: "test-only".into(),
            expected: Some(fingerprint.clone()),
            run_id: "direction".into(),
            jumps: vec![],
            test_only: false,
        },
        cancel.clone(),
        Arc::new(move |r| m.lock().unwrap().push(r)),
        Arc::new(|_, _, _| panic!("known key")),
    ));
    wait_for(&metrics, "listening").await;
    let mut tcp = TcpStream::connect(("127.0.0.1", remote_port))
        .await
        .unwrap();
    tcp.write_all(b"in").await.unwrap();
    tcp.shutdown().await.unwrap();
    let mut response = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), tcp.read_to_end(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&response, b"reply");
    service_task.await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if metrics
                .lock()
                .unwrap()
                .iter()
                .any(|r| r.sent == 5 && r.received == 2)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    cancel.cancel();
    remote_task.await.unwrap();
    assert!(destinations
        .lock()
        .unwrap()
        .iter()
        .any(|h| h == "only-on-ssh.test"));
    assert_eq!(
        commands.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "default -N must not open a command"
    );
    // Explicit command execution must be acknowledged before the listener becomes ready.
    let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = reserve.local_addr().unwrap().port();
    drop(reserve);
    let events = Arc::new(Mutex::new(Vec::new()));
    let e = events.clone();
    let cancel = CancellationToken::new();
    let task = tokio::spawn(tunnel::run(
        tunnel::RunRequest {
            host: host.clone(),
            rule: Rule {
                id: "command".into(),
                host_id: host.id.clone(),
                name: "command".into(),
                bind_port: port,
                target_host: "127.0.0.1".into(),
                target_port: target.port(),
                no_remote_command: false,
                remote_command: "test-command".into(),
                ..Default::default()
            },
            secret: "test-only".into(),
            expected: Some(fingerprint.clone()),
            run_id: "command".into(),
            jumps: vec![],
            test_only: false,
        },
        cancel.clone(),
        Arc::new(move |r| e.lock().unwrap().push(r)),
        Arc::new(|_, _, _| panic!("known key")),
    ));
    wait_for(&events, "listening").await;
    assert_eq!(commands.load(std::sync::atomic::Ordering::SeqCst), 1);
    cancel.cancel();
    task.await.unwrap();
    // A host probe only authenticates: even an occupied bind port and explicit command are ignored.
    let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let e = events.clone();
    tunnel::run(
        tunnel::RunRequest {
            host: host.clone(),
            rule: Rule {
                id: "probe".into(),
                host_id: host.id.clone(),
                name: "probe".into(),
                bind_port: occupied.local_addr().unwrap().port(),
                target_host: "127.0.0.1".into(),
                target_port: 9,
                no_remote_command: false,
                remote_command: "test-command".into(),
                ..Default::default()
            },
            secret: "test-only".into(),
            expected: Some(fingerprint),
            run_id: "probe".into(),
            jumps: vec![],
            test_only: true,
        },
        CancellationToken::new(),
        Arc::new(move |r| e.lock().unwrap().push(r)),
        Arc::new(|_, _, _| panic!("known key")),
    )
    .await;
    assert_eq!(events.lock().unwrap().last().unwrap().status, "tested");
    assert!(!events
        .lock()
        .unwrap()
        .iter()
        .any(|r| matches!(r.status.as_str(), "binding" | "listening")));
    assert_eq!(commands.load(std::sync::atomic::Ordering::SeqCst), 1);
    ssh_task.abort();
    echo_task.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_loopback_ordered_inline_jumps_check_each_key_authentication_and_cancellation() {
    let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target_port = echo.local_addr().unwrap().port();
    let echo_task = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = echo.accept().await {
            tokio::spawn(async move {
                let (mut r, mut w) = tcp.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
            });
        }
    });
    let mut servers = Vec::new();
    let mut hosts = Vec::new();
    for id in ["first", "second", "target"] {
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = socket.local_addr().unwrap().port();
        let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
        let config = Arc::new(server::Config {
            keys: vec![key],
            auth_rejection_time: Duration::ZERO,
            ..Default::default()
        });
        servers.push(tokio::spawn(async move {
            TestServer::default()
                .run_on_socket(config, &socket)
                .await
                .unwrap();
        }));
        hosts.push(Host {
            id: id.into(),
            name: id.into(),
            address: "127.0.0.1".into(),
            port,
            user: "tester".into(),
            auth_method: oria_tunnel_lib::model::AuthMethod::Password,
            ..Default::default()
        });
    }
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("config");
    std::fs::write(&root,format!("Host first second target\n HostName 127.0.0.1\n User tester\n IdentityAgent none\nHost first\n Port {}\nHost second\n Port {}\n ProxyJump first\nHost target\n Port {}\n ProxyJump tester@first:{},ssh://tester@second:{}\n",hosts[0].port,hosts[1].port,hosts[2].port,hosts[0].port,hosts[1].port)).unwrap();
    let discovered = ssh_config::discover_files(&[root], dir.path());
    assert!(discovered
        .hosts
        .iter()
        .all(|h| h.identity_agent.as_deref() == Some("none") && h.identity_files.is_empty()));
    let target = discovered
        .hosts
        .iter()
        .find(|h| h.id == "ssh:target")
        .unwrap();
    let route = oria_tunnel_lib::model::resolve_jumps(&discovered.hosts, target).unwrap();
    assert_eq!(route.len(), 2);
    for mode in [
        "success",
        "wrong-jump-key",
        "wrong-second-key",
        "wrong-second-password",
        "wrong-target-password",
        "cancel-second-trust",
        "cancel-target-trust",
    ] {
        let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reserve.local_addr().unwrap().port();
        drop(reserve);
        let events = Arc::new(Mutex::new(Vec::new()));
        let e = events.clone();
        let prompts = Arc::new(Mutex::new(Vec::new()));
        let p = prompts.clone();
        let pending = Arc::new(Mutex::new(None));
        let pending_clone = pending.clone();
        let cancel = CancellationToken::new();
        let task = tokio::spawn(tunnel::run(
            tunnel::RunRequest {
                host: target.clone(),
                rule: Rule {
                    id: mode.into(),
                    name: mode.into(),
                    host_id: target.id.clone(),
                    bind_port: port,
                    target_host: "127.0.0.1".into(),
                    target_port,
                    ..Default::default()
                },
                secret: if mode == "wrong-target-password" {
                    "wrong"
                } else {
                    "test-only"
                }
                .into(),
                expected: None,
                run_id: mode.into(),
                test_only: false,
                jumps: route
                    .iter()
                    .enumerate()
                    .map(|(index, host)| tunnel::HopRequest {
                        host: host.clone(),
                        secret: if mode == "wrong-second-password" && index == 1 {
                            "wrong"
                        } else {
                            "test-only"
                        }
                        .into(),
                        expected: ((mode == "wrong-jump-key" && index == 0)
                            || (mode == "wrong-second-key" && index == 1))
                            .then(|| "SHA256:wrong".into()),
                    })
                    .collect(),
            },
            cancel.clone(),
            Arc::new(move |r| e.lock().unwrap().push(r)),
            Arc::new(move |endpoint, _, reply| {
                p.lock().unwrap().push(endpoint);
                if (mode == "cancel-target-trust" && p.lock().unwrap().len() == 3)
                    || (mode == "cancel-second-trust" && p.lock().unwrap().len() == 2)
                {
                    *pending_clone.lock().unwrap() = Some(reply);
                } else {
                    let _ = reply.send(true);
                }
            }),
        ));
        if mode == "success" {
            wait_for(&events, "listening").await;
            let mut tcp = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            tcp.write_all(b"through jump").await.unwrap();
            let mut response = [0; 12];
            tcp.read_exact(&mut response).await.unwrap();
            assert_eq!(&response, b"through jump");
            assert_eq!(
                *prompts.lock().unwrap(),
                hosts
                    .iter()
                    .map(|h| format!("{}:{}", h.address, h.port))
                    .collect::<Vec<_>>()
            );
            cancel.cancel();
        } else if matches!(mode, "cancel-target-trust" | "cancel-second-trust") {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if pending.lock().unwrap().is_some() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            cancel.cancel();
        } else {
            wait_for(&events, "failed").await;
            assert!(!events
                .lock()
                .unwrap()
                .iter()
                .any(|r| r.status == "listening"));
        }
        tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        assert!(TcpListener::bind(("127.0.0.1", port)).await.is_ok());
    }
    for task in servers {
        task.abort();
    }
    echo_task.abort();
}

#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn isolated_windows_named_pipe_agent_signs_and_obeys_identities_only() {
    use russh::keys::agent::{client::AgentClient, server::serve};
    use tokio::net::windows::named_pipe::ServerOptions;
    let pipe = format!(r"\\.\pipe\oriatunnel-fixture-{}", uuid::Uuid::new_v4());
    let first = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe)
        .unwrap();
    let incoming =
        futures_util::stream::unfold((first, pipe.clone()), |(server, path)| async move {
            if server.connect().await.is_err() {
                return None;
            }
            let next = ServerOptions::new().create(&path).unwrap();
            Some((Ok(server), (next, path)))
        });
    let agent_task = tokio::spawn(serve(Box::pin(incoming), ()));
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let mut agent = AgentClient::connect_named_pipe(&pipe).await.unwrap();
    agent.add_identity(&key, &[]).await.unwrap();
    drop(agent);
    let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ssh_port = socket.local_addr().unwrap().port();
    let mut server = TestServer::default();
    server.allowed_key = Some(key.public_key().clone());
    let host_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = host_key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let config = Arc::new(server::Config {
        keys: vec![host_key],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let ssh_task = tokio::spawn(async move {
        let mut server = server;
        server.run_on_socket(config, &socket).await.unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let public_path = dir.path().join("fixture.pub");
    std::fs::write(&public_path, key.public_key().to_openssh().unwrap()).unwrap();
    for allow in [true, false] {
        let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reserve.local_addr().unwrap().port();
        drop(reserve);
        let host = Host {
            id: "agent-fixture".into(),
            name: "agent-fixture".into(),
            address: "127.0.0.1".into(),
            port: ssh_port,
            user: "tester".into(),
            auth_method: oria_tunnel_lib::model::AuthMethod::Agent,
            identity_agent: Some(pipe.clone()),
            identities_only: true,
            identity_files: vec![if allow {
                public_path.clone()
            } else {
                dir.path().join("absent.pub")
            }
            .to_string_lossy()
            .into_owned()],
            ..Default::default()
        };
        let events = Arc::new(Mutex::new(Vec::new()));
        let e = events.clone();
        let cancel = CancellationToken::new();
        let task = tokio::spawn(tunnel::run(
            tunnel::RunRequest {
                rule: Rule {
                    id: "agent".into(),
                    name: "agent".into(),
                    host_id: host.id.clone(),
                    bind_port: port,
                    target_host: "127.0.0.1".into(),
                    target_port: 9,
                    ..Default::default()
                },
                host,
                secret: String::new().into(),
                expected: Some(fingerprint.clone()),
                run_id: "agent".into(),
                jumps: vec![],
                test_only: false,
            },
            cancel.clone(),
            Arc::new(move |r| e.lock().unwrap().push(r)),
            Arc::new(|_, _, _| panic!("known key")),
        ));
        if allow {
            wait_for(&events, "listening").await;
            cancel.cancel();
        } else {
            wait_for(&events, "failed").await;
            assert!(!events
                .lock()
                .unwrap()
                .iter()
                .any(|r| r.status == "listening"));
        }
        task.await.unwrap();
        assert!(TcpListener::bind(("127.0.0.1", port)).await.is_ok());
    }
    ssh_task.abort();
    agent_task.abort();
}

async fn isolated_fixture() -> (Host, String, tokio::task::JoinHandle<()>) {
    let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let config = Arc::new(server::Config {
        keys: vec![key],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let task = tokio::spawn(async move {
        TestServer::default()
            .run_on_socket(config, &socket)
            .await
            .unwrap();
    });
    (
        Host {
            id: "isolated".into(),
            name: "isolated".into(),
            address: "127.0.0.1".into(),
            port,
            user: "tester".into(),
            auth_method: oria_tunnel_lib::model::AuthMethod::Password,
            ..Default::default()
        },
        fingerprint,
        task,
    )
}
#[tokio::test(flavor = "multi_thread")]
async fn isolated_loopback_remote_refusals_and_socks_ipv6_protocol_errors() {
    let (host, fingerprint, server) = isolated_fixture().await;
    for address in ["127.0.0.1", "0.0.0.0"] {
        let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = occupied.local_addr().unwrap().port();
        let events = Arc::new(Mutex::new(Vec::new()));
        let e = events.clone();
        tunnel::run(
            tunnel::RunRequest {
                host: host.clone(),
                rule: Rule {
                    id: address.into(),
                    name: address.into(),
                    host_id: host.id.clone(),
                    kind: ForwardKind::R,
                    bind_address: address.into(),
                    bind_port: port,
                    target_host: "127.0.0.1".into(),
                    target_port: 9,
                    ..Default::default()
                },
                secret: "test-only".into(),
                expected: Some(fingerprint.clone()),
                run_id: "refusal".into(),
                jumps: vec![],
                test_only: false,
            },
            CancellationToken::new(),
            Arc::new(move |r| e.lock().unwrap().push(r)),
            Arc::new(|_, _, _| panic!("known key")),
        )
        .await;
        assert_eq!(events.lock().unwrap().last().unwrap().status, "failed");
        assert!(!events
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.status == "listening"));
    }
    let echo = TcpListener::bind("[::1]:0").await.unwrap();
    let target_port = echo.local_addr().unwrap().port();
    let echo_task = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = echo.accept().await {
            tokio::spawn(async move {
                let (mut r, mut w) = tcp.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
            });
        }
    });
    let reserve = TcpListener::bind("[::1]:0").await.unwrap();
    let port = reserve.local_addr().unwrap().port();
    drop(reserve);
    let events = Arc::new(Mutex::new(Vec::new()));
    let e = events.clone();
    let cancel = CancellationToken::new();
    let task = tokio::spawn(tunnel::run(
        tunnel::RunRequest {
            host: host.clone(),
            rule: Rule {
                id: "ipv6".into(),
                name: "ipv6".into(),
                host_id: host.id,
                kind: ForwardKind::D,
                bind_address: "::1".into(),
                bind_port: port,
                ..Default::default()
            },
            secret: "test-only".into(),
            expected: Some(fingerprint),
            run_id: "ipv6".into(),
            jumps: vec![],
            test_only: false,
        },
        cancel.clone(),
        Arc::new(move |r| e.lock().unwrap().push(r)),
        Arc::new(|_, _, _| panic!("known key")),
    ));
    wait_for(&events, "listening").await;
    let mut no_auth = TcpStream::connect(("::1", port)).await.unwrap();
    no_auth.write_all(&[5, 1, 2]).await.unwrap();
    let mut auth = [0; 2];
    no_auth.read_exact(&mut auth).await.unwrap();
    assert_eq!(auth, [5, 255]);
    for (request, code) in [(vec![5, 3, 0, 1], 7), (vec![5, 1, 0, 9], 8)] {
        let mut tcp = TcpStream::connect(("::1", port)).await.unwrap();
        tcp.write_all(&[5, 1, 0]).await.unwrap();
        tcp.read_exact(&mut auth).await.unwrap();
        tcp.write_all(&request).await.unwrap();
        let mut response = [0; 10];
        tcp.read_exact(&mut response).await.unwrap();
        assert_eq!(response[1], code);
    }
    let mut tcp = TcpStream::connect(("::1", port)).await.unwrap();
    tcp.write_all(&[5, 1, 0]).await.unwrap();
    tcp.read_exact(&mut auth).await.unwrap();
    let mut request = vec![5, 1, 0, 4];
    request.extend_from_slice(&std::net::Ipv6Addr::LOCALHOST.octets());
    request.extend_from_slice(&target_port.to_be_bytes());
    tcp.write_all(&request).await.unwrap();
    let mut response = [0; 10];
    tcp.read_exact(&mut response).await.unwrap();
    assert_eq!(response[1], 0);
    tcp.write_all(b"ipv6-ok").await.unwrap();
    let mut bytes = [0; 7];
    tcp.read_exact(&mut bytes).await.unwrap();
    assert_eq!(&bytes, b"ipv6-ok");
    cancel.cancel();
    task.await.unwrap();
    assert!(TcpListener::bind(("::1", port)).await.is_ok());
    server.abort();
    echo_task.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_loopback_encrypted_private_key_authentication_and_wrong_passphrase() {
    let dir = tempfile::tempdir().unwrap();
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let encrypted = key.encrypt(&mut rand::rng(), "fixture-passphrase").unwrap();
    let path = dir.path().join("ephemeral-fixture-key");
    // Generated solely for this fixture. TempDir removes the key; no user identity is read or copied.
    encrypted
        .write_openssh_file(&path, russh::keys::ssh_key::LineEnding::LF)
        .unwrap();
    let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    let host_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = host_key
        .public_key()
        .fingerprint(russh::keys::HashAlg::Sha256)
        .to_string();
    let config = Arc::new(server::Config {
        keys: vec![host_key],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let mut server = TestServer::default();
    server.allowed_key = Some(key.public_key().clone());
    let task = tokio::spawn(async move {
        server.run_on_socket(config, &socket).await.unwrap();
    });
    let host = Host {
        id: "key".into(),
        name: "key".into(),
        address: "127.0.0.1".into(),
        port,
        user: "tester".into(),
        identity_files: vec![path.to_string_lossy().into_owned()],
        auth_method: oria_tunnel_lib::model::AuthMethod::PrivateKey,
        ..Default::default()
    };
    for (passphrase, saved) in [
        ("fixture-passphrase", false),
        ("wrong", false),
        ("fixture-passphrase", true),
    ] {
        let events = Arc::new(Mutex::new(Vec::new()));
        let e = events.clone();
        tunnel::run(
            tunnel::RunRequest {
                host: host.clone(),
                rule: Rule {
                    id: "key".into(),
                    name: "key".into(),
                    host_id: host.id.clone(),
                    bind_port: 9,
                    target_host: "127.0.0.1".into(),
                    target_port: 9,
                    ..Default::default()
                },
                secret: if saved {
                    tunnel::Secret::password(passphrase.into())
                } else {
                    passphrase.into()
                },
                expected: Some(fingerprint.clone()),
                run_id: "key".into(),
                jumps: vec![],
                test_only: true,
            },
            CancellationToken::new(),
            Arc::new(move |r| e.lock().unwrap().push(r)),
            Arc::new(|_, _, _| panic!("known key")),
        )
        .await;
        assert_eq!(
            events.lock().unwrap().last().unwrap().status,
            if passphrase == "wrong" || saved {
                "failed"
            } else {
                "tested"
            }
        );
        assert!(!format!("{:?}", events.lock().unwrap()).contains(passphrase));
    }
    task.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn password_observer_only_receives_successful_trusted_authentication_per_hop() {
    let (mut target, key, target_server) = isolated_fixture().await;
    target.id = "target".into();
    let (mut jump, jump_key, jump_server) = isolated_fixture().await;
    jump.id = "jump".into();
    for mode in [
        "success",
        "wrong-password",
        "wrong-key",
        "cancelled",
        "jump-success",
        "target-failure",
    ] {
        let observed = Arc::new(Mutex::new(Vec::new()));
        let output = observed.clone();
        let events = Arc::new(Mutex::new(Vec::new()));
        let statuses = events.clone();
        let cancel = CancellationToken::new();
        if mode == "cancelled" {
            cancel.cancel();
        }
        let with_jump = matches!(mode, "jump-success" | "target-failure");
        tokio::time::timeout(
            Duration::from_secs(10),
            tunnel::run_with_password_observer(
                tunnel::RunRequest {
                    host: target.clone(),
                    rule: Rule {
                        id: "observer".into(),
                        name: "Observer fixture".into(),
                        host_id: target.id.clone(),
                        bind_port: 9,
                        target_host: "127.0.0.1".into(),
                        target_port: 9,
                        ..Default::default()
                    },
                    secret: tunnel::Secret::password(
                        if matches!(mode, "wrong-password" | "target-failure") {
                            "rejected"
                        } else {
                            "test-only"
                        }
                        .into(),
                    ),
                    expected: Some(if mode == "wrong-key" {
                        "untrusted".into()
                    } else {
                        key.clone()
                    }),
                    run_id: mode.into(),
                    test_only: true,
                    jumps: if with_jump {
                        vec![tunnel::HopRequest {
                            host: jump.clone(),
                            secret: tunnel::Secret::password("test-only".into()),
                            expected: Some(jump_key.clone()),
                        }]
                    } else {
                        vec![]
                    },
                },
                cancel,
                Arc::new(move |r| statuses.lock().unwrap().push(r)),
                Arc::new(|_, _, _| panic!("known fixture key")),
                Some(Arc::new(move |host, password, method| {
                    assert!(password == "test-only");
                    assert!(method == oria_tunnel_lib::model::AuthMethod::Password);
                    output.lock().unwrap().push(host.id.clone());
                })),
            ),
        )
        .await
        .unwrap();
        let expected: Vec<&str> = match mode {
            "success" => vec!["target"],
            "jump-success" => vec!["jump", "target"],
            "target-failure" => vec!["jump"],
            _ => vec![],
        };
        assert_eq!(*observed.lock().unwrap(), expected);
        assert!(!format!("{:?}", events.lock().unwrap()).contains("test-only"));
    }
    jump_server.abort();
    target_server.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_loopback_handshake_timeout_releases_socket_but_waits_for_user_trust() {
    for banner in [false, true] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let peer = tokio::spawn(async move {
            let (mut tcp, _) = listener.accept().await.unwrap();
            if banner {
                tcp.write_all(b"SSH-2.0-isolated-timeout-fixture\r\n")
                    .await
                    .unwrap();
            }
            let mut bytes = Vec::new();
            tokio::time::timeout(Duration::from_secs(4), tcp.read_to_end(&mut bytes))
                .await
                .expect("timeout must close SSH transport")
                .unwrap();
        });
        let events = Arc::new(Mutex::new(Vec::new()));
        let e = events.clone();
        let host = Host {
            id: "timeout".into(),
            name: "timeout".into(),
            address: "127.0.0.1".into(),
            port,
            user: "tester".into(),
            auth_method: oria_tunnel_lib::model::AuthMethod::Password,
            connection: oria_tunnel_lib::model::ConnectionOptions {
                connect_timeout_secs: 1,
                ..Default::default()
            },
            ..Default::default()
        };
        tunnel::run(
            tunnel::RunRequest {
                rule: Rule {
                    id: "timeout".into(),
                    name: "timeout".into(),
                    host_id: host.id.clone(),
                    bind_port: 9,
                    target_host: "127.0.0.1".into(),
                    target_port: 9,
                    ..Default::default()
                },
                host,
                secret: "test-only".into(),
                expected: None,
                run_id: "timeout".into(),
                jumps: vec![],
                test_only: true,
            },
            CancellationToken::new(),
            Arc::new(move |r| e.lock().unwrap().push(r)),
            Arc::new(|_, _, _| panic!("silent peer has no host key")),
        )
        .await;
        assert_eq!(events.lock().unwrap().last().unwrap().status, "failed");
        assert!(events
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .message
            .contains("超时"));
        peer.await.unwrap();
    }
    let (mut host, _, server) = isolated_fixture().await;
    host.connection.connect_timeout_secs = 1;
    let events = Arc::new(Mutex::new(Vec::new()));
    let e = events.clone();
    let pending = Arc::new(Mutex::new(None));
    let p = pending.clone();
    let task = tokio::spawn(tunnel::run(
        tunnel::RunRequest {
            rule: Rule {
                id: "trust-delay".into(),
                name: "trust-delay".into(),
                host_id: host.id.clone(),
                bind_port: 9,
                target_host: "127.0.0.1".into(),
                target_port: 9,
                ..Default::default()
            },
            host,
            secret: "test-only".into(),
            expected: None,
            run_id: "trust-delay".into(),
            jumps: vec![],
            test_only: true,
        },
        CancellationToken::new(),
        Arc::new(move |r| e.lock().unwrap().push(r)),
        Arc::new(move |_, _, reply| {
            *p.lock().unwrap() = Some(reply);
        }),
    ));
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if pending.lock().unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(1300)).await;
    assert!(
        !task.is_finished(),
        "manual host verification must not consume ConnectTimeout"
    );
    pending.lock().unwrap().take().unwrap().send(true).unwrap();
    task.await.unwrap();
    assert_eq!(events.lock().unwrap().last().unwrap().status, "tested");
    server.abort();
}
