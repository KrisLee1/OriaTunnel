use crate::model::{timestamp, AuthMethod, FailureKind, ForwardKind, Host, Rule, Runtime};
use russh::{
    client,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate},
    Channel, ChannelMsg, Disconnect,
};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot, watch},
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;

pub type Notify = Arc<dyn Fn(Runtime) + Send + Sync>;
pub type TrustPrompt = Arc<dyn Fn(String, String, oneshot::Sender<bool>) + Send + Sync>;
pub type PasswordObserver = Arc<dyn Fn(&Host, &str, AuthMethod) + Send + Sync>;
// Secrets have no Debug/Serialize implementation and are wiped on every drop path.
#[derive(Clone, Default)]
pub struct Secret(zeroize::Zeroizing<String>, bool);
impl From<String> for Secret {
    fn from(value: String) -> Self {
        Self(zeroize::Zeroizing::new(value), false)
    }
}
impl From<&str> for Secret {
    fn from(value: &str) -> Self {
        value.to_string().into()
    }
}
impl std::ops::Deref for Secret {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}
impl Secret {
    pub fn password(value: String) -> Self {
        Self(zeroize::Zeroizing::new(value), true)
    }
    fn clear(&mut self) {
        use zeroize::Zeroize;
        self.0.zeroize();
    }
}
#[derive(Clone)]
pub struct HopRequest {
    pub host: Host,
    pub secret: Secret,
    pub expected: Option<String>,
}
#[derive(Clone)]
pub struct RunRequest {
    pub host: Host,
    pub rule: Rule,
    pub secret: Secret,
    pub expected: Option<String>,
    pub run_id: String,
    pub jumps: Vec<HopRequest>,
    pub test_only: bool,
}
struct Client {
    expected: Option<String>,
    prompt: TrustPrompt,
    remote_port: Option<u16>,
    incoming: mpsc::Sender<Channel<client::Msg>>,
    endpoint: String,
    trust_wait: watch::Sender<bool>,
    key_rejected: Arc<std::sync::atomic::AtomicBool>,
}
impl client::Handler for Client {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        if let Some(expected) = &self.expected {
            self.key_rejected.store(
                expected != &fingerprint,
                std::sync::atomic::Ordering::Relaxed,
            );
            return Ok(expected == &fingerprint);
        }
        let (tx, rx) = oneshot::channel();
        let _ = self.trust_wait.send(true);
        (self.prompt)(self.endpoint.clone(), fingerprint.clone(), tx);
        let accepted = rx.await.unwrap_or(false);
        let _ = self.trust_wait.send(false);
        if accepted {
            self.expected = Some(fingerprint);
        } else {
            self.key_rejected
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        Ok(accepted)
    }
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        _: &str,
        port: u32,
        _: &str,
        _: u32,
        reply: client::ChannelOpenHandle,
        _: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if self.remote_port.map(u32::from) == Some(port) {
            if let Ok(slot) = self.incoming.try_reserve() {
                reply.accept().await;
                slot.send(channel);
            }
        }
        Ok(())
    }
}
fn update(runtime: &Arc<Mutex<Runtime>>, notify: &Notify, status: &str, message: String) {
    let mut r = runtime.lock().unwrap();
    r.status = status.into();
    r.message = message;
    notify(r.clone());
}
pub async fn run(
    request: RunRequest,
    cancel: CancellationToken,
    notify: Notify,
    prompt: TrustPrompt,
) {
    run_with_password_observer(request, cancel, notify, prompt, None).await;
}
pub async fn run_with_password_observer(
    request: RunRequest,
    cancel: CancellationToken,
    notify: Notify,
    prompt: TrustPrompt,
    observer: Option<PasswordObserver>,
) {
    let test_only = request.test_only;
    let cancellation = cancel.clone();
    let runtime = Arc::new(Mutex::new(Runtime {
        rule_id: request.rule.id.clone(),
        run_id: request.run_id.clone(),
        status: "connecting".into(),
        host_snapshot: Some(request.host.clone()),
        jump_snapshots: request.jumps.iter().map(|h| h.host.clone()).collect(),
        ..Default::default()
    }));
    update(&runtime, &notify, "connecting", String::new());
    let result = forward(
        request,
        cancel,
        notify.clone(),
        prompt,
        runtime.clone(),
        observer,
    )
    .await;
    runtime.lock().unwrap().connections = 0;
    match result {
        Ok(()) => update(
            &runtime,
            &notify,
            if test_only && !cancellation.is_cancelled() {
                "tested"
            } else {
                "stopped"
            },
            String::new(),
        ),
        Err(e) => {
            runtime.lock().unwrap().error_kind = Some(e.kind);
            update(&runtime, &notify, "failed", e.message);
        }
    }
}
struct Failure {
    kind: FailureKind,
    message: String,
}
impl Failure {
    fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}
