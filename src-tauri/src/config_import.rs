//! Strict portable-package boundary. No trust, runtime, command, or credential input.
use crate::model::{
    AuthMethod, ConnectionOptions, ForwardKind, Host, ReconnectPolicy, Rule, RuleIcon,
    ServiceProtocol, Snapshot,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ImportSource {
    Upload {
        #[serde(rename = "fileName")]
        file_name: String,
        content: String,
    },
    Path {
        path: String,
    },
}
impl ImportSource {
    pub fn read(self) -> Result<(Vec<u8>, String), String> {
        fn check_name(name: &str) -> Result<(), String> {
            if !text(name) || !name.to_ascii_lowercase().ends_with(".json") {
                return Err("请选择 JSON 格式的配置文件".into());
            }
            Ok(())
        }
        let (bytes, file_name) = match self {
            Self::Upload { file_name, content } => {
                check_name(&file_name)?;
                if file_name.contains(['/', '\\']) {
                    return Err("配置文件名无效".into());
                }
                if content.len() > MAX_BYTES {
                    return Err("配置包超过 2 MiB 限制".into());
                }
                (content.into_bytes(), file_name)
            }
            Self::Path { path } => {
                let path = std::path::Path::new(&path);
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or("配置文件名无效")?;
                check_name(name)?;
                let file = std::fs::File::open(path).map_err(|_| "无法读取所选配置文件")?;
                let metadata = file.metadata().map_err(|_| "无法读取所选配置文件")?;
                if !metadata.is_file() || metadata.len() > MAX_BYTES as u64 {
                    return Err("配置文件应为不超过 2 MiB 的普通文件".into());
                }
                use std::io::Read;
                let mut bytes = Vec::new();
                file.take((MAX_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "无法读取所选配置文件")?;
                (bytes, name.to_string())
            }
        };
        if bytes.len() > MAX_BYTES {
            return Err("配置包超过 2 MiB 限制".into());
        }
        Ok((bytes, file_name))
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Package {
    format: String,
    version: u32,
    hosts: Vec<PortableHost>,
    rules: Vec<PortableRule>,
    credentials_included: bool,
    runtime_included: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableHost {
    id: String,
    name: String,
    address: String,
    port: u16,
    user: String,
    auth_method: AuthMethod,
    tags: Vec<String>,
    connection: ConnectionOptions,
    proxy_jump: Option<String>,
    identities_only: bool,
    #[serde(default)]
    algorithms: crate::model::AlgorithmOptions,
    identity_files: Vec<String>,
    identity_files_omitted: bool,
    connection_blocked: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableRule {
    #[serde(default)]
    icon: Option<RuleIcon>,
    id: String,
    name: String,
    color: Option<String>,
    #[serde(default)]
    service_protocol: Option<ServiceProtocol>,
    host_id: String,
    kind: ForwardKind,
    bind_address: String,
    bind_port: u16,
    target_host: String,
    target_port: u16,
    connection: Option<ConnectionOptions>,
    background: bool,
    reconnect: ReconnectPolicy,
    no_remote_command: bool,
    remote_command_omitted: bool,
    auto_connect: bool,
    repeat_command_on_reconnect: bool,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Choices {
    pub rule_ids: Vec<String>,
    pub reuse_hosts: BTreeMap<String, String>,
    pub forward_only: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub file_name: String,
    hosts: Vec<HostPreview>,
    rules: Vec<RulePreview>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostPreview {
    id: String,
    name: String,
    endpoint: String,
    conflict: bool,
    key_paths_omitted: bool,
    key_paths: Vec<String>,
    proxy_jump: Option<String>,
    blocked: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RulePreview {
    id: String,
    name: String,
    host_id: String,
    path: String,
    conflict: bool,
    listener_conflict: bool,
    command_omitted: bool,
}
pub struct Plan {
    pub hosts: Vec<Host>,
    pub rules: Vec<Rule>,
}
fn text(value: &str) -> bool {
    value.len() <= 4096 && !value.chars().any(char::is_control)
}
fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4096
        && text(value)
        && !value.contains([',', '@', '%', ' ', '[', ']'])
}
fn unique_name(name: &str, names: &mut BTreeSet<String>) -> String {
    if names.insert(name.to_string()) {
        return name.to_string();
    }
    for index in 2.. {
        let candidate = format!("{name} ({index})");
        if names.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
}
pub fn parse(bytes: &[u8]) -> Result<Package, String> {
    if bytes.len() > MAX_BYTES {
        return Err("配置包超过 2 MiB 限制".into());
    }
    // Serde errors may contain untrusted field values. Never return their text to UI/logs.
    let package: Package = serde_json::from_slice(bytes)
        .map_err(|_| "配置包格式无效，或包含不允许的字段（凭据、命令、运行态等）".to_string())?;
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| "配置包格式无效")?;
    for item in value["hosts"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(value["rules"].as_array().into_iter().flatten())
    {
        for (key, allowed) in [
            (
                "connection",
                &[
                    "connectTimeoutSecs",
                    "keepaliveIntervalSecs",
                    "keepaliveMax",
                ][..],
            ),
            (
                "reconnect",
                &["enabled", "maxAttempts", "initialDelaySecs", "maxDelaySecs"][..],
            ),
        ] {
            if item[key]
                .as_object()
                .is_some_and(|map| map.keys().any(|k| !allowed.contains(&k.as_str())))
            {
                return Err("配置包连接参数包含不允许的字段".into());
            }
        }
    }
    if package.format != "oria-tunnel"
        || package.version != 1
        || package.credentials_included
        || package.runtime_included
    {
        return Err("仅支持不含凭据和运行态的 OriaTunnel v1 配置包".into());
    }
    if package.hosts.is_empty()
        || package.hosts.len() > 500
        || package.rules.is_empty()
        || package.rules.len() > 1000
    {
        return Err("配置包应包含 1–500 台主机及 1–1000 条规则".into());
    }
    let mut ids = BTreeSet::new();
    for h in &package.hosts {
        if !id(&h.id)
            || !ids.insert(&h.id)
            || h.name.trim().is_empty()
            || !text(&h.name)
            || h.address.is_empty()
            || !text(&h.address)
            || h.address.chars().any(char::is_whitespace)
            || h.user.is_empty()
            || !text(&h.user)
            || h.user.chars().any(char::is_whitespace)
            || h.port == 0
            || h.tags.len() > 50
            || h.tags.iter().any(|t| !text(t))
            || h.identity_files.len() > 32
            || h.identity_files.iter().any(|p| p.is_empty() || !text(p))
        {
            return Err("配置包主机字段无效或 ID 重复".into());
        }
        h.connection.validate()?;
        crate::ssh_algorithms::preferred(&h.algorithms)?;
    }
    let mut rule_ids = BTreeSet::new();
    for r in &package.rules {
        if !id(&r.id)
            || !rule_ids.insert(&r.id)
            || !ids.contains(&r.host_id)
            || !text(&r.name)
            || !text(&r.bind_address)
            || !text(&r.target_host)
            || (!r.no_remote_command && !r.remote_command_omitted)
        {
            return Err("配置包规则无效、ID 重复、缺少主机或缺少命令省略标记".into());
        }
        r.to_rule(r.id.clone(), r.host_id.clone()).validate()?;
    }
    // Validate the complete dependency graph before offering an import, including unselected routes.
    let hosts = package
        .hosts
        .iter()
        .map(|h| h.to_host(h.id.clone(), h.proxy_jump.clone()))
        .collect::<Vec<_>>();
    for h in &hosts {
        crate::model::resolve_jumps(&hosts, h)?;
    }
    Ok(package)
}
impl PortableHost {
    fn to_host(&self, id: String, proxy_jump: Option<String>) -> Host {
        Host {
            id,
            name: self.name.clone(),
            address: self.address.clone(),
            port: self.port,
            user: self.user.clone(),
            identity_files: self.identity_files.clone(),
            source: "manual".into(),
            connection: self.connection.clone(),
            auth_method: self.auth_method.clone(),
            tags: self.tags.clone(),
            identities_only: self.identities_only,
            algorithms: self.algorithms.clone(),
            proxy_jump,
            ..Default::default()
        }
    }
}
impl PortableRule {
    fn to_rule(&self, id: String, host_id: String) -> Rule {
        Rule {
            id,
            host_id,
            name: self.name.clone(),
            kind: self.kind,
            color: self.color.clone(),
            icon: self.icon.clone(),
            service_protocol: self.service_protocol,
            bind_address: self.bind_address.clone(),
            bind_port: self.bind_port,
            target_host: self.target_host.clone(),
            target_port: self.target_port,
            connection: self.connection.clone(),
            background: self.background,
            reconnect: self.reconnect.clone(),
            // Even a malicious package cannot enable startup or commands.
            no_remote_command: true,
            auto_connect: false,
            repeat_command_on_reconnect: false,
            remote_command: String::new(),
        }
    }
}
impl Package {
    pub fn preview(&self, snapshot: &Snapshot, token: String, file_name: String) -> Preview {
        Preview {
            token,
            file_name,
            hosts: self
                .hosts
                .iter()
                .map(|h| HostPreview {
                    id: h.id.clone(),
                    name: h.name.clone(),
                    endpoint: format!("{}@{}:{}", h.user, h.address, h.port),
                    conflict: snapshot
                        .hosts
                        .iter()
                        .any(|old| old.id == h.id || old.name == h.name),
                    key_paths_omitted: h.identity_files_omitted,
                    key_paths: h.identity_files.clone(),
                    proxy_jump: h.proxy_jump.clone(),
                    blocked: h.connection_blocked,
                })
                .collect(),
            rules: self
                .rules
                .iter()
                .map(|r| RulePreview {
                    id: r.id.clone(),
                    name: r.name.clone(),
                    host_id: r.host_id.clone(),
                    path: format!(
                        "{:?} · {}:{} → {}:{}",
                        r.kind, r.bind_address, r.bind_port, r.target_host, r.target_port
                    ),
                    conflict: snapshot
                        .rules
                        .iter()
                        .any(|old| old.id == r.id || old.name == r.name),
                    listener_conflict: snapshot.rules.iter().any(|old| {
                        old.bind_port == r.bind_port
                            && old.bind_address == r.bind_address
                            && (old.kind == ForwardKind::R) == (r.kind == ForwardKind::R)
                    }),
                    command_omitted: r.remote_command_omitted || !r.no_remote_command,
                })
                .collect(),
        }
    }
    pub fn prepare(&self, snapshot: &Snapshot, choices: &Choices) -> Result<Plan, String> {
        if choices.rule_ids.is_empty() {
            return Err("请选择至少一条规则".into());
        }
        let wanted: BTreeSet<_> = choices.rule_ids.iter().collect();
        if wanted.len() != choices.rule_ids.len()
            || wanted
                .iter()
                .any(|id| !self.rules.iter().any(|r| &r.id == *id))
        {
            return Err("导入选择无效".into());
        }
        for (old, existing) in &choices.reuse_hosts {
            if !self.hosts.iter().any(|h| &h.id == old)
                || !snapshot
                    .hosts
                    .iter()
                    .any(|h| &h.id == existing && h.diagnostics.is_empty())
            {
                return Err("复用主机已不存在或需处理，请重新预览".into());
            }
        }
        let mut needed = BTreeSet::new();
        let originals = self
            .hosts
            .iter()
            .map(|h| h.to_host(h.id.clone(), h.proxy_jump.clone()))
            .collect::<Vec<_>>();
        fn dependencies(
            id: &str,
            hosts: &[Host],
            reuse: &BTreeMap<String, String>,
            needed: &mut BTreeSet<String>,
        ) {
            if !needed.insert(id.to_string()) || reuse.contains_key(id) {
                return;
            }
            if let Some(expression) = hosts
                .iter()
                .find(|h| h.id == id)
                .and_then(|h| h.proxy_jump.as_deref())
            {
                for next in expression.split(',').map(str::trim) {
                    dependencies(next, hosts, reuse, needed);
                }
            }
        }
        for rule in self.rules.iter().filter(|r| wanted.contains(&r.id)) {
            if (rule.remote_command_omitted || !rule.no_remote_command) && !choices.forward_only {
                return Err("所选规则省略了远程命令，请跳过或明确改为仅转发".into());
            }
            dependencies(&rule.host_id, &originals, &choices.reuse_hosts, &mut needed);
        }
        if self.hosts.iter().any(|h| {
            needed.contains(&h.id)
                && h.connection_blocked
                && !choices.reuse_hosts.contains_key(&h.id)
        }) {
            return Err(
                "所选依赖包含来源标记为不兼容的主机；请跳过相关规则或明确复用已验证的现有主机"
                    .into(),
            );
        }
        let mapping: BTreeMap<_, _> = needed
            .iter()
            .map(|id| {
                (
                    id.clone(),
                    choices
                        .reuse_hosts
                        .get(id)
                        .cloned()
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                )
            })
            .collect();
        let mut hosts = self
            .hosts
            .iter()
            .filter(|h| needed.contains(&h.id) && !choices.reuse_hosts.contains_key(&h.id))
            .map(|h| {
                let jump = h
                    .proxy_jump
                    .as_ref()
                    .map(|expression| {
                        expression
                            .split(',')
                            .map(|id| mapping.get(id.trim()).cloned().ok_or("跳板依赖缺失"))
                            .collect::<Result<Vec<_>, _>>()
                            .map(|ids| ids.join(","))
                    })
                    .transpose()?;
                Ok(h.to_host(mapping[&h.id].clone(), jump))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let mut host_names = snapshot.hosts.iter().map(|h| h.name.clone()).collect();
        for host in &mut hosts {
            host.name = unique_name(&host.name, &mut host_names);
        }
        let mut candidates = snapshot.hosts.clone();
        candidates.extend(hosts.clone());
        for h in &hosts {
            crate::model::resolve_jumps(&candidates, h)?;
        }
        let mut rules = self
            .rules
            .iter()
            .filter(|r| wanted.contains(&r.id))
            .map(|r| {
                // These exported flags are deliberately ignored, even if set true in input.
                let _ = (r.auto_connect, r.repeat_command_on_reconnect);
                r.to_rule(
                    uuid::Uuid::new_v4().to_string(),
                    mapping[&r.host_id].clone(),
                )
            })
            .collect::<Vec<_>>();
        let mut rule_names = snapshot.rules.iter().map(|r| r.name.clone()).collect();
        for rule in &mut rules {
            rule.name = unique_name(&rule.name, &mut rule_names);
        }
        Ok(Plan { hosts, rules })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upload_and_dropped_path_feed_the_same_strict_package_boundary() {
        let content = serde_json::to_string(&fixture()).unwrap();
        let (uploaded, name) = ImportSource::Upload {
            file_name: "fixture.JSON".into(),
            content: content.clone(),
        }
        .read()
        .unwrap();
        assert_eq!(name, "fixture.JSON");
        assert!(parse(&uploaded).is_ok());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.JSON");
        std::fs::write(&path, &content).unwrap();
        let (dropped, _) = ImportSource::Path {
            path: path.to_string_lossy().into_owned(),
        }
        .read()
        .unwrap();
        assert_eq!(uploaded, dropped);
        let (invalid, _) = ImportSource::Upload {
            file_name: "secret.json".into(),
            content: r#"{"password":"never-echo-source"}"#.into(),
        }
        .read()
        .unwrap();
        let error = parse(&invalid).err().unwrap();
        assert!(!error.contains("never-echo-source"));
    }
    #[test]
    fn import_sources_reject_non_json_directories_and_oversized_files() {
        assert!(ImportSource::Upload {
            file_name: "fixture.txt".into(),
            content: "{}".into()
        }
        .read()
        .is_err());
        assert!(ImportSource::Upload {
            file_name: "../fixture.json".into(),
            content: "{}".into()
        }
        .read()
        .is_err());
        assert!(ImportSource::Upload {
            file_name: "fixture.json".into(),
            content: "x".repeat(MAX_BYTES + 1)
        }
        .read()
        .is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.json");
        std::fs::write(&path, vec![b' '; MAX_BYTES + 1]).unwrap();
        assert!(ImportSource::Path {
            path: path.to_string_lossy().into_owned()
        }
        .read()
        .is_err());
        let folder = dir.path().join("folder.json");
        std::fs::create_dir(&folder).unwrap();
        assert!(ImportSource::Path {
            path: folder.to_string_lossy().into_owned()
        }
        .read()
        .is_err());
    }
    pub fn fixture() -> serde_json::Value {
        let jump = Host {
            id: "jump".into(),
            name: "Jump".into(),
            address: "127.0.0.1".into(),
            port: 22,
            user: "test".into(),
            ..Default::default()
        };
        let host = Host {
            id: "host".into(),
            name: "Host".into(),
            address: "::1".into(),
            port: 2222,
            user: "test".into(),
            proxy_jump: Some("jump".into()),
            ..Default::default()
        };
        let rule = Rule {
            id: "rule".into(),
            name: "Forward".into(),
            color: Some("#7c3aed".into()),
            service_protocol: Some(ServiceProtocol::Https),
            host_id: "host".into(),
            bind_port: 15432,
            target_host: "localhost".into(),
            target_port: 5432,
            ..Default::default()
        };
        crate::config_export::package(
            &Snapshot {
                hosts: vec![jump, host],
                rules: vec![rule],
                ..Default::default()
            },
            &["rule".into()],
            false,
        )
        .unwrap()
    }
    fn parsed(value: &serde_json::Value) -> Result<Package, String> {
        parse(&serde_json::to_vec(value).unwrap())
    }
    #[test]
    fn icons_round_trip_and_invalid_icons_are_rejected() {
        for icon in [
            serde_json::Value::Null,
            serde_json::json!({"kind":"builtin", "value":"database"}),
            serde_json::json!({"kind":"emoji", "value":"👩🏽‍💻"}),
        ] {
            let mut value = fixture();
            value["rules"][0]["icon"] = icon.clone();
            let package = parsed(&value).unwrap();
            let plan = package
                .prepare(
                    &Snapshot::default(),
                    &Choices {
                        rule_ids: vec!["rule".into()],
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(serde_json::to_value(&plan.rules[0].icon).unwrap(), icon);
            let exported_ids = plan
                .rules
                .iter()
                .map(|rule| rule.id.clone())
                .collect::<Vec<_>>();
            let exported = crate::config_export::package(
                &Snapshot {
                    hosts: plan.hosts,
                    rules: plan.rules,
                    ..Default::default()
                },
                &exported_ids,
                false,
            )
            .unwrap();
            assert_eq!(exported["rules"][0]["icon"], icon);
        }
        let mut value = fixture();
        value["rules"][0].as_object_mut().unwrap().remove("icon");
        assert!(parsed(&value).unwrap().rules[0].icon.is_none());
        for icon in [
            serde_json::json!({"kind":"builtin", "value":"missing"}),
            serde_json::json!({"kind":"url", "value":"https://example.invalid/icon.svg"}),
            serde_json::json!({"kind":"emoji", "value":"🚀🚀"}),
            serde_json::json!({"kind":"emoji", "value":"🚀", "extra":"rejected"}),
        ] {
            value["rules"][0]["icon"] = icon;
            assert!(parsed(&value).is_err());
        }
    }
    #[test]
    fn service_protocols_round_trip_and_missing_protocol_stays_unselected() {
        for protocol in [
            serde_json::Value::Null,
            "http".into(),
            "https".into(),
            "vnc".into(),
        ] {
            let mut value = fixture();
            value["rules"][0]["serviceProtocol"] = protocol.clone();
            let package = parsed(&value).unwrap();
            let plan = package
                .prepare(
                    &Snapshot::default(),
                    &Choices {
                        rule_ids: vec!["rule".into()],
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(
                serde_json::to_value(plan.rules[0].service_protocol).unwrap(),
                protocol
            );
        }
        let mut value = fixture();
        value["rules"][0]
            .as_object_mut()
            .unwrap()
            .remove("serviceProtocol");
        assert!(parsed(&value).unwrap().rules[0].service_protocol.is_none());
        for invalid in ["ftp", "javascript", "https://example.invalid", "VNC"] {
            value["rules"][0]["serviceProtocol"] = invalid.into();
            assert!(parsed(&value).is_err());
        }
    }
    #[test]
    fn round_trip_remaps_dependencies_and_cannot_restore_startup_trust_or_commands() {
        let mut value = fixture();
        let mut incomplete = value.clone();
        incomplete["rules"][0]
            .as_object_mut()
            .unwrap()
            .remove("repeatCommandOnReconnect");
        assert!(parsed(&incomplete).is_err());
        incomplete = value.clone();
        incomplete["hosts"][0]
            .as_object_mut()
            .unwrap()
            .remove("connectionBlocked");
        assert!(parsed(&incomplete).is_err());
        value["rules"][0]["autoConnect"] = true.into();
        value["rules"][0]["repeatCommandOnReconnect"] = true.into();
        let package = parsed(&value).unwrap();
        let plan = package
            .prepare(
                &Snapshot::default(),
                &Choices {
                    rule_ids: vec!["rule".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(plan.hosts.len(), 2);
        assert_eq!(plan.rules.len(), 1);
        assert_eq!(plan.rules[0].color.as_deref(), Some("#7c3aed"));
        assert_eq!(plan.rules[0].service_protocol, Some(ServiceProtocol::Https));
        let mut invalid_color = value.clone();
        invalid_color["rules"][0]["color"] = "url(secret)".into();
        assert!(parsed(&invalid_color).is_err());
        assert!(plan
            .hosts
            .iter()
            .all(|h| h.source == "manual" && h.source_file.is_none() && h.diagnostics.is_empty()));
        let host = plan.hosts.iter().find(|h| h.name == "Host").unwrap();
        assert_ne!(host.id, "host");
        assert_eq!(plan.rules[0].host_id, host.id);
        assert_eq!(
            crate::model::resolve_jumps(&plan.hosts, host).unwrap()[0].name,
            "Jump"
        );
        assert!(!plan.rules[0].auto_connect);
        assert!(!plan.rules[0].repeat_command_on_reconnect);
        assert!(plan.rules[0].no_remote_command);
        let mut missing = fixture();
        missing["rules"][0]["noRemoteCommand"] = false.into();
        missing["rules"][0]["remoteCommandOmitted"] = true.into();
        let package = parsed(&missing).unwrap();
        let mut choices = Choices {
            rule_ids: vec!["rule".into()],
            ..Default::default()
        };
        assert!(package.prepare(&Snapshot::default(), &choices).is_err());
        choices.forward_only = true;
        assert!(
            package
                .prepare(&Snapshot::default(), &choices)
                .unwrap()
                .rules[0]
                .no_remote_command
        );
    }
    #[test]
    fn algorithm_policy_survives_portable_round_trip_and_invalid_policies_are_rejected() {
        let mut value = fixture();
        let options = serde_json::json!({"ciphers":"aes128-ctr", "kexAlgorithms":"curve25519-sha256", "macs":"hmac-sha2-256"});
        value["hosts"][0]["algorithms"] = options.clone();
        let plan = parsed(&value)
            .unwrap()
            .prepare(
                &Snapshot::default(),
                &Choices {
                    rule_ids: vec!["rule".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        let host_name = value["hosts"][0]["name"].as_str().unwrap();
        let snapshot = Snapshot {
            hosts: plan.hosts,
            rules: plan.rules,
            ..Default::default()
        };
        let exported =
            crate::config_export::package(&snapshot, &[snapshot.rules[0].id.clone()], false)
                .unwrap();
        let exported_host = exported["hosts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h["name"] == host_name)
            .unwrap();
        assert_eq!(exported_host["algorithms"], options);
        assert!(parsed(&exported).is_ok());
        for invalid in ["unsupported-cipher", "-*", "aes128-ctr,", "none"] {
            value["hosts"][0]["algorithms"]["ciphers"] = invalid.into();
            assert!(parsed(&value).is_err());
        }
    }
    #[test]
    fn rejects_secret_fields_malformed_graphs_versions_and_oversized_input_without_echoing_values()
    {
        for field in [
            "password",
            "privateKey",
            "trustedKeys",
            "runtime",
            "remoteCommand",
        ] {
            let mut value = fixture();
            value["hosts"][0][field] = "DO_NOT_ECHO".into();
            let error = parsed(&value).err().unwrap();
            assert!(!error.contains("DO_NOT_ECHO"));
        }
        let mut value = fixture();
        value["hosts"][0]["connection"]["secret"] = "DO_NOT_ECHO".into();
        assert!(parsed(&value).is_err());
        let mut value = fixture();
        value["version"] = 2.into();
        assert!(parsed(&value).is_err());
        let mut value = fixture();
        value["hosts"][1]["id"] = "jump".into();
        assert!(parsed(&value).is_err());
        let mut value = fixture();
        value["hosts"][0]["proxyJump"] = "host".into();
        assert!(parsed(&value).is_err());
        let mut value = fixture();
        value["rules"][0]["hostId"] = "missing".into();
        assert!(parsed(&value).is_err());
        assert!(parse(&vec![b' '; MAX_BYTES + 1]).is_err());
        assert!(parse(b"{ truncated").is_err());
    }
    #[test]
    fn reuse_is_explicit_and_missing_or_attention_hosts_are_refused() {
        let package = parsed(&fixture()).unwrap();
        let mut snapshot = Snapshot {
            hosts: vec![Host {
                id: "existing".into(),
                name: "keep".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let choices = Choices {
            rule_ids: vec!["rule".into()],
            reuse_hosts: BTreeMap::from([("jump".into(), "existing".into())]),
            ..Default::default()
        };
        let plan = package.prepare(&snapshot, &choices).unwrap();
        assert_eq!(plan.hosts.len(), 1);
        assert_eq!(plan.hosts[0].proxy_jump.as_deref(), Some("existing"));
        assert_eq!(snapshot.hosts[0].name, "keep");
        snapshot.hosts[0].diagnostics.push("unavailable".into());
        assert!(package.prepare(&snapshot, &choices).is_err());
        snapshot.hosts.clear();
        assert!(package.prepare(&snapshot, &choices).is_err());
    }
    #[test]
    fn blocked_sources_require_explicit_reuse_and_reused_targets_do_not_import_unused_dependencies()
    {
        let mut value = fixture();
        value["hosts"][1]["connectionBlocked"] = true.into();
        let package = parsed(&value).unwrap();
        let mut choices = Choices {
            rule_ids: vec!["rule".into()],
            ..Default::default()
        };
        let snapshot = Snapshot {
            hosts: vec![Host {
                id: "existing".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(package.prepare(&snapshot, &choices).is_err());
        choices.reuse_hosts.insert("host".into(), "existing".into());
        let plan = package.prepare(&snapshot, &choices).unwrap();
        assert!(plan.hosts.is_empty());
        assert_eq!(plan.rules[0].host_id, "existing");
    }
    #[test]
    fn ordered_inline_profiles_export_and_import_with_all_dependencies() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("config");
        std::fs::write(&file,"Host first second target\n HostName 127.0.0.1\n User tester\nHost second\n ProxyJump first\nHost target\n ProxyJump user@first:2200,ssh://other@second:2201\n").unwrap();
        let hosts = crate::ssh_config::discover_files(&[file], dir.path()).hosts;
        let rule = Rule {
            id: "rule".into(),
            name: "route".into(),
            host_id: "ssh:target".into(),
            bind_port: 15432,
            target_host: "localhost".into(),
            target_port: 80,
            ..Default::default()
        };
        let value = crate::config_export::package(
            &Snapshot {
                hosts,
                rules: vec![rule],
                ..Default::default()
            },
            &["rule".into()],
            false,
        )
        .unwrap();
        let package = parsed(&value).unwrap();
        let plan = package
            .prepare(
                &Snapshot::default(),
                &Choices {
                    rule_ids: vec!["rule".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        let target = plan
            .hosts
            .iter()
            .find(|h| h.id == plan.rules[0].host_id)
            .unwrap();
        let route = crate::model::resolve_jumps(&plan.hosts, target).unwrap();
        assert_eq!(route.len(), 2);
        assert_eq!(route[0].user, "user");
        assert_eq!(route[1].user, "other");
        assert_eq!(route[1].port, 2201);
    }
}
