//! Native OpenSSH client against two disposable loopback SFTP servers.
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
#[path = "../../tests/common/posix_shell.rs"]
mod posix_shell;

// Match sshd's subsystem lifecycle: report the process exit before dropping the
// SSH stream. The raw SFTP fixture alone otherwise closes without an exit code.
pub(super) struct ExitStream<S> {
    inner: S,
    eof: bool,
    reported: bool,
    exit: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>,
}
impl<S> ExitStream<S> {
    pub fn new(inner: S, handle: server::Handle, id: ChannelId) -> Self {
        Self {
            inner,
            eof: false,
            reported: false,
            exit: Box::pin(async move {
                let _ = handle.exit_status_request(id, 0).await;
            }),
        }
    }
}
impl<S: tokio::io::AsyncRead + Unpin> tokio::io::AsyncRead for ExitStream<S> {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buffer: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        if !self.eof {
            let before = buffer.filled().len();
            match std::pin::Pin::new(&mut self.inner).poll_read(cx, buffer) {
                std::task::Poll::Ready(Ok(())) if buffer.filled().len() == before => {
                    self.eof = true
                }
                result => return result,
            }
        }
        if !self.reported {
            match self.exit.as_mut().poll(cx) {
                std::task::Poll::Pending => return std::task::Poll::Pending,
                std::task::Poll::Ready(()) => self.reported = true,
            }
        }
        std::task::Poll::Ready(Ok(()))
    }
}
impl<S: tokio::io::AsyncWrite + Unpin> tokio::io::AsyncWrite for ExitStream<S> {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        bytes: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        std::pin::Pin::new(&mut self.inner).poll_write(cx, bytes)
    }
    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

