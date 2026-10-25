//! Real OS PTY fixture, isolated HOME/cwd, loopback only. Never reads user SSH config or keys.
#![allow(dead_code)]
use russh::{
    keys::{Algorithm, PrivateKey},
    server::{self, Auth, Server as _, Session},
    Channel, ChannelId, Pty, Sig,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};
#[cfg(unix)]
use std::{
    fs::File,
    io::{Read, Write},
    os::fd::{AsRawFd, FromRawFd},
};
#[cfg(unix)]
use tokio::io::unix::AsyncFd;
use tokio::net::{TcpListener, TcpStream};
#[cfg(windows)]
#[path = "terminal_windows_pty.rs"]
mod platform;
#[cfg(windows)]
use platform::{allocate, spawn_shell, PtyPair};
#[cfg(unix)]
use tokio_util::sync::CancellationToken;
#[cfg(unix)]
struct PtyPair {
    master: Arc<AsyncFd<File>>,
    slave: Mutex<Option<File>>,
    cancel: CancellationToken,
}
#[derive(Clone, Default)]
pub struct Fixture {
    pairs: Arc<Mutex<BTreeMap<ChannelId, Arc<PtyPair>>>>,
    pub refuse_pty: bool,
    pub refuse_shell: bool,
    pub sizes: Arc<Mutex<Vec<(u32, u32)>>>,
    pub shells: Arc<std::sync::atomic::AtomicUsize>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        for p in self.pairs.lock().unwrap().values() {
            p.cancel.cancel();
        }
    }
}
impl server::Server for Fixture {
    type Handler = Self;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
        Self {
            pairs: Default::default(),
            refuse_pty: self.refuse_pty,
            refuse_shell: self.refuse_shell,
            sizes: self.sizes.clone(),
            shells: self.shells.clone(),
        }
    }
}
#[cfg(unix)]
fn allocate(cols: u32, rows: u32) -> std::io::Result<PtyPair> {
    let (mut master, mut slave) = (-1, -1);
    let mut size = libc::winsize {
        ws_row: rows as u16,
        ws_col: cols as u16,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: openpty initializes two owned descriptors; size is valid for the call.
    if unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    } != 0
    {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: descriptors were newly allocated above, with exactly one owning File each.
    let (master, slave) = unsafe { (File::from_raw_fd(master), File::from_raw_fd(slave)) };
    if unsafe { libc::fcntl(master.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(PtyPair {
        // SAFETY: the owned File stays open and its fd is never replaced while registered.
        master: Arc::new(unsafe { AsyncFd::register(master) }?),
        slave: Mutex::new(Some(slave)),
        cancel: CancellationToken::new(),
    })
}
#[cfg(unix)]
async fn spawn_shell(
    pair: Arc<PtyPair>,
    channel: ChannelId,
    handle: server::Handle,
    command: Option<String>,
) {
    let dir = tempfile::tempdir().unwrap();
    let mut process = tokio::process::Command::new("/bin/sh");
    process
        .env_clear()
        .env("HOME", dir.path())
        .env("PATH", "/usr/bin:/bin")
        .env("TERM", "xterm-256color")
        .env(
            "LC_ALL",
            if cfg!(target_os = "macos") {
                "en_US.UTF-8"
            } else {
                "C.UTF-8"
            },
        )
        .env("PS1", "oria-e2> ")
        .env("HISTFILE", "/dev/null")
        .current_dir(dir.path())
        .kill_on_drop(true);
    if let Some(command) = command {
        process.args(["-c", &command]);
    } else {
        process.arg("-i");
    }
    let slave = pair.slave.lock().unwrap().take().unwrap();
    process
        .stdin(slave.try_clone().unwrap())
        .stdout(slave.try_clone().unwrap())
        .stderr(slave.try_clone().unwrap());
    // SAFETY: only async-signal-safe syscalls run between fork and exec. Child owns stdin.
    unsafe {
        process.pre_exec(|| {
            if libc::setsid() < 0 || libc::ioctl(0, libc::TIOCSCTTY as _, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = process.spawn().unwrap();
    drop(process);
    drop(slave);
    let output = pair.clone();
    let output_handle = handle.clone();
    let reader = tokio::spawn(async move {
        let mut data = [0u8; 8192];
        loop {
            let mut ready = tokio::select! {_=output.cancel.cancelled()=>break,r=output.master.readable()=>match r{Ok(r)=>r,Err(_)=>break}};
            let read = ready.try_io(|io| {
                let mut file = io.get_ref();
                file.read(&mut data)
            });
            match read {
                Ok(Ok(0)) | Ok(Err(_)) => break,
                Ok(Ok(n)) => {
                    if output_handle
                        .data(channel, data[..n].to_vec())
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => {}
            }
        }
    });
    let code = tokio::select! {_=pair.cancel.cancelled()=>{let _=child.kill().await;None},status=child.wait()=>status.ok().and_then(|s|s.code())};
    if code.is_none() {
        pair.cancel.cancel();
    }
    let _ = reader.await;
    if let Some(code) = code {
        let _ = handle.exit_status_request(channel, code as u32).await;
    }
    pair.cancel.cancel();
    let _ = handle.eof(channel).await;
    let _ = handle.close(channel).await;
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
    async fn pty_request(
        &mut self,
        ch: ChannelId,
        _: &str,
        cols: u32,
        rows: u32,
        _: u32,
        _: u32,
        _: &[(Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.refuse_pty {
            session.channel_failure(ch)?;
        } else {
            self.sizes.lock().unwrap().push((cols, rows));
            let pair = allocate(cols, rows).unwrap();
            self.pairs.lock().unwrap().insert(ch, Arc::new(pair));
            session.channel_success(ch)?;
        }
        Ok(())
    }
    async fn window_change_request(
        &mut self,
        ch: ChannelId,
        cols: u32,
        rows: u32,
        _: u32,
        _: u32,
        _: &mut Session,
    ) -> Result<(), Self::Error> {
        self.sizes.lock().unwrap().push((cols, rows));
        if let Some(pair) = self.pairs.lock().unwrap().get(&ch) {
            #[cfg(windows)]
            pair.resize(cols, rows);
            #[cfg(unix)]
            {
                let size = libc::winsize {
                    ws_row: rows as u16,
                    ws_col: cols as u16,
                    ws_xpixel: 0,
                    ws_ypixel: 0,
                };
                unsafe {
                    libc::ioctl(
                        pair.master.get_ref().as_raw_fd(),
                        libc::TIOCSWINSZ as _,
                        &size,
                    )
                };
            }
        }
        Ok(())
    }
    async fn shell_request(
        &mut self,
        ch: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.refuse_shell {
            session.channel_failure(ch)?;
            return Ok(());
        }
        session.channel_success(ch)?;
        self.shells
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if let Some(pair) = self.pairs.lock().unwrap().get(&ch).cloned() {
            tokio::spawn(spawn_shell(pair, ch, session.handle(), None));
        }
        Ok(())
    }
    async fn exec_request(
        &mut self,
        ch: ChannelId,
        command: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(pair) = self.pairs.lock().unwrap().get(&ch).cloned() {
            session.channel_success(ch)?;
            self.shells
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::spawn(spawn_shell(
                pair,
                ch,
                session.handle(),
                Some(String::from_utf8_lossy(command).into_owned()),
            ));
        } else {
            session.channel_failure(ch)?;
        }
        Ok(())
    }
    async fn data(
        &mut self,
        ch: ChannelId,
        data: &[u8],
        _: &mut Session,
    ) -> Result<(), Self::Error> {
        let pair = self.pairs.lock().unwrap().get(&ch).cloned();
        if let Some(pair) = pair {
            #[cfg(windows)]
            pair.write(data).await;
            #[cfg(unix)]
            {
                let mut remaining = data;
                while !remaining.is_empty() {
                    let mut ready = tokio::select! {_=pair.cancel.cancelled()=>break,r=pair.master.writable()=>match r{Ok(r)=>r,Err(_)=>break}};
                    match ready.try_io(|io| {
                        let mut file = io.get_ref();
                        file.write(remaining)
                    }) {
                        Ok(Ok(0)) | Ok(Err(_)) => break,
                        Ok(Ok(n)) => remaining = &remaining[n..],
                        Err(_) => {}
                    }
                }
            }
        }
        Ok(())
    }
    async fn channel_close(&mut self, ch: ChannelId, _: &mut Session) -> Result<(), Self::Error> {
        if let Some(pair) = self.pairs.lock().unwrap().remove(&ch) {
            pair.cancel.cancel();
        }
        Ok(())
    }
    async fn signal(&mut self, ch: ChannelId, _: Sig, _: &mut Session) -> Result<(), Self::Error> {
        if let Some(pair) = self.pairs.lock().unwrap().get(&ch) {
            pair.cancel.cancel();
        }
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
        if let Ok(mut socket) = TcpStream::connect((host, port as u16)).await {
            reply.accept().await;
            tokio::spawn(async move {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            });
        } else {
            reply.reject(russh::ChannelOpenFailure::ConnectFailed).await;
        }
        Ok(())
    }
}
pub async fn start(fixture: Fixture) -> (u16, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = Arc::new(server::Config {
        keys: vec![PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap()],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let task = tokio::spawn(async move {
        let mut fixture = fixture;
        let _ = fixture.run_on_socket(config, &listener).await;
    });
    (port, task)
}
