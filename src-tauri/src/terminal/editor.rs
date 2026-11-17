//! Probe on a separate channel. Never type initialization commands into a PTY.
use crate::tunnel::Connection;
use russh::ChannelMsg;
use std::time::Duration;

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(super) async fn startup(connection: &Connection, id: &str) -> Option<String> {
    let shell = tokio::time::timeout(Duration::from_secs(2), async {
        let mut probe = connection.open_session().await.ok()?;
        probe.exec(true, "echo \"$0\"").await.ok()?;
        let mut name = Vec::new();
        while let Some(message) = probe.wait().await {
            match message {
                ChannelMsg::Data { data } if name.len() + data.len() <= 256 => {
                    name.extend_from_slice(&data)
                }
                ChannelMsg::Failure | ChannelMsg::Data { .. } => return None,
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        String::from_utf8(name).ok()
    })
    .await
    .ok()??;
    let shell = shell.trim().rsplit('/').next()?.trim_start_matches('-');
    shell_startup(shell, id)
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
