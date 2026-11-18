//! Probe on a separate channel. Never type initialization commands into a PTY.
use crate::tunnel::Connection;
use data_encoding::BASE64;
use flate2::{write::GzEncoder, Compression};
use russh::ChannelMsg;
use std::{io::Write, time::Duration};

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

// Each shell expands its own variables. The fixed fields also distinguish cmd
// from PowerShell without taking a path or command from the probe as executable input.
// The backslash quotes $env for POSIX shells using nounset; Windows keeps it.
const PROBE: &str = r#"echo "oria-shell~$0~%OS%~\$env:OS""#;

pub(super) struct Startup {
    pub command: String,
    pub powershell: bool,
}

pub(super) async fn startup(connection: &Connection, id: &str) -> Option<Startup> {
    let reply = tokio::time::timeout(Duration::from_secs(5), async {
        let mut probe = connection.open_session().await.ok()?;
        probe.exec(true, PROBE).await.ok()?;
        let mut name = Vec::new();
        while let Some(message) = probe.wait().await {
            match message {
                ChannelMsg::Data { data } if name.len() + data.len() <= 4096 => {
                    name.extend_from_slice(&data)
                }
                ChannelMsg::Failure | ChannelMsg::Data { .. } => return None,
                ChannelMsg::ExitStatus { exit_status } if exit_status != 0 => return None,
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        Some(String::from_utf8_lossy(&name).into_owned())
    })
    .await
    .ok()??;
    startup_from_reply(&reply, id)
}

fn startup_from_reply(reply: &str, id: &str) -> Option<Startup> {
    let line = reply
        .trim_end()
        .lines()
        .next_back()?
        .trim()
        .trim_matches('"');
    let fields: Vec<_> = line.strip_prefix("oria-shell~")?.split('~').collect();
    match fields.as_slice() {
        ["$0", "Windows_NT", r"\$env:OS"] => windows_startup(WindowsShell::Cmd, id),
        [_, "%OS%", r"\Windows_NT"] => windows_startup(WindowsShell::PowerShell, id),
        [shell, "%OS%", "$env:OS"] => {
            let shell = shell.rsplit('/').next()?.trim_start_matches('-');
            Some(Startup {
                command: shell_startup(shell, id)?,
                powershell: false,
            })
        }
        _ => None,
    }
}

enum WindowsShell {
    Cmd,
    PowerShell,
}

fn windows_startup(shell: WindowsShell, id: &str) -> Option<Startup> {
    // Windows OpenSSH runs a PTY exec through its configured shell. Carry the
    // shared hook in one argument below cmd's 8191-character limit without
    // uploading a script or writing initialization commands to the interactive PTY.
    let mut gzip = GzEncoder::new(Vec::new(), Compression::default());
    writeln!(
        gzip,
        "$env:ORIA_TERMINAL_SESSION='{}'",
        id.replace('\'', "''")
    )
    .ok()?;
    gzip.write_all(include_bytes!("editor.ps1")).ok()?;
    let archive = BASE64.encode(&gzip.finish().ok()?);
    let script = format!(
        "if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') {{ \
        . ([ScriptBlock]::Create([IO.StreamReader]::new([IO.Compression.GZipStream]::new(\
        [IO.MemoryStream]::new([Convert]::FromBase64String('{archive}')),\
        [IO.Compression.CompressionMode]::Decompress)).ReadToEnd())) }}"
    );
    let command = if matches!(shell, WindowsShell::Cmd) {
        // Use the same system PowerShell as a local Windows terminal. Keep cmd
        // interactive on installations without Windows PowerShell.
        let exe = r#"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"#;
        format!(
            r#"if exist "{exe}" ("{exe}" -NoLogo -NoExit -Command "{script}") else ("%ComSpec%")"#
        )
    } else {
        // Keep the configured edition and install location, including PowerShell 7.
        format!(
            "& (Get-Process -Id $PID).Path -NoLogo -NoExit -Command '{}'; exit $LASTEXITCODE",
            script.replace('\'', "''")
        )
    };
    Some(Startup {
        command,
        powershell: true,
    })
}

pub(super) fn shell_startup(shell: &str, id: &str) -> Option<String> {
    let hooks = format!("__oria_token={}\n{}", quote(id), include_str!("editor.sh"));
    match shell.rsplit('/').next()? {
        "bash" => {
            // Reproduce login startup order in the interactive rcfile, then install the hook.
            let rc = format!(
                r#"[ ! -r /etc/profile ] || . /etc/profile
for __oria_profile in ~/.bash_profile ~/.bash_login ~/.profile; do
    if [ -r "$__oria_profile" ]; then . "$__oria_profile"; break; fi
done
unset __oria_profile
{hooks}"#
            );
            Some(format!(
                "exec \"$BASH\" --rcfile <(printf '%s\\n' {}) -i",
                quote(&rc)
            ))
        }
        "zsh" => {
            let zsh = quote(shell);
            // Interpose only until .zshrc. Subsequent startup and logout files use the real ZDOTDIR.
            let rc = format!(
                r#"__oria_temp=$ZDOTDIR
ZDOTDIR=$__oria_user_zdot
unset __oria_user_zdot
[[ ${{HISTFILE-}} != "$__oria_temp/"* ]] || HISTFILE="$ZDOTDIR/${{HISTFILE:t}}"
command rm -f -- "$__oria_temp/.zshenv" "$__oria_temp/.zprofile" "$__oria_temp/.zshrc"
command rmdir -- "$__oria_temp"
unset __oria_temp
[[ ! -r "$ZDOTDIR/.zshrc" ]] || source "$ZDOTDIR/.zshrc"
{hooks}"#
            );
            Some(format!(
                r#"export __oria_user_zdot=${{ZDOTDIR:-$HOME}}
ZDOTDIR=$(mktemp -d) || exec {zsh} -il
export ZDOTDIR
for f in .zshenv .zprofile; do
  printf '%s\n' '__oria_stage=$ZDOTDIR; ZDOTDIR=$__oria_user_zdot' "[[ ! -r \"\$ZDOTDIR/$f\" ]] || source \"\$ZDOTDIR/$f\"" '__oria_user_zdot=$ZDOTDIR; ZDOTDIR=$__oria_stage' > "$ZDOTDIR/$f"
done
printf '%s\n' {} > "$ZDOTDIR/.zshrc"
exec {zsh} -il"#,
                quote(&rc)
            ))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_probe_selects_only_supported_interactive_shells() {
        for reply in [
            "oria-shell~/bin/bash~%OS%~$env:OS",
            "oria-shell~-zsh~%OS%~$env:OS",
        ] {
            assert!(
                !startup_from_reply(reply, "terminal:test")
                    .unwrap()
                    .powershell
            );
        }
        for reply in [
            "",
            "Windows_NT",
            "oria-shell~/bin/fish~%OS%~$env:OS",
            "oria-shell~~%OS%~",
            "oria-shell~$0~%OS%~$env:OS",
        ] {
            assert!(startup_from_reply(reply, "terminal:test").is_none());
        }
    }

    #[test]
    fn both_windows_shells_launch_the_shared_hook_with_the_session_id() {
        use std::io::Read;
        let id = "terminal:workspace-a:2b48981a-b672-405e-bb01-826ff0158ca2";
        for (reply, cmd) in [
            ("\"oria-shell~$0~Windows_NT~\\$env:OS\"\r\n", true),
            ("profile banner\r\noria-shell~~%OS%~\\Windows_NT\r\n", false),
        ] {
            let startup = startup_from_reply(reply, id).unwrap();
            assert!(startup.powershell);
            assert!(startup.command.len() < 8000);
            assert_eq!(
                startup
                    .command
                    .contains(r"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"),
                cmd
            );
            let script = startup.command.replace("''", "'");
            let archive = script
                .split_once("FromBase64String('")
                .unwrap()
                .1
                .split_once('\'')
                .unwrap()
                .0;
            let bytes = BASE64.decode(archive.as_bytes()).unwrap();
            let mut decoded = String::new();
            flate2::read::GzDecoder::new(bytes.as_slice())
                .read_to_string(&mut decoded)
                .unwrap();
            assert_eq!(
                decoded,
                format!(
                    "$env:ORIA_TERMINAL_SESSION='{id}'\n{}",
                    include_str!("editor.ps1")
                )
            );
        }
    }
}
