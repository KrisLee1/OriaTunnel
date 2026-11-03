//! Launch with ORIATUNNEL_TEST_DATA_DIR and ORIATUNNEL_TEST_SSH_CONFIG for isolated native QA.
#![cfg_attr(windows, windows_subsystem = "windows")]
fn main() {
    oria_tunnel_lib::run();
}
