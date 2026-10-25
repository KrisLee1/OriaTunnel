use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const EVENT: &str = "tunnel://update";

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Verifying,
    Ready,
    Preparing,
    Installing,
    Error,
}
impl Phase {
    fn busy(self) -> bool {
        matches!(
            self,
            Self::Checking
                | Self::Downloading
                | Self::Verifying
                | Self::Preparing
                | Self::Installing
        )
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Failure {
    Check,
    Download,
    Install,
    Cleanup,
    ActivityChanged,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Unavailable {
    NotConfigured,
    Development,
    Unsupported,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    version: String,
    notes: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: u64,
    current_version: String,
    phase: Phase,
    unavailable: Option<Unavailable>,
    auto_check: bool,
    preference_error: bool,
    release: Option<Release>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<Failure>,
    can_download: bool,
    can_install: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preferences {
    auto_check: bool,
}
struct Inner {
    snapshot: Snapshot,
    update: Option<Update>,
    bytes: Option<Arc<Vec<u8>>>,
}
pub struct UpdateState {
    inner: Mutex<Inner>,
    operation: tokio::sync::Mutex<()>,
    preferences: PathBuf,
}

fn availability(configured: bool, development: bool, installed: bool) -> Option<Unavailable> {
    if !configured {
        Some(Unavailable::NotConfigured)
    } else if development {
        Some(Unavailable::Development)
    } else if !installed {
        Some(Unavailable::Unsupported)
    } else {
        None
    }
}
fn load_preferences(path: &std::path::Path) -> (bool, bool) {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<Preferences>(&bytes) {
            Ok(value) => (value.auto_check, false),
            Err(_) => (false, true),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (true, false),
        Err(_) => (false, true),
    }
}
impl UpdateState {
    pub fn load<R: tauri::Runtime>(app: &tauri::AppHandle<R>, directory: PathBuf) -> Self {
        let config = app.config().plugins.0.get("updater");
        let configured = config
            .and_then(|c| c.get("pubkey"))
            .and_then(|v| v.as_str())
            .is_some_and(|key| !key.trim().is_empty());
        let installed = if cfg!(target_os = "macos") {
            std::env::current_exe().ok().is_some_and(|p| {
                p.components()
                    .any(|c| c.as_os_str().to_string_lossy().ends_with(".app"))
            })
        } else if cfg!(windows) {
            matches!(
                tauri::utils::platform::bundle_type(),
                Some(tauri::utils::config::BundleType::Nsis)
            )
        } else {
            false
        };
        let preferences = directory.join("update-preferences.json");
        let (auto_check, preference_error) = load_preferences(&preferences);
        Self {
            inner: Mutex::new(Inner {
                snapshot: Snapshot {
                    revision: 0,
                    current_version: app.package_info().version.to_string(),
                    phase: Phase::Idle,
                    unavailable: availability(configured, cfg!(debug_assertions), installed),
                    auto_check,
                    preference_error,
                    release: None,
                    downloaded: 0,
                    total: None,
                    error: None,
                    can_download: false,
                    can_install: false,
                },
                update: None,
                bytes: None,
            }),
            operation: tokio::sync::Mutex::new(()),
            preferences,
        }
    }
    fn snapshot(&self) -> Snapshot {
        self.inner.lock().unwrap().snapshot.clone()
    }
    fn change<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        f: impl FnOnce(&mut Inner),
    ) -> Snapshot {
        let next = {
            let mut inner = self.inner.lock().unwrap();
            f(&mut inner);
            inner.snapshot.revision += 1;
            let enabled = inner.snapshot.unavailable.is_none() && !inner.snapshot.phase.busy();
            inner.snapshot.can_download =
                enabled && inner.update.is_some() && inner.bytes.is_none();
            inner.snapshot.can_install = enabled && inner.update.is_some() && inner.bytes.is_some();
            inner.snapshot.clone()
        };
        let _ = app.emit(EVENT, &next);
        next
    }
    fn fail<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, error: Failure) -> Snapshot {
        self.change(app, |inner| {
            inner.snapshot.phase = Phase::Error;
            inner.snapshot.error = Some(error);
        })
    }
    fn ensure_available(&self) -> Result<(), String> {
        if self.snapshot().unavailable.is_some() {
            Err("unavailable".into())
        } else {
            Ok(())
        }
    }
    pub async fn check<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        background: bool,
    ) -> Result<Snapshot, String> {
        let _operation = self.operation.try_lock().map_err(|_| "busy")?;
        self.ensure_available()?;
        if background && !self.snapshot().auto_check {
            return Ok(self.snapshot());
        }
        // A startup check must never discard a package already requested by the user.
        if background && self.snapshot().phase != Phase::Idle {
            return Ok(self.snapshot());
        }
        self.change(app, |inner| {
            inner.update = None;
            inner.bytes = None;
            inner.snapshot.phase = Phase::Checking;
            inner.snapshot.error = None;
            inner.snapshot.release = None;
            inner.snapshot.downloaded = 0;
            inner.snapshot.total = None;
        });
        let result = async {
            let updater = app
                .updater_builder()
                .timeout(Duration::from_secs(20))
                .version_comparator(|current, release| {
                    release.version > current && release.version.pre.is_empty()
                })
                // The default hook destroys Tauri resources before ShellExecute can fail.
                // SSH cleanup is awaited by our install command; keep the old UI usable on failure.
                .on_before_exit(|| {})
                .build()?;
            updater.check().await
        }
        .await;
        match result {
            Ok(update)
                if update
                    .as_ref()
                    .is_none_or(|u| u.download_url.scheme() == "https") =>
            {
                Ok(self.change(app, |inner| {
                    inner.snapshot.phase = if update.is_some() {
                        Phase::Available
                    } else {
                        Phase::UpToDate
                    };
                    inner.snapshot.release = update.as_ref().map(|u| Release {
                        version: u.version.clone(),
                        notes: u
                            .body
                            .as_deref()
                            .unwrap_or_default()
                            .chars()
                            .take(65_536)
                            .collect(),
                    });
                    inner.update = update;
                }))
            }
            _ if background => Ok(self.change(app, |inner| {
                inner.snapshot.phase = Phase::Idle;
            })),
            _ => Ok(self.fail(app, Failure::Check)),
        }
    }
    async fn download<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        version: &str,
    ) -> Result<Snapshot, String> {
        let _operation = self.operation.try_lock().map_err(|_| "busy")?;
        self.ensure_available()?;
        let mut update = {
            let inner = self.inner.lock().unwrap();
            inner
                .update
                .as_ref()
                .filter(|u| u.version == version)
                .cloned()
                .ok_or("notReady")?
        };
        // Checking uses a short timeout; allow a longer bounded package transfer.
        update.timeout = Some(Duration::from_secs(600));
        self.change(app, |inner| {
            inner.bytes = None;
            inner.snapshot.phase = Phase::Downloading;
            inner.snapshot.error = None;
            inner.snapshot.downloaded = 0;
            inner.snapshot.total = None;
        });
        let mut downloaded = 0_u64;
        let mut last_emit = Instant::now();
        let transfer = update.download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                if last_emit.elapsed() >= Duration::from_millis(100) {
                    self.change(app, |inner| {
                        inner.snapshot.downloaded = downloaded;
                        inner.snapshot.total = total;
                    });
                    last_emit = Instant::now();
                }
            },
            || {
                self.change(app, |inner| {
                    inner.snapshot.phase = Phase::Verifying;
                });
            },
        );
        let result = transfer.await;
        match result {
            Ok(bytes) => Ok(self.change(app, |inner| {
                inner.snapshot.downloaded = bytes.len() as u64;
                inner.snapshot.total = Some(bytes.len() as u64);
                inner.bytes = Some(Arc::new(bytes));
                inner.snapshot.phase = Phase::Ready;
            })),
            _ => Ok(self.fail(app, Failure::Download)),
        }
    }
    fn set_auto_check<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        enabled: bool,
    ) -> Snapshot {
        let save = || -> std::io::Result<()> {
            if let Some(parent) = self.preferences.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let temporary = self.preferences.with_extension("tmp");
            std::fs::write(
                &temporary,
                serde_json::to_vec(&Preferences {
                    auto_check: enabled,
                })?,
            )?;
            std::fs::rename(temporary, &self.preferences)
        };
        if save().is_err() {
            return self.change(app, |inner| {
                inner.snapshot.preference_error = true;
            });
        }
        self.change(app, |inner| {
            inner.snapshot.auto_check = enabled;
            inner.snapshot.preference_error = false;
        })
    }
}

