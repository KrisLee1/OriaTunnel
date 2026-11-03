//! Optional server-to-server SFTP copy through a remote OpenSSH client.
//! Only public host keys are sent; passwords, private keys and agents stay local.
use super::fs::{Fs, Remote, Result};
use crate::tunnel::ConnectionPeer;
use russh::{ChannelMsg, Sig};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

pub(super) struct Plan {
    executor: Arc<Remote>,
    peer: ConnectionPeer,
    pub pull: bool,
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
pub(super) fn safe_path(path: &str) -> bool {
    path.starts_with('/') && !path.chars().any(char::is_control)
}
fn peer_options(peer: &ConnectionPeer) -> Option<Vec<String>> {
    if peer.address.is_empty()
        || peer.user.is_empty()
        || peer.user.chars().any(char::is_control)
        || (!peer
            .address
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-'))
            && peer.address.parse::<std::net::IpAddr>().is_err())
        || peer.address.starts_with('-')
    {
        return None;
    }
    let mut parts = peer.public_key.split_whitespace();
    let algorithm = parts.next()?;
    let key = parts.next()?;
    if !algorithm
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || "-@.".contains(ch))
        || !key
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "+/=".contains(ch))
    {
        return None;
    }
    let algorithms = if algorithm == "ssh-rsa" {
        "rsa-sha2-512,rsa-sha2-256"
    } else {
        algorithm
    };
    // HostKeyAlias pins every connection to the key already verified by our SSH
    // engine. No remote known_hosts file is changed or trusted implicitly.
    let known = format!(
        r#"KnownHostsCommand=/usr/bin/printf "%%s" "oria-file-peer,[oria-file-peer]:{} {} {}""#,
        peer.port, algorithm, key
    );
    let mut options = [
        "BatchMode=yes",
        "StrictHostKeyChecking=yes",
        "ForwardAgent=no",
        "ForwardX11=no",
        "IdentityAgent=none",
        "AddKeysToAgent=no",
        "PasswordAuthentication=no",
        "KbdInteractiveAuthentication=no",
        "NumberOfPasswordPrompts=0",
        "ClearAllForwardings=yes",
        "PermitLocalCommand=no",
        "ProxyCommand=none",
        "ProxyJump=none",
        "ControlMaster=no",
        "ControlPath=none",
        "ConnectTimeout=5",
        "ConnectionAttempts=1",
        "ServerAliveInterval=15",
        "ServerAliveCountMax=2",
        "UserKnownHostsFile=/dev/null",
        "GlobalKnownHostsFile=/dev/null",
        "HostKeyAlias=oria-file-peer",
        "CheckHostIP=no",
        "UpdateHostKeys=no",
    ]
    .map(str::to_owned)
    .to_vec();
    options.extend([
        known,
        format!("HostKeyAlgorithms={algorithms}"),
        format!("User={}", peer.user),
    ]);
    for (name, value) in [
        ("Ciphers", &peer.algorithms.ciphers),
        ("KexAlgorithms", &peer.algorithms.kex_algorithms),
        ("MACs", &peer.algorithms.macs),
    ] {
        if let Some(value) = value {
            options.push(format!("{name}={value}"));
        }
    }
    Some(options)
}
fn options(peer: &ConnectionPeer) -> Option<String> {
    Some(format!(
        "-F /dev/null {}",
        peer_options(peer)?
            .iter()
            .map(|value| format!("-o {}", quote(value)))
            .collect::<Vec<_>>()
            .join(" ")
    ))
}
struct Output {
    bytes: Vec<u8>,
    status: Option<u32>,
}
async fn exec(
    remote: &Remote,
    command: &str,
    input: &[u8],
    cancel: &CancellationToken,
) -> Result<Output> {
    let mut channel = tokio::select! { _=cancel.cancelled()=>return Err("cancelled".into()), result=tokio::time::timeout(Duration::from_secs(8), remote._connection.open_session())=>result.map_err(|_|"directUnsupported")?.map_err(|_|"directUnsupported")? };
    let result = tokio::select! { _=cancel.cancelled()=>Err("cancelled".into()), result=tokio::time::timeout(Duration::from_secs(12), async {
        channel.exec(true, command.as_bytes().to_vec()).await.map_err(|_|"directUnsupported")?;
        if !input.is_empty() { channel.data(input).await.map_err(|_|"directUnsupported")?; }
        channel.eof().await.map_err(|_|"directUnsupported")?;
        let mut output = Output { bytes: Vec::new(), status: None };
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => { if output.bytes.len() + data.len() > 32768 { return Err("directUnsupported".into()); } output.bytes.extend_from_slice(&data); }
                ChannelMsg::Failure => return Err("directUnsupported".into()),
                ChannelMsg::ExitStatus { exit_status } => output.status = Some(exit_status),
                ChannelMsg::Close => break,
                _ => {},
            }
        }
        Ok::<_, String>(output)
    })=>result.unwrap_or_else(|_|Err("directUnsupported".into())) };
    if result.is_err() {
        let _ = tokio::time::timeout(Duration::from_millis(500), channel.signal(Sig::TERM)).await;
    }
    let _ = tokio::time::timeout(Duration::from_millis(500), channel.close()).await;
    result
}
fn modern_openssh(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes);
    text.split("OpenSSH_")
        .nth(1)
        .and_then(|version| version.split('.').next())
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 9)
}
async fn probe(
    executor: &Remote,
    peer: &ConnectionPeer,
    cancel: &CancellationToken,
) -> Result<bool> {
    let Some(options) = options(peer) else {
        return Ok(false);
    };
    let tools = exec(
        executor,
        "test -x /usr/bin/printf && command -v scp && ssh -V 2>&1",
        &[],
        cancel,
    )
    .await?;
    if tools.status != Some(0) || !modern_openssh(&tools.bytes) {
        return Ok(false);
    }
    let command = format!(
        "exec ssh {options} -p {} -s -- {} sftp",
        peer.port,
        quote(&peer.address)
    );
    // SFTP INIT v3: validates authentication, the pinned host key, and subsystem
    // availability without writing any file or requiring a shell on the peer.
    let result = exec(executor, &command, &[0, 0, 0, 5, 1, 0, 0, 0, 3], cancel).await?;
    Ok(result.status == Some(0)
        && result.bytes.len() >= 9
        && result.bytes[4] == 2
        && u32::from_be_bytes(result.bytes[5..9].try_into().unwrap()) >= 3)
}
pub(super) async fn discover(
    source: &Fs,
    target: &Fs,
    cancel: &CancellationToken,
) -> Result<Option<Plan>> {
    let (Fs::Remote(source), Fs::Remote(target)) = (source, target) else {
        return Ok(None);
    };
    for (executor, peer, pull) in [
        (source, &target._connection.peer, false),
        (target, &source._connection.peer, true),
    ] {
        let Some(peer) = peer else {
            continue;
        };
        match probe(executor, peer, cancel).await {
            Ok(true) => {
                return Ok(Some(Plan {
                    executor: executor.clone(),
                    peer: peer.clone(),
                    pull,
                }))
            }
            Err(error) if error == "cancelled" => return Err(error),
            _ => {}
        }
    }
    Ok(None)
}
fn remote_operand(peer: &ConnectionPeer, path: &str, pattern: bool) -> String {
    let host = if peer.address.contains(':') {
        format!("[{}]", peer.address)
    } else {
        peer.address.clone()
    };
    let escaped = if pattern {
        path.chars()
            .flat_map(|ch| {
                if "\\*?[]".contains(ch) {
                    vec!['\\', ch]
                } else {
                    vec![ch]
                }
            })
            .collect()
    } else {
        path.to_owned()
    };
    format!("{host}:{escaped}")
}
impl Plan {
    fn command(&self, source: &str, temp: &str) -> String {
        let (from, to) = if self.pull {
            (remote_operand(&self.peer, source, true), temp.into())
        } else {
            (source.into(), remote_operand(&self.peer, temp, false))
        };
        format!(
            "printf 'ORIA_FILE_PID:%s\\n' \"$$\"; exec scp -B {} -P {} -- {} {}",
            options(&self.peer).unwrap(),
            self.peer.port,
            quote(&from),
            quote(&to)
        )
    }
    pub async fn copy(
        &self,
        source: &str,
        target: &Fs,
        temp: &str,
        total: u64,
        cancel: &CancellationToken,
        mut update: impl FnMut(u64, Option<u32>, bool),
    ) -> Result<()> {
        let mut channel = tokio::time::timeout(
            Duration::from_secs(10),
            self.executor._connection.open_session(),
        )
        .await
        .map_err(|_| "connectionTimeout")?
        .map_err(|_| "connectionFailed")?;
        // From this point onward loss of acknowledgement is an unknown remote
        // outcome; never fall back to a second copy after submitting this exec.
        channel
            .exec(true, self.command(source, temp).into_bytes())
            .await
            .map_err(|_| "directUnknown")?;
        let mut ticker = tokio::time::interval(Duration::from_millis(250));
        let mut output = Vec::new();
        let mut copied = 0;
        let mut changed = Instant::now();
        let mut pid = None;
        loop {
            tokio::select! {
                _=cancel.cancelled()=>break,
                _=ticker.tick()=>{
                    if let Ok(Ok(Some(meta))) = tokio::time::timeout(Duration::from_secs(2), target.meta(temp)).await {
                        if meta.kind != "file" || meta.size > total { break; }
                        if meta.size != copied { copied = meta.size; changed = Instant::now(); update(copied, pid, false); }
                    }
                    if changed.elapsed() > Duration::from_secs(120) { break; }
                },
                message=channel.wait()=>match message {
                    Some(ChannelMsg::Data {data})=>{
                        if output.len() + data.len() > 8192 { break; }
                        output.extend_from_slice(&data);
                        if pid.is_none() { pid = String::from_utf8_lossy(&output).lines().find_map(|line| line.strip_prefix("ORIA_FILE_PID:").and_then(|pid|pid.parse::<u32>().ok())).filter(|pid| *pid>1); if pid.is_some() { update(copied, pid, false); } }
                    },
                    Some(ChannelMsg::Failure)=>{ update(copied, pid, true); return Err("directFailed".into()); },
                    Some(ChannelMsg::ExitStatus {exit_status})=>{ update(copied, pid, true); let _=channel.close().await; return if exit_status==0 { Ok(()) } else { Err("directFailed".into()) }; },
                    Some(ChannelMsg::ExitSignal {..})=>{ update(copied, pid, true); return Err(if cancel.is_cancelled() {"cancelled"} else {"directFailed"}.into()); },
                    Some(ChannelMsg::Close)|None=>return Err("directUnknown".into()),
                    _=>{},
                }
            }
        }
        let _ = tokio::time::timeout(Duration::from_millis(500), channel.signal(Sig::TERM)).await;
        let stopped = tokio::time::timeout(Duration::from_secs(3), async {
            while let Some(message) = channel.wait().await {
                if matches!(
                    message,
                    ChannelMsg::ExitStatus { .. } | ChannelMsg::ExitSignal { .. }
                ) {
                    return true;
                }
            }
            false
        })
        .await
        .unwrap_or(false);
        let _ = tokio::time::timeout(Duration::from_millis(500), channel.close()).await;
        if stopped {
            update(copied, pid, true);
            Err(if cancel.is_cancelled() {
                "cancelled"
            } else {
                "directFailed"
            }
            .into())
        } else {
            Err("directUnknown".into())
        }
    }
}
pub(super) async fn confirm_stopped(executor: &Fs, pid: Option<u32>, temp: &str) -> Result<()> {
    let Fs::Remote(executor) = executor else {
        return Err("directUnknown".into());
    };
    let pid = pid.filter(|pid| *pid > 1).ok_or("directUnknown")?;
    let token = temp
        .rsplit('/')
        .next()
        .filter(|name| name.starts_with(".oria-transfer-") && name.ends_with(".part"))
        .ok_or("directUnknown")?;
    let cancel = CancellationToken::new();
    for attempt in 0..4 {
        let output = exec(executor, &format!("ps -p {pid} -o args="), &[], &cancel)
            .await
            .map_err(|_| "directUnknown")?;
        let args = String::from_utf8_lossy(&output.bytes);
        if output.status == Some(1) && args.trim().is_empty() {
            return Ok(());
        }
        if output.status != Some(0) {
            return Err("directUnknown".into());
        }
        if !args.contains(token) || !args.contains("scp") {
            return Ok(());
        }
        if attempt == 0 {
            let result = exec(executor, &format!("kill -TERM {pid}"), &[], &cancel)
                .await
                .map_err(|_| "directUnknown")?;
            if result.status != Some(0) {
                return Err("directUnknown".into());
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("directUnknown".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pinned_options_disable_remote_configuration_and_never_forward_local_credentials() {
        let peer = ConnectionPeer {
            address: "127.0.0.1".into(),
            user: "fixture".into(),
            port: 2222,
            public_key: "ssh-ed25519 AAAAfixture==".into(),
            algorithms: Default::default(),
        };
        let options = options(&peer).unwrap();
        for value in [
            "-F /dev/null",
            "StrictHostKeyChecking=yes",
            "IdentityAgent=none",
            "ForwardAgent=no",
            "KnownHostsCommand=",
            "AAAAfixture==",
        ] {
            assert!(options.contains(value));
        }
        assert!(!modern_openssh(b"OpenSSH_8.9"));
        assert!(modern_openssh(b"OpenSSH_9.9p1"));
        assert!(modern_openssh(b"OpenSSH_10.0p1"));
        assert!(!safe_path("/file\nnext"));
        assert!(safe_path("/中文 '$(echo bad)' [x].txt"));
        assert_eq!(quote("a'b"), "'a'\\''b'");
        assert_eq!(
            remote_operand(&peer, "/a[*].txt", true),
            "127.0.0.1:/a\\[\\*\\].txt"
        );
    }
}
