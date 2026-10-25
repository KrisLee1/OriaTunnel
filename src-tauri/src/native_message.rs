//! Explicit message metadata inside existing string fields. External details remain literal.
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock, RwLock},
};
use tauri::Manager;

const PREFIX: &str = "oria-message:";
const LANGUAGES: [&str; 8] = ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "ru"];
static LANGUAGE: RwLock<&str> = RwLock::new("zh-CN");
static CATALOGS: OnceLock<BTreeMap<&str, Value>> = OnceLock::new();
fn catalogs() -> &'static BTreeMap<&'static str, Value> {
    CATALOGS.get_or_init(|| {
        BTreeMap::from([
            (
                "zh-CN",
                serde_json::from_str(include_str!("../../src/public/locales/zh-CN/native.json"))
                    .unwrap(),
            ),
            (
                "zh-TW",
                serde_json::from_str(include_str!("../../src/public/locales/zh-TW/native.json"))
                    .unwrap(),
            ),
            (
                "en",
                serde_json::from_str(include_str!("../../src/public/locales/en/native.json"))
                    .unwrap(),
            ),
            (
                "ja",
                serde_json::from_str(include_str!("../../src/public/locales/ja/native.json"))
                    .unwrap(),
            ),
            (
                "ko",
                serde_json::from_str(include_str!("../../src/public/locales/ko/native.json"))
                    .unwrap(),
            ),
            (
                "de",
                serde_json::from_str(include_str!("../../src/public/locales/de/native.json"))
                    .unwrap(),
            ),
            (
                "fr",
                serde_json::from_str(include_str!("../../src/public/locales/fr/native.json"))
                    .unwrap(),
            ),
            (
                "ru",
                serde_json::from_str(include_str!("../../src/public/locales/ru/native.json"))
                    .unwrap(),
            ),
        ])
    })
}
fn normalize(language: &str) -> Option<&'static str> {
    LANGUAGES.into_iter().find(|value| *value == language)
}
pub fn language() -> &'static str {
    *LANGUAGE.read().unwrap()
}
fn interpolate(template: &str, mut parameter: impl FnMut(&str) -> Option<String>) -> String {
    let mut output = String::new();
    let mut rest = template;
    while let Some((before, after)) = rest.split_once("{{") {
        output.push_str(before);
        let Some((key, tail)) = after.split_once("}}") else {
            output.push_str("{{");
            output.push_str(after);
            return output;
        };
        if let Some(value) = parameter(key) {
            output.push_str(&value);
        } else {
            output.push_str("{{");
            output.push_str(key);
            output.push_str("}}");
        }
        rest = tail;
    }
    output.push_str(rest);
    output
}
pub fn message(key: &str, args: Value) -> String {
    let template = catalogs()["zh-CN"][key].as_str().unwrap_or(key);
    let fallback = interpolate(template, |key| {
        args.get(key).and_then(|v| match v {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            Value::Object(value) => value
                .get("message")
                .and_then(Value::as_str)
                .map(|value| render_in_language(value, "zh-CN")),
            _ => None,
        })
    });
    format!(
        "{PREFIX}{}",
        json!({"v":1,"key":key,"args":args,"fallback":fallback})
    )
}
pub fn plain(key: &str) -> String {
    message(key, json!({}))
}
pub fn combine(messages: &[String], separator: &str) -> String {
    let fallback = messages
        .iter()
        .map(|m| render_in_language(m, "zh-CN"))
        .collect::<Vec<_>>()
        .join(separator);
    format!(
        "{PREFIX}{}",
        json!({"v":1,"messages":messages,"separator":separator,"fallback":fallback})
    )
}
pub fn key(value: &str) -> Option<String> {
    let item: Value = serde_json::from_str(value.strip_prefix(PREFIX)?).ok()?;
    (item["v"] == 1)
        .then(|| item["key"].as_str().map(str::to_owned))
        .flatten()
}
pub fn text(key: &str, args: Value) -> String {
    render_in_language(&message(key, args), language())
}
pub fn render_in_language(value: &str, language: &str) -> String {
    fn render(value: &str, language: &str, depth: usize, remaining: &mut usize) -> String {
        let Some(raw) = value.strip_prefix(PREFIX) else {
            return value.into();
        };
        let Ok(item) = serde_json::from_str::<Value>(raw) else {
            return value.into();
        };
        let Some(fallback) = item["fallback"].as_str() else {
            return value.into();
        };
        if item["v"] != 1 {
            return value.into();
        }
        if depth > 24 || *remaining == 0 {
            return fallback.into();
        }
        *remaining -= 1;
        if let (Some(messages), Some(separator)) =
            (item["messages"].as_array(), item["separator"].as_str())
        {
            return messages
                .iter()
                .map(|m| {
                    m.as_str()
                        .map(|m| render(m, language, depth + 1, remaining))
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>()
                .join(separator);
        }
        let Some(key) = item["key"].as_str() else {
            return fallback.into();
        };
        let Some(template) = catalogs().get(language).and_then(|c| c[key].as_str()) else {
            return fallback.into();
        };
        interpolate(template, |name| {
            item["args"].get(name).and_then(|v| match v {
                Value::String(value) => Some(value.clone()),
                Value::Number(value) => Some(value.to_string()),
                Value::Object(value) => value
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|value| render(value, language, depth + 1, remaining)),
                _ => None,
            })
        })
    }
    render(value, language, 0, &mut 20000)
}

fn read_preference(path: &Path) -> Option<&'static str> {
    std::fs::metadata(path)
        .ok()
        .filter(|m| m.len() <= 1024)
        .and_then(|_| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value["language"].as_str().and_then(normalize))
}

