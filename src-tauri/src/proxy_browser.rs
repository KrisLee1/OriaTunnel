//! Explicitly launched SOCKS5 browser; never changes system proxy settings.
use crate::model::{ForwardKind, Rule, Runtime};
use std::path::Path;
#[cfg(any(windows, target_os = "macos", test))]
use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Browser {
    Edge,
    Chrome,
    Firefox,
}
#[cfg(any(windows, target_os = "macos", test))]
impl Browser {
    fn name(self) -> &'static str {
        match self {
            Self::Edge => "Edge",
            Self::Chrome => "Chrome",
            Self::Firefox => "Firefox",
        }
    }
}

pub fn endpoint(rule: &Rule, active: &Rule, runtime: &Runtime) -> Result<String, String> {
    if rule.kind != ForwardKind::D || active.kind != ForwardKind::D {
        return Err(crate::native_message::plain("proxyBrowserDynamic"));
    }
    if !rule.same_connection(active) || runtime.configuration_changed {
        return Err(crate::native_message::plain("forwardChanged"));
    }
    if runtime.rule_id != rule.id || runtime.status != "listening" {
        return Err(crate::native_message::plain("startForward"));
    }
    let address = match active.bind_address.as_str() {
        "127.0.0.1" => "127.0.0.1",
        "::1" => "[::1]",
        _ => return Err(crate::native_message::plain("proxyBrowserDynamic")),
    };
    if active.bind_port == 0 {
        return Err(crate::native_message::plain("servicePort"));
    }
    Ok(format!("socks5://{address}:{}", active.bind_port))
}

#[cfg(any(windows, target_os = "macos", test))]
fn profile_path(directory: &Path, runtime: &Runtime, proxy: &str, browser: Browser) -> PathBuf {
    use sha2::{Digest, Sha256};
    // A run-specific profile cannot reuse a running browser with stale proxy
    // flags after editing a rule or replacing its SSH route. No IDs become paths.
    let identity =
        serde_json::to_vec(&(&runtime.rule_id, &runtime.run_id, proxy, browser.name())).unwrap();
    directory
        .join("proxy-browsers")
        .join(format!("{:x}", Sha256::digest(identity)))
}

#[cfg(any(windows, target_os = "macos", test))]
fn arguments(profile: &Path, proxy: &str, browser: Browser) -> Vec<std::ffi::OsString> {
    if browser == Browser::Firefox {
        return vec![
            "--no-remote".into(),
            "--profile".into(),
            profile.as_os_str().into(),
            "--new-window".into(),
            "about:blank".into(),
        ];
    }
    let mut profile_arg = std::ffi::OsString::from("--user-data-dir=");
    profile_arg.push(profile);
    vec![
        profile_arg,
        format!("--proxy-server={proxy}").into(),
        "--proxy-bypass-list=<-loopback>".into(),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--new-window".into(),
        "about:blank".into(),
    ]
}

#[cfg(any(windows, target_os = "macos", test))]
fn firefox_preferences(proxy: &str) -> Result<String, String> {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
    let address: SocketAddr = proxy
        .strip_prefix("socks5://")
        .and_then(|value| value.parse().ok())
        .filter(|address: &SocketAddr| {
            address.port() != 0
                && (address.ip() == IpAddr::V4(Ipv4Addr::LOCALHOST)
                    || address.ip() == IpAddr::V6(Ipv6Addr::LOCALHOST))
        })
        .ok_or(crate::native_message::plain("proxyBrowserDynamic"))?;
    let preferences = serde_json::json!({
        "network.proxy.type": 1,
        "network.proxy.socks": address.ip().to_string(),
        "network.proxy.socks_port": address.port(),
        "network.proxy.socks_version": 5,
        "network.proxy.socks_remote_dns": true,
        "network.proxy.no_proxies_on": "",
        "network.proxy.allow_hijacking_localhost": true,
        "network.proxy.failover_direct": false,
        "browser.shell.checkDefaultBrowser": false,
        "browser.startup.homepage_override.mstone": "ignore",
        "browser.startup.page": 0,
        "browser.aboutwelcome.enabled": false,
    });
    Ok(preferences
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| {
            format!(
                "user_pref({}, {value});\n",
                serde_json::to_string(key).unwrap()
            )
        })
        .collect())
}

