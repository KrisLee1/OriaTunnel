//! Export a portable allowlist, never the internal config/trust/runtime document.
use crate::model::{rule_uses_host, Snapshot};
use serde_json::{json, Value};
pub fn package(
    snapshot: &Snapshot,
    ids: &[String],
    include_key_paths: bool,
) -> Result<Value, String> {
    if ids.is_empty() {
        return Err("请选择要导出的规则".into());
    }
    let rules: Vec<_> = ids
        .iter()
        .map(|id| {
            snapshot
                .rules
                .iter()
                .find(|r| &r.id == id)
                .ok_or("部分规则已不存在")
        })
        .collect::<Result<_, _>>()?;
    let hosts:Vec<_>=snapshot.hosts.iter().filter(|h|rules.iter().any(|r|rule_uses_host(r,&snapshot.hosts,&h.id))).map(|h|json!({
        "id":h.id,"name":h.name,"address":h.address,"port":h.port,"user":h.user,"authMethod":h.auth_method,
        "tags":h.tags,"connection":h.connection,"proxyJump":h.proxy_jump,"identitiesOnly":h.identities_only,
        "algorithms":h.algorithms,
        "identityFiles":if include_key_paths {h.identity_files.clone()}else {Vec::new()},
        "identityFilesOmitted":!include_key_paths&&!h.identity_files.is_empty(),
        "connectionBlocked":!h.diagnostics.is_empty(),
    })).collect();
    let rules:Vec<_>=rules.iter().map(|r|json!({
        "id":r.id,"name":r.name,"color":r.color,"icon":r.icon,"serviceProtocol":r.service_protocol,"hostId":r.host_id,"kind":r.kind,"bindAddress":r.bind_address,"bindPort":r.bind_port,
        "targetHost":r.target_host,"targetPort":r.target_port,"connection":r.connection,"background":r.background,
        "reconnect":r.reconnect,"noRemoteCommand":r.no_remote_command,"remoteCommandOmitted":!r.no_remote_command,
        "autoConnect":false,"repeatCommandOnReconnect":false,
    })).collect();
    Ok(
        json!({"format":"oria-tunnel","version":1,"hosts":hosts,"rules":rules,"credentialsIncluded":false,"runtimeIncluded":false}),
    )
}
pub fn write(path: &std::path::Path, value: &Value) -> Result<(), String> {
    let temp = path.with_file_name(format!(".oria-export-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        f.write_all(&serde_json::to_vec_pretty(value)?)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&temp, path)
    })()
    .map_err(|_: std::io::Error| "配置导出未完成，原文件保持不变".to_string());
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    #[test]
    fn allowlist_omits_commands_trust_sources_and_secrets_and_retains_route() {
        let jump = Host {
            id: "jump".into(),
            name: "jump".into(),
            ..Default::default()
        };
        let host = Host {
            id: "target".into(),
            name: "target".into(),
            proxy_jump: Some("jump".into()),
            identity_files: vec!["CANARY_PATH".into()],
            configured_forwards: vec!["CANARY_CONFIG".into()],
            source_file: Some("CANARY_SOURCE".into()),
            ..Default::default()
        };
        let rule = Rule {
            id: "rule".into(),
            host_id: "target".into(),
            remote_command: "CANARY_PASSWORD".into(),
            no_remote_command: false,
            auto_connect: true,
            ..Default::default()
        };
        let s = Snapshot {
            hosts: vec![
                jump,
                host,
                Host {
                    id: "unrelated".into(),
                    ..Default::default()
                },
            ],
            rules: vec![rule],
            ..Default::default()
        };
        let value = package(&s, &["rule".into()], false).unwrap();
        let text = value.to_string();
        assert!(!text.contains("CANARY"));
        assert!(!text.contains("unrelated"));
        assert_eq!(value["hosts"].as_array().unwrap().len(), 2);
        assert_eq!(value["rules"][0]["autoConnect"], false);
        assert_eq!(value["rules"][0]["remoteCommandOmitted"], true);
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("export.json");
        write(&file, &value).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&file).unwrap()).unwrap(),
            value
        );
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            std::fs::write(&file, b"existing-export").unwrap();
            let locked = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(&file)
                .unwrap();
            assert!(write(&file, &value).is_err());
            drop(locked);
            assert_eq!(std::fs::read(&file).unwrap(), b"existing-export");
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        }
        assert!(package(&s, &["missing".into()], false).is_err());
    }
}
