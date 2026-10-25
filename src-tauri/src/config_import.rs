//! Strict v1/v2 package boundary. v2 commands remain disabled until separately reviewed.
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
                return Err(crate::native_message::plain("jsonFileRequired"));
            }
            Ok(())
        }
        let (bytes, file_name) = match self {
            Self::Upload { file_name, content } => {
                check_name(&file_name)?;
                if file_name.contains(['/', '\\']) {
                    return Err(crate::native_message::plain("configFileName"));
                }
                if content.len() > MAX_BYTES {
                    return Err(crate::native_message::plain("configTooLarge"));
                }
                (content.into_bytes(), file_name)
            }
            Self::Path { path } => {
                let path = std::path::Path::new(&path);
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or(crate::native_message::plain("configFileName"))?;
                check_name(name)?;
                let file = std::fs::File::open(path)
                    .map_err(|_| crate::native_message::plain("selectedConfigRead"))?;
                let metadata = file
                    .metadata()
                    .map_err(|_| crate::native_message::plain("selectedConfigRead"))?;
                if !metadata.is_file() || metadata.len() > MAX_BYTES as u64 {
                    return Err(crate::native_message::plain("configRegularFile"));
                }
                use std::io::Read;
                let mut bytes = Vec::new();
                file.take((MAX_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|_| crate::native_message::plain("selectedConfigRead"))?;
                (bytes, name.to_string())
            }
        };
        if bytes.len() > MAX_BYTES {
            return Err(crate::native_message::plain("configTooLarge"));
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
    #[serde(default)]
    services: Option<Vec<PortableService>>,
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
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableService {
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    icon: Option<crate::model::RuleIcon>,
    id: String,
    name: String,
    #[serde(default)]
    execution_host_id: String,
    rule_ids: Vec<String>,
    no_local_environment: bool,
    actions: Vec<crate::commands::Action>,
    control: crate::service_control::Control,
}
impl PortableService {
    fn definition(&self) -> crate::commands::Service {
        crate::commands::Service {
            category: self.category.clone(),
            color: self.color.clone(),
            icon: self.icon.clone(),
            id: self.id.clone(),
            name: self.name.clone(),
            execution_host_id: self.execution_host_id.clone(),
            rule_ids: self.rule_ids.clone(),
            revision: String::new(),
            no_local_environment: self.no_local_environment,
            actions: self.actions.clone(),
            control: self.control.clone(),
            execution_enabled: false,
        }
    }
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Choices {
    pub rule_ids: Vec<String>,
    #[serde(default)]
    pub service_ids: Vec<String>,
    pub reuse_hosts: BTreeMap<String, String>,
    pub forward_only: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub file_name: String,
    version: u32,
    services: Vec<ServicePreview>,
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServicePreview {
    #[serde(flatten)]
    definition: PortableService,
    endpoint: String,
    conflict: bool,
}
pub struct Plan {
    pub hosts: Vec<Host>,
    pub rules: Vec<Rule>,
    pub services: Vec<crate::commands::Service>,
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
        return Err(crate::native_message::plain("configTooLarge"));
    }
    // Serde errors may contain untrusted field values. Never return their text to UI/logs.
    let package: Package = serde_json::from_slice(bytes)
        .map_err(|_| crate::native_message::plain("configForbiddenFields"))?;
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| crate::native_message::plain("configInvalid"))?;
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
                return Err(crate::native_message::plain("configConnectionFields"));
            }
        }
    }
    if package.format != "oria-tunnel"
        || !matches!(package.version, 1 | 2)
        || (package.version == 1 && value.get("services").is_some())
        || (package.version == 2 && package.services.is_none())
        || package.credentials_included
        || package.runtime_included
    {
        return Err(crate::native_message::plain("configVersion"));
    }
    if (package.hosts.is_empty() && (package.version == 1 || !package.rules.is_empty()))
        || package.hosts.len() > 500
        || (package.rules.is_empty() && package.services.as_ref().is_none_or(Vec::is_empty))
        || package.rules.len() > 1000
        || package.services.as_ref().is_some_and(|s| s.len() > 256)
    {
        return Err(crate::native_message::plain("configLimits"));
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
            return Err(crate::native_message::plain("configHostsInvalid"));
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
            return Err(crate::native_message::plain("configRulesInvalid"));
        }
        r.to_rule(r.id.clone(), r.host_id.clone()).validate()?;
    }
    let mut service_ids = BTreeSet::new();
    for service in package.services.iter().flatten() {
        if !id(&service.id)
            || !text(&service.name)
            || service.actions.iter().any(|a| !text(&a.label))
            || !service_ids.insert(&service.id)
            || (!service.execution_host_id.is_empty() && !ids.contains(&service.execution_host_id))
            || service.rule_ids.iter().any(|id| !rule_ids.contains(id))
            || service.rule_ids.iter().collect::<BTreeSet<_>>().len() != service.rule_ids.len()
        {
            return Err("invalidServicePackage".into());
        }
        service
            .definition()
            .validate()
            .map_err(|_| "invalidServicePackage")?;
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
            version: self.version,
            services: self
                .services
                .iter()
                .flatten()
                .map(|s| ServicePreview {
                    definition: s.clone(),
                    endpoint: self
                        .hosts
                        .iter()
                        .find(|h| h.id == s.execution_host_id)
                        .map(|h| format!("{}@{}:{}", h.user, h.address, h.port))
                        .unwrap_or_default(),
                    conflict: snapshot
                        .services
                        .iter()
                        .any(|old| old.id == s.id || old.name == s.name),
                })
                .collect(),
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
        if choices.rule_ids.is_empty() && choices.service_ids.is_empty() {
            return Err(crate::native_message::plain("selectImportItems"));
        }
        let wanted: BTreeSet<_> = choices.rule_ids.iter().collect();
        if wanted.len() != choices.rule_ids.len()
            || wanted
                .iter()
                .any(|id| !self.rules.iter().any(|r| &r.id == *id))
        {
            return Err(crate::native_message::plain("importSelectionInvalid"));
        }
        let selected_services: BTreeSet<_> = choices.service_ids.iter().collect();
        if selected_services.len() != choices.service_ids.len()
            || selected_services
                .iter()
                .any(|id| !self.services.iter().flatten().any(|s| &s.id == *id))
        {
            return Err("invalidServicePackage".into());
        }
        if snapshot.services.len() + selected_services.len() > 256 {
            return Err("servicePackageLimit".into());
        }
        for (old, existing) in &choices.reuse_hosts {
            if !self.hosts.iter().any(|h| &h.id == old)
                || !snapshot
                    .hosts
                    .iter()
                    .any(|h| &h.id == existing && h.diagnostics.is_empty())
            {
                return Err(crate::native_message::plain("reuseHostInvalid"));
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
                return Err(crate::native_message::plain("importCommandOmitted"));
            }
            dependencies(&rule.host_id, &originals, &choices.reuse_hosts, &mut needed);
        }
        if self.hosts.iter().any(|h| {
            needed.contains(&h.id)
                && h.connection_blocked
                && !choices.reuse_hosts.contains_key(&h.id)
        }) {
            return Err(crate::native_message::plain("importIncompatibleHost"));
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
                let jump =
                    h.proxy_jump
                        .as_ref()
                        .map(|expression| {
                            expression
                                .split(',')
                                .map(|id| {
                                    mapping.get(id.trim()).cloned().ok_or(
                                        crate::native_message::plain("jumpDependencyMissing"),
                                    )
                                })
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
        let rule_mapping: BTreeMap<_, _> = self
            .rules
            .iter()
            .filter(|r| wanted.contains(&r.id))
            .map(|r| (r.id.clone(), uuid::Uuid::new_v4().to_string()))
            .collect();
        let mut rules = self
            .rules
            .iter()
            .filter(|r| wanted.contains(&r.id))
            .map(|r| {
                // These exported flags are deliberately ignored, even if set true in input.
                let _ = (r.auto_connect, r.repeat_command_on_reconnect);
                r.to_rule(rule_mapping[&r.id].clone(), mapping[&r.host_id].clone())
            })
            .collect::<Vec<_>>();
        let mut rule_names = snapshot.rules.iter().map(|r| r.name.clone()).collect();
        for rule in &mut rules {
            rule.name = unique_name(&rule.name, &mut rule_names);
        }
        let mut service_names = snapshot.services.iter().map(|s| s.name.clone()).collect();
        let mut services = Vec::new();
        for imported in self
            .services
            .iter()
            .flatten()
            .filter(|s| selected_services.contains(&s.id))
        {
            let mut service = imported.definition();
            service.id = uuid::Uuid::new_v4().to_string();
            service.revision = uuid::Uuid::new_v4().to_string();
            service.name = unique_name(&service.name, &mut service_names);
            service.execution_host_id.clear();
            service.rule_ids = imported
                .rule_ids
                .iter()
                .filter_map(|id| rule_mapping.get(id).cloned())
                .collect();
            let action_mapping: BTreeMap<_, _> = service
                .actions
                .iter()
                .map(|a| (a.id.clone(), uuid::Uuid::new_v4().to_string()))
                .collect();
            for action in &mut service.actions {
                action.id = action_mapping[&action.id].clone();
                if ["start", "stop", "restart", "custom"].contains(&action.kind.as_str()) {
                    action.confirm = true;
                }
            }
            if let Some(p) = &mut service.control.status_probe {
                p.action_id = action_mapping[&p.action_id].clone();
            }
            service.control.start_action_id = service
                .control
                .start_action_id
                .as_ref()
                .map(|id| action_mapping[id].clone());
            if let Some(p) = &mut service.control.health_probe {
                p.repeatable = false;
            }
            service.control.check_after_actions = false;
            service.execution_enabled = false;
            service.validate().map_err(|_| "invalidServicePackage")?;
            services.push(service);
        }
        Ok(Plan {
            hosts,
            rules,
            services,
        })
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
    fn service_fixture() -> serde_json::Value {
        let mut value = fixture();
        value["version"] = 2.into();
        let t = crate::service_templates::build("systemdUser", "model").unwrap();
        let mut control = t.control;
        control.check_after_actions = true;
        control.health_probe = Some(crate::service_control::HealthProbe {
            command: "HEALTH_CANARY".into(),
            ready_codes: vec![0],
            not_ready_codes: vec![1],
            repeatable: true,
            timeout_secs: 2,
            interval_secs: 1,
            budget_secs: 10,
        });
        value["services"] = serde_json::json!([{"id":"service","name":"Model","executionHostId":"host","ruleIds":["rule"],"noLocalEnvironment":true,"actions":t.actions,"control":control}]);
        value
    }
    #[test]
    fn service_appearance_and_structured_arguments_survive_sharing_without_execution_permission() {
        let mut value = service_fixture();
        value["services"][0]["category"] = "inference".into();
        let mut invalid_category = value.clone();
        invalid_category["services"][0]["category"] = "not-a-category".into();
        assert!(parsed(&invalid_category).is_err());
        value["services"][0]["color"] = "#67ad98".into();
        value["services"][0]["icon"] = serde_json::json!({"kind":"builtin","value":"brain"});
        let invocation = crate::commands::Invocation {
            script: None,
            environment: vec![crate::commands::EnvironmentVariable {
                name: "MODEL_PORT".into(),
                value: "8000".into(),
            }],
            executable: "model-server".into(),
            arguments: vec![crate::commands::CommandArgument {
                name: "--model".into(),
                value: Some("path with 'quotes' $(literal) 中文".into()),
            }],
        };
        value["services"][0]["actions"][0]["command"] = invocation.render().unwrap().into();
        value["services"][0]["actions"][0]["invocation"] =
            serde_json::to_value(&invocation).unwrap();
        let plan = parsed(&value)
            .unwrap()
            .prepare(
                &Snapshot::default(),
                &Choices {
                    rule_ids: vec!["rule".into()],
                    service_ids: vec!["service".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        let service = &plan.services[0];
        assert_eq!(service.category.as_deref(), Some("inference"));
        assert_eq!(
            service.actions[0].invocation.as_ref().unwrap().environment[0].name,
            "MODEL_PORT"
        );
        assert_eq!(
            service.actions[0].invocation.as_ref().unwrap().environment[0].value,
            "8000"
        );
        assert_eq!(service.color.as_deref(), Some("#67ad98"));
        assert!(service.icon.is_some());
        assert!(!service.execution_enabled);
        assert_eq!(
            service.actions[0]
                .invocation
                .as_ref()
                .unwrap()
                .render()
                .unwrap(),
            invocation.render().unwrap()
        );
        let snapshot = Snapshot {
            hosts: plan.hosts,
            rules: plan.rules,
            services: plan.services,
            ..Default::default()
        };
        let exported = crate::config_export::package_with_services(
            &snapshot,
            &[snapshot.rules[0].id.clone()],
            &[snapshot.services[0].id.clone()],
            false,
        )
        .unwrap();
        assert_eq!(
            exported["services"][0]["icon"],
            value["services"][0]["icon"]
        );
        assert!(exported["services"][0].get("executionEnabled").is_none());
        assert_eq!(exported["services"][0]["category"], "inference");
        assert!(parsed(&exported).is_ok());
        value["services"][0]["actions"][0]["command"] = "tampered".into();
        assert!(parsed(&value).is_err());
    }
    #[test]
    fn unlimited_terminal_duration_survives_sharing_without_enabling_execution() {
        let mut value = service_fixture();
        value["services"][0]["actions"][0]["mode"] = "terminal".into();
        value["services"][0]["actions"][0]["timeoutSecs"] = 0.into();
        value["services"][0]["control"]["startActionId"] = serde_json::Value::Null;
        let plan = parsed(&value)
            .unwrap()
            .prepare(
                &Snapshot::default(),
                &Choices {
                    rule_ids: vec!["rule".into()],
                    service_ids: vec!["service".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            plan.services[0].actions[0].mode,
            crate::commands::ExecutionMode::Terminal
        );
        assert_eq!(plan.services[0].actions[0].timeout_secs, 0);
        assert!(!plan.services[0].execution_enabled);
        let snapshot = Snapshot {
            hosts: plan.hosts,
            rules: plan.rules,
            services: plan.services,
            ..Default::default()
        };
        let exported = crate::config_export::package_with_services(
            &snapshot,
            &[snapshot.rules[0].id.clone()],
            &[snapshot.services[0].id.clone()],
            false,
        )
        .unwrap();
        assert_eq!(exported["services"][0]["actions"][0]["timeoutSecs"], 0);
        assert!(parsed(&exported).is_ok());
        value["services"][0]["actions"][0]["mode"] = "command".into();
        assert!(parsed(&value).is_err());
    }
    #[test]
    fn v2_remaps_all_ids_links_and_probe_references_and_revokes_execution() {
        let value = service_fixture();
        let package = parsed(&value).unwrap();
        let plan = package
            .prepare(
                &Snapshot::default(),
                &Choices {
                    rule_ids: vec!["rule".into()],
                    service_ids: vec!["service".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        let s = &plan.services[0];
        assert!(!s.execution_enabled);
        assert_eq!(s.require_execution().unwrap_err(), "serviceDisabled");
        assert_ne!(s.id, "service");
        assert!(!s.revision.is_empty());
        assert_eq!(s.rule_ids, [plan.rules[0].id.clone()]);
        assert!(s.execution_host_id.is_empty());
        assert_eq!(plan.hosts.len(), 2);
        assert!(!s.control.check_after_actions);
        assert!(!s.control.health_probe.as_ref().unwrap().repeatable);
        assert_eq!(
            s.control.health_probe.as_ref().unwrap().command,
            "HEALTH_CANARY"
        );
        assert_eq!(
            s.control.status_probe.as_ref().unwrap().action_id,
            s.actions[3].id
        );
        assert_eq!(
            s.control.start_action_id.as_ref().unwrap(),
            &s.actions[0].id
        );
        for (a, old) in s
            .actions
            .iter()
            .zip(value["services"][0]["actions"].as_array().unwrap())
        {
            assert_ne!(a.id, old["id"].as_str().unwrap());
            assert_eq!(a.command, old["command"].as_str().unwrap());
            if ["start", "stop", "restart"].contains(&a.kind.as_str()) {
                assert!(a.confirm);
            }
        }
        let preview = serde_json::to_value(package.preview(
            &Snapshot::default(),
            "token".into(),
            "test.json".into(),
        ))
        .unwrap();
        assert_eq!(preview["version"], 2);
        assert_eq!(
            preview["services"][0]["control"]["healthProbe"]["command"],
            "HEALTH_CANARY"
        );
        assert!(preview["services"][0].get("executionEnabled").is_none());
    }
    #[test]
    fn v2_service_only_reuses_explicit_host_and_discards_unselected_links_and_dependencies() {
        let value = service_fixture();
        let package = parsed(&value).unwrap();
        let snapshot = Snapshot {
            hosts: vec![Host {
                id: "existing".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let choices = Choices {
            service_ids: vec!["service".into()],
            reuse_hosts: BTreeMap::from([("host".into(), "existing".into())]),
            ..Default::default()
        };
        let plan = package.prepare(&snapshot, &choices).unwrap();
        assert!(plan.hosts.is_empty());
        assert!(plan.rules.is_empty());
        assert!(plan.services[0].rule_ids.is_empty());
        assert!(plan.services[0].execution_host_id.is_empty());
        let snapshot = Snapshot {
            services: plan.services,
            ..Default::default()
        };
        let plan = package
            .prepare(
                &snapshot,
                &Choices {
                    service_ids: vec!["service".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(plan.services[0].name, "Model (2)");
        assert!(plan.hosts.is_empty());
        assert!(package
            .prepare(
                &snapshot,
                &Choices {
                    service_ids: vec!["service".into(), "service".into()],
                    ..Default::default()
                }
            )
            .is_err());
    }
    #[test]
    fn v2_rejects_unknown_executable_fields_invalid_references_and_version_downgrade() {
        for path in [
            "/services/0",
            "/services/0/actions/0",
            "/services/0/control",
            "/services/0/control/statusProbe",
            "/services/0/control/healthProbe",
        ] {
            for field in [
                "password",
                "executionEnabled",
                "revision",
                "runtime",
                "secret",
            ] {
                let mut value = service_fixture();
                value.pointer_mut(path).unwrap()[field] = "DO_NOT_ECHO".into();
                let error = parsed(&value).err().unwrap();
                assert!(!error.contains("DO_NOT_ECHO"));
            }
        }
        for (path, replacement) in [
            ("/services/0/executionHostId", serde_json::json!("missing")),
            ("/services/0/ruleIds", serde_json::json!(["missing"])),
            (
                "/services/0/control/startActionId",
                serde_json::json!("missing"),
            ),
            (
                "/services/0/control/statusProbe/actionId",
                serde_json::json!("missing"),
            ),
        ] {
            let mut value = service_fixture();
            *value.pointer_mut(path).unwrap() = replacement;
            assert!(parsed(&value).is_err());
        }
        let mut value = service_fixture();
        value["version"] = 1.into();
        assert!(parsed(&value).is_err());
        value["services"] = serde_json::Value::Null;
        assert!(parsed(&value).is_err());
        value["version"] = 2.into();
        assert!(parsed(&value).is_err());
        value = service_fixture();
        value["version"] = 99.into();
        assert!(parsed(&value).is_err());
        let mut value = service_fixture();
        let s = value["services"][0].clone();
        value["services"] = serde_json::json!([s.clone(), s]);
        assert!(parsed(&value).is_err());
        let mut value = service_fixture();
        value["services"][0]["actions"][0]["command"] = "x".repeat(65537).into();
        assert!(parsed(&value).is_err());
        let mut value = service_fixture();
        let mut services = Vec::new();
        for i in 0..257 {
            let mut s = value["services"][0].clone();
            s["id"] = format!("s-{i}").into();
            services.push(s);
        }
        value["services"] = serde_json::json!(services);
        assert!(parsed(&value).is_err());
    }
    #[test]
    fn v2_explicit_export_excludes_credentials_trust_runtime_and_unselected_services() {
        let plan = parsed(&service_fixture())
            .unwrap()
            .prepare(
                &Snapshot::default(),
                &Choices {
                    rule_ids: vec!["rule".into()],
                    service_ids: vec!["service".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        let mut snapshot = Snapshot {
            hosts: plan.hosts,
            rules: plan.rules,
            services: plan.services,
            ..Default::default()
        };
        let sid = snapshot.services[0].id.clone();
        let rid = snapshot.rules[0].id.clone();
        snapshot.services[0].execution_enabled = true;
        snapshot.services[0].revision = "REVISION_CANARY".into();
        snapshot.hosts[0]
            .identity_files
            .push("SECRET_PATH_CANARY".into());
        let mut other = snapshot.services[0].clone();
        other.id = "other".into();
        other.actions[0].command = "UNSELECTED_CANARY".into();
        snapshot.services.push(other);
        let v1 = crate::config_export::package_with_services(
            &snapshot,
            std::slice::from_ref(&rid),
            &[],
            false,
        )
        .unwrap();
        assert_eq!(v1["version"], 1);
        assert!(v1.get("services").is_none());
        assert!(!v1.to_string().contains("HEALTH_CANARY"));
        for rules in [vec![], vec![rid]] {
            let value = crate::config_export::package_with_services(
                &snapshot,
                &rules,
                std::slice::from_ref(&sid),
                false,
            )
            .unwrap();
            assert_eq!(value["version"], 2);
            let text = value.to_string();
            for canary in [
                "UNSELECTED_CANARY",
                "REVISION_CANARY",
                "SECRET_PATH_CANARY",
                "executionEnabled",
            ] {
                assert!(!text.contains(canary));
            }
            assert!(text.contains("HEALTH_CANARY"));
            let package = parsed(&value).unwrap();
            let plan = package
                .prepare(
                    &Snapshot::default(),
                    &Choices {
                        rule_ids: rules,
                        service_ids: vec![sid.clone()],
                        ..Default::default()
                    },
                )
                .unwrap();
            assert!(!plan.services[0].execution_enabled);
            assert_eq!(plan.services[0].rule_ids.len(), plan.rules.len());
        }
    }
    #[test]
    fn v2_export_limits_the_pretty_file_bytes_not_only_compact_json() {
        let plan = parsed(&service_fixture())
            .unwrap()
            .prepare(
                &Snapshot::default(),
                &Choices {
                    service_ids: vec!["service".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        let mut snapshot = Snapshot {
            hosts: plan.hosts,
            services: plan.services,
            ..Default::default()
        };
        snapshot.services[0].control = Default::default();
        let a = snapshot.services[0].actions[0].clone();
        snapshot.services[0].actions = (0..32)
            .map(|i| crate::commands::Action {
                id: format!("a-{i}"),
                command: "x".into(),
                ..a.clone()
            })
            .collect();
        let ids = vec![snapshot.services[0].id.clone()];
        let mut value =
            crate::config_export::package_with_services(&snapshot, &[], &ids, false).unwrap();
        let base = serde_json::to_vec(&value).unwrap().len();
        let length = 1 + (MAX_BYTES - base) / 32;
        assert!(length <= 65536);
        for (action, portable) in snapshot.services[0]
            .actions
            .iter_mut()
            .zip(value["services"][0]["actions"].as_array_mut().unwrap())
        {
            action.command = "x".repeat(length);
            portable["command"] = action.command.clone().into();
        }
        assert!(serde_json::to_vec(&value).unwrap().len() <= MAX_BYTES);
        assert!(serde_json::to_vec_pretty(&value).unwrap().len() > MAX_BYTES);
        assert_eq!(
            crate::config_export::package_with_services(&snapshot, &[], &ids, false).unwrap_err(),
            "servicePackageLimit"
        );
    }
}