#[cfg(any(windows, target_os = "macos", test))]
fn prepare_profile(
    directory: &Path,
    runtime: &Runtime,
    proxy: &str,
    browser: Browser,
) -> Result<PathBuf, String> {
    let mut profile = profile_path(directory, runtime, proxy, browser);
    // --no-remote cannot open a second window with a profile already in use.
    // Never overwrite prefs or interfere with the user's normal Firefox.
    if browser == Browser::Firefox {
        let prefs = firefox_preferences(proxy)?;
        profile = profile.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&profile)
            .map_err(|_| crate::native_message::plain("proxyBrowserFailed"))?;
        use std::io::Write;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(profile.join("user.js"))
            .and_then(|mut file| file.write_all(prefs.as_bytes()))
            .map_err(|_| crate::native_message::plain("proxyBrowserFailed"))?;
    } else {
        std::fs::create_dir_all(&profile)
            .map_err(|_| crate::native_message::plain("proxyBrowserFailed"))?;
    }
    Ok(profile)
}

#[cfg(windows)]
fn executable(browser: Browser) -> Option<PathBuf> {
    let relative = match browser {
        Browser::Edge => "Microsoft/Edge/Application/msedge.exe",
        Browser::Chrome => "Google/Chrome/Application/chrome.exe",
        Browser::Firefox => "Mozilla Firefox/firefox.exe",
    };
    ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(|root| PathBuf::from(root).join(relative))
        .find(|path| path.is_absolute() && path.is_file())
}

#[cfg(target_os = "macos")]
fn executable(browser: Browser) -> Option<PathBuf> {
    let relative = match browser {
        Browser::Edge => "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        Browser::Chrome => "Google Chrome.app/Contents/MacOS/Google Chrome",
        Browser::Firefox => "Firefox.app/Contents/MacOS/firefox",
    };
    std::iter::once(PathBuf::from("/Applications"))
        .chain(dirs::home_dir().map(|home| home.join("Applications")))
        .map(|root| root.join(relative))
        .find(|path| path.is_absolute() && path.is_file())
}

