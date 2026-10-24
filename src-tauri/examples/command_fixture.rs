//! Loopback-only fixture for manual UI verification. No real hosts or keys on disk.
#[path = "../tests/common/command_server.rs"]
mod server;
#[tokio::main]
async fn main() {
    let (port, _, task) = server::start().await;
    println!("ISOLATED_SSH_PORT={port}");
    let _ = task.await;
}
