//! A local OS shell uses the same bounded transcript and input ownership as SSH.
use super::{Changed, Input, Manager};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::{
    io::{Read, Write},
    sync::Arc,
    time::Duration,
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn size((cols, rows): (u32, u32)) -> PtySize {
    PtySize {
        rows: rows as u16,
        cols: cols as u16,
        pixel_width: 0,
        pixel_height: 0,
    }
}

struct Process {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
}

pub(crate) fn shell() -> String {
    #[cfg(windows)]
    let shell = std::env::var("ComSpec")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| CommandBuilder::new_default_prog().get_shell());
    #[cfg(not(windows))]
    let shell = CommandBuilder::new_default_prog().get_shell();
    #[cfg(windows)]
    if std::path::Path::new(&shell)
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("cmd.exe"))
    {
        if let Some(system) = std::env::var_os("SystemRoot") {
            let powershell = std::path::PathBuf::from(system)
                .join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
            if powershell.is_file() {
                return powershell.to_string_lossy().into_owned();
            }
        }
    }
    shell
}

fn spawn(shell: &str, id: &str, dimensions: (u32, u32)) -> Result<Process, String> {
    #[cfg(windows)]
    let mut cmd = CommandBuilder::new(shell);
    #[cfg(not(windows))]
    let mut cmd = CommandBuilder::new_default_prog();
    #[cfg(unix)]
    {
        if let Some(startup) = super::editor::shell_startup(shell, id) {
            cmd = CommandBuilder::new(shell);
            if std::path::Path::new(shell).ends_with("zsh") {
                cmd.arg("-f");
            }
            cmd.args(["-c", &startup]);
        }
    }
    #[cfg(windows)]
    if std::path::Path::new(shell).file_stem().is_some_and(|name| {
        name.eq_ignore_ascii_case("powershell") || name.eq_ignore_ascii_case("pwsh")
    }) {
        cmd.env("ORIA_TERMINAL_SESSION", id);
        cmd.args(["-NoLogo", "-NoExit", "-Command", include_str!("editor.ps1")]);
    } else if std::path::Path::new(shell)
        .file_name()
        .is_some_and(|s| s.eq_ignore_ascii_case("cmd.exe"))
    {
        // cmd expands $E to ESC. Mark each native prompt without changing its visible text.
        let prompt = cmd
            .get_env("PROMPT")
            .and_then(|s| s.to_str())
            .unwrap_or("$P$G");
        cmd.env("PROMPT", format!("$E]133;A$E\\{prompt}"));
    }
    #[cfg(not(any(unix, windows)))]
    let _ = id;
    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let pair = native_pty_system()
        .openpty(size(dimensions))
        .map_err(|_| "localPty")?;
    let reader = pair.master.try_clone_reader().map_err(|_| "localPty")?;
    let writer = pair.master.take_writer().map_err(|_| "localPty")?;
    let child = pair.slave.spawn_command(cmd).map_err(|_| "localShell")?;
    Ok(Process {
        master: pair.master,
        child,
        reader,
        writer,
    })
}

// A background job may inherit the slave past shell exit. On Unix, drain the
// ready tail, then release the reader rather than waiting on that other job.
#[cfg(unix)]
fn readable(fd: std::os::fd::RawFd, finished: &CancellationToken) -> bool {
    let mut descriptor = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    loop {
        let ready = unsafe { libc::poll(&mut descriptor, 1, 100) };
        if ready > 0 {
            return true;
        }
        if ready < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return false;
        }
        if finished.is_cancelled() {
            return false;
        }
    }
}