#[cfg(any(windows, target_os = "macos"))]
pub fn launch(
    directory: &Path,
    runtime: &Runtime,
    proxy: &str,
    browser: Browser,
    url: Option<&str>,
) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let executable = executable(browser).ok_or_else(|| {
        crate::native_message::message(
            "proxyBrowserMissing",
            serde_json::json!({"browser": browser.name()}),
        )
    })?;
    let profile = prepare_profile(directory, runtime, proxy, browser)?;
    let mut command = Command::new(executable);
    let mut args = arguments(&profile, proxy, browser);
    if let Some(url) = url {
        *args.last_mut().unwrap() = url.into();
    }
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Launch the GUI executable directly; never show a console or invoke
        // PowerShell/cmd to pass the proxy arguments.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|_| crate::native_message::plain("proxyBrowserFailed"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn launch(
    _directory: &Path,
    _runtime: &Runtime,
    _proxy: &str,
    _browser: Browser,
    _url: Option<&str>,
) -> Result<(), String> {
    Err(crate::native_message::plain("proxyBrowserPlatform"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Rule, Runtime) {
        let rule = Rule {
            id: "proxy".into(),
            kind: ForwardKind::D,
            bind_port: 15432,
            ..Default::default()
        };
        let runtime = Runtime {
            rule_id: rule.id.clone(),
            run_id: "run-a".into(),
            status: "listening".into(),
            ..Default::default()
        };
        (rule, runtime)
    }
    #[test]
    fn requires_live_unchanged_dynamic_loopback_listener() {
        let (mut rule, mut runtime) = fixture();
        assert_eq!(
            endpoint(&rule, &rule, &runtime).unwrap(),
            "socks5://127.0.0.1:15432"
        );
        rule.bind_address = "::1".into();
        assert_eq!(
            endpoint(&rule, &rule, &runtime).unwrap(),
            "socks5://[::1]:15432"
        );
        let active = rule.clone();
        rule.bind_port += 1;
        assert!(endpoint(&rule, &active, &runtime).is_err());
        rule = active;
        for status in ["stopped", "failed", "connecting", "reconnecting"] {
            runtime.status = status.into();
            assert!(endpoint(&rule, &rule, &runtime).is_err());
        }
        runtime.status = "listening".into();
        runtime.configuration_changed = true;
        assert!(endpoint(&rule, &rule, &runtime).is_err());
        runtime.configuration_changed = false;
        runtime.rule_id = "other".into();
        assert!(endpoint(&rule, &rule, &runtime).is_err());
        runtime.rule_id = rule.id.clone();
        for address in ["0.0.0.0", "evil; --flag", "localhost", "127.0.0.1/path"] {
            rule.bind_address = address.into();
            assert!(endpoint(&rule, &rule, &runtime).is_err());
        }
        rule.bind_address = "127.0.0.1".into();
        for kind in [ForwardKind::L, ForwardKind::R] {
            rule.kind = kind;
            assert!(endpoint(&rule, &rule, &runtime).is_err());
        }
    }
    #[test]
    fn isolates_profiles_and_uses_literal_arguments_without_a_shell() {
        let (_, mut runtime) = fixture();
        runtime.rule_id = "../../outside".into();
        let root = Path::new("test data");
        let first = profile_path(root, &runtime, "socks5://127.0.0.1:15432", Browser::Edge);
        assert_eq!(first.parent().unwrap(), root.join("proxy-browsers"));
        assert_eq!(first.file_name().unwrap().len(), 64);
        assert_eq!(
            first,
            profile_path(root, &runtime, "socks5://127.0.0.1:15432", Browser::Edge)
        );
        assert_ne!(
            first,
            profile_path(root, &runtime, "socks5://127.0.0.1:15432", Browser::Chrome)
        );
        runtime.run_id = "run-b".into();
        assert_ne!(
            first,
            profile_path(root, &runtime, "socks5://127.0.0.1:15432", Browser::Edge)
        );
        assert_ne!(
            first,
            profile_path(root, &runtime, "socks5://[::1]:15432", Browser::Edge)
        );
        let args = arguments(&first, "socks5://127.0.0.1:15432", Browser::Edge);
        assert_eq!(args[1], "--proxy-server=socks5://127.0.0.1:15432");
        assert_eq!(args[2], "--proxy-bypass-list=<-loopback>");
        assert_eq!(args.last().unwrap(), "about:blank");
        assert!(!args.iter().any(|arg| arg == "--ignore-certificate-errors"));
    }

    #[test]
    fn firefox_proxy_preferences_support_ipv4_ipv6_remote_dns_and_loopback() {
        for (proxy, host) in [
            ("socks5://127.0.0.1:15432", "127.0.0.1"),
            ("socks5://[::1]:15432", "::1"),
        ] {
            let source = firefox_preferences(proxy).unwrap();
            let preferences: std::collections::BTreeMap<String, serde_json::Value> = source
                .lines()
                .map(|line| {
                    let pair = line
                        .strip_prefix("user_pref(")
                        .unwrap()
                        .strip_suffix(");")
                        .unwrap();
                    let values: Vec<serde_json::Value> =
                        serde_json::from_str(&format!("[{pair}]")).unwrap();
                    (values[0].as_str().unwrap().to_owned(), values[1].clone())
                })
                .collect();
            assert_eq!(preferences["network.proxy.type"], 1);
            assert_eq!(preferences["network.proxy.socks"], host);
            assert_eq!(preferences["network.proxy.socks_port"], 15432);
            assert_eq!(preferences["network.proxy.socks_version"], 5);
            assert_eq!(preferences["network.proxy.socks_remote_dns"], true);
            assert_eq!(preferences["network.proxy.allow_hijacking_localhost"], true);
            assert_eq!(preferences["network.proxy.no_proxies_on"], "");
            assert_eq!(preferences["network.proxy.failover_direct"], false);
        }
        for proxy in [
            "http://127.0.0.1:1234",
            "socks5://127.0.0.1:0",
            "socks5://192.0.2.1:1234",
            "socks5://localhost:1234",
            "socks5://127.0.0.1:1234/\");evil()",
        ] {
            assert!(firefox_preferences(proxy).is_err());
        }
    }

    #[test]
    fn repeated_firefox_launches_have_separate_profiles_and_leave_existing_files_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let (_, runtime) = fixture();
        let ordinary_profile = directory.path().join("prefs.js");
        std::fs::write(&ordinary_profile, "ordinary Firefox preferences").unwrap();
        let first = prepare_profile(
            directory.path(),
            &runtime,
            "socks5://127.0.0.1:15432",
            Browser::Firefox,
        )
        .unwrap();
        let second = prepare_profile(
            directory.path(),
            &runtime,
            "socks5://127.0.0.1:15432",
            Browser::Firefox,
        )
        .unwrap();
        assert_ne!(first, second);
        assert_eq!(first.parent(), second.parent());
        assert!(first.starts_with(directory.path().join("proxy-browsers")));
        assert_eq!(
            std::fs::read_to_string(first.join("user.js")).unwrap(),
            firefox_preferences("socks5://127.0.0.1:15432").unwrap()
        );
        assert_eq!(
            std::fs::read_to_string(ordinary_profile).unwrap(),
            "ordinary Firefox preferences"
        );
        let args = arguments(&first, "socks5://127.0.0.1:15432", Browser::Firefox);
        assert_eq!(args[0], "--no-remote");
        assert_eq!(args[1], "--profile");
        assert_eq!(args[2], first.as_os_str());
        assert_eq!(args[3], "--new-window");
        assert_eq!(args[4], "about:blank");
        assert!(!args
            .iter()
            .any(|arg| arg == "--console" || arg == "--jsconsole"));
    }
}