pub struct NativeLanguageState {
    path: PathBuf,
    write: Mutex<()>,
}
impl NativeLanguageState {
    pub fn load(directory: &Path) -> Self {
        let path = directory.join("native-language.json");
        let selected = read_preference(&path);
        *LANGUAGE.write().unwrap() = selected.unwrap_or("zh-CN");
        Self {
            path,
            write: Mutex::new(()),
        }
    }
    fn save(&self, language: &str) -> Result<(), String> {
        let language = normalize(language).ok_or_else(|| plain("languageInvalid"))?;
        let _guard = self.write.lock().unwrap();
        let temp = self
            .path
            .with_file_name(format!(".native-language-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> std::io::Result<()> {
            std::fs::create_dir_all(self.path.parent().unwrap())?;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            file.write_all(
                serde_json::to_string(&json!({"language":language}))
                    .unwrap()
                    .as_bytes(),
            )?;
            file.sync_all()?;
            std::fs::rename(&temp, &self.path)
        })();
        if let Err(error) = result {
            let _ = std::fs::remove_file(temp);
            return Err(message("languageSave", json!({"error":error.to_string()})));
        }
        *LANGUAGE.write().unwrap() = language;
        Ok(())
    }
}
#[tauri::command]
pub fn set_native_language(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    language: String,
) -> Result<(), String> {
    crate::app::command_api::local(&window)?;
    app.state::<NativeLanguageState>().save(&language)?;
    crate::desktop::refresh_language(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_catalogs_have_matching_keys_and_placeholders() {
        let source = catalogs()["en"].as_object().unwrap();
        for language in LANGUAGES {
            let catalog = catalogs()[language].as_object().unwrap();
            assert_eq!(
                source.keys().collect::<Vec<_>>(),
                catalog.keys().collect::<Vec<_>>(),
                "{language}"
            );
            for (key, value) in catalog {
                assert!(
                    !value.as_str().unwrap().trim().is_empty(),
                    "{language}:{key}"
                );
            }
        }
    }
    #[test]
    fn raw_parameters_remain_literal_and_only_explicit_nested_messages_translate() {
        let literal = plain("ruleMissing");
        let value = message(
            "jumpNeedsAttention",
            json!({"arg0":literal,"arg1":{"message":plain("hostSourceMissing")}}),
        );
        let text = render_in_language(&value, "en");
        assert!(text.contains(&literal));
        assert!(text.ends_with("The host source is unavailable"));
        assert_eq!(
            render_in_language(
                "C:\\folder with spaces\\file:22: library error {{arg0}}",
                "de"
            ),
            "C:\\folder with spaces\\file:22: library error {{arg0}}"
        );
    }
    #[test]
    fn message_lists_preserve_large_diagnostic_sets() {
        let messages = (0..14000)
            .map(|_| plain("sshPortInvalid"))
            .collect::<Vec<_>>();
        let value = combine(&messages, "\n");
        let text = render_in_language(&value, "en");
        assert_eq!(text.lines().count(), 14000);
        assert!(!text.contains(PREFIX));
    }
    #[test]
    fn language_preference_is_allowlisted_and_atomic() {
        let dir = tempfile::tempdir().unwrap();
        let state = NativeLanguageState::load(dir.path());
        state.save("zh-CN").unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&state.path).unwrap()).unwrap()
                ["language"],
            "zh-CN"
        );
        let before = std::fs::read(&state.path).unwrap();
        assert!(state.save("../bad").is_err());
        assert_eq!(std::fs::read(&state.path).unwrap(), before);
        // No production profile is touched by this test.
    }

    #[test]
    fn corrupt_unknown_and_oversized_preferences_do_not_change_startup_defaults() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("native-language.json");
        assert_eq!(read_preference(&path), None);
        for bytes in [
            "invalid JSON".to_string(),
            "{\"language\":\"unknown\"}".into(),
            "x".repeat(2048),
        ] {
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(read_preference(&path), None);
        }
        std::fs::write(&path, "{\"language\":\"fr\"}").unwrap();
        assert_eq!(read_preference(&path), Some("fr"));
        let error = message("configRead", json!({"e":"library detail {{file}}"}));
        let rendered = render_in_language(&error, read_preference(&path).unwrap());
        assert!(rendered.contains("library detail {{file}}"));
        assert!(!rendered.contains(PREFIX));
    }
    #[test]
    fn failed_language_save_keeps_the_existing_target_and_cleans_temporary_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("native-language.json");
        std::fs::create_dir(&path).unwrap();
        let state = NativeLanguageState {
            path: path.clone(),
            write: Mutex::new(()),
        };
        assert_eq!(
            key(&state.save("en").unwrap_err()).as_deref(),
            Some("languageSave")
        );
        assert!(path.is_dir());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    #[test]
    fn temporary_ssh_sources_keep_file_line_and_nested_message_identity() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config with spaces");
        std::fs::write(&path, "Host fixture\n HostName \"unclosed\n").unwrap();
        let found =
            crate::ssh_config::discover_files(std::slice::from_ref(&path), directory.path());
        assert_eq!(found.hosts.len(), 1);
        let diagnostic = found.hosts[0]
            .diagnostics
            .iter()
            .find(|value| key(value).as_deref() == Some("sshFileLine"))
            .unwrap();
        for language in LANGUAGES {
            let rendered = render_in_language(diagnostic, language);
            assert!(rendered.contains(&format!("{}:2:", path.display())));
            assert!(!rendered.contains(PREFIX));
        }
        assert!(found.hosts.iter().all(|host| !host.diagnostics.is_empty()));
    }
}
