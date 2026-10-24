#[cfg(unix)]
#[path = "../tests/common/terminal_server.rs"]
mod server;
#[cfg(unix)]
#[tokio::main]
async fn main() {
    let (port, task) = server::start(server::Fixture::default()).await;
    println!("ISOLATED_SSH_PORT={port}");
    let _ = task.await;
}
#[cfg(not(unix))]
fn main() {
    eprintln!("Real PTY server fixture requires Unix; the SSH client supports Windows.");
}
