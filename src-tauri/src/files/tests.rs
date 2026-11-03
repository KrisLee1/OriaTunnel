use super::*;
use russh::{
    server::{self, Auth, Session as SshSession},
    Channel, ChannelId,
};
use russh_sftp::protocol::*;
use std::{collections::HashSet, path::PathBuf, time::Duration};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
#[path = "direct_tests.rs"]
mod direct_tests;
#[derive(Clone)]
struct Server {
    root: PathBuf,
    channels: Arc<Mutex<HashMap<ChannelId, Channel<server::Msg>>>>,
    reject: bool,
    direct: Option<Arc<direct_tests::Fixture>>,
    children: Arc<Mutex<HashMap<ChannelId, CancellationToken>>>,
    native_client: bool,
}
impl server::Server for Server {
    type Handler = Self;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
        Self {
            channels: Default::default(),
            children: Default::default(),
            native_client: false,
            ..self.clone()
        }
    }
}
impl server::Handler for Server {
    type Error = russh::Error;
    async fn exec_request(
        &mut self,
        id: ChannelId,
        command: &[u8],
        session: &mut SshSession,
    ) -> std::result::Result<(), Self::Error> {
        if let Some(fixture) = &self.direct {
            if self.root.join(".allow-native-direct").exists() {
                let channel = self.channels.lock().unwrap().remove(&id).unwrap();
                let token = CancellationToken::new();
                self.children.lock().unwrap().insert(id, token.clone());
                session.channel_success(id)?;
                fixture.execute(self.root.clone(), channel, session.handle(), command, token);
                return Ok(());
            }
        }
        session.channel_failure(id)?;
        Ok(())
    }
    async fn signal(
        &mut self,
        id: ChannelId,
        _: russh::Sig,
        _: &mut SshSession,
    ) -> std::result::Result<(), Self::Error> {
        if let Some(token) = self.children.lock().unwrap().get(&id) {
            token.cancel();
        }
        Ok(())
    }
    async fn channel_close(
        &mut self,
        id: ChannelId,
        _: &mut SshSession,
    ) -> std::result::Result<(), Self::Error> {
        if let Some(token) = self.children.lock().unwrap().remove(&id) {
            token.cancel();
        }
        self.channels.lock().unwrap().remove(&id);
        Ok(())
    }
    async fn auth_publickey(
        &mut self,
        user: &str,
        key: &russh::keys::PublicKey,
    ) -> std::result::Result<Auth, Self::Error> {
        self.native_client = user == "fixture"
            && self.direct.as_ref().is_some_and(|fixture| {
                russh::keys::PublicKey::from_openssh(&fixture.public_key)
                    .is_ok_and(|expected| expected.key_data() == key.key_data())
            });
        Ok(if self.native_client {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }
    async fn auth_password(&mut self, _: &str, p: &str) -> std::result::Result<Auth, Self::Error> {
        Ok(if p == "fixture-only" {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }
    async fn channel_open_session(
        &mut self,
        c: Channel<server::Msg>,
        reply: server::ChannelOpenHandle,
        _: &mut SshSession,
    ) -> std::result::Result<(), Self::Error> {
        self.channels.lock().unwrap().insert(c.id(), c);
        reply.accept().await;
        Ok(())
    }
    async fn subsystem_request(
        &mut self,
        id: ChannelId,
        name: &str,
        s: &mut SshSession,
    ) -> std::result::Result<(), Self::Error> {
        if name != "sftp" || self.reject {
            s.channel_failure(id)?;
            return Ok(());
        }
        let c = self.channels.lock().unwrap().remove(&id).unwrap();
        s.channel_success(id)?;
        let handler = Sftp {
            app_reads: if self.native_client {
                None
            } else {
                self.direct
                    .as_ref()
                    .map(|fixture| fixture.app_reads.clone())
            },
            delayed: false,
            root: self.root.clone(),
            files: HashMap::new(),
            dirs: HashSet::new(),
            read_dirs: HashSet::new(),
        };
        let handle = s.handle();
        tokio::spawn(async move {
            let stream = direct_tests::ExitStream::new(c.into_stream(), handle, id);
            russh_sftp::server::run(stream, handler).await;
        });
        Ok(())
    }
}
struct Sftp {
    app_reads: Option<Arc<std::sync::atomic::AtomicUsize>>,
    delayed: bool,
    root: PathBuf,
    files: HashMap<String, tokio::fs::File>,
    dirs: HashSet<String>,
    read_dirs: HashSet<String>,
}
fn status(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: String::new(),
        language_tag: "en".into(),
    }
}
impl Sftp {
    fn path(&self, p: &str) -> std::result::Result<PathBuf, StatusCode> {
        if p.split('/').any(|s| s == ".." || s.contains('\\')) {
            return Err(StatusCode::PermissionDenied);
        }
        Ok(self.root.join(p.trim_start_matches('/')))
    }
}
impl russh_sftp::server::Handler for Sftp {
    type Error = StatusCode;
    async fn stat(&mut self, id: u32, path: String) -> std::result::Result<Attrs, Self::Error> {
        self.lstat(id, path).await
    }
    async fn fstat(&mut self, id: u32, handle: String) -> std::result::Result<Attrs, Self::Error> {
        let metadata = self
            .files
            .get(&handle)
            .ok_or(StatusCode::Failure)?
            .metadata()
            .await
            .map_err(|_| StatusCode::Failure)?;
        Ok(Attrs {
            id,
            attrs: FileAttributes {
                size: Some(metadata.len()),
                permissions: Some(0o100600),
                ..Default::default()
            },
        })
    }
    async fn setstat(
        &mut self,
        id: u32,
        _: String,
        _: FileAttributes,
    ) -> std::result::Result<Status, Self::Error> {
        Ok(status(id))
    }
    async fn fsetstat(
        &mut self,
        id: u32,
        _: String,
        _: FileAttributes,
    ) -> std::result::Result<Status, Self::Error> {
        Ok(status(id))
    }
    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }
    async fn realpath(&mut self, id: u32, path: String) -> std::result::Result<Name, Self::Error> {
        self.path(&path)?;
        Ok(Name {
            id,
            files: vec![File::dummy(if path == "." { "/".into() } else { path })],
        })
    }
    async fn lstat(&mut self, id: u32, path: String) -> std::result::Result<Attrs, Self::Error> {
        let m = std::fs::symlink_metadata(self.path(&path)?).map_err(|_| StatusCode::NoSuchFile)?;
        let mut a = FileAttributes::from(&m);
        if m.is_file() {
            a.set_regular(true);
        }
        if m.is_dir() {
            a.set_dir(true);
        }
        if m.file_type().is_symlink() {
            a.set_symlink(true);
        }
        Ok(Attrs { id, attrs: a })
    }
    async fn opendir(&mut self, id: u32, path: String) -> std::result::Result<Handle, Self::Error> {
        if !self.path(&path)?.is_dir() {
            return Err(StatusCode::NoSuchFile);
        }
        self.dirs.insert(path.clone());
        self.read_dirs.remove(&path);
        Ok(Handle { id, handle: path })
    }
    async fn readdir(&mut self, id: u32, path: String) -> std::result::Result<Name, Self::Error> {
        if !self.dirs.contains(&path) || !self.read_dirs.insert(path.clone()) {
            return Err(StatusCode::Eof);
        }
        let mut files = vec![];
        for e in std::fs::read_dir(self.path(&path)?).map_err(|_| StatusCode::Failure)? {
            let e = e.unwrap();
            let a = self
                .lstat(
                    id,
                    format!(
                        "{}/{}",
                        path.trim_end_matches('/'),
                        e.file_name().to_str().unwrap()
                    ),
                )
                .await?
                .attrs;
            files.push(File::new(e.file_name().to_str().unwrap(), a));
        }
        Ok(Name { id, files })
    }
    async fn open(
        &mut self,
        id: u32,
        path: String,
        flags: OpenFlags,
        _: FileAttributes,
    ) -> std::result::Result<Handle, Self::Error> {
        let f = tokio::fs::OpenOptions::new()
            .read(flags.contains(OpenFlags::READ))
            .write(flags.contains(OpenFlags::WRITE))
            .create(flags.contains(OpenFlags::CREATE) && !flags.contains(OpenFlags::EXCLUDE))
            .create_new(flags.contains(OpenFlags::EXCLUDE))
            .open(self.path(&path)?)
            .await
            .map_err(|_| StatusCode::PermissionDenied)?;
        let handle = uuid::Uuid::new_v4().to_string();
        self.files.insert(handle.clone(), f);
        Ok(Handle { id, handle })
    }
    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> std::result::Result<Data, Self::Error> {
        if let Some(reads) = &self.app_reads {
            reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        let f = self.files.get_mut(&handle).ok_or(StatusCode::Failure)?;
        f.seek(std::io::SeekFrom::Start(offset)).await.unwrap();
        let mut data = vec![0; len as usize];
        let n = f.read(&mut data).await.unwrap();
        data.truncate(n);
        if n == 0 {
            return Err(StatusCode::Eof);
        }
        Ok(Data { id, data })
    }
    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> std::result::Result<Status, Self::Error> {
        if !self.delayed && self.root.join(".delay-first-write").exists() {
            self.delayed = true;
            tokio::time::sleep(Duration::from_millis(3100)).await;
        }
        let f = self.files.get_mut(&handle).ok_or(StatusCode::Failure)?;
        f.seek(std::io::SeekFrom::Start(offset)).await.unwrap();
        f.write_all(&data).await.map_err(|_| StatusCode::Failure)?;
        Ok(status(id))
    }
    async fn close(&mut self, id: u32, handle: String) -> std::result::Result<Status, Self::Error> {
        self.files.remove(&handle);
        self.dirs.remove(&handle);
        Ok(status(id))
    }
    async fn rename(
        &mut self,
        id: u32,
        a: String,
        b: String,
    ) -> std::result::Result<Status, Self::Error> {
        let a = self.path(&a)?;
        let b = self.path(&b)?;
        if b.exists() {
            return Err(StatusCode::Failure);
        }
        std::fs::rename(a, b).map_err(|_| StatusCode::Failure)?;
        Ok(status(id))
    }
    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _: FileAttributes,
    ) -> std::result::Result<Status, Self::Error> {
        std::fs::create_dir(self.path(&path)?).map_err(|_| StatusCode::Failure)?;
        Ok(status(id))
    }
    async fn remove(&mut self, id: u32, path: String) -> std::result::Result<Status, Self::Error> {
        std::fs::remove_file(self.path(&path)?).map_err(|_| StatusCode::Failure)?;
        Ok(status(id))
    }
    async fn rmdir(&mut self, id: u32, path: String) -> std::result::Result<Status, Self::Error> {
        std::fs::remove_dir(self.path(&path)?).map_err(|_| StatusCode::Failure)?;
        Ok(status(id))
    }
}
async fn setup(root: PathBuf, reject: bool) -> (Fs, tokio::task::JoinHandle<()>) {
    setup_with_direct(root, reject, None).await
}
async fn setup_with_direct(
    root: PathBuf,
    reject: bool,
    direct: Option<Arc<direct_tests::Fixture>>,
) -> (Fs, tokio::task::JoinHandle<()>) {
    use server::Server as _;
    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    let cfg = Arc::new(server::Config {
        keys: vec![russh::keys::PrivateKey::random(
            &mut rand::rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap()],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    let mut server = Server {
        root,
        channels: Default::default(),
        reject,
        direct,
        children: Default::default(),
        native_client: false,
    };
    let job = tokio::spawn(async move {
        let _ = server.run_on_socket(cfg, &socket).await;
    });
    let notify: crate::tunnel::Notify = Arc::new(|_| {});
    let connection = crate::tunnel::connect(
        vec![crate::tunnel::HopRequest {
            host: crate::model::Host {
                id: "fixture".into(),
                name: "loopback".into(),
                address: "127.0.0.1".into(),
                port,
                user: "fixture".into(),
                auth_method: crate::model::AuthMethod::Password,
                ..Default::default()
            },
            secret: "fixture-only".into(),
            expected: None,
        }],
        None,
        &CancellationToken::new(),
        &notify,
        Arc::new(|_, _, reply| {
            let _ = reply.send(true);
        }),
        &Arc::new(Mutex::new(crate::model::Runtime::default())),
        None,
    )
    .await
    .map_err(|e| format!("{:?}", e.kind))
    .unwrap()
    .unwrap();
    let channel = connection.open_session().await.unwrap();
    channel.request_subsystem(true, "sftp").await.unwrap();
    let raw = russh_sftp::client::RawSftpSession::new(channel.into_stream());
    raw.set_timeout(2);
    let version = raw.init().await.unwrap();
    (
        Fs::Remote(Arc::new(fs::Remote {
            raw,
            extensions: version.extensions,
            _connection: connection,
        })),
        job,
    )
}
async fn manager(root: PathBuf, journal: PathBuf) -> (Arc<Manager>, tokio::task::JoinHandle<()>) {
    let (fs, job) = setup(root, false).await;
    let m = Arc::new(Manager::new(journal));
    m.remotes.lock().unwrap().insert("session".into(), fs);
    m.sessions.lock().unwrap().insert(
        "session".into(),
        Session {
            id: "session".into(),
            host_id: "fixture".into(),
            host_name: "loopback".into(),
            phase: "connected".into(),
            route: vec!["fixture".into()],
            fingerprint: None,
            endpoint: None,
            error: None,
        },
    );
    m.route_keys
        .lock()
        .unwrap()
        .insert("session".into(), "frozen-fixture".into());
    (m, job)
}
async fn settled(m: &Manager, id: &str) -> Task {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let task = m.tasks.lock().unwrap().get(id).cloned().unwrap();
            if !task.active() {
                return task;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}
async fn attach_destination(m: &Manager, root: PathBuf) -> tokio::task::JoinHandle<()> {
    let (fs, job) = setup(root, false).await;
    m.remotes
        .lock()
        .unwrap()
        .insert("destination-session".into(), fs);
    m.sessions.lock().unwrap().insert(
        "destination-session".into(),
        Session {
            id: "destination-session".into(),
            host_id: "destination-host".into(),
            host_name: "Destination".into(),
            phase: "connected".into(),
            route: vec!["destination-jump".into(), "destination-host".into()],
            fingerprint: None,
            endpoint: None,
            error: None,
        },
    );
    m.route_keys
        .lock()
        .unwrap()
        .insert("destination-session".into(), "frozen-destination".into());
    job
}

#[tokio::test]
async fn two_real_sftp_hosts_relay_nested_files_without_local_staging_and_keep_conflicts_safe() {
    let source = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let profile = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(source.path().join("资料/empty")).unwrap();
    let bytes = (0..512 * 1024 + 73)
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    std::fs::write(source.path().join("资料/文件.bin"), &bytes).unwrap();
    let (m, server) = manager(source.path().into(), profile.path().join("history.json")).await;
    let target_server = attach_destination(&m, destination.path().into()).await;
    let src = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let dst = m
        .directory(Some("destination-session".into()), "/".into())
        .await
        .unwrap();
    let id = m
        .submit(
            uuid::Uuid::new_v4().to_string(),
            vec![src.entries[0].id.clone()],
            dst.id.clone(),
        )
        .await
        .unwrap();
    let task = settled(&m, &id).await;
    assert_eq!(task.phase, "completed");
    assert_eq!(task.direction, "relay");
    assert_eq!(task.source_remote.as_ref().unwrap().host_id, "fixture");
    assert_eq!(
        task.target_remote.as_ref().unwrap().host_id,
        "destination-host"
    );
    assert_eq!(
        std::fs::read(destination.path().join("资料/文件.bin")).unwrap(),
        bytes
    );
    assert_eq!(
        std::fs::read(source.path().join("资料/文件.bin")).unwrap(),
        bytes
    );
    assert!(destination.path().join("资料/empty").is_dir());
    // The only local profile artifact is history, never a staged copy of the payload.
    assert_eq!(std::fs::read_dir(profile.path()).unwrap().count(), 1);
    let id = m
        .submit(
            uuid::Uuid::new_v4().to_string(),
            vec![src.entries[0].id.clone()],
            dst.id,
        )
        .await
        .unwrap();
    assert_eq!(settled(&m, &id).await.phase, "conflict");
    assert_eq!(
        std::fs::read(destination.path().join("资料/文件.bin")).unwrap(),
        bytes
    );
    m.control_between(
        &id,
        "keep",
        Some("destination-session".into()),
        Some("session".into()),
    )
    .await
    .unwrap();
    assert_eq!(settled(&m, &id).await.phase, "completed");
    m.shutdown().await;
    server.abort();
    target_server.abort();
}

#[tokio::test]
async fn relay_resume_revalidates_both_routes_and_protects_source_and_target_jump_hosts() {
    let source = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let profile = tempfile::tempdir().unwrap();
    std::fs::write(source.path().join("large.bin"), vec![42; 2 * 1024 * 1024]).unwrap();
    let (m, server) = manager(source.path().into(), profile.path().join("history.json")).await;
    let target_server = attach_destination(&m, destination.path().into()).await;
    m.sessions
        .lock()
        .unwrap()
        .get_mut("session")
        .unwrap()
        .route
        .insert(0, "source-jump".into());
    let src = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let dst = m
        .directory(Some("destination-session".into()), "/".into())
        .await
        .unwrap();
    let id = m
        .submit(
            uuid::Uuid::new_v4().to_string(),
            vec![src.entries[0].id.clone()],
            dst.id,
        )
        .await
        .unwrap();
    // Browser disconnect state must not remove an active task's frozen references.
    for session in m.sessions.lock().unwrap().values_mut() {
        session.phase = "disconnected".into();
    }
    assert!(m.busy_host("source-jump"));
    assert!(m.busy_host("destination-jump"));
    assert!(m.busy_host("fixture"));
    assert!(m.busy_host("destination-host"));
    m.control(&id, "pause", None).await.unwrap();
    assert_eq!(settled(&m, &id).await.phase, "paused");
    for session in m.sessions.lock().unwrap().values_mut() {
        session.phase = "connected".into();
    }
    m.route_keys
        .lock()
        .unwrap()
        .insert("session".into(), "changed-source-route".into());
    assert_eq!(
        m.control_between(
            &id,
            "resume",
            Some("destination-session".into()),
            Some("session".into())
        )
        .await
        .unwrap_err(),
        "routeChanged"
    );
    m.route_keys
        .lock()
        .unwrap()
        .insert("session".into(), "frozen-fixture".into());
    m.route_keys
        .lock()
        .unwrap()
        .insert("destination-session".into(), "changed-target-route".into());
    assert_eq!(
        m.control_between(
            &id,
            "resume",
            Some("destination-session".into()),
            Some("session".into())
        )
        .await
        .unwrap_err(),
        "routeChanged"
    );
    m.route_keys
        .lock()
        .unwrap()
        .insert("destination-session".into(), "frozen-destination".into());
    m.control_between(
        &id,
        "resume",
        Some("destination-session".into()),
        Some("session".into()),
    )
    .await
    .unwrap();
    assert_eq!(settled(&m, &id).await.phase, "completed");
    assert_eq!(
        std::fs::read(destination.path().join("large.bin")).unwrap(),
        vec![42; 2 * 1024 * 1024]
    );
    m.shutdown().await;
    server.abort();
    target_server.abort();
}

#[tokio::test]
async fn relay_cancel_cleans_the_destination_and_same_host_copies_are_rejected() {
    let source = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let profile = tempfile::tempdir().unwrap();
    std::fs::write(source.path().join("large.bin"), vec![42; 2 * 1024 * 1024]).unwrap();
    let (m, server) = manager(source.path().into(), profile.path().join("history.json")).await;
    let target_server = attach_destination(&m, destination.path().into()).await;
    let src = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let dst = m
        .directory(Some("destination-session".into()), "/".into())
        .await
        .unwrap();
    m.sessions
        .lock()
        .unwrap()
        .get_mut("destination-session")
        .unwrap()
        .host_id = "fixture".into();
    assert_eq!(
        m.submit(
            uuid::Uuid::new_v4().to_string(),
            vec![src.entries[0].id.clone()],
            dst.id.clone()
        )
        .await
        .unwrap_err(),
        "unsupportedTransfer"
    );
    m.sessions
        .lock()
        .unwrap()
        .get_mut("destination-session")
        .unwrap()
        .host_id = "destination-host".into();
    let id = m
        .submit(
            uuid::Uuid::new_v4().to_string(),
            vec![src.entries[0].id.clone()],
            dst.id,
        )
        .await
        .unwrap();
    m.control(&id, "cancel", None).await.unwrap();
    assert_eq!(settled(&m, &id).await.phase, "cancelled");
    assert_eq!(std::fs::read_dir(destination.path()).unwrap().count(), 0);
    assert!(source.path().join("large.bin").exists());
    m.shutdown().await;
    server.abort();
    target_server.abort();
}
#[tokio::test]
async fn real_sftp_roundtrip_directory_background_and_preview() {
    let remote = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let content = vec![0xa5; 256 * 1024 + 123];
    std::fs::create_dir(local.path().join("folder")).unwrap();
    std::fs::create_dir(local.path().join("folder/empty")).unwrap();
    std::fs::write(local.path().join("folder/中文 file.bin"), &content).unwrap();
    let (m, job) = manager(remote.path().into(), dest.path().join("journal.json")).await;
    let source = m
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    let target = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    m.submit(id.clone(), vec![source.entries[0].id.clone()], target.id)
        .await
        .unwrap();
    assert_eq!(settled(&m, &id).await.phase, "completed");
    assert_eq!(
        std::fs::read(remote.path().join("folder/中文 file.bin")).unwrap(),
        content
    );
    assert!(remote.path().join("folder/empty").is_dir());
    let src = m
        .directory(Some("session".into()), "/folder".into())
        .await
        .unwrap();
    let file = src.entries.iter().find(|e| e.meta.kind == "file").unwrap();
    let (bytes, truncated) = m.preview(&file.id, 1024).await.unwrap();
    assert_eq!(bytes.len(), 1024);
    assert!(truncated);
    let target = m
        .directory(None, dest.path().to_str().unwrap().into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    m.submit(id.clone(), vec![file.id.clone()], target.id)
        .await
        .unwrap();
    assert_eq!(settled(&m, &id).await.phase, "completed");
    assert_eq!(
        std::fs::read(dest.path().join("中文 file.bin")).unwrap(),
        content
    );
    m.shutdown().await;
    job.abort();
}
#[tokio::test]
async fn conflicts_do_not_truncate_and_keep_both() {
    let remote = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    std::fs::write(local.path().join("same"), b"new").unwrap();
    std::fs::write(remote.path().join("same"), b"original").unwrap();
    let (m, j) = manager(remote.path().into(), local.path().join("journal.json")).await;
    let src = m
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    let dst = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    m.submit(
        id.clone(),
        vec![src
            .entries
            .iter()
            .find(|e| e.name == "same")
            .unwrap()
            .id
            .clone()],
        dst.id,
    )
    .await
    .unwrap();
    assert_eq!(settled(&m, &id).await.phase, "conflict");
    assert_eq!(
        std::fs::read(remote.path().join("same")).unwrap(),
        b"original"
    );
    m.control(&id, "keep", None).await.unwrap();
    assert_eq!(settled(&m, &id).await.phase, "completed");
    assert_eq!(
        std::fs::read(remote.path().join("same (2)")).unwrap(),
        b"new"
    );
    m.shutdown().await;
    j.abort();
}
#[tokio::test]
async fn cancelled_work_is_joined_and_no_partial_final_file() {
    let remote = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    std::fs::write(local.path().join("large"), vec![1; 8 * 1024 * 1024]).unwrap();
    let (m, j) = manager(remote.path().into(), local.path().join("journal.json")).await;
    let src = m
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    let dst = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    m.submit(id.clone(), vec![src.entries[0].id.clone()], dst.id)
        .await
        .unwrap();
    m.control(&id, "cancel", None).await.unwrap();
    assert_eq!(settled(&m, &id).await.phase, "cancelled");
    m.shutdown().await;
    assert!(!remote.path().join("large").exists());
    assert_eq!(std::fs::read_dir(remote.path()).unwrap().count(), 0);
    j.abort();
}
#[test]
fn corrupt_journal_is_preserved() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("transfers.json");
    std::fs::write(&path, b"not-json").unwrap();
    let m = Manager::new(path.clone());
    assert_eq!(m.snapshot().warning.as_deref(), Some("journalDamaged"));
    m.save();
    assert_eq!(std::fs::read(path).unwrap(), b"not-json");
}
#[tokio::test]
async fn computer_lists_real_roots_without_network_or_mutation_authority() {
    let t = tempfile::tempdir().unwrap();
    let m = Manager::new(t.path().join("journal.json"));
    let d = m.directory(None, ":computer:".into()).await.unwrap();
    assert_eq!(d.path, ":computer:");
    assert!(d.id.is_empty());
    assert_eq!(
        d.entries.iter().map(|e| e.name.clone()).collect::<Vec<_>>(),
        fs::roots()
    );
    for e in d.entries {
        assert!(!m.entry(&e.id).unwrap().mutable);
    }
    assert!(m.snapshot().sessions.is_empty());
}

#[tokio::test]
async fn timed_out_temporary_writes_retry_at_the_same_offset_without_duplicate_bytes() {
    let remote = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    std::fs::write(remote.path().join(".delay-first-write"), b"").unwrap();
    let bytes: Vec<_> = (0..100_000).map(|n| (n % 251) as u8).collect();
    std::fs::write(local.path().join("payload"), &bytes).unwrap();
    let (m, j) = manager(remote.path().into(), local.path().join("journal.json")).await;
    let src = m
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    let target = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    m.submit(id.clone(), vec![src.entries[0].id.clone()], target.id)
        .await
        .unwrap();
    let task = settled(&m, &id).await;
    assert_eq!(task.phase, "completed", "{:?}", task.error);
    assert_eq!(task.bytes, bytes.len() as u64);
    assert_eq!(std::fs::read(remote.path().join("payload")).unwrap(), bytes);
    m.shutdown().await;
    j.abort();
}

#[tokio::test]
async fn pause_resume_recovery_and_route_binding() {
    let remote = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    std::fs::write(local.path().join("paused"), vec![7; 1024 * 1024]).unwrap();
    let journal = local.path().join("journal.json");
    let (m, j) = manager(remote.path().into(), journal.clone()).await;
    let src = m
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    let dst = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    m.submit(id.clone(), vec![src.entries[0].id.clone()], dst.id)
        .await
        .unwrap();
    m.control(&id, "pause", None).await.unwrap();
    assert_eq!(settled(&m, &id).await.phase, "paused");
    m.clear_history();
    assert!(m.tasks.lock().unwrap().contains_key(&id));
    assert!(!remote.path().join("paused").exists());
    let restored = Manager::new(journal);
    assert_eq!(restored.snapshot().tasks[0].phase, "interrupted");
    assert!(restored.snapshot().sessions.is_empty());
    m.route_keys
        .lock()
        .unwrap()
        .insert("session".into(), "changed".into());
    assert_eq!(
        m.control(&id, "resume", None).await.unwrap_err(),
        "routeChanged"
    );
    m.route_keys
        .lock()
        .unwrap()
        .insert("session".into(), "frozen-fixture".into());
    m.control(&id, "resume", None).await.unwrap();
    assert_eq!(settled(&m, &id).await.phase, "completed");
    assert_eq!(
        std::fs::read(remote.path().join("paused")).unwrap(),
        vec![7; 1024 * 1024]
    );
    m.shutdown().await;
    j.abort();
}

#[tokio::test]
async fn stale_rename_and_permanent_remote_delete_are_checked() {
    let remote = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    std::fs::write(remote.path().join("original"), b"old").unwrap();
    let (m, j) = manager(remote.path().into(), local.path().join("journal.json")).await;
    let list = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let id = &list.entries[0].id;
    std::fs::write(remote.path().join("original"), b"changed length").unwrap();
    assert_eq!(
        m.mutate("rename", id, "renamed").await.unwrap_err(),
        "staleEntry"
    );
    assert!(remote.path().join("original").exists());
    let list = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    m.mutate("rename", &list.entries[0].id, "renamed")
        .await
        .unwrap();
    let list = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    m.mutate("delete", &list.entries[0].id, "").await.unwrap();
    assert!(!remote.path().join("renamed").exists());
    m.shutdown().await;
    j.abort();
}

#[tokio::test]
async fn ten_thousand_local_entries_are_bounded_and_complete() {
    let d = tempfile::tempdir().unwrap();
    for i in 0..10_000 {
        std::fs::write(d.path().join(format!("item-{i:05}")), b"").unwrap();
    }
    let m = Manager::new(d.path().join("not-created.json"));
    let start = std::time::Instant::now();
    let list = m
        .directory(None, d.path().to_str().unwrap().into())
        .await
        .unwrap();
    assert_eq!(list.entries.len(), 10_000);
    println!("10,000 local entries: {:?}", start.elapsed());
}

#[tokio::test]
async fn a_conflict_does_not_block_unrelated_files_and_unknown_commit_requires_hash_verification() {
    let remote = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    std::fs::write(local.path().join("conflict"), b"new").unwrap();
    std::fs::write(local.path().join("free"), b"verified bytes").unwrap();
    std::fs::write(remote.path().join("conflict"), b"preserved").unwrap();
    let (m, j) = manager(remote.path().into(), local.path().join("journal.json")).await;
    let src = m
        .directory(None, local.path().to_str().unwrap().into())
        .await
        .unwrap();
    let target = m
        .directory(Some("session".into()), "/".into())
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    m.submit(
        id.clone(),
        src.entries.iter().map(|e| e.id.clone()).collect(),
        target.id,
    )
    .await
    .unwrap();
    let t = settled(&m, &id).await;
    assert_eq!(t.phase, "conflict");
    assert_eq!(
        std::fs::read(remote.path().join("conflict")).unwrap(),
        b"preserved"
    );
    assert_eq!(
        std::fs::read(remote.path().join("free")).unwrap(),
        b"verified bytes"
    );
    let source = local.path().join("free").to_str().unwrap().to_owned();
    m.change(&id, |t| {
        t.error = Some("commitUnknown".into());
        t.phase = "failed".into();
        t.commit_source = Some(source);
        t.commit_target = Some("/free".into());
        t.completed.clear();
    });
    assert_eq!(
        m.control(&id, "resume", None).await.unwrap_err(),
        "commitUnknown"
    );
    m.control(&id, "verify", None).await.unwrap();
    let task = m.tasks.lock().unwrap()[&id].clone();
    assert_eq!(task.phase, "paused");
    assert_eq!(task.completed.len(), 1);
    m.shutdown().await;
    j.abort();
}
