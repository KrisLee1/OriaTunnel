//! Read-only SSH alias discovery. Never invokes ssh -G, Match exec or ProxyCommand.
use crate::model::Host;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

#[derive(Default, Clone, PartialEq, Eq)]
pub struct Discovery {
    pub hosts: Vec<Host>,
    pub diagnostics: Vec<String>,
}
#[derive(Clone)]
struct Entry {
    key: String,
    values: Vec<String>,
    file: String,
}
fn parse_error(parsed: &mut ParseState, message: String) {
    parsed.entries.push(Entry {
        key: "parse-error".into(),
        values: vec![message],
        file: String::new(),
    });
}
#[derive(Default)]
struct ParseState {
    entries: Vec<Entry>,
    aliases: BTreeSet<String>,
    warnings: Vec<String>,
}

fn words(line: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    for ch in line.chars() {
        if let Some(q) = quote {
            if ch == q {
                quote = None
            } else {
                word.push(ch)
            }
        } else {
            match ch {
                '\'' | '"' => quote = Some(ch),
                '#' => break,
                c if c.is_whitespace() => {
                    if !word.is_empty() {
                        words.push(std::mem::take(&mut word));
                    }
                }
                _ => word.push(ch),
            }
        }
    }
    if quote.is_some() {
        return Err(crate::native_message::plain("sshUnclosedQuote"));
    }
    if !word.is_empty() {
        words.push(word)
    }
    Ok(words)
}
fn expand(path: &str, home: &Path) -> PathBuf {
    if path == "~" {
        home.into()
    } else if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        home.join(rest)
    } else {
        PathBuf::from(path)
    }
}
fn load(
    path: &Path,
    home: &Path,
    base: &Path,
    patterns: &mut Vec<String>,
    parsed: &mut ParseState,
    stack: &mut Vec<PathBuf>,
) {
    let canonical = match path.canonicalize() {
        Ok(p) => p,
        Err(e) => {
            let message = crate::native_message::message(
                "sshFileRead",
                serde_json::json!({"file":path.display().to_string(),"error":e.to_string()}),
            );
            if stack.is_empty() {
                parsed.warnings.push(message);
            } else {
                parse_error(parsed, message);
            }
            return;
        }
    };
    if stack.len() >= 16 || stack.contains(&canonical) {
        parse_error(
            parsed,
            crate::native_message::message(
                "sshIncludeCycle",
                serde_json::json!({"arg0": (path.display()).to_string()}),
            ),
        );
        return;
    }
    let text = match std::fs::read_to_string(&canonical) {
        Ok(t) => t,
        Err(e) => {
            let message = crate::native_message::message(
                "sshFileRead",
                serde_json::json!({"file":path.display().to_string(),"error":e.to_string()}),
            );
            if stack.is_empty() {
                parsed.warnings.push(message);
            } else {
                parse_error(parsed, message);
            }
            return;
        }
    };
    stack.push(canonical);
    for (line_index, line) in text.lines().enumerate() {
        let normalized = line.trim();
        // '=' is only a separator between directive and value; paths keep their '='.
        let normalized = if let Some(i) = normalized.find('=') {
            if !normalized[..i].trim().contains(char::is_whitespace) {
                format!("{} {}", &normalized[..i], &normalized[i + 1..])
            } else {
                normalized.into()
            }
        } else {
            normalized.into()
        };
        let parts = match words(&normalized) {
            Ok(p) => p,
            Err(e) => {
                parse_error(
                    parsed,
                    crate::native_message::message(
                        "sshFileLine",
                        serde_json::json!({"file":path.display().to_string(),"line":line_index+1,"error":{"message":e}}),
                    ),
                );
                continue;
            }
        };
        if parts.len() < 2 {
            if !parts.is_empty() {
                parse_error(
                    parsed,
                    crate::native_message::message(
                        "sshMissingArgument",
                        serde_json::json!({"arg0": (path.display()).to_string(),"arg1": (line_index + 1).to_string()}),
                    ),
                );
            }
            continue;
        }
        let key = parts[0].to_ascii_lowercase();
        let values = parts[1..].to_vec();
        if key == "host" {
            *patterns = values;
            for alias in patterns.iter().filter(|s| !s.contains(['*', '?', '!'])) {
                parsed.aliases.insert(alias.clone());
            }
            parsed.entries.push(Entry {
                key,
                values: patterns.clone(),
                file: format!("{}:{}", path.display(), line_index + 1),
            });
        } else if key == "include" {
            parsed.entries.push(Entry {
                key: "include-start".into(),
                values: vec![],
                file: String::new(),
            });
            for value in values {
                let p = expand(&value, home);
                let p = if p.is_absolute() { p } else { base.join(p) };
                match glob::glob(&p.to_string_lossy()) {
                    Ok(paths) => {
                        for included in paths {
                            match included {
                                Ok(p) => load(&p, home, base, patterns, parsed, stack),
                                Err(e) => parse_error(parsed, e.to_string()),
                            }
                        }
                    }
                    Err(e) => parse_error(parsed, e.to_string()),
                }
            }
            parsed.entries.push(Entry {
                key: "include-end".into(),
                values: vec![],
                file: String::new(),
            });
        } else if key == "match" {
            parsed.entries.push(Entry {
                key,
                values,
                file: format!("{}:{}", path.display(), line_index + 1),
            });
        } else {
            parsed.entries.push(Entry {
                key,
                values,
                file: format!("{}:{}", path.display(), line_index + 1),
            })
        }
    }
    stack.pop();
}
fn matches(patterns: &[String], alias: &str) -> bool {
    let mut positive = false;
    for pattern in patterns {
        let (negative, p) = pattern
            .strip_prefix('!')
            .map_or((false, pattern.as_str()), |p| (true, p));
        if glob::Pattern::new(&p.to_ascii_lowercase())
            .is_ok_and(|p| p.matches(&alias.to_ascii_lowercase()))
        {
            if negative {
                return false;
            }
            positive = true
        }
    }
    positive
}
pub fn discover_files(files: &[PathBuf], home: &Path) -> Discovery {
    let mut result = Discovery::default();
    let mut parsed = ParseState::default();
    for (index, path) in files.iter().enumerate() {
        match path.try_exists() {
            Ok(true) => {}
            Ok(false) => continue,
            Err(e) => {
                parsed.warnings.push(crate::native_message::message(
                    "sshFileRead",
                    serde_json::json!({"file":path.display().to_string(),"error":e.to_string()}),
                ));
                continue;
            }
        }
        let base = if index == 0 {
            home.join(".ssh")
        } else {
            path.parent().unwrap_or(home).into()
        };
        parsed.entries.push(Entry {
            key: "root".into(),
            values: vec![],
            file: String::new(),
        });
        load(
            path,
            home,
            &base,
            &mut vec!["*".into()],
            &mut parsed,
            &mut vec![],
        );
    }
    result.diagnostics = parsed.warnings;
    let mut global = true;
    for entry in &parsed.entries {
        match entry.key.as_str() {
            "root" => global = true,
            "host" | "match" => global = false,
            "parse-error" if global => result.diagnostics.extend(entry.values.clone()),
            _ => {}
        }
    }
    if parsed.aliases.is_empty() {
        result.diagnostics.extend(
            parsed
                .entries
                .iter()
                .filter(|e| e.key == "parse-error")
                .flat_map(|e| e.values.clone()),
        );
    }
    let mut targets: BTreeMap<String, (crate::jump_endpoint::Endpoint, bool)> = parsed
        .aliases
        .iter()
        .map(|alias| {
            (
                format!("ssh:{alias}"),
                (
                    crate::jump_endpoint::Endpoint {
                        alias: alias.clone(),
                        user: None,
                        port: None,
                    },
                    false,
                ),
            )
        })
        .collect();
    let mut processed = BTreeSet::new();
    let mut dependency_sources = BTreeMap::<String, String>::new();
    while let Some((id, (endpoint, dependency))) = targets.pop_first() {
        if !processed.insert(id.clone()) {
            continue;
        }
        let alias = endpoint.alias.clone();
        let mut values = BTreeMap::<String, String>::new();
        if let Some(user) = &endpoint.user {
            values.insert("user".into(), user.clone());
        }
        if let Some(port) = endpoint.port {
            values.insert("port".into(), port.to_string());
        }
        let mut keys = Vec::new();
        let mut diagnostics = Vec::new();
        let mut source = None;
        let mut field_sources = BTreeMap::new();
        if let Some(origin) = dependency_sources.get(&id) {
            if endpoint.user.is_some() {
                field_sources.insert("user".into(), origin.clone());
            }
            if endpoint.port.is_some() {
                field_sources.insert("port".into(), origin.clone());
            }
        }
        let mut configured_forwards = Vec::new();
        let mut unsupported_session_options = Vec::new();
        let local_user = std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_default();
        let mut needs_final = false;
        let mut declared = dependency;
        for final_pass in [false, true] {
            if final_pass && !needs_final {
                break;
            }
            let mut active = true;
            let mut skipped_include = 0;
            for entry in &parsed.entries {
                if skipped_include > 0 {
                    match entry.key.as_str() {
                        "include-start" => skipped_include += 1,
                        "include-end" => skipped_include -= 1,
                        _ => {}
                    }
                    continue;
                }
                match entry.key.as_str() {
                    "root" => {
                        active = true;
                        continue;
                    }
                    "include-start" => {
                        if !active {
                            skipped_include = 1;
                        }
                        continue;
                    }
                    "include-end" => continue,
                    "host" => {
                        active = matches(&entry.values, &alias);
                        declared |= active && entry.values.iter().any(|p| p == &alias);
                        continue;
                    }
                    "match" => {
                        let outcome = crate::ssh_conditions::evaluate(
                            &entry.values,
                            &alias,
                            &local_user,
                            &values,
                            final_pass,
                        );
                        needs_final |= outcome.final_pass;
                        active = outcome.active;
                        if outcome.unsupported {
                            diagnostics.push(crate::native_message::message(
                                "sshUnsupportedMatch",
                                serde_json::json!({"arg0": (entry.file).to_string()}),
                            ));
                        }
                        continue;
                    }
                    _ => {}
                }
                if !active {
                    continue;
                }
                if entry.key == "parse-error" {
                    diagnostics.extend(entry.values.clone());
                    continue;
                }
                source.get_or_insert(entry.file.clone());
                let value = entry.values.join(" ");
                match entry.key.as_str() {
                    "canonicalizehostname" if value == "no" => {}
                    "sendenv" => {
                        field_sources
                            .entry(entry.key.clone())
                            .or_insert(entry.file.clone());
                        if !unsupported_session_options
                            .iter()
                            .any(|name| name == "SendEnv")
                        {
                            unsupported_session_options.push("SendEnv".into());
                        }
                    }
                    "identityfile" => {
                        if keys.contains(&value) {
                            continue;
                        }
                        field_sources
                            .insert(format!("identityfile[{}]", keys.len()), entry.file.clone());
                        keys.push(value);
                    }
                    "hostname"
                    | "port"
                    | "user"
                    | "connecttimeout"
                    | "serveraliveinterval"
                    | "serveralivecountmax"
                    | "identityagent"
                    | "identitiesonly"
                    | "tag"
                    | "ciphers"
                    | "kexalgorithms"
                    | "macs"
                    | "proxyjump" => {
                        if !values.contains_key(&entry.key) {
                            field_sources.insert(entry.key.clone(), entry.file.clone());
                        }
                        values.entry(entry.key.clone()).or_insert(value);
                    }
                    "localforward" | "remoteforward" | "dynamicforward" => {
                        let forward = format!("{} {} · {}", entry.key, value, entry.file);
                        if !configured_forwards.contains(&forward) {
                            configured_forwards.push(forward);
                        }
                    } // Source information only; never import listeners implicitly.
                    _ => diagnostics.push(crate::native_message::message("sshUnsupportedDirective", serde_json::json!({"arg0": (entry.file).to_string(),"arg1": (entry.key).to_string()}))),
                }
            }
        }
        diagnostics.sort();
        diagnostics.dedup();
        if !declared {
            continue;
        }
        let address = values
            .get("hostname")
            .cloned()
            .unwrap_or(alias.clone())
            .replace("%h", &alias);
        let user = values.get("user").cloned().unwrap_or_else(|| {
            std::env::var("USERNAME")
                .or_else(|_| std::env::var("USER"))
                .unwrap_or_default()
        });
        let port = values
            .get("port")
            .map(|p| p.parse::<u16>())
            .transpose()
            .unwrap_or_else(|_| {
                diagnostics.push(crate::native_message::plain("sshPortInvalid"));
                Some(0)
            })
            .unwrap_or(22);
        if port == 0 {
            diagnostics.push(crate::native_message::plain("sshPortZero"))
        }
        let identity_files: Vec<String> = keys
            .into_iter()
            .map(|p| {
                expand(
                    &p.replace("%d", &home.to_string_lossy())
                        .replace("%h", &address)
                        .replace("%r", &user)
                        .replace("%p", &port.to_string()),
                    home,
                )
                .to_string_lossy()
                .into_owned()
            })
            .collect();
        let mut connection = crate::model::ConnectionOptions::default();
        let algorithms = crate::model::AlgorithmOptions {
            ciphers: values.get("ciphers").cloned(),
            kex_algorithms: values.get("kexalgorithms").cloned(),
            macs: values.get("macs").cloned(),
        };
        // Use the same capability check for discovery and the actual handshake.
        for (key, error) in crate::ssh_algorithms::diagnostics(&algorithms) {
            diagnostics.push(crate::native_message::message(
                "sshFileRead",
                serde_json::json!({"file":field_sources[&key],"error":{"message":error}}),
            ));
        }
        for (name, slot) in [
            ("connecttimeout", &mut connection.connect_timeout_secs),
            (
                "serveraliveinterval",
                &mut connection.keepalive_interval_secs,
            ),
        ] {
            if let Some(value) = values.get(name) {
                match value.parse() {
                    Ok(number) => *slot = number,
                    Err(_) => diagnostics.push(crate::native_message::message(
                        "sshSecondsInvalid",
                        serde_json::json!({"name": (name).to_string()}),
                    )),
                }
            }
        }
        if let Some(value) = values.get("serveralivecountmax") {
            match value.parse() {
                Ok(number) => connection.keepalive_max = number,
                Err(_) => diagnostics.push(crate::native_message::plain("sshAliveCount")),
            }
        }
        if let Err(error) = connection.validate() {
            diagnostics.push(error);
        }
        let identities_only = match values.get("identitiesonly").map(String::as_str) {
            None | Some("no") => false,
            Some("yes") => true,
            _ => {
                diagnostics.push(crate::native_message::plain("sshIdentitiesOnly"));
                false
            }
        };
        let identity_agent = values
            .get("identityagent")
            .map(|p| expand(p, home).to_string_lossy().into_owned());
        if identity_agent
            .as_ref()
            .is_some_and(|p| p.contains(['$', '%']))
        {
            diagnostics.push(crate::native_message::plain("sshIdentityAgentToken"));
        }
        let proxy_jump = values
            .get("proxyjump")
            .filter(|p| p.as_str() != "none")
            .and_then(|expression| {
                match expression
                    .split(',')
                    .map(str::trim)
                    .map(|raw| {
                        crate::jump_endpoint::parse(raw)
                            .map(|endpoint| crate::jump_endpoint::id(raw, &endpoint))
                    })
                    .collect::<Result<Vec<_>, _>>()
                {
                    Ok(ids) => {
                        for raw in expression.split(',').map(str::trim) {
                            let endpoint = crate::jump_endpoint::parse(raw).unwrap();
                            let id = crate::jump_endpoint::id(raw, &endpoint);
                            if let Some(origin) = field_sources.get("proxyjump") {
                                dependency_sources.insert(id.clone(), origin.clone());
                            }
                            if !processed.contains(&id) {
                                targets.entry(id).or_insert((endpoint, true));
                            }
                        }
                        Some(ids.join(","))
                    }
                    Err(error) => {
                        diagnostics.push(error);
                        None
                    }
                }
            });
        if !result.diagnostics.is_empty() {
            diagnostics.push(crate::native_message::plain("sshSourceBlocked"));
        }
        for value in [&address, &user].into_iter().chain(identity_files.iter()) {
            if value.contains('%') {
                diagnostics.push(crate::native_message::plain("sshUnexpandedToken"));
                break;
            }
        }
        result.hosts.push(Host {
            id: id.clone(),
            name: if endpoint.user.is_some() || endpoint.port.is_some() {
                format!("{}@{}:{}", user, alias, port)
            } else {
                alias
            },
            address,
            port,
            user,
            identity_files,
            source: "config".into(),
            source_file: source.or_else(|| dependency_sources.get(&id).cloned()),
            diagnostics,
            connection,
            algorithms,
            identities_only,
            identity_agent,
            proxy_jump,
            field_sources,
            configured_forwards,
            unsupported_session_options,
            ..Default::default()
        });
    }
    result
}
pub fn discover() -> Discovery {
    discover_with(&[])
}
pub fn discover_with(additional: &[String]) -> Discovery {
    let home = dirs::home_dir().unwrap_or_default();
    #[cfg(debug_assertions)]
    if let Some(file) = std::env::var_os("ORIATUNNEL_TEST_SSH_CONFIG") {
        return discover_files(&[file.into()], &home);
    }
    let mut files = vec![home.join(".ssh/config")];
    files.extend(additional.iter().map(|path| expand(path, &home)));
    if cfg!(windows) {
        if let Some(data) = std::env::var_os("ProgramData") {
            files.push(PathBuf::from(data).join("ssh/ssh_config"))
        }
    } else {
        files.push("/etc/ssh/ssh_config".into())
    }
    let mut discovery = discover_files(&files, &home);
    for path in additional {
        let path = expand(path, &home);
        if matches!(path.try_exists(), Ok(false)) {
            discovery.diagnostics.push(crate::native_message::message(
                "sshSourceMissing",
                serde_json::json!({"arg0": (path.display()).to_string()}),
            ));
        }
    }
    if !discovery.diagnostics.is_empty() {
        for host in &mut discovery.hosts {
            if !host
                .diagnostics
                .iter()
                .any(|d| crate::native_message::key(d).as_deref() == Some("sshSourceBlocked"))
            {
                host.diagnostics
                    .push(crate::native_message::plain("sshSourceBlocked"));
            }
        }
    }
    discovery
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_crypto_include_respects_host_overrides_and_retains_error_locations() {
        let directory = tempfile::tempdir().unwrap();
        let user = directory.path().join("config");
        let system = directory.path().join("ssh_config");
        let crypto = directory.path().join("crypto.conf");
        std::fs::write(&user, "Host fixture\n HostName 127.0.0.1\n Ciphers aes128-ctr\nHost blocked\n Ciphers unsupported-cipher\n").unwrap();
        std::fs::write(&system, "Include crypto.conf\n").unwrap();
        std::fs::write(&crypto, "Ciphers aes256-gcm@openssh.com,aes128-ctr\nKexAlgorithms curve25519-sha256,unsupported-kex\nMACs hmac-sha2-256,unsupported-mac\n").unwrap();
        let found = discover_files(&[user, system], directory.path());
        assert!(found.diagnostics.is_empty());
        let host = found.hosts.iter().find(|h| h.name == "fixture").unwrap();
        assert!(host.diagnostics.is_empty(), "{:?}", host.diagnostics);
        assert_eq!(host.algorithms.ciphers.as_deref(), Some("aes128-ctr"));
        assert_eq!(
            host.field_sources["kexalgorithms"],
            format!("{}:2", crypto.display())
        );
        let blocked = found.hosts.iter().find(|h| h.name == "blocked").unwrap();
        assert_eq!(blocked.diagnostics.len(), 1);
        assert!(blocked.diagnostics[0].contains("config:5: Ciphers:"));
        let roundtrip: Host = serde_json::from_slice(&serde_json::to_vec(host).unwrap()).unwrap();
        assert!(roundtrip.same_connection(host));
        let mut changed = roundtrip.clone();
        changed.algorithms.macs = Some("hmac-sha2-512".into());
        assert!(!roundtrip.same_connection(&changed));
        // Old saved snapshots have no policy field and retain transport defaults.
        let mut old = serde_json::to_value(host).unwrap();
        old.as_object_mut().unwrap().remove("algorithms");
        let old: Host = serde_json::from_value(old).unwrap();
        assert_eq!(old.algorithms, Default::default());
    }

    #[test]
    fn algorithm_errors_are_scoped_and_do_not_disable_unrelated_hosts() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config");
        std::fs::write(&config, "Host bad\n Ciphers aes128-ctr trailing\n KexAlgorithms -*\n MACs unsupported-mac\nHost good\n Ciphers aes128-ctr\nMatch originalhost bad\n MACs hmac-sha2-512\n").unwrap();
        let found = discover_files(&[config], directory.path());
        let good = found.hosts.iter().find(|h| h.name == "good").unwrap();
        assert!(good.diagnostics.is_empty());
        let bad = found.hosts.iter().find(|h| h.name == "bad").unwrap();
        assert_eq!(bad.diagnostics.len(), 3);
        for (index, name) in [(2, "Ciphers"), (3, "KexAlgorithms"), (4, "MACs")] {
            assert!(bad
                .diagnostics
                .iter()
                .any(|d| d.contains(&format!("config:{index}: {name}:"))));
        }
    }
    #[test]
    fn macos_default_sendenv_is_session_only_and_never_reads_environment_values() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config");
        std::fs::write(
            &config,
            "Host fixture\n HostName 127.0.0.1\n User tester\nHost *\n SendEnv LANG LC_*\n",
        )
        .unwrap();
        let discovery = discover_files(&[config], directory.path());
        let host = &discovery.hosts[0];
        assert!(host.diagnostics.is_empty());
        assert_eq!(host.unsupported_session_options, ["SendEnv"]);
        assert!(host.field_sources.contains_key("sendenv"));
        assert!(!serde_json::to_string(host).unwrap().contains("LC_*"));
    }
    #[test]
    fn inline_and_uri_jumps_apply_per_hop_overrides_before_match_without_target_inheritance() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("config");
        std::fs::write(&root,"Host target\n User target-user\n ProxyJump custom@hop:2200,ssh://other@[::1]:2201\nHost hop\n HostName 127.0.0.1\n User base-user\n Port 22\nMatch originalhost hop user custom\n ServerAliveInterval 31\nHost *\n ConnectTimeout 28\n").unwrap();
        let d = discover_files(&[root], dir.path());
        let target = d.hosts.iter().find(|h| h.name == "target").unwrap();
        assert!(target.diagnostics.is_empty());
        let route = crate::model::resolve_jumps(&d.hosts, target).unwrap();
        assert_eq!(route.len(), 2);
        assert_eq!(route[0].user, "custom");
        assert_eq!(route[0].port, 2200);
        assert_eq!(route[0].address, "127.0.0.1");
        assert_eq!(route[0].connection.keepalive_interval_secs, 31);
        assert_eq!(route[1].user, "other");
        assert_eq!(route[1].port, 2201);
        assert_eq!(route[1].address, "::1");
        assert_eq!(route[1].connection.connect_timeout_secs, 28);
        assert!(route.iter().all(|h| h.diagnostics.is_empty()));
        let original = d.hosts.iter().find(|h| h.id == "ssh:hop").unwrap();
        assert_eq!(original.user, "base-user");
        assert_eq!(original.port, 22);
    }
    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn controlled_static_match_fixture_agrees_with_openssh_without_execution_or_network() {
        // This exact generated fixture contains no exec, ProxyCommand, LocalCommand,
        // canonicalization, or source inclusion. Never run -G on a user config.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("config");
        let text="Host service\n HostName actual.internal\n User deploy\nMatch originalhost service host actual.* user deploy\n Port 2222\nMatch final originalhost service\n ServerAliveInterval 17\nMatch all\n ConnectTimeout 24\n";
        std::fs::write(&root, text).unwrap();
        #[cfg(windows)]
        let exe = std::path::PathBuf::from(std::env::var_os("WINDIR").unwrap())
            .join("System32/OpenSSH/ssh.exe");
        #[cfg(target_os = "macos")]
        let exe = std::path::PathBuf::from("/usr/bin/ssh");
        let output = std::process::Command::new(exe)
            .args(["-G", "-F"])
            .arg(&root)
            .arg("service")
            .output()
            .unwrap();
        assert!(output.status.success());
        let output = String::from_utf8(output.stdout).unwrap();
        let fields = output
            .lines()
            .filter_map(|line| line.split_once(' '))
            .collect::<BTreeMap<_, _>>();
        let d = discover_files(&[root], dir.path());
        let host = &d.hosts[0];
        assert!(host.diagnostics.is_empty());
        assert_eq!(host.address, fields["hostname"]);
        assert_eq!(host.user, fields["user"]);
        assert_eq!(host.port.to_string(), fields["port"]);
        assert_eq!(
            host.connection.keepalive_interval_secs.to_string(),
            fields["serveraliveinterval"]
        );
        assert_eq!(
            host.connection.connect_timeout_secs.to_string(),
            fields["connecttimeout"]
        );
    }
    #[test]
    fn static_match_final_conditional_include_and_unsupported_exec_are_scoped() {
        let dir = tempfile::tempdir().unwrap();
        let ssh = dir.path().join(".ssh");
        std::fs::create_dir(&ssh).unwrap();
        let root = ssh.join("config");
        std::fs::write(
            ssh.join("special"),
            "Port 2222\nUser deploy\nIdentityFile ~/key\n",
        )
        .unwrap();
        std::fs::write(
            ssh.join("inactive"),
            "ProxyCommand never-run\nHost hidden-candidate\n Include inactive\n",
        )
        .unwrap();
        std::fs::write(&root,"Host service\n HostName actual.internal\nMatch originalhost service host actual.*\n Include special\nMatch originalhost other\n Include inactive\nMatch originalhost danger exec \"never-execute-command\"\n User forbidden\nHost other\n HostName 127.0.0.2\nHost danger\n HostName 127.0.0.3\nMatch final originalhost service user deploy\n ServerAliveInterval 17\nMatch all\n ConnectTimeout 24\n").unwrap();
        let discovered = discover_files(&[root], dir.path());
        let service = discovered
            .hosts
            .iter()
            .find(|h| h.name == "service")
            .unwrap();
        assert_eq!(service.port, 2222);
        assert_eq!(service.user, "deploy");
        assert_eq!(service.connection.keepalive_interval_secs, 17);
        assert_eq!(service.identity_files.len(), 1);
        assert!(service.diagnostics.is_empty());
        let danger = discovered
            .hosts
            .iter()
            .find(|h| h.name == "danger")
            .unwrap();
        assert!(danger.diagnostics.iter().any(|d| d.contains("Match")));
        assert_eq!(service.connection.connect_timeout_secs, 24);
        assert!(!discovered
            .hosts
            .iter()
            .any(|h| h.name == "hidden-candidate"));
        let other = discovered.hosts.iter().find(|h| h.name == "other").unwrap();
        assert_eq!(other.port, 22);
        assert!(!other.diagnostics.is_empty());
    }
    #[test]
    fn comma_proxy_jump_retains_order_and_distinct_route_references() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("config");
        std::fs::write(&root,"Host first second target\n User tester\nHost second\n ProxyJump first\nHost target\n ProxyJump first,second\n").unwrap();
        let d = discover_files(&[root], dir.path());
        let target = d.hosts.iter().find(|h| h.name == "target").unwrap();
        assert!(target.diagnostics.is_empty());
        assert_eq!(target.proxy_jump.as_deref(), Some("ssh:first,ssh:second"));
        assert_eq!(
            crate::model::resolve_jumps(&d.hosts, target)
                .unwrap()
                .iter()
                .map(|h| h.name.as_str())
                .collect::<Vec<_>>(),
            ["first", "second"]
        );
    }
    #[test]
    fn connection_options_provenance_glob_updates_and_nonexecuting_diagnostics() {
        let dir = tempfile::tempdir().unwrap();
        let ssh = dir.path().join(".ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        let root = ssh.join("config");
        std::fs::write(&root,"Include *.conf\nHost jump\n HostName 127.0.0.1\nHost service\n HostName 127.0.0.2\n ProxyJump jump\n ConnectTimeout 30\n ServerAliveInterval 0\n ServerAliveCountMax 5\n IdentityAgent none\n IdentitiesOnly yes\n IdentityFile ~/first\n IdentityFile ~/second\n LocalForward 1234 localhost:80\nHost * !excluded\n User inherited\n Port 2222\nHost excluded\n User explicit\n").unwrap();
        let first = discover_files(std::slice::from_ref(&root), dir.path());
        let service = first.hosts.iter().find(|h| h.name == "service").unwrap();
        assert_eq!(service.user, "inherited");
        assert_eq!(service.connection.connect_timeout_secs, 30);
        assert_eq!(service.connection.keepalive_interval_secs, 0);
        assert_eq!(service.connection.keepalive_max, 5);
        assert_eq!(service.proxy_jump.as_deref(), Some("ssh:jump"));
        assert_eq!(service.identity_agent.as_deref(), Some("none"));
        assert!(service.identities_only);
        assert_eq!(service.identity_files.len(), 2);
        assert!(service.field_sources["connecttimeout"].contains("config:"));
        assert_eq!(service.configured_forwards.len(), 1);
        assert!(service.diagnostics.is_empty());
        let sentinel = dir.path().join("MUST_NOT_EXIST");
        std::fs::write(
            ssh.join("added.conf"),
            format!("Host added\n ProxyCommand write {}\n", sentinel.display()),
        )
        .unwrap();
        let next = discover_files(std::slice::from_ref(&root), dir.path());
        assert_eq!(next.hosts.len(), first.hosts.len() + 1);
        assert!(next
            .hosts
            .iter()
            .find(|h| h.name == "added")
            .unwrap()
            .diagnostics
            .iter()
            .any(|d| d.contains("proxycommand")));
        assert!(!sentinel.exists());
    }
    #[test]
    fn aliases_include_order_identity_and_unsafe_options() {
        let dir = tempfile::tempdir().unwrap();
        let ssh = dir.path().join(".ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        std::fs::write(ssh.join("config"),"Include hosts\nHost prod duplicate\n User deploy\n IdentityFile \"~/key with spaces\"\nHost *\n User fallback\n Port 2222\nHost unsafe\n ProxyCommand echo unsafe\n").unwrap();
        std::fs::write(
            ssh.join("hosts"),
            "Host prod\n HostName 127.0.0.1\n User first\n",
        )
        .unwrap();
        let d = discover_files(&[ssh.join("config")], dir.path());
        let prod = d.hosts.iter().find(|h| h.name == "prod").unwrap();
        assert_eq!(prod.user, "first");
        assert_eq!(prod.address, "127.0.0.1");
        assert_eq!(prod.port, 2222);
        assert!(prod.identity_files[0].ends_with("key with spaces"));
        assert_eq!(d.hosts.len(), 3);
        assert!(!d
            .hosts
            .iter()
            .find(|h| h.name == "unsafe")
            .unwrap()
            .diagnostics
            .is_empty());
    }
    #[test]
    fn include_loop_is_diagnostic() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config");
        std::fs::write(&p, format!("Include {}\nHost okay\n User a", p.display())).unwrap();
        assert!(!discover_files(&[p], d.path()).diagnostics.is_empty());
    }
}
