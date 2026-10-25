#![allow(dead_code)]
#[path = "posix_shell.rs"]
mod posix_shell;
use russh::{
    keys::{Algorithm, PrivateKey},
    server::{self, Auth, Server as _, Session},
    Channel, ChannelId, Sig,
};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::AsyncReadExt,
    net::{TcpListener, TcpStream},
};
use tokio_util::sync::CancellationToken;
#[derive(Clone)]
pub struct Fixture {
    pub calls: Arc<AtomicUsize>,
    pub history: Arc<Mutex<Vec<String>>>,
    pub home: Arc<tempfile::TempDir>,
    pub health_port: u16,
    pub shutdown: CancellationToken,
    children: Arc<Mutex<BTreeMap<ChannelId, CancellationToken>>>,
}
impl server::Server for Fixture {
    type Handler = Self;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
        Self {
            calls: self.calls.clone(),
            history: self.history.clone(),
            home: self.home.clone(),
            health_port: self.health_port,
            shutdown: self.shutdown.clone(),
            children: Default::default(),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        for c in self.children.lock().unwrap().values() {
            c.cancel();
        }
    }
}
impl server::Handler for Fixture {
    type Error = russh::Error;
    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if user == "tester" && password == "isolated-test-only" {
            Auth::Accept
        } else {
            Auth::reject()
        })
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
    async fn signal(&mut self, ch: ChannelId, _: Sig, _: &mut Session) -> Result<(), Self::Error> {
        if let Some(c) = self.children.lock().unwrap().get(&ch) {
            c.cancel();
        }
        Ok(())
    }
    async fn channel_close(&mut self, ch: ChannelId, _: &mut Session) -> Result<(), Self::Error> {
        if let Some(c) = self.children.lock().unwrap().remove(&ch) {
            c.cancel();
        }
        Ok(())
    }
    async fn exec_request(
        &mut self,
        ch: ChannelId,
        command: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.history
            .lock()
            .unwrap()
            .push(String::from_utf8_lossy(command).into_owned());
        if command == b"fixture-reject" {
            session.channel_failure(ch)?;
            return Ok(());
        }
        session.channel_success(ch)?;
        if command == b"fixture-unknown" {
            session.eof(ch)?;
            session.close(ch)?;
            return Ok(());
        }
        if command == b"fixture-signal" {
            session.exit_signal_request(ch, Sig::TERM, false, "", "en")?;
            session.close(ch)?;
            return Ok(());
        }
        let token = CancellationToken::new();
        self.children.lock().unwrap().insert(ch, token.clone());
        let handle = session.handle();
        let health_port = self.health_port;
        let script = match command {
            b"fixture-start"=>"touch started; printf 'started\\n'".into(),
            b"fixture-stop"=>"rm -f started; printf 'stopped\\n'".into(),
            b"fixture-status"=>"if test -f started; then printf 'running\\n'; else printf 'stopped\\n'; exit 3; fi".into(),
            b"fixture-json"=>"printf '{\"state\":\"running\",\"ready\":false}'".into(),
            b"fixture-bad-json"=>"printf '{\"state\":\"running\",\"unexpected\":true}'".into(),
            b"fixture-unmapped"=>"exit 9".into(),
            b"fixture-health"=>format!("curl --silent --show-error --fail --max-time 1 http://127.0.0.1:{health_port}/health"),
            // Windows can spend the entire short probe budget retrying a
            // refused socket. Keep this known closed-target fixture's mapping
            // stable without changing production exit-code interpretation.
            b"fixture-health-closed" if cfg!(windows)=>"curl --silent --show-error --fail --max-time 1 http://127.0.0.1:1/health; code=$?; if test \"$code\" = 28; then exit 7; else exit \"$code\"; fi".into(),
            b"fixture-health-closed"=>"curl --silent --show-error --fail --max-time 1 http://127.0.0.1:1/health".into(),
            b"fixture-fail"=>"printf 'failed\\n' >&2; exit 7".into(),
            b"fixture-hang"=>"sleep 30".into(),
            b"fixture-large"=>"dd if=/dev/zero bs=65536 count=48 2>/dev/null".into(),
            _=>"printf 'ok\\n'".into(),
        };
        let home = self.home.clone();
        tokio::spawn(async move {
            let mut process = {
                let mut p = posix_shell::command();
                p.args(["-c", &script])
                    .env_clear()
                    .env("HOME", home.path())
                    .env(
                        "PATH",
                        if cfg!(windows) {
                            "/mingw64/bin:/clangarm64/bin:/usr/bin:/bin"
                        } else {
                            "/usr/bin:/bin"
                        },
                    )
                    .current_dir(home.path());
                p
            };
            let mut child = process
                .kill_on_drop(true)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            let mut out = child.stdout.take().unwrap();
            let mut err = child.stderr.take().unwrap();
            let stdout = handle.clone();
            let stderr = handle.clone();
            let readers = tokio::spawn(async move {
                tokio::join!(
                    async {
                        let mut b = [0; 8192];
                        loop {
                            let n = out.read(&mut b).await.unwrap();
                            if n == 0 {
                                break;
                            }
                            if stdout.data(ch, b[..n].to_vec()).await.is_err() {
                                break;
                            }
                        }
                    },
                    async {
                        let mut b = [0; 8192];
                        loop {
                            let n = err.read(&mut b).await.unwrap();
                            if n == 0 {
                                break;
                            }
                            if stderr.extended_data(ch, 1, b[..n].to_vec()).await.is_err() {
                                break;
                            }
                        }
                    }
                );
            });
            let code = tokio::select! {_=token.cancelled()=>{let _=child.kill().await;None},status=child.wait()=>status.ok().and_then(|s|s.code())};
            if code.is_some() {
                let _ = readers.await;
            } else {
                readers.abort();
            }
            if let Some(code) = code {
                let _ = handle.exit_status_request(ch, code as u32).await;
            }
            let _ = handle.eof(ch).await;
            let _ = handle.close(ch).await;
        });
        Ok(())
    }
}
pub async fn start() -> (u16, Fixture, tokio::task::JoinHandle<()>) {
    let health = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let fixture = Fixture {
        calls: Arc::new(AtomicUsize::new(0)),
        history: Default::default(),
        home: Arc::new(tempfile::tempdir().unwrap()),
        health_port: health.local_addr().unwrap().port(),
        shutdown: CancellationToken::new(),
        children: Default::default(),
    };
    let home = fixture.home.clone();
    let cancel = fixture.shutdown.clone();
    tokio::spawn(async move {
        loop {
            let accepted = tokio::select! {_=cancel.cancelled()=>break,r=health.accept()=>r};
            let Ok((mut stream, _)) = accepted else {
                break;
            };
            let home = home.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let mut buf = [0; 2048];
                let _ = stream.read(&mut buf).await;
                let ready = std::fs::metadata(home.path().join("started"))
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|m| m.elapsed().ok())
                    .is_some_and(|age| age >= Duration::from_millis(1200));
                let reply = if ready {
                    "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nready"
                } else {
                    "HTTP/1.1 503 Unavailable\r\nContent-Length: 7\r\nConnection: close\r\n\r\nloading"
                };
                let _ = stream.write_all(reply.as_bytes()).await;
            });
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = Arc::new(server::Config {
        keys: vec![PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap()],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let server = fixture.clone();
    let job = tokio::spawn(async move {
        let mut server = server;
        let _ = server.run_on_socket(config, &listener).await;
    });
    (port, fixture, job)
}
