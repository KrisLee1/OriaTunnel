//! Loopback SSH + delayed HTTP readiness for isolated native E3 QA only.
#[cfg(unix)]
#[path = "../tests/common/service_server.rs"]
mod server;
#[cfg(unix)]
#[tokio::main]
async fn main() {
    let (port, fixture, job) = server::start().await;
    println!(
        "ISOLATED_SSH_PORT={port} HEALTH_PORT={}",
        fixture.health_port
    );
    let _ = job.await;
}
#[cfg(not(unix))]
fn main() {
    eprintln!("The E3 manual fixture currently requires Unix.");
}