pub async fn execute(
    manager: Arc<Manager>,
    id: String,
    shell: String,
    cancel: CancellationToken,
    mut input: mpsc::Receiver<Input>,
    changed: Changed,
) {
    let Some(mut sizes) = manager.size_receiver(&id) else {
        return;
    };
    if cancel.is_cancelled() {
        manager.finish(&id, "disconnected", None);
        changed();
        return;
    }
    let initial = *sizes.borrow_and_update();
    let job = id.clone();
    let process = tokio::task::spawn_blocking(move || spawn(&shell, &job, initial)).await;
    let Process {
        master,
        mut child,
        mut reader,
        mut writer,
    } = match process {
        Ok(Ok(process)) => process,
        result => {
            let error = match result {
                Ok(Err(error)) => error,
                _ => "localPty".into(),
            };
            manager.finish(&id, "failed", Some(error));
            changed();
            return;
        }
    };
    let finished = CancellationToken::new();
    // A duplicate descriptor keeps poll tied to this master even when the
    // supervisor releases its handle. The reader consumes from the same PTY.
    #[cfg(unix)]
    let poll_fd = master.as_raw_fd().and_then(|fd| {
        unsafe { std::os::fd::BorrowedFd::borrow_raw(fd) }
            .try_clone_to_owned()
            .ok()
            .map(Arc::new)
    });
    #[cfg(unix)]
    if let (Some(fd), Some(pid)) = (&poll_fd, child.process_id()) {
        if let Some(entry) = manager.entries.lock().unwrap().get_mut(&id) {
            entry.local_shell = Some((fd.clone(), pid));
        }
    }
    let output_manager = manager.clone();
    let output_id = id.clone();
    let output_cancel = cancel.clone();
    #[cfg(unix)]
    let reader_finished = finished.clone();
    let runtime = tokio::runtime::Handle::current();
    let mut output = tokio::task::spawn_blocking(move || {
        let mut buf = [0; 16384];
        #[cfg(unix)]
        let mut tail = None;
        loop {
            let limit = buf.len();
            #[cfg(unix)]
            let limit = if let Some(fd) = &poll_fd {
                use std::os::fd::AsRawFd;
                if output_cancel.is_cancelled() {
                    break;
                }
                let limit = if reader_finished.is_cancelled() {
                    // Drain the queued shell output once. A disowned writer can keep
                    // filling the PTY indefinitely after its login shell has exited.
                    let left = tail.get_or_insert_with(|| {
                        let mut queued: libc::c_int = 0;
                        if unsafe { libc::ioctl(fd.as_raw_fd(), libc::FIONREAD, &mut queued) } == 0
                        {
                            queued.max(0) as usize
                        } else {
                            buf.len()
                        }
                    });
                    limit.min(*left)
                } else {
                    limit
                };
                if limit == 0 || !readable(fd.as_raw_fd(), &reader_finished) {
                    break;
                }
                limit
            } else {
                limit
            };
            match reader.read(&mut buf[..limit]) {
                Ok(0) => break,
                Ok(n) => {
                    #[cfg(unix)]
                    if let Some(left) = tail.as_mut() {
                        *left -= n;
                    }
                    if !output_cancel.is_cancelled() {
                        runtime.block_on(output_manager.output(
                            &output_id,
                            &buf[..n],
                            &output_cancel,
                        ));
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });
    let send = async move {
        while let Some(event) = input.recv().await {
            if let Input::Data(bytes) = event {
                writer = tokio::task::spawn_blocking(move || {
                    writer.write_all(&bytes).ok()?;
                    writer.flush().ok()?;
                    Some(writer)
                })
                .await
                .ok()
                .flatten()?;
            }
        }
        None::<()>
    };
    tokio::pin!(send);
    manager.change(&id, |s| s.phase = "running".into());
    changed();
    let mut poll = tokio::time::interval(Duration::from_millis(50));
    let mut output_done = false;
    let status = loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => break None,
            _ = &mut send => break None,
            result = &mut output, if !output_done => {output_done = true; if result.is_err() {break None;}},
            result = sizes.changed() => {
                if result.is_err() || master.resize(size(*sizes.borrow_and_update())).is_err() {break None;}
            }
            _ = poll.tick() => match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {},
                Err(_) => break None,
            }
        }
    };
    if status.is_none() {
        #[cfg(unix)]
        if let Some(group) = master.process_group_leader() {
            // tcgetpgrp is scoped to the PTY created above.
            unsafe {
                libc::kill(-group, libc::SIGHUP);
            }
        }
        let _ = tokio::task::spawn_blocking(move || {
            let _ = child.kill();
            let _ = child.wait();
        })
        .await;
    }
    finished.cancel();
    // Closing ConPTY releases its output pipe. Read concurrently until EOF.
    let _ = tokio::task::spawn_blocking(move || drop(master)).await;
    if !output_done {
        let _ = output.await;
    }
    if let Some(status) = status {
        manager.change(&id, |s| {
            s.exit_code = Some(status.exit_code());
            s.exit_signal = status.signal().map(str::to_owned);
        });
        manager.finish(&id, "exited", None);
    } else if cancel.is_cancelled() {
        manager.finish(&id, "disconnected", None);
    } else {
        manager.finish(&id, "failed", Some("localPty".into()));
    }
    changed();
}