pub(super) struct Fixture {
    pub public_key: String,
    pub app_reads: Arc<AtomicUsize>,
    pub copies: AtomicUsize,
    directory: tempfile::TempDir,
    diagnostics: Mutex<Vec<u8>>,
}
fn posix(path: &std::path::Path) -> String {
    let value = crate::files::fs::display_path(&path.to_string_lossy()).replace('\\', "/");
    if cfg!(windows) && value.as_bytes().get(1) == Some(&b':') {
        format!("/{}{}", value[..1].to_ascii_lowercase(), &value[2..])
    } else {
        value
    }
}
impl Fixture {
    fn new() -> Arc<Self> {
        let directory = tempfile::tempdir().unwrap();
        // Ephemeral fixture identity only; never reads a user's SSH keys, logs
        // private material, or keeps it in workspace outputs. TempDir removes it.
        let key =
            russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
                .unwrap();
        key.write_openssh_file(
            directory.path().join("fixture-key"),
            russh::keys::ssh_key::LineEnding::LF,
        )
        .unwrap();
        std::fs::write(
            directory.path().join("ssh"),
            "#!/bin/sh\nexec /usr/bin/ssh -i \"$ORIA_FIXTURE_KEY\" -o IdentitiesOnly=yes \"$@\"\n",
        )
        .unwrap();
        std::fs::write(
            directory.path().join("scp"),
            r#"#!/usr/bin/env bash
args=("$@")
length=${#args[@]}
for index in "$((length-2))" "$((length-1))"; do
  if [[ "${args[index]}" == /* ]]; then args[index]="$ORIA_FIXTURE_ROOT${args[index]}"; fi
done
exec /usr/bin/scp -S "$ORIA_FIXTURE_HELPERS/ssh" "${args[@]}"
"#,
        )
        .unwrap();
        Arc::new(Self {
            public_key: key.public_key().to_openssh().unwrap(),
            app_reads: Arc::new(AtomicUsize::new(0)),
            copies: AtomicUsize::new(0),
            directory,
            diagnostics: Mutex::new(Vec::new()),
        })
    }
    async fn prepare(&self) {
        let script = format!(
            "chmod 700 '{}' '{}' && chmod 600 '{}' && /usr/bin/ssh -V",
            posix(&self.directory.path().join("ssh")),
            posix(&self.directory.path().join("scp")),
            posix(&self.directory.path().join("fixture-key"))
        );
        let output = posix_shell::command()
            .args(["-c", &script])
            .output()
            .await
            .unwrap();
        assert!(
            output.status.success(),
            "native OpenSSH fixture unavailable"
        );
    }
    pub fn execute(
        self: &Arc<Self>,
        root: PathBuf,
        channel: Channel<server::Msg>,
        handle: server::Handle,
        command: &[u8],
        cancel: CancellationToken,
    ) {
        let script = String::from_utf8(command.to_vec()).unwrap();
        let copying = script.starts_with("printf 'ORIA_FILE_PID:");
        if copying {
            self.copies.fetch_add(1, Ordering::SeqCst);
        }
        let fixture = self.clone();
        tokio::spawn(async move {
            let id = channel.id();
            let mut process = posix_shell::command();
            let helpers = posix(fixture.directory.path());
            let isolated = format!("export PATH=\"$ORIA_FIXTURE_HELPERS:/usr/bin:/bin\"; {script}");
            process
                .args(["-c", &isolated])
                .env_remove("BASH_ENV")
                .env_remove("ENV")
                .env("PATH", format!("{helpers}:/usr/bin:/bin"))
                .env("ORIA_FIXTURE_HELPERS", helpers)
                .env("ORIA_FIXTURE_ROOT", posix(&root))
                .env(
                    "ORIA_FIXTURE_KEY",
                    posix(&fixture.directory.path().join("fixture-key")),
                )
                .env("HOME", fixture.directory.path())
                .env("SSH_AUTH_SOCK", "")
                .kill_on_drop(true)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            let mut child = process.spawn().unwrap();
            let mut stdin = child.stdin.take().unwrap();
            let mut stdout = child.stdout.take().unwrap();
            let mut stderr = child.stderr.take().unwrap();
            let (mut inbound, mut outbound) = tokio::io::split(channel.into_stream());
            let input = tokio::spawn(async move {
                let _ = tokio::io::copy(&mut inbound, &mut stdin).await;
                let _ = stdin.shutdown().await;
            });
            let log_tools = script.starts_with("test -x");
            let output_fixture = fixture.clone();
            let output = tokio::spawn(async move {
                let mut buffer = [0; 4096];
                loop {
                    let count = stdout.read(&mut buffer).await.unwrap_or(0);
                    if count == 0 {
                        break;
                    }
                    if log_tools {
                        output_fixture
                            .diagnostics
                            .lock()
                            .unwrap()
                            .extend_from_slice(&buffer[..count]);
                    }
                    if outbound.write_all(&buffer[..count]).await.is_err() {
                        break;
                    }
                }
                outbound
            });
            let error_handle = handle.clone();
            let diagnostic = fixture.clone();
            let errors = tokio::spawn(async move {
                let mut bytes = [0; 4096];
                loop {
                    let count = stderr.read(&mut bytes).await.unwrap_or(0);
                    if count == 0 {
                        break;
                    }
                    {
                        let mut log = diagnostic.diagnostics.lock().unwrap();
                        if log.len() < 16384 {
                            log.extend_from_slice(&bytes[..count]);
                        }
                    }
                    let _ = error_handle
                        .extended_data(id, 1, bytes[..count].to_vec())
                        .await;
                }
            });
            let status = tokio::select! {_=cancel.cancelled()=>{let _=child.kill().await;255},result=child.wait()=>result.ok().and_then(|status|status.code()).unwrap_or(255) as u32};
            let outbound = output.await;
            let _ = errors.await;
            input.abort();
            if !(copying && root.join(".lose-direct-result").exists()) {
                let _ = handle.exit_status_request(id, status).await;
            }
            let _ = handle.eof(id).await;
            let _ = handle.close(id).await;
            drop(outbound);
        });
    }
}

async fn connect_pair(
    source: &std::path::Path,
    target: &std::path::Path,
    journal: PathBuf,
    fixture: Arc<Fixture>,
) -> (
    Arc<Manager>,
    tokio::task::JoinHandle<()>,
    tokio::task::JoinHandle<()>,
) {
    let (source_fs, a) = setup_with_direct(source.into(), false, Some(fixture.clone())).await;
    let (target_fs, b) = setup_with_direct(target.into(), false, Some(fixture)).await;
    let manager = Arc::new(Manager::new(journal));
    for (id, host, fs) in [("a-session", "a", source_fs), ("b-session", "b", target_fs)] {
        manager.remotes.lock().unwrap().insert(id.into(), fs);
        manager
            .route_keys
            .lock()
            .unwrap()
            .insert(id.into(), format!("frozen-{host}"));
        manager.sessions.lock().unwrap().insert(
            id.into(),
            Session {
                id: id.into(),
                host_id: host.into(),
                host_name: host.into(),
                phase: "connected".into(),
                route: vec![host.into()],
                fingerprint: None,
                endpoint: None,
                error: None,
            },
        );
    }
    (manager, a, b)
}
async fn submit_file(manager: &Arc<Manager>) -> String {
    let source = manager
        .directory(Some("a-session".into()), "/".into())
        .await
        .unwrap();
    let entry = source
        .entries
        .iter()
        .find(|entry| entry.name.ends_with(".bin"))
        .unwrap();
    let target = manager
        .directory(Some("b-session".into()), "/".into())
        .await
        .unwrap();
    manager
        .submit(
            uuid::Uuid::new_v4().to_string(),
            vec![entry.id.clone()],
            target.id,
        )
        .await
        .unwrap()
}
#[tokio::test]
async fn native_openssh_push_and_pull_precede_relay_without_reading_payload_through_the_app() {
    for pull in [false, true] {
        let source = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let profile = tempfile::tempdir().unwrap();
        let fixture = Fixture::new();
        fixture.prepare().await;
        let executor = if pull { target.path() } else { source.path() };
        std::fs::write(executor.join(".allow-native-direct"), []).unwrap();
        let bytes = (0..256 * 1024 + 17)
            .map(|i| (i % 251) as u8)
            .collect::<Vec<_>>();
        let filename = "中文 [x] '$()'.bin";
        std::fs::write(source.path().join(filename), &bytes).unwrap();
        let (manager, a, b) = connect_pair(
            source.path(),
            target.path(),
            profile.path().join("history.json"),
            fixture.clone(),
        )
        .await;
        let id = submit_file(&manager).await;
        let task = settled(&manager, &id).await;
        assert_eq!(
            task.phase,
            "completed",
            "{}",
            String::from_utf8_lossy(&fixture.diagnostics.lock().unwrap())
        );
        assert_eq!(
            task.transport.as_deref(),
            Some("direct"),
            "{}",
            String::from_utf8_lossy(&fixture.diagnostics.lock().unwrap())
        );
        assert_eq!(task.direct_pull, pull);
        assert_eq!(fixture.copies.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.app_reads.load(Ordering::SeqCst), 0);
        assert_eq!(std::fs::read(target.path().join(filename)).unwrap(), bytes);
        manager.shutdown().await;
        a.abort();
        b.abort();
    }
}
#[tokio::test]
async fn lost_direct_result_never_replays_as_relay_and_requires_confirming_the_remote_process() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let profile = tempfile::tempdir().unwrap();
    let fixture = Fixture::new();
    fixture.prepare().await;
    std::fs::write(source.path().join(".allow-native-direct"), []).unwrap();
    std::fs::write(source.path().join(".lose-direct-result"), []).unwrap();
    std::fs::write(source.path().join("data.bin"), vec![8; 65536]).unwrap();
    let (manager, a, b) = connect_pair(
        source.path(),
        target.path(),
        profile.path().join("history.json"),
        fixture.clone(),
    )
    .await;
    let id = submit_file(&manager).await;
    let task = settled(&manager, &id).await;
    assert_eq!(
        task.error.as_deref(),
        Some("directUnknown"),
        "{}",
        String::from_utf8_lossy(&fixture.diagnostics.lock().unwrap())
    );
    assert!(task.direct_pending);
    assert!(manager.unresolved_direct());
    assert!(manager.active_ids().contains(&format!("files:{id}")));
    assert_eq!(task.transport.as_deref(), Some("direct"));
    assert_eq!(fixture.app_reads.load(Ordering::SeqCst), 0);
    assert!(!target.path().join("data.bin").exists());
    assert_eq!(
        manager.control(&id, "resume", None).await.unwrap_err(),
        "directUnknown"
    );
    assert_eq!(
        manager.control(&id, "cancel", None).await.unwrap_err(),
        "directUnknown"
    );
    manager.control(&id, "verify", None).await.unwrap();
    assert_eq!(manager.tasks.lock().unwrap()[&id].phase, "paused");
    assert!(!manager.tasks.lock().unwrap()[&id].direct_pending);
    manager.shutdown().await;
    a.abort();
    b.abort();
}

#[tokio::test]
async fn a_different_host_key_never_receives_a_direct_copy_and_falls_back_to_the_verified_sftp_sessions(
) {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let profile = tempfile::tempdir().unwrap();
    let fixture = Fixture::new();
    fixture.prepare().await;
    std::fs::write(source.path().join(".allow-native-direct"), []).unwrap();
    std::fs::write(source.path().join("data.bin"), vec![19; 65536]).unwrap();
    let (manager, a, b) = connect_pair(
        source.path(),
        target.path(),
        profile.path().join("history.json"),
        fixture.clone(),
    )
    .await;
    {
        let mut remotes = manager.remotes.lock().unwrap();
        let Fs::Remote(remote) = remotes.get_mut("b-session").unwrap() else {
            unreachable!()
        };
        let remote = Arc::get_mut(remote).unwrap();
        remote._connection.peer.as_mut().unwrap().public_key =
            russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
                .unwrap()
                .public_key()
                .to_openssh()
                .unwrap();
    }
    let id = submit_file(&manager).await;
    let task = settled(&manager, &id).await;
    assert_eq!(task.phase, "completed");
    assert_eq!(task.transport.as_deref(), Some("relay"));
    assert_eq!(fixture.copies.load(Ordering::SeqCst), 0);
    assert!(fixture.app_reads.load(Ordering::SeqCst) > 0);
    assert_eq!(
        std::fs::read(target.path().join("data.bin")).unwrap(),
        vec![19; 65536]
    );
    manager.shutdown().await;
    a.abort();
    b.abort();
}
