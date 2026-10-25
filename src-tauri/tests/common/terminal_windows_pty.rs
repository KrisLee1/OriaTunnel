//! Windows-only ConPTY backend for the loopback SSH fixture. Not linked into the app.
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize, SlavePty};
use std::{
    io::Write,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub struct PtyPair {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    slave: Mutex<Option<Box<dyn SlavePty + Send>>>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    pub cancel: CancellationToken,
}
impl Drop for PtyPair {
    fn drop(&mut self) {
        self.cancel.cancel();
        // Also close input when a failed test drops the session future early.
        drop(self.writer.lock().unwrap().take());
    }
}
struct KillOnDrop(Box<dyn portable_pty::ChildKiller + Send + Sync>);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
    }
}
fn size(cols: u32, rows: u32) -> PtySize {
    PtySize {
        cols: cols as u16,
        rows: rows as u16,
        pixel_width: 0,
        pixel_height: 0,
    }
}
pub fn allocate(cols: u32, rows: u32) -> Result<PtyPair, Box<dyn std::error::Error>> {
    let pair = native_pty_system().openpty(size(cols, rows))?;
    let writer = pair.master.take_writer()?;
    Ok(PtyPair {
        master: Mutex::new(Some(pair.master)),
        slave: Mutex::new(Some(pair.slave)),
        writer: Arc::new(Mutex::new(Some(writer))),
        cancel: CancellationToken::new(),
    })
}
impl PtyPair {
    pub fn resize(&self, cols: u32, rows: u32) {
        if let Some(master) = self.master.lock().unwrap().as_ref() {
            master.resize(size(cols, rows)).unwrap();
        }
    }
    pub async fn write(&self, data: &[u8]) {
        let writer = self.writer.clone();
        let data = data.to_vec();
        let _ = tokio::task::spawn_blocking(move || {
            if let Some(writer) = writer.lock().unwrap().as_mut() {
                let _ = writer.write_all(&data);
            }
        })
        .await;
    }
}
pub async fn spawn_shell(
    pair: Arc<PtyPair>,
    channel: russh::ChannelId,
    handle: russh::server::Handle,
    command: Option<String>,
) {
    let directory = tempfile::tempdir().unwrap();
    // Absolute system path and no profile: never execute user PowerShell setup.
    let system = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap());
    let powershell = system.join("System32/WindowsPowerShell/v1.0");
    let mut process = CommandBuilder::new(powershell.join("powershell.exe"));
    process.env_clear();
    // Preserve only OS metadata needed by the Windows/.NET module loader, never
    // the runner's user PATH, profile, PowerShell modules, or authentication.
    for name in [
        "SystemRoot",
        "WINDIR",
        "SystemDrive",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "CommonProgramFiles",
        "CommonProgramFiles(x86)",
        "PROCESSOR_ARCHITECTURE",
    ] {
        if let Some(value) = std::env::var_os(name) {
            process.env(name, value);
        }
    }
    process.env(
        "PATH",
        std::env::join_paths([system.join("System32"), powershell.clone()]).unwrap(),
    );
    process.env("PSModulePath", powershell.join("Modules"));
    process.env(
        "PSModuleAnalysisCachePath",
        directory.path().join("module-cache"),
    );
    process.args(["-NoLogo", "-NoProfile"]);
    if command.is_none() {
        process.arg("-NoExit");
    } else {
        process.arg("-NonInteractive");
    }
    process.arg("-Command");
    let command = command.unwrap_or_else(||
        "function global:PSConsoleHostReadLine { [Console]::ReadLine() }; function global:prompt { 'oria-e2> ' }".into());
    let utility =
        powershell.join("Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1");
    let utility = utility.to_string_lossy().replace('\'', "''");
    process.arg(format!("[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; [Console]::WriteLine('fixture-shell-ready'); Import-Module '{utility}' -ErrorAction Stop; [Console]::WriteLine('fixture-modules-ready'); {command}"));
    process.cwd(directory.path());
    process.env("HOME", directory.path());
    process.env("USERPROFILE", directory.path());
    process.env("APPDATA", directory.path());
    process.env("LOCALAPPDATA", directory.path());
    process.env("TEMP", directory.path());
    process.env("TMP", directory.path());
    process.env("TERM", "xterm-256color");
    let mut child = pair
        .slave
        .lock()
        .unwrap()
        .take()
        .unwrap()
        .spawn_command(process)
        .unwrap();
    let _kill_on_drop = KillOnDrop(child.clone_killer());
    let mut reader = pair
        .master
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .try_clone_reader()
        .unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(8);
    let cursor_reply = pair.writer.clone();
    let reader = tokio::task::spawn_blocking(move || {
        let mut bytes = [0; 8192];
        let mut queries = super::queries::Queries::default();
        loop {
            match reader.read(&mut bytes) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // ConPTY negotiates cursor position and device attributes.
                    // The headless consumer replies as a basic terminal; the
                    // manual fixture retains xterm's actual responses.
                    if cfg!(test) {
                        let replies = queries.feed(&bytes[..n]);
                        if !replies.is_empty() {
                            if let Some(writer) = cursor_reply.lock().unwrap().as_mut() {
                                writer.write_all(&replies).unwrap();
                                writer.flush().unwrap();
                            }
                        }
                    }
                    if tx.blocking_send(bytes[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let output_handle = handle.clone();
    let output = tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if output_handle.data(channel, bytes).await.is_err() {
                break;
            }
        }
    });
    let status = loop {
        if pair.cancel.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    };
    // Releasing ConPTY closes output. Continue draining while it shuts down.
    // Signal input EOF before closing the pseudoconsole. Its shutdown can
    // otherwise wait for an input pipe retained by the cursor-response reader.
    drop(pair.writer.lock().unwrap().take());
    let master = pair.master.lock().unwrap().take();
    let close = tokio::task::spawn_blocking(move || drop(master));
    let _ = tokio::time::timeout(Duration::from_secs(5), reader).await;
    let _ = tokio::time::timeout(Duration::from_secs(5), output).await;
    let _ = close.await;
    if let Some(status) = status {
        let _ = handle
            .exit_status_request(channel, status.exit_code())
            .await;
    }
    let _ = handle.eof(channel).await;
    let _ = handle.close(channel).await;
}