fn network_error(error: std::io::Error) -> Failure {
    let kind = if error.kind() == std::io::ErrorKind::TimedOut {
        FailureKind::Timeout
    } else if error
        .raw_os_error()
        .is_some_and(|code| matches!(code, 11001..=11004))
    {
        FailureKind::Dns
    } else {
        FailureKind::Network
    };
    Failure::new(kind, "SSH 网络连接失败，请检查地址、DNS 和网络")
}
async fn authenticate(
    ssh: &mut client::Handle<Client>,
    host: &Host,
    secret: &Secret,
) -> Result<AuthMethod, String> {
    let mut authenticated = None;
    if matches!(host.auth_method, AuthMethod::Auto | AuthMethod::PrivateKey) {
        let mut identities = host.identity_files.clone();
        if identities.is_empty() {
            if let Some(home) = dirs::home_dir() {
                for file in ["id_ed25519", "id_rsa"] {
                    let p = home.join(".ssh").join(file);
                    if p.is_file() {
                        identities.push(p.to_string_lossy().into_owned());
                    }
                }
            }
        }
        for identity in identities {
            if let Ok(key) = russh::keys::load_secret_key(
                identity,
                if secret.is_empty() || secret.1 {
                    None
                } else {
                    Some(secret)
                },
            ) {
                let hash = ssh
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| e.to_string())?
                    .flatten();
                if ssh
                    .authenticate_publickey(
                        &host.user,
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await
                    .map_err(|e| e.to_string())?
                    .success()
                {
                    authenticated = Some(AuthMethod::PrivateKey);
                    break;
                }
            }
        }
    }
    if authenticated.is_none()
        && matches!(host.auth_method, AuthMethod::Auto | AuthMethod::Agent)
        && host.identity_agent.as_deref() != Some("none")
    {
        let agent_auth =
            tokio::time::timeout(Duration::from_secs(15), authenticate_agent(ssh, host)).await;
        match agent_auth {
            Ok(Ok(true)) => authenticated = Some(AuthMethod::Agent),
            Ok(Ok(false)) => {}
            _ if host.auth_method == AuthMethod::Agent => {
                return Err("系统代理认证失败：请检查服务、IdentityAgent 和可用密钥".into())
            }
            _ => {}
        }
    }
    if authenticated.is_none()
        && matches!(host.auth_method, AuthMethod::Auto | AuthMethod::Password)
        && !secret.is_empty()
        && ssh
            .authenticate_password(&host.user, &**secret)
            .await
            .map_err(|e| format!("认证失败: {e}"))?
            .success()
    {
        authenticated = Some(AuthMethod::Password);
    }
    authenticated.ok_or_else(|| "认证失败：请检查认证方式、私钥或本次密码/私钥口令".into())
}
async fn authenticate_agent(ssh: &mut client::Handle<Client>, host: &Host) -> Result<bool, String> {
    use russh::keys::agent::{client::AgentClient, AgentIdentity};
    #[cfg(windows)]
    let mut agent = AgentClient::connect_named_pipe(
        host.identity_agent
            .as_deref()
            .unwrap_or(r"\\.\pipe\openssh-ssh-agent"),
    )
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let mut agent = if let Some(path) = &host.identity_agent {
        AgentClient::connect_uds(path).await
    } else {
        AgentClient::connect_env().await
    }
    .map_err(|e| e.to_string())?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| e.to_string())?;
    let hash = ssh
        .best_supported_rsa_hash()
        .await
        .map_err(|e| e.to_string())?
        .flatten();
    for identity in identities {
        if let AgentIdentity::PublicKey { key, .. } = identity {
            if host.identities_only
                && !host.identity_files.iter().any(|path| {
                    russh::keys::load_public_key(path)
                        .or_else(|_| russh::keys::load_public_key(format!("{path}.pub")))
                        .is_ok_and(|public| public == key)
                })
            {
                continue;
            }
            if ssh
                .authenticate_publickey_with(&host.user, key, hash, &mut agent)
                .await
                .map_err(|e| e.to_string())?
                .success()
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
trait SshStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> SshStream for T {}
// russh owns a spawned task during key exchange. Closing a dropped handshake future
// alone does not guarantee that task releases its socket, so transports have a guard.
struct ConnectionStream {
    inner: Box<dyn SshStream>,
    cancelled: Pin<Box<dyn Future<Output = ()> + Send>>,
}
impl AsyncRead for ConnectionStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if self.cancelled.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(std::io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}
impl AsyncWrite for ConnectionStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        if self.cancelled.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(std::io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        if self.cancelled.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(std::io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
async fn handshake(
    config: Arc<client::Config>,
    socket: ConnectionStream,
    handler: Client,
    mut trust_wait: watch::Receiver<bool>,
    cancel: &CancellationToken,
    mut remaining: Duration,
) -> Result<Option<client::Handle<Client>>, Failure> {
    let key_rejected = handler.key_rejected.clone();
    let connect = client::connect_stream(config, socket, handler);
    tokio::pin!(connect);
    let mut paused = false;
    loop {
        let started = tokio::time::Instant::now();
        tokio::select! {biased;
            _=cancel.cancelled()=>return Ok(None),
            result=&mut connect=>return result.map(Some).map_err(|_| if key_rejected.load(std::sync::atomic::Ordering::Relaxed) { Failure::new(FailureKind::HostKey, "主机指纹未获信任或已变化") } else { Failure::new(FailureKind::Network, "SSH 握手失败或连接中断") }),
            _=trust_wait.changed()=>{if !paused {remaining=remaining.saturating_sub(started.elapsed());}paused = *trust_wait.borrow();},
            _=tokio::time::sleep(remaining),if !paused=>return Err(Failure::new(FailureKind::Timeout, "SSH 握手超时")),
        }
    }
}
async fn forward(
    request: RunRequest,
    cancel: CancellationToken,
    notify: Notify,
    prompt: TrustPrompt,
    runtime: Arc<Mutex<Runtime>>,
    observer: Option<PasswordObserver>,
) -> Result<(), Failure> {
    let RunRequest {
        host,
        rule,
        secret,
        expected,
        mut jumps,
        test_only,
        ..
    } = request;
    rule.validate()
        .map_err(|e| Failure::new(FailureKind::Configuration, e))?;
    if !test_only && !rule.no_remote_command && !host.unsupported_session_options.is_empty() {
        return Err(Failure::new(
            FailureKind::Configuration,
            format!(
                "远程命令暂不支持来源会话选项 {}；请使用仅转发模式",
                host.unsupported_session_options.join("、")
            ),
        ));
    }
    let mut target = host.clone();
    if let Some(options) = &rule.connection {
        target.connection = options.clone();
    }
    jumps.push(HopRequest {
        host: target,
        secret,
        expected,
    });
    let (tx, mut rx) = mpsc::channel(128);
    let mut sessions: Vec<Arc<client::Handle<Client>>> = Vec::new();
    let transport_cancel = CancellationToken::new();
    let result=async {
        for (index,mut hop) in jumps.into_iter().enumerate() {
            let host=hop.host;
            host.connection.validate().map_err(|e|Failure::new(FailureKind::Configuration,e))?;
            let preferred=crate::ssh_algorithms::preferred(&host.algorithms).map_err(|e|Failure::new(FailureKind::Configuration,e))?;
            let timeout=Duration::from_secs(host.connection.connect_timeout_secs);
            let started=tokio::time::Instant::now();
            let socket: Box<dyn SshStream>=if let Some(previous)=sessions.last() {
                let channel=tokio::select! {biased; _=cancel.cancelled()=>return Ok(()),result=tokio::time::timeout(timeout,previous.channel_open_direct_tcpip(&host.address,host.port as u32,"127.0.0.1",0))=>result.map_err(|_|Failure::new(FailureKind::Timeout,"跳板目标连接超时"))?.map_err(|_|Failure::new(FailureKind::ForwardDenied,"跳板无法连接下一跳或被策略拒绝"))?};
                Box::new(channel.into_stream())
            } else {
                let tcp=tokio::select! {biased; _=cancel.cancelled()=>return Ok(()),result=tokio::time::timeout(timeout,TcpStream::connect((host.address.as_str(),host.port)))=>result.map_err(|_|Failure::new(FailureKind::Timeout,"SSH 连接超时"))?.map_err(network_error)?};
                Box::new(tcp)
            };
            let final_hop=host.id==rule.host_id;
            let (trust_tx,trust_rx)=watch::channel(false);
            let handler=Client {expected:hop.expected,prompt:prompt.clone(),endpoint:format!("{}:{}",host.address,host.port),remote_port:(final_hop && rule.kind==ForwardKind::R).then_some(rule.bind_port),incoming:tx.clone(),trust_wait:trust_tx.clone(),key_rejected:Arc::new(false.into())};
            let config=Arc::new(client::Config {preferred,keepalive_interval:(host.connection.keepalive_interval_secs>0).then(||Duration::from_secs(host.connection.keepalive_interval_secs)),keepalive_max:host.connection.keepalive_max,..Default::default()});
            update(&runtime,&notify,"connecting",format!("SSH {} · {}",index+1,host.name));
            let socket=ConnectionStream {inner:socket,cancelled:Box::pin(transport_cancel.clone().cancelled_owned())};
            let Some(mut ssh)=handshake(config,socket,handler,trust_rx,&cancel,timeout.saturating_sub(started.elapsed())).await? else {return Ok(());};
            update(&runtime,&notify,"authenticating",host.name.clone());
            let auth=tokio::select! {biased; _=cancel.cancelled()=>Ok(None),result=authenticate(&mut ssh,&host,&hop.secret)=>result.map(Some)};
            if let Ok(Some(method)) = &auth {
                if *method == AuthMethod::Password && !cancel.is_cancelled() {
                    if let Some(observer) = &observer { observer(&host, &hop.secret, method.clone()); }
                }
            }
            hop.secret.clear();
            sessions.push(Arc::new(ssh));
            match auth {Ok(Some(method))=>{if final_hop {runtime.lock().unwrap().auth_method_used=Some(method);}},Ok(None)=>return Ok(()),Err(_)=>return Err(Failure::new(FailureKind::Authentication,"认证失败：请检查认证方式、私钥或本次密码/私钥口令"))}
        }
        if test_only {Ok(())}else {serve(sessions.last().unwrap().clone(),&rule,&cancel,&notify,&runtime,&mut rx).await}
    }.await;
    for ssh in sessions.iter().rev() {
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            ssh.disconnect(Disconnect::ByApplication, "Stopped", "en"),
        )
        .await;
    }
    transport_cancel.cancel();
    result
}
async fn serve(
    ssh: Arc<client::Handle<Client>>,
    rule: &Rule,
    cancel: &CancellationToken,
    notify: &Notify,
    runtime: &Arc<Mutex<Runtime>>,
    incoming: &mut mpsc::Receiver<Channel<client::Msg>>,
) -> Result<(), Failure> {
    // Drop aborts all streams on every failure path.
    let mut connections = JoinSet::new();
    if !rule.no_remote_command {
        let mut command = tokio::select! {biased; _=cancel.cancelled()=>return Ok(()), r=ssh.channel_open_session()=>r.map_err(|_|Failure::new(FailureKind::RemoteCommand,"远程会话失败"))?};
        command
            .exec(true, rule.remote_command.as_bytes().to_vec())
            .await
            .map_err(|_| Failure::new(FailureKind::RemoteCommand, "远程命令请求失败"))?;
        let accepted = tokio::select! {biased; _=cancel.cancelled()=>return Ok(()), r=tokio::time::timeout(Duration::from_secs(15), async {loop {match command.wait().await {Some(ChannelMsg::Success)=>return true, Some(ChannelMsg::Failure)|None=>return false, _=>{}}}})=>r.unwrap_or(false)};
        if !accepted {
            return Err(Failure::new(
                FailureKind::RemoteCommand,
                "服务端拒绝远程命令或响应超时",
            ));
        }
        connections.spawn(async move { while command.wait().await.is_some() {} });
    }
    update(runtime, notify, "binding", String::new());
    let listener = if rule.kind == ForwardKind::R {
        tokio::select! {biased; _=cancel.cancelled()=>return Ok(()), result=ssh.tcpip_forward(&rule.bind_address, rule.bind_port as u32)=>result.map_err(|_|Failure::new(FailureKind::ForwardDenied,"远程监听被拒绝或端口占用"))?};
        None
    } else {
        Some(
            TcpListener::bind((rule.bind_address.as_str(), rule.bind_port))
                .await
                .map_err(|_| {
                    Failure::new(FailureKind::Bind, "本机监听失败，请检查端口占用和地址")
                })?,
        )
    };
    update(runtime, notify, "listening", String::new());
    let mut timer = tokio::time::interval(Duration::from_millis(500));
    loop {
        tokio::select! {biased;
            _=cancel.cancelled()=>break,
            _=timer.tick()=>{if ssh.is_closed() {return Err(Failure::new(FailureKind::Network,"SSH 连接已断开"));} notify(runtime.lock().unwrap().clone());},
            channel=incoming.recv(), if rule.kind == ForwardKind::R=>{
                if let Some(channel)=channel { let target=(rule.target_host.clone(), rule.target_port); let r=runtime.clone();let n=notify.clone();let c=cancel.clone(); connections.spawn(async move {
                    tokio::select! {biased; _=c.cancelled()=>{}, result=tokio::time::timeout(Duration::from_secs(15), TcpStream::connect((target.0.as_str(),target.1)))=>match result {
                        Ok(Ok(tcp))=>{target_health(&r,&n,true,"local");pump(tcp, channel, r, n, c.clone()).await},
                        _=>{target_health(&r,&n,false,"local");}
                    }}
                }); }
            },
            accepted=async {listener.as_ref().unwrap().accept().await}, if listener.is_some()=>{
                let (mut tcp, origin)=accepted.map_err(|_|Failure::new(FailureKind::Bind,"监听接收连接失败"))?;
                let r=runtime.clone(); let n=notify.clone(); let c=cancel.clone();let ssh=ssh.clone();let rule=rule.clone();
                connections.spawn(async move {
                    tokio::select! {biased; _=c.cancelled()=>{}, _=async {
                        let target=if rule.kind==ForwardKind::D {
                            match tokio::time::timeout(Duration::from_secs(10), socks_target(&mut tcp)).await {Ok(Ok(t))=>t,_=>return}
                        } else {(rule.target_host,rule.target_port)};
                        let channel=tokio::time::timeout(Duration::from_secs(15),ssh.channel_open_direct_tcpip(target.0,target.1 as u32,origin.ip().to_string(),origin.port() as u32)).await;
                        match channel {
                            Ok(Ok(channel))=>{
                                target_health(&r,&n,true,"remote");
                                if rule.kind==ForwardKind::D && tcp.write_all(&[5,0,0,1,0,0,0,0,0,0]).await.is_err() {return;}
                                pump(tcp,channel,r,n,c.clone()).await;
                            },
                            _=>{
                                if rule.kind==ForwardKind::D {let _=tcp.write_all(&[5,5,0,1,0,0,0,0,0,0]).await;}
                                target_health(&r,&n,false,"remote");
                            }
                        }
                    }=>{}}
                });
            },
            _=connections.join_next(),if !connections.is_empty()=>{}
        }
    }
    drop(listener);
    connections.abort_all();
    while connections.join_next().await.is_some() {}
    if rule.kind == ForwardKind::R {
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            ssh.cancel_tcpip_forward(&rule.bind_address, rule.bind_port as u32),
        )
        .await;
    }
    Ok(())
}
fn target_health(runtime: &Arc<Mutex<Runtime>>, notify: &Notify, reachable: bool, side: &str) {
    let mut r = runtime.lock().unwrap();
    r.target_health = crate::model::TargetHealth {
        state: Some(
            if reachable {
                "reachable"
            } else {
                "unreachable"
            }
            .into(),
        ),
        checked_at: Some(timestamp()),
        side: Some(side.into()),
        method: Some("tcp-connect".into()),
    };
    r.message = if reachable {
        String::new()
    } else {
        "目标 TCP 连接失败；监听继续等待请求".into()
    };
    notify(r.clone());
}
async fn pump(
    mut tcp: TcpStream,
    channel: Channel<client::Msg>,
    runtime: Arc<Mutex<Runtime>>,
    notify: Notify,
    cancel: CancellationToken,
) {
    runtime.lock().unwrap().connections += 1;
    let mut stream = channel.into_stream();
    let (mut tr, mut tw) = tcp.split();
    let (mut sr, mut sw) = tokio::io::split(&mut stream);
    let upload = copy_counted(&mut tr, &mut sw, runtime.clone(), true);
    let download = copy_counted(&mut sr, &mut tw, runtime.clone(), false);
    tokio::select! {biased; _=cancel.cancelled()=>{}, _=async{let _=tokio::try_join!(upload,download);}=>{}}
    let mut r = runtime.lock().unwrap();
    r.connections = r.connections.saturating_sub(1);
    notify(r.clone());
}
async fn copy_counted<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(
    reader: &mut R,
    writer: &mut W,
    runtime: Arc<Mutex<Runtime>>,
    sent: bool,
) -> std::io::Result<()> {
    let mut buf = [0u8; 16384];
    loop {
        let count = reader.read(&mut buf).await?;
        if count == 0 {
            writer.shutdown().await?;
            return Ok(());
        }
        writer.write_all(&buf[..count]).await?;
        let mut r = runtime.lock().unwrap();
        if sent {
            r.sent += count as u64;
        } else {
            r.received += count as u64;
        }
    }
}
/// SOCKS5 CONNECT only; domain names are passed unchanged to the SSH server.
async fn socks_target(tcp: &mut TcpStream) -> std::io::Result<(String, u16)> {
    use std::io::{Error, ErrorKind};
    let mut greeting = [0; 2];
    tcp.read_exact(&mut greeting).await?;
    if greeting[0] != 5 || greeting[1] == 0 {
        return Err(Error::new(ErrorKind::InvalidData, "SOCKS version"));
    }
    let mut methods = vec![0; greeting[1] as usize];
    tcp.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        tcp.write_all(&[5, 255]).await?;
        return Err(Error::new(ErrorKind::PermissionDenied, "SOCKS auth"));
    }
    tcp.write_all(&[5, 0]).await?;
    let mut request = [0; 4];
    tcp.read_exact(&mut request).await?;
    let error = if request[0] != 5 || request[2] != 0 {
        Some(1)
    } else if request[1] != 1 {
        Some(7)
    } else if ![1, 3, 4].contains(&request[3]) {
        Some(8)
    } else {
        None
    };
    if let Some(code) = error {
        tcp.write_all(&[5, code, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
        return Err(Error::new(ErrorKind::InvalidData, "SOCKS request"));
    }
    let host = match request[3] {
        1 => {
            let mut ip = [0; 4];
            tcp.read_exact(&mut ip).await?;
            std::net::Ipv4Addr::from(ip).to_string()
        }
        4 => {
            let mut ip = [0; 16];
            tcp.read_exact(&mut ip).await?;
            std::net::Ipv6Addr::from(ip).to_string()
        }
        _ => {
            let len = tcp.read_u8().await?;
            let mut name = vec![0; len as usize];
            tcp.read_exact(&mut name).await?;
            String::from_utf8(name)
                .map_err(|_| Error::new(ErrorKind::InvalidData, "SOCKS hostname"))?
        }
    };
    let port = tcp.read_u16().await?;
    if host.is_empty() || host.contains('\0') || port == 0 {
        return Err(Error::new(ErrorKind::InvalidData, "SOCKS target"));
    }
    Ok((host, port))
}