fn state(app: &tauri::AppHandle) -> Arc<UpdateState> {
    app.state::<Arc<UpdateState>>().inner().clone()
}

// Reserves the existing exit coordinator, including tray Quit and window-close requests.
struct InstallationLease {
    exit: Arc<std::sync::atomic::AtomicU8>,
    connections: Arc<crate::app::AppState>,
    committed: bool,
}
impl InstallationLease {
    fn acquire(app: &tauri::AppHandle) -> Result<Self, String> {
        Self::reserve(
            app.state::<crate::ExitState>().0.clone(),
            crate::app::state(app),
        )
    }
    fn reserve(
        exit: Arc<std::sync::atomic::AtomicU8>,
        connections: Arc<crate::app::AppState>,
    ) -> Result<Self, String> {
        exit.compare_exchange(
            0,
            3,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .map_err(|_| "busy")?;
        Ok(Self {
            exit,
            connections,
            committed: false,
        })
    }
    fn commit(&mut self) {
        self.committed = true;
        self.exit.store(2, std::sync::atomic::Ordering::SeqCst);
    }
}
impl Drop for InstallationLease {
    fn drop(&mut self) {
        if !self.committed {
            self.connections.finish_update_attempt();
            let _ = self.exit.compare_exchange(
                3,
                0,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            );
        }
    }
}

#[tauri::command]
pub fn update_snapshot(app: tauri::AppHandle) -> Snapshot {
    state(&app).snapshot()
}
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Snapshot, String> {
    state(&app).check(&app, false).await
}
#[tauri::command]
pub async fn download_update(app: tauri::AppHandle, version: String) -> Result<Snapshot, String> {
    state(&app).download(&app, &version).await
}
#[tauri::command]
pub async fn set_update_auto_check(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<Snapshot, String> {
    let state = state(&app);
    let _operation = state.operation.try_lock().map_err(|_| "busy")?;
    Ok(state.set_auto_check(&app, enabled))
}
#[tauri::command]
pub async fn update_install_context(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    if !state(&app).snapshot().can_install {
        return Err("notReady".into());
    }
    Ok(crate::app::state(&app).active_work_ids().await)
}
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    version: String,
    expected_work_ids: Vec<String>,
) -> Result<Snapshot, String> {
    let state = state(&app);
    let _operation = state.operation.try_lock().map_err(|_| "busy")?;
    state.ensure_available()?;
    let (update, bytes) = {
        let inner = state.inner.lock().unwrap();
        let update = inner
            .update
            .as_ref()
            .filter(|u| u.version == version)
            .cloned()
            .ok_or("notReady")?;
        (update, inner.bytes.clone().ok_or("notReady")?)
    };
    if update.verify(&bytes).is_err() {
        state.change(&app, |inner| {
            inner.bytes = None;
        });
        return Ok(state.fail(&app, Failure::Download));
    }
    let mut lease = InstallationLease::acquire(&app)?;
    state.change(&app, |inner| {
        inner.snapshot.phase = Phase::Preparing;
        inner.snapshot.error = None;
    });
    let connections = crate::app::state(&app);
    if let Err(cause) = connections.prepare_update(&expected_work_ids).await {
        let error = if cause == "activityChanged" {
            Failure::ActivityChanged
        } else {
            Failure::Cleanup
        };
        return Ok(state.fail(&app, error));
    }
    connections.publish(&app);
    state.change(&app, |inner| {
        inner.snapshot.phase = Phase::Installing;
    });
    let result = tokio::task::spawn_blocking(move || update.install(bytes.as_slice())).await;
    match result {
        Ok(Ok(())) => {
            lease.commit();
            // Windows successfully launching the installer exits inside the plugin.
            app.request_restart();
            Ok(state.snapshot())
        }
        _ => Ok(state.fail(&app, Failure::Install)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    const PUBLIC_KEY: &str = include_str!("../tests/fixtures/updater/public.key");
    const SIGNATURE: &str = include_str!("../tests/fixtures/updater/payload.sig");
    const PAYLOAD: &[u8] = include_bytes!("../tests/fixtures/updater/payload.txt");

    async fn serve(status: &str, body: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let header = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n", body.len());
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let count = stream.read(&mut request).await.unwrap();
            assert!(count > 0);
            stream.write_all(header.as_bytes()).await.unwrap();
            stream.write_all(&body).await.unwrap();
        });
        (url, task)
    }
    fn test_app(endpoint: &str) -> tauri::App<tauri::test::MockRuntime> {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({
                "pubkey": PUBLIC_KEY.trim(), "endpoints": [endpoint],
                "requireSignedVersion": true,
                "dangerousInsecureTransportProtocol": true
            }),
        );
        tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap()
    }
    fn test_state(
        app: &tauri::AppHandle<tauri::test::MockRuntime>,
        directory: PathBuf,
    ) -> UpdateState {
        let state = UpdateState::load(app, directory);
        state.inner.lock().unwrap().snapshot.unavailable = None;
        state
    }
    async fn announced_update(
        version: &str,
    ) -> (
        tauri::App<tauri::test::MockRuntime>,
        UpdateState,
        tempfile::TempDir,
    ) {
        let body = serde_json::to_vec(&serde_json::json!({
            "version": version, "notes": "<script>untrusted release notes</script>",
            "url": "https://example.invalid/update", "signature": SIGNATURE.trim()
        }))
        .unwrap();
        let (endpoint, server) = serve("200 OK", body).await;
        let app = test_app(&endpoint);
        let directory = tempfile::tempdir().unwrap();
        let state = test_state(app.handle(), directory.path().into());
        state.check(app.handle(), false).await.unwrap();
        server.await.unwrap();
        (app, state, directory)
    }
    #[tokio::test]
    async fn checks_distinguish_no_update_bad_manifest_and_background_failure() {
        for (status, body, background, expected) in [
            ("204 No Content", "", false, Phase::UpToDate),
            ("200 OK", "bad JSON", false, Phase::Error),
            ("503 Unavailable", "", true, Phase::Idle),
        ] {
            let (endpoint, server) = serve(status, body.as_bytes().to_vec()).await;
            let app = test_app(&endpoint);
            let directory = tempfile::tempdir().unwrap();
            let state = test_state(app.handle(), directory.path().into());
            let snapshot = state.check(app.handle(), background).await.unwrap();
            assert_eq!(snapshot.phase, expected);
            assert_eq!(
                snapshot.error,
                if expected == Phase::Error {
                    Some(Failure::Check)
                } else {
                    None
                }
            );
            server.await.unwrap();
        }
        for version in ["0.1.0", "0.0.9", "0.2.0-beta.1"] {
            let (_app, state, _directory) = announced_update(version).await;
            assert_eq!(state.snapshot().phase, Phase::UpToDate);
        }
    }
    #[tokio::test]
    async fn actual_download_requires_signature_and_signed_version_and_can_retry() {
        let (app, state, _directory) = announced_update("0.2.0").await;
        assert_eq!(state.snapshot().phase, Phase::Available);
        assert!(state.snapshot().can_download);
        let (url, server) = serve("200 OK", b"tampered".to_vec()).await;
        state
            .inner
            .lock()
            .unwrap()
            .update
            .as_mut()
            .unwrap()
            .download_url = url.parse().unwrap();
        let failed = state.download(app.handle(), "0.2.0").await.unwrap();
        server.await.unwrap();
        assert_eq!(failed.error, Some(Failure::Download));
        assert!(!failed.can_install);
        assert!(failed.can_download);
        let (url, server) = serve("200 OK", PAYLOAD.to_vec()).await;
        state
            .inner
            .lock()
            .unwrap()
            .update
            .as_mut()
            .unwrap()
            .download_url = url.parse().unwrap();
        let ready = state.download(app.handle(), "0.2.0").await.unwrap();
        server.await.unwrap();
        assert_eq!(ready.phase, Phase::Ready);
        assert!(ready.can_install);
        assert!(!ready.can_download);
        assert_eq!(ready.downloaded, PAYLOAD.len() as u64);
        assert!(state.download(app.handle(), "0.3.0").await.is_err());
        let guard = state.operation.lock().await;
        assert_eq!(
            state.check(app.handle(), false).await.err().unwrap(),
            "busy"
        );
        drop(guard);
        let (_app, state, _directory) = announced_update("0.3.0").await;
        let update = state.inner.lock().unwrap().update.clone().unwrap();
        assert!(update.verify(PAYLOAD).is_err());
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn windows_static_manifest_selects_binary_architecture_and_rejects_other_arch_only() {
        let current = format!("windows-{}", std::env::consts::ARCH);
        for include_current in [true, false] {
            let mut platforms = serde_json::Map::new();
            for target in ["windows-aarch64", "windows-x86_64"] {
                if !include_current && target == current {
                    continue;
                }
                platforms.insert(
                    target.into(),
                    serde_json::json!({
                        "url": format!("https://example.invalid/{target}-setup.exe"),
                        "signature": SIGNATURE.trim()
                    }),
                );
            }
            let body = serde_json::to_vec(&serde_json::json!({
                "version": "0.2.0", "platforms": platforms
            }))
            .unwrap();
            let (endpoint, server) = serve("200 OK", body).await;
            let app = test_app(&endpoint);
            let directory = tempfile::tempdir().unwrap();
            let state = test_state(app.handle(), directory.path().into());
            let snapshot = state.check(app.handle(), false).await.unwrap();
            server.await.unwrap();
            if include_current {
                assert_eq!(snapshot.phase, Phase::Available);
                assert_eq!(
                    state
                        .inner
                        .lock()
                        .unwrap()
                        .update
                        .as_ref()
                        .unwrap()
                        .download_url
                        .path(),
                    format!("/{current}-setup.exe")
                );
            } else {
                assert_eq!(snapshot.error, Some(Failure::Check));
                assert!(!snapshot.can_download);
            }
        }
    }
    #[tokio::test]
    async fn failed_installation_releases_both_exit_and_connection_gates() {
        let directory = tempfile::tempdir().unwrap();
        let connections = Arc::new(crate::app::AppState::isolated(
            directory.path().join("connections.json"),
        ));
        let exit = Arc::new(std::sync::atomic::AtomicU8::new(0));
        let lease = InstallationLease::reserve(exit.clone(), connections.clone()).unwrap();
        assert!(InstallationLease::reserve(exit.clone(), connections.clone()).is_err());
        connections.prepare_update(&[]).await.unwrap();
        assert!(connections.update_installing());
        // Every pre-commit error path drops this same lease, including installer errors.
        drop(lease);
        assert_eq!(exit.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert!(!connections.update_installing());
        exit.store(1, std::sync::atomic::Ordering::SeqCst);
        assert!(InstallationLease::reserve(exit.clone(), connections.clone()).is_err());
        exit.store(0, std::sync::atomic::Ordering::SeqCst);
        let mut lease = InstallationLease::reserve(exit.clone(), connections.clone()).unwrap();
        connections.prepare_update(&[]).await.unwrap();
        lease.commit();
        drop(lease);
        assert_eq!(exit.load(std::sync::atomic::Ordering::SeqCst), 2);
        assert!(connections.update_installing());
    }
    #[tokio::test]
    async fn preferences_round_trip_and_failed_save_keep_last_value() {
        let app = test_app("http://127.0.0.1:1/unused");
        let directory = tempfile::tempdir().unwrap();
        let state = test_state(app.handle(), directory.path().into());
        assert!(!state.set_auto_check(app.handle(), false).auto_check);
        assert_eq!(load_preferences(&state.preferences), (false, false));
        assert_eq!(
            state.check(app.handle(), true).await.unwrap().phase,
            Phase::Idle
        );
        std::fs::create_dir(state.preferences.with_extension("tmp")).unwrap();
        let failed = state.set_auto_check(app.handle(), true);
        assert!(failed.preference_error);
        assert!(!failed.auto_check);
        assert_eq!(load_preferences(&state.preferences), (false, false));
    }
    #[test]
    fn missing_key_debug_and_uninstalled_builds_never_enable_updates() {
        assert_eq!(
            availability(false, false, true),
            Some(Unavailable::NotConfigured)
        );
        assert_eq!(
            availability(true, true, true),
            Some(Unavailable::Development)
        );
        assert_eq!(
            availability(true, false, false),
            Some(Unavailable::Unsupported)
        );
        assert_eq!(availability(true, false, true), None);
    }
    #[test]
    fn broken_preferences_fail_closed_and_are_not_overwritten_on_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("preferences.json");
        assert_eq!(load_preferences(&path), (true, false));
        std::fs::write(&path, "broken").unwrap();
        assert_eq!(load_preferences(&path), (false, true));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "broken");
        std::fs::write(&path, r#"{"autoCheck":false}"#).unwrap();
        assert_eq!(load_preferences(&path), (false, false));
    }
}
