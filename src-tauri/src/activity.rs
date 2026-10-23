//! Whitelisted lifecycle records only: never serialize Runtime, Host, commands or errors.
use crate::model::{timestamp, FailureKind, Runtime};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, VecDeque},
    io::Write,
    path::{Path, PathBuf},
};
const LIMIT: u64 = 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Event {
    Connecting,
    Authenticating,
    Binding,
    Listening,
    VerifyingHost,
    Reconnecting,
    Stopped,
    Failed,
    Tested,
    NeedsAttention,
    TargetReachable,
    TargetUnreachable,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub timestamp: u64,
    pub rule_id: String,
    pub run_id: String,
    pub event: Event,
    pub error_kind: Option<FailureKind>,
    pub retry_count: u32,
    pub level: String,
}
pub struct Activity {
    directory: PathBuf,
    records: VecDeque<Record>,
    seen: BTreeMap<String, (String, Option<String>, u32)>,
    pub write_failed: bool,
}
impl Activity {
    pub fn open(directory: PathBuf) -> Self {
        let mut records = VecDeque::new();
        // Bound reads as well as writes; a malformed log is ignored, never executed.
        for index in (0..=2).rev() {
            let path = Self::file(&directory, index);
            if std::fs::metadata(&path).is_ok_and(|m| m.len() <= LIMIT + 8192) {
                if let Ok(contents) = std::fs::read_to_string(path) {
                    for line in contents.lines() {
                        if let Ok(record) = serde_json::from_str::<Record>(line) {
                            if record.timestamp == 0 || record.timestamp > 8_640_000_000_000_000 {
                                continue;
                            }
                            records.push_back(record);
                            if records.len() > 1000 {
                                records.pop_front();
                            }
                        }
                    }
                }
            }
        }
        Self {
            directory,
            records,
            seen: BTreeMap::new(),
            write_failed: false,
        }
    }
    fn file(directory: &Path, index: usize) -> PathBuf {
        directory.join(format!("activity-{index}.jsonl"))
    }
    pub fn records(&self) -> Vec<Record> {
        self.records.iter().cloned().collect()
    }
    pub fn observe(&mut self, r: &Runtime) {
        let status = match r.status.as_str() {
            "connecting" => Event::Connecting,
            "authenticating" => Event::Authenticating,
            "binding" => Event::Binding,
            "listening" => Event::Listening,
            "verifying-host" => Event::VerifyingHost,
            "reconnecting" => Event::Reconnecting,
            "stopped" => Event::Stopped,
            "failed" => Event::Failed,
            "tested" => Event::Tested,
            "needs-attention" => Event::NeedsAttention,
            _ => return,
        };
        let key = (
            r.status.clone(),
            r.target_health.state.clone(),
            r.retry_count,
        );
        let old = self.seen.insert(r.rule_id.clone(), key.clone());
        if old.as_ref() == Some(&key) {
            return;
        }
        if old.as_ref().is_none_or(|o| o.0 != key.0 || o.2 != key.2) {
            self.append(r, status);
        }
        if old.as_ref().is_none_or(|o| o.1 != key.1) {
            match key.1.as_deref() {
                Some("reachable") => self.append(r, Event::TargetReachable),
                Some("unreachable") => self.append(r, Event::TargetUnreachable),
                _ => {}
            }
        }
        if !r.desired_running
            && matches!(
                r.status.as_str(),
                "stopped" | "tested" | "failed" | "needs-attention"
            )
        {
            self.seen.remove(&r.rule_id);
        }
    }
    fn append(&mut self, r: &Runtime, event: Event) {
        let level = if matches!(
            event,
            Event::Failed | Event::NeedsAttention | Event::TargetUnreachable
        ) {
            "warning"
        } else {
            "info"
        }
        .into();
        let record = Record {
            timestamp: timestamp(),
            rule_id: r.rule_id.clone(),
            run_id: r.run_id.clone(),
            event,
            error_kind: r.error_kind,
            retry_count: r.retry_count,
            level,
        };
        if self.write(&record).is_err() {
            self.write_failed = true;
        }
        self.records.push_back(record);
        if self.records.len() > 1000 {
            self.records.pop_front();
        }
    }
    fn write(&self, r: &Record) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.directory)?;
        let path = Self::file(&self.directory, 0);
        if std::fs::metadata(&path).is_ok_and(|m| m.len() >= LIMIT) {
            let oldest = Self::file(&self.directory, 2);
            if oldest.exists() {
                std::fs::remove_file(oldest)?;
            }
            let previous = Self::file(&self.directory, 1);
            if previous.exists() {
                std::fs::rename(&previous, Self::file(&self.directory, 2))?;
            }
            std::fs::rename(&path, previous)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        serde_json::to_writer(&mut file, r)?;
        file.write_all(b"\n")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logs_exclude_secrets_rotate_and_reload_without_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = Activity::open(dir.path().into());
        let mut r = Runtime {
            rule_id: "fixture".into(),
            run_id: "run".into(),
            status: "listening".into(),
            desired_running: true,
            message: "CANARY_PASSWORD PRIVATE KEY remote-command".into(),
            ..Default::default()
        };
        log.observe(&r);
        log.observe(&r);
        assert_eq!(log.records().len(), 1);
        r.target_health.state = Some("unreachable".into());
        log.observe(&r);
        assert_eq!(log.records().len(), 2);
        let text = std::fs::read_to_string(Activity::file(dir.path(), 0)).unwrap();
        assert!(!text.contains("CANARY"));
        assert!(!text.contains("PRIVATE"));
        std::fs::write(Activity::file(dir.path(), 0), vec![b' '; LIMIT as usize]).unwrap();
        r.status = "reconnecting".into();
        log.observe(&r);
        assert!(Activity::file(dir.path(), 1).exists());
        let mut invalid = log.records().last().unwrap().clone();
        invalid.timestamp = u64::MAX;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(Activity::file(dir.path(), 0))
            .unwrap();
        serde_json::to_writer(&mut file, &invalid).unwrap();
        file.write_all(b"\n").unwrap();
        drop(file);
        let reloaded = Activity::open(dir.path().into());
        assert_eq!(reloaded.records().len(), 1);
        assert!(!log.write_failed);
        let blocked = dir.path().join("not-a-directory");
        std::fs::write(&blocked, b"fixture").unwrap();
        let mut unavailable = Activity::open(blocked);
        unavailable.observe(&r);
        assert!(unavailable.write_failed);
        assert_eq!(unavailable.records().len(), 2);
        assert!(unavailable
            .records()
            .iter()
            .any(|event| event.event == Event::Reconnecting));
        assert!(unavailable
            .records()
            .iter()
            .any(|event| event.event == Event::TargetUnreachable));
    }
}
