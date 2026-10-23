//! Isolated manual/native validation fixture. Binds loopback only; never uses user hosts.
use russh::{
    keys::{Algorithm, PrivateKey},
    server::{self, Auth, Server as _, Session},
    Channel,
};
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
#[derive(Clone)]
struct Fixture;
impl server::Server for Fixture {
    type Handler = Self;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
        self.clone()
    }
}
impl server::Handler for Fixture {
    type Error = russh::Error;
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
        if host != "127.0.0.1" {
            reply
                .reject(russh::ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        }
        if let Ok(mut target) = TcpStream::connect((host, port as u16)).await {
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
#[tokio::main]
async fn main() {
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../outputs/validation");
    std::fs::create_dir_all(&dir).unwrap();
    let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target_port = target.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut tcp, _)) = target.accept().await {
            tokio::spawn(async move {
                let mut data = [0; 8192];
                let _ = tcp.read(&mut data).await;
                let body = "OriaTunnel SSH forwarding verified";
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = tcp.write_all(response.as_bytes()).await;
            });
        }
    });
    let ssh = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = ssh.local_addr().unwrap().port();
    let config = Arc::new(server::Config {
        keys: vec![PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap()],
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    });
    std::fs::write(
        dir.join("ssh_config"),
        format!("Host loopback-validation\n HostName 127.0.0.1\n Port {port}\n User tester\n"),
    )
    .unwrap();
    std::fs::write(
        dir.join("ports.json"),
        format!("{{\"sshPort\":{port},\"targetPort\":{target_port}}}"),
    )
    .unwrap();
    println!("Loopback fixture ready. target={target_port}, SSH={port}, password=test-only");
    Fixture.run_on_socket(config, &ssh).await.unwrap();
}
