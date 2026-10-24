//! Bounded POSIX-sh templates, never evaluated locally. No arbitrary substitution or sudo.
use crate::{
    commands::{Action, ExecutionMode},
    service_control::{Control, StatusProbe},
};
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub actions: Vec<Action>,
    pub control: Control,
    pub resource: String,
    pub shell: String,
}
pub fn build(kind: &str, resource: &str) -> Result<Template, String> {
    let valid = resource.len() <= 128
        && resource
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && resource
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-@:".contains(&c));
    if !valid {
        return Err("templateInvalid".into());
    }
    let (tool, target) = match kind {
        "systemdUser" | "systemdSystem" => {
            let target = if resource.ends_with(".service") {
                resource.to_string()
            } else {
                format!("{resource}.service")
            };
            (
                if kind == "systemdUser" {
                    "systemctl --user"
                } else {
                    "systemctl"
                },
                target,
            )
        }
        "docker" => {
            if resource.bytes().any(|c| b"@:".contains(&c)) {
                return Err("templateInvalid".into());
            }
            ("docker", resource.into())
        }
        _ => return Err("templateUnsupported".into()),
    };
    // Resource allowlist forbids quotes, whitespace, expansions and option prefixes.
    let quoted = format!("'{target}'");
    let status = if kind == "docker" {
        format!("state=$(docker inspect --type container --format '{{{{.State.Status}}}}' -- {quoted}) || exit 5\ncase \"$state\" in\n  running) exit 0 ;;\n  exited|created) exit 3 ;;\n  dead) exit 4 ;;\n  *) exit 5 ;;\nesac")
    } else {
        format!("load=$({tool} show --property=LoadState --value -- {quoted}) || exit 5\n[ \"$load\" = loaded ] || exit 5\nstate=$({tool} show --property=ActiveState --value -- {quoted}) || exit 5\ncase \"$state\" in\n  active) exit 0 ;;\n  inactive) exit 3 ;;\n  failed) exit 4 ;;\n  *) exit 5 ;;\nesac")
    };
    let mut actions = Vec::new();
    for verb in ["start", "stop", "restart", "status", "logs"] {
        let command = match verb {
            "status" => status.clone(),
            "logs" => {
                if kind == "docker" {
                    format!("docker logs --tail 100 -- {quoted}")
                } else {
                    format!(
                        "journalctl {}--no-pager --lines=100 --unit={quoted}",
                        if kind == "systemdUser" { "--user " } else { "" }
                    )
                }
            }
            _ => format!("{tool} {verb} -- {quoted}"),
        };
        actions.push(Action {
            invocation: None,
            id: uuid::Uuid::new_v4().to_string(),
            kind: verb.into(),
            label: verb.into(),
            command,
            mode: ExecutionMode::Command,
            timeout_secs: if verb == "status" { 15 } else { 60 },
            success_codes: vec![0],
            confirm: matches!(verb, "stop" | "restart"),
        });
    }
    let control = Control {
        status_probe: Some(StatusProbe {
            action_id: actions[3].id.clone(),
            mode: "exitCode".into(),
            running_codes: vec![0],
            stopped_codes: vec![3],
            failed_codes: vec![4],
        }),
        start_action_id: Some(actions[0].id.clone()),
        ..Default::default()
    };
    Ok(Template {
        actions,
        control,
        resource: target,
        shell: "POSIX sh".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_shell_injection_and_unknown_templates() {
        for bad in [
            "", "-service", "a b", "a\nb", "a;b", "$(id)", "`id`", "a'", "a\"", "a/b", "模型",
            "a\\b",
        ] {
            assert!(build("systemdUser", bad).is_err(), "{bad:?}");
            assert!(build("docker", bad).is_err(), "{bad:?}");
        }
        assert!(build("docker", "a@b").is_err());
        assert!(build("docker", "a:b").is_err());
        assert!(build("systemdUser", &"a".repeat(129)).is_err());
        assert!(build("arbitrary", "service").is_err());
        let t = build("systemdUser", "model@worker").unwrap();
        assert_eq!(t.resource, "model@worker.service");
        assert!(!t.control.check_after_actions);
        assert!(t.control.health_probe.is_none());
        assert_eq!(
            t.control.status_probe.as_ref().unwrap().action_id,
            t.actions[3].id
        );
        assert_eq!(
            build("systemdSystem", "x.service").unwrap().resource,
            "x.service"
        );
    }
    #[cfg(unix)]
    #[test]
    fn posix_templates_parse_and_status_mapping_uses_exact_stub_arguments() {
        use std::{
            io::Write,
            os::unix::fs::PermissionsExt,
            process::{Command, Stdio},
        };
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("argv");
        // Only isolated stubs can be resolved from PATH. Never invoke system services or Docker.
        let stub = "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$ARG_LOG\"\ncase \"$*\" in\n *LoadState*) printf '%s\\n' \"$LOAD\" ;;\n *) printf '%s\\n' \"$STATE\" ;;\nesac\n";
        for name in ["systemctl", "journalctl", "docker"] {
            let file = dir.path().join(name);
            std::fs::write(&file, stub).unwrap();
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        for kind in ["systemdUser", "systemdSystem", "docker"] {
            let t = build(kind, "model-worker").unwrap();
            for a in &t.actions {
                let mut child = Command::new("/bin/sh")
                    .arg("-n")
                    .stdin(Stdio::piped())
                    .spawn()
                    .unwrap();
                child
                    .stdin
                    .take()
                    .unwrap()
                    .write_all(a.command.as_bytes())
                    .unwrap();
                assert!(child.wait().unwrap().success());
            }
            let cases = if kind == "docker" {
                vec![
                    ("running", 0),
                    ("exited", 3),
                    ("created", 3),
                    ("dead", 4),
                    ("restarting", 5),
                ]
            } else {
                vec![
                    ("active", 0),
                    ("inactive", 3),
                    ("failed", 4),
                    ("activating", 5),
                ]
            };
            for (state, code) in cases {
                std::fs::write(&log, "").unwrap();
                let result = Command::new("/bin/sh")
                    .args(["-c", &t.actions[3].command])
                    .env("PATH", dir.path())
                    .env("ARG_LOG", &log)
                    .env("LOAD", "loaded")
                    .env("STATE", state)
                    .status()
                    .unwrap();
                assert_eq!(result.code(), Some(code));
                let argv = std::fs::read_to_string(&log).unwrap();
                if kind == "docker" {
                    assert_eq!(argv, "inspect\n--type\ncontainer\n--format\n{{.State.Status}}\n--\nmodel-worker\n");
                } else {
                    let prefix = if kind == "systemdUser" {
                        "--user\n"
                    } else {
                        ""
                    };
                    assert_eq!(argv, format!("{prefix}show\n--property=LoadState\n--value\n--\nmodel-worker.service\n{prefix}show\n--property=ActiveState\n--value\n--\nmodel-worker.service\n"));
                }
            }
            if kind != "docker" {
                let result = Command::new("/bin/sh")
                    .args(["-c", &t.actions[3].command])
                    .env("PATH", dir.path())
                    .env("ARG_LOG", &log)
                    .env("LOAD", "not-found")
                    .env("STATE", "inactive")
                    .status()
                    .unwrap();
                assert_eq!(result.code(), Some(5));
            }
        }
    }
}
