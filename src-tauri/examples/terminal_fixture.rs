#[cfg(any(unix, windows))]
#[path = "../tests/common/terminal_server.rs"]
mod server;
#[cfg(any(unix, windows))]
#[tokio::main]
async fn main() {
    let (port, task) = server::start(server::Fixture::default()).await;
    println!("ISOLATED_SSH_PORT={port}");
    let _ = task.await;
}
#[cfg(not(any(unix, windows)))]
fn main() {
    eprintln!("Real PTY server fixture requires Unix; the SSH client supports Windows.");
}
