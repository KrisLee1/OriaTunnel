use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum RuleIcon {
    Builtin(String),
    Emoji(String),
}
impl RuleIcon {
    pub fn validate(&self) -> Result<(), String> {
        let valid = match self {
            Self::Builtin(value) => {
                static CATALOG: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
                let catalog = CATALOG.get_or_init(|| serde_json::from_str(include_str!(
                    "../../src/features/tunnels/connection-icon-catalog.json"
                )).expect("embedded icon catalog"));
                catalog["icons"].as_array().is_some_and(|icons|
                    icons.iter().any(|icon| icon["id"].as_str() == Some(value.as_str())))
            }
            Self::Emoji(value) => {
                !value.is_empty() && value.chars().count() <= 16 &&
                value.graphemes(true).count() == 1 &&
                !value.chars().any(|c| c.is_control() || c.is_whitespace() ||
                    matches!(c, '\u{00ad}' | '\u{061c}' | '\u{180e}' | '\u{200b}' | '\u{200c}' |
                        '\u{200e}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{206f}' |
                        '\u{feff}' | '\u{fff9}'..='\u{fffb}' | '\u{e0001}')) &&
                value.chars().any(|c| c != '\u{200d}' && !(0xe0020..=0xe007f).contains(&(c as u32)) &&
                    !(0xfe00..=0xfe0f).contains(&(c as u32)))
            }
        };
        if valid {
            Ok(())
        } else {
            Err(crate::native_message::plain("iconInvalid"))
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub user: String,
    pub identity_files: Vec<String>,
    pub source: String,
    pub source_file: Option<String>,
    pub diagnostics: Vec<String>,
    pub connection: ConnectionOptions,
    pub auth_method: AuthMethod,
    pub tags: Vec<String>,
    pub hidden: bool,
    pub identity_agent: Option<String>,
    pub identities_only: bool,
    pub proxy_jump: Option<String>,
    #[serde(default)]
    pub algorithms: AlgorithmOptions,
    pub field_sources: std::collections::BTreeMap<String, String>,
    pub configured_forwards: Vec<String>,
    /// Session-only source options do not affect -N forwarding. Commands must not
    /// silently omit them; only directive names are retained, never environment values.
    #[serde(default)]
    pub unsupported_session_options: Vec<String>,
}
impl Host {
    pub fn same_connection(&self, other: &Self) -> bool {
        self.address == other.address
            && self.port == other.port
            && self.user == other.user
            && self.identity_files == other.identity_files
            && self.auth_method == other.auth_method
            && self.connection == other.connection
            && self.identity_agent == other.identity_agent
            && self.identities_only == other.identities_only
            && self.proxy_jump == other.proxy_jump
            && self.algorithms == other.algorithms
            && self.diagnostics == other.diagnostics
            && self.unsupported_session_options == other.unsupported_session_options
    }
}
/// Source expressions are retained so copying/exporting a host preserves its policy.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlgorithmOptions {
    pub ciphers: Option<String>,
    pub kex_algorithms: Option<String>,
    pub macs: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    #[default]
    Auto,
    Password,
    PrivateKey,
    Agent,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionOptions {
    pub connect_timeout_secs: u64,
    pub keepalive_interval_secs: u64,
    pub keepalive_max: usize,
}
impl Default for ConnectionOptions {
    fn default() -> Self {
        Self {
            connect_timeout_secs: 15,
            keepalive_interval_secs: 15,
            keepalive_max: 3,
        }
    }
}
impl ConnectionOptions {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=600).contains(&self.connect_timeout_secs)
            || self.keepalive_interval_secs > 3600
            || !(1..=100).contains(&self.keepalive_max)
        {
            return Err(crate::native_message::plain("connectionOptions"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, Copy)]
pub enum ForwardKind {
    #[default]
    L,
    R,
    D,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceProtocol {
    Http,
    Https,
    Vnc,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    #[serde(default)]
    pub icon: Option<RuleIcon>,
    #[serde(default)]
    pub service_protocol: Option<ServiceProtocol>,
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub host_id: String,
    pub bind_address: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub kind: ForwardKind,
    pub connection: Option<ConnectionOptions>,
    pub no_remote_command: bool,
    pub remote_command: String,
    // Retained in the current transport format; tray hiding always keeps forwards running.
    pub background: bool,
    pub reconnect: ReconnectPolicy,
    pub auto_connect: bool,
    pub repeat_command_on_reconnect: bool,
}
impl Default for Rule {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            host_id: String::new(),
            color: None,
            icon: None,
            service_protocol: None,
            bind_address: "127.0.0.1".into(),
            bind_port: 0,
            target_host: String::new(),
            target_port: 0,
            kind: ForwardKind::L,
            connection: None,
            no_remote_command: true,
            remote_command: String::new(),
            background: true,
            reconnect: Default::default(),
            auto_connect: false,
            repeat_command_on_reconnect: false,
        }
    }
}
impl Rule {
    pub fn same_connection(&self, other: &Self) -> bool {
        let mut before = self.clone();
        let mut after = other.clone();
        before.name.clear();
        after.name.clear();
        before.service_protocol = None;
        after.service_protocol = None;
        before.color = None;
        after.color = None;
        before.icon = None;
        after.icon = None;
        before.background = true;
        after.background = true;
        before.auto_connect = false;
        after.auto_connect = false;
        before == after
    }
    pub fn validate(&self) -> Result<(), String> {
        self.reconnect.validate()?;
        if let Some(icon) = &self.icon {
            icon.validate()?;
        }
        if let Some(color) = &self.color {
            if color.len() != 7
                || !color.starts_with('#')
                || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return Err(crate::native_message::plain("colorInvalid"));
            }
        }
        if self.bind_port == 0
            || self.name.trim().is_empty()
            || self.host_id.is_empty()
            || (self.kind != ForwardKind::D
                && (self.target_port == 0 || self.target_host.trim().is_empty()))
        {
            return Err(crate::native_message::plain("ruleFields"));
        }
        if self.bind_address.trim().is_empty() || self.bind_address.contains(['\0', '\n', '\r']) {
            return Err(crate::native_message::plain("listenerInvalid"));
        }
        if self.kind == ForwardKind::D && !matches!(self.bind_address.as_str(), "127.0.0.1" | "::1")
        {
            return Err(crate::native_message::plain("socksLoopback"));
        }
        if !self.no_remote_command && self.remote_command.trim().is_empty() {
            return Err(crate::native_message::plain("commandRequired"));
        }
        if let Some(connection) = &self.connection {
            connection.validate()?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub rule_id: String,
    pub run_id: String,
    pub status: String,
    pub message: String,
    pub fingerprint: Option<String>,
    pub sent: u64,
    pub received: u64,
    pub connections: usize,
    pub host_snapshot: Option<Host>,
    pub configuration_changed: bool,
    pub verification_endpoint: Option<String>,
    pub jump_snapshots: Vec<Host>,
    #[serde(default)]
    pub error_kind: Option<FailureKind>,
    #[serde(default)]
    pub desired_running: bool,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default)]
    pub retry_at: Option<u64>,
    #[serde(default)]
    pub uptime_secs: u64,
    #[serde(default)]
    pub sent_per_second: Option<u64>,
    #[serde(default)]
    pub received_per_second: Option<u64>,
    #[serde(default)]
    pub target_health: TargetHealth,
    #[serde(default)]
    pub history: Vec<MetricPoint>,
    #[serde(default)]
    pub auth_method_used: Option<AuthMethod>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectPolicy {
    pub enabled: bool,
    pub max_attempts: u32,
    pub initial_delay_secs: u64,
    pub max_delay_secs: u64,
}
impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            max_attempts: 8,
            initial_delay_secs: 2,
            max_delay_secs: 60,
        }
    }
}
impl ReconnectPolicy {
    pub fn validate(&self) -> Result<(), String> {
        if self.max_attempts > 100
            || !(1..=3600).contains(&self.initial_delay_secs)
            || self.max_delay_secs < self.initial_delay_secs
            || self.max_delay_secs > 3600
        {
            return Err(crate::native_message::plain("reconnectOptions"));
        }
        Ok(())
    }
    pub fn delay(&self, attempt: u32) -> std::time::Duration {
        std::time::Duration::from_secs(
            self.initial_delay_secs
                .saturating_mul(1u64 << attempt.saturating_sub(1).min(32))
                .min(self.max_delay_secs),
        )
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FailureKind {
    Network,
    Dns,
    Timeout,
    Authentication,
    HostKey,
    Bind,
    ForwardDenied,
    Configuration,
    RemoteCommand,
}
impl FailureKind {
    pub fn retryable(self) -> bool {
        matches!(self, Self::Network | Self::Dns | Self::Timeout)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TargetHealth {
    pub state: Option<String>,
    pub checked_at: Option<u64>,
    pub side: Option<String>,
    pub method: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricPoint {
    pub timestamp: u64,
    pub sent_per_second: u64,
    pub received_per_second: u64,
}
pub fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
pub fn resolve_jumps(hosts: &[Host], target: &Host) -> Result<Vec<Host>, String> {
    let mut route = Vec::new();
    let mut seen = std::collections::BTreeSet::from([target.id.clone()]);
    fn append(
        hosts: &[Host],
        target: &Host,
        route: &mut Vec<Host>,
        seen: &mut std::collections::BTreeSet<String>,
    ) -> Result<(), String> {
        let Some(expression) = &target.proxy_jump else {
            return Ok(());
        };
        for (index, id) in expression.split(',').enumerate() {
            if seen.len() >= 9 {
                return Err(crate::native_message::plain("jumpTooLong"));
            }
            let id = id.trim();
            if id.is_empty() {
                return Err(crate::native_message::plain("jumpEmpty"));
            }
            if !seen.insert(id.to_string()) {
                return Err(crate::native_message::plain("jumpCycle"));
            }
            let host = hosts.iter().find(|h| h.id == id).ok_or_else(|| {
                crate::native_message::message(
                    "jumpSourceMissing",
                    serde_json::json!({"id": (id).to_string()}),
                )
            })?;
            if !host.diagnostics.is_empty() {
                return Err(crate::native_message::message(
                    "jumpNeedsAttention",
                    serde_json::json!({"arg0": (host.name).to_string(),"arg1": {"message":crate::native_message::combine(&host.diagnostics,"；")}}),
                ));
            }
            // An explicit comma route supplies the transport for later hops; only the
            // first jump may require its own preceding route.
            if index == 0 {
                append(hosts, host, route, seen)?;
            }
            if route.len() >= 8 {
                return Err(crate::native_message::plain("jumpTooLong"));
            }
            route.push(host.clone());
        }
        Ok(())
    }
    append(hosts, target, &mut route, &mut seen)?;
    Ok(route)
}
pub fn rule_uses_host(rule: &Rule, hosts: &[Host], id: &str) -> bool {
    if rule.host_id == id {
        return true;
    }
    // Keep complete profile dependencies portable and protected, including a hop's
    // own route which an explicit later-hop transport may currently override.
    let mut next = vec![rule.host_id.as_str()];
    let mut seen = std::collections::BTreeSet::new();
    while let Some(current) = next.pop() {
        if current == id {
            return true;
        }
        if !seen.insert(current) {
            continue;
        }
        if let Some(expression) = hosts
            .iter()
            .find(|h| h.id == current)
            .and_then(|h| h.proxy_jump.as_deref())
        {
            next.extend(expression.split(',').map(str::trim));
        }
    }
    false
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub services: Vec<crate::commands::Service>,
    pub hosts: Vec<Host>,
    pub rules: Vec<Rule>,
    pub trusted_keys: std::collections::BTreeMap<String, String>,
    pub host_snapshots: std::collections::BTreeMap<String, Host>,
    pub hidden_hosts: Vec<String>,
    pub close_to_tray: bool,
    pub host_metadata: std::collections::BTreeMap<String, HostMetadata>,
    pub source_files: Vec<String>,
    pub auto_sync_hosts: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct HostMetadata {
    pub name: String,
    pub tags: Vec<String>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            services: Vec::new(),
            hosts: Vec::new(),
            rules: Vec::new(),
            trusted_keys: Default::default(),
            host_snapshots: Default::default(),
            hidden_hosts: Vec::new(),
            close_to_tray: true,
            host_metadata: Default::default(),
            source_files: Vec::new(),
            auto_sync_hosts: true,
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub services: Vec<crate::commands::Service>,
    pub hosts: Vec<Host>,
    pub added_host_ids: Vec<String>,
    pub rules: Vec<Rule>,
    pub runtimes: Vec<Runtime>,
    pub diagnostics: Vec<String>,
    pub revision: u64,
    pub close_to_tray: bool,
    pub agent_supported: bool,
    pub source_files: Vec<String>,
    pub auto_sync_hosts: bool,
    pub activity: Vec<crate::activity::Record>,
    pub undo_count: usize,
    pub autostart: bool,
    pub autostart_supported: bool,
    pub autostart_error: Option<String>,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn current_config_round_trip_retains_connection_and_rule_defaults() {
        let config = Config {
            rules: vec![Rule {
                id: "r".into(),
                name: "forward".into(),
                host_id: "h".into(),
                bind_port: 1234,
                target_host: "localhost".into(),
                target_port: 22,
                ..Default::default()
            }],
            ..Default::default()
        };
        let c: Config = serde_json::from_slice(&serde_json::to_vec(&config).unwrap()).unwrap();
        let rule = &c.rules[0];
        assert_eq!(rule.kind, ForwardKind::L);
        assert!(rule.no_remote_command);
        assert!(rule.background);
        assert!(!rule.auto_connect);
        assert!(rule.connection.is_none());
        assert!(c.close_to_tray);
        assert!(rule.validate().is_ok());
    }
    #[test]
    fn service_protocol_is_optional_persisted_metadata() {
        let rule = Rule::default();
        assert!(rule.service_protocol.is_none());
        for protocol in [
            ServiceProtocol::Http,
            ServiceProtocol::Https,
            ServiceProtocol::Vnc,
        ] {
            let selected = Rule {
                service_protocol: Some(protocol),
                ..rule.clone()
            };
            assert!(rule.same_connection(&selected));
            let mut value = serde_json::to_value(&selected).unwrap();
            let reloaded: Rule = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(reloaded.service_protocol, Some(protocol));
            value.as_object_mut().unwrap().remove("serviceProtocol");
            assert!(serde_json::from_value::<Rule>(value.clone())
                .unwrap()
                .service_protocol
                .is_none());
            value["serviceProtocol"] = "javascript".into();
            assert!(serde_json::from_value::<Rule>(value).is_err());
        }
    }
    #[test]
    fn icons_are_validated_persisted_and_do_not_change_transport() {
        let rule = Rule {
            name: "icon fixture".into(),
            host_id: "h".into(),
            bind_port: 15432,
            target_host: "localhost".into(),
            target_port: 5432,
            ..Default::default()
        };
        let catalog: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/features/tunnels/connection-icon-catalog.json"
        ))
        .unwrap();
        let icons = catalog["icons"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| RuleIcon::Builtin(item["id"].as_str().unwrap().into()))
            .chain(
                catalog["emojis"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|item| RuleIcon::Emoji(item["value"].as_str().unwrap().into())),
            )
            .chain([
                RuleIcon::Emoji("👩🏽‍💻".into()),
                RuleIcon::Emoji("🇨🇳".into()),
                RuleIcon::Emoji("★".into()),
            ]);
        for icon in icons {
            let selected = Rule {
                icon: Some(icon),
                ..rule.clone()
            };
            assert!(selected.validate().is_ok(), "{:?}", selected.icon);
            assert!(rule.same_connection(&selected));
            let reloaded: Rule =
                serde_json::from_value(serde_json::to_value(&selected).unwrap()).unwrap();
            assert_eq!(reloaded.icon, selected.icon);
        }
        for icon in [
            RuleIcon::Builtin("unknown".into()),
            RuleIcon::Emoji("".into()),
            RuleIcon::Emoji("🚀🚀".into()),
            RuleIcon::Emoji("\n".into()),
            RuleIcon::Emoji("\u{202e}".into()),
            RuleIcon::Emoji("\u{200d}".into()),
            RuleIcon::Emoji("https://example.invalid/icon.svg".into()),
        ] {
            assert!(Rule {
                icon: Some(icon),
                ..rule.clone()
            }
            .validate()
            .is_err());
        }
        let mut old = serde_json::to_value(&rule).unwrap();
        old.as_object_mut().unwrap().remove("icon");
        assert!(serde_json::from_value::<Rule>(old).unwrap().icon.is_none());
    }
    #[test]
    fn connection_color_is_validated_persisted_and_does_not_change_transport() {
        let rule = Rule {
            name: "color fixture".into(),
            host_id: "h".into(),
            bind_port: 15432,
            target_host: "localhost".into(),
            target_port: 5432,
            ..Default::default()
        };
        let mut colored = rule.clone();
        colored.color = Some("#7C3aed".into());
        assert!(colored.validate().is_ok());
        assert!(rule.same_connection(&colored));
        let reloaded: Rule =
            serde_json::from_slice(&serde_json::to_vec(&colored).unwrap()).unwrap();
        assert_eq!(reloaded.color, colored.color);
        for invalid in ["red", "#123", "#12345g", "#12345678", "url(secret)"] {
            colored.color = Some(invalid.into());
            assert!(colored.validate().is_err());
        }
    }
    #[test]
    fn socks_is_loopback_only_and_has_no_required_fixed_target() {
        let mut rule = Rule {
            name: "proxy".into(),
            host_id: "h".into(),
            bind_port: 1080,
            kind: ForwardKind::D,
            ..Default::default()
        };
        assert!(rule.validate().is_ok());
        rule.bind_address = "0.0.0.0".into();
        assert!(rule.validate().is_err());
        rule.kind = ForwardKind::R;
        rule.target_host = "::1".into();
        rule.target_port = 8080;
        assert!(rule.validate().is_ok());
        rule.no_remote_command = false;
        assert!(rule.validate().is_err());
    }
    #[test]
    fn jumps_are_ordered_and_cycles_missing_or_unsupported_hops_are_refused() {
        let a = Host {
            id: "a".into(),
            ..Default::default()
        };
        let mut b = Host {
            id: "b".into(),
            proxy_jump: Some("a".into()),
            ..Default::default()
        };
        let c = Host {
            id: "c".into(),
            proxy_jump: Some("b".into()),
            ..Default::default()
        };
        let route = resolve_jumps(&[a.clone(), b.clone()], &c).unwrap();
        assert_eq!(
            route.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert!(resolve_jumps(std::slice::from_ref(&a), &c).is_err());
        b.proxy_jump = Some("c".into());
        assert!(resolve_jumps(&[a.clone(), b.clone(), c.clone()], &c).is_err());
        b.proxy_jump = None;
        b.diagnostics.push("unsupported".into());
        assert!(resolve_jumps(&[a, b], &c).is_err());
    }
    #[test]
    fn explicit_ordered_route_supplies_later_hops_transport_and_protects_dependencies() {
        let a = Host {
            id: "a".into(),
            ..Default::default()
        };
        let b = Host {
            id: "b".into(),
            proxy_jump: Some("a".into()),
            ..Default::default()
        };
        let mut target = Host {
            id: "target".into(),
            proxy_jump: Some("a,b".into()),
            ..Default::default()
        };
        let hosts = vec![a, b, target.clone()];
        assert_eq!(
            resolve_jumps(&hosts, &target)
                .unwrap()
                .iter()
                .map(|h| h.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        let rule = Rule {
            host_id: "target".into(),
            ..Default::default()
        };
        assert!(rule_uses_host(&rule, &hosts, "a"));
        assert!(rule_uses_host(&rule, &hosts, "b"));
        target.proxy_jump = Some("a,a".into());
        assert!(resolve_jumps(&hosts, &target).is_err());
        target.proxy_jump = Some("a,".into());
        assert!(resolve_jumps(&hosts, &target).is_err());
    }
}
