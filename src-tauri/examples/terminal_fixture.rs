#[cfg(any(unix, windows))]
#[path = "../tests/common/terminal_server.rs"]
mod server;
#[cfg(any(unix, windows))]
#[tokio::main]
async fn main() {
    let fixture = server::Fixture::default();
    let fixture = {
        let mut fixture = fixture;
        fixture.editor_shell = match std::env::args().nth(1).as_deref() {
            #[cfg(unix)]
            Some("bash") => Some("/bin/bash"),
            #[cfg(unix)]
            Some("zsh") => Some("/bin/zsh"),
            #[cfg(windows)]
            Some("cmd") => Some("cmd"),
            #[cfg(windows)]
            Some("powershell") => Some("powershell"),
            None => None,
            _ => panic!("unsupported shell for this platform"),
        };
        fixture
    };
    let (port, task) = server::start(fixture).await;
    println!("ISOLATED_SSH_PORT={port}");
    let _ = task.await;
}
#[cfg(not(any(unix, windows)))]
fn main() {
    eprintln!("Real PTY server fixture requires Unix; the SSH client supports Windows.");
}
