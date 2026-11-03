use super::*;
use crate::files::{
    self,
    fs::{err, Fs, Remote},
};
use russh_sftp::client::RawSftpSession;
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connect {
    host_id: String,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
    #[serde(default)]
    remember_host_ids: Vec<String>,
}
fn bind(state: &Arc<AppState>, app: &tauri::AppHandle) {
    let app = app.clone();
    state.files.set_changed(Arc::new(move |snapshot| {
        let _ = app.emit("files://snapshot", snapshot);
    }));
}
#[tauri::command]
pub fn file_snapshot(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
) -> Result<files::Snapshot, String> {
    command_api::local(&window)?;
    Ok(state.files.snapshot())
}
#[tauri::command]
pub fn file_clear_history(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.files.clear_history();
    Ok(())
}
#[tauri::command]
pub async fn file_connect(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Connect,
) -> Result<String, String> {
    command_api::local(&window)?;
    let _guard = state.workers.lock().await;
    state.allow_launch()?;
    if request.secrets.len() > 32 || request.secrets.values().any(|s| s.len() > 65536) {
        return Err("invalidRequest".into());
    }
    let snapshot = state.snapshot();
    let host = snapshot
        .hosts
        .iter()
        .find(|h| h.id == request.host_id)
        .ok_or("hostMissing")?
        .clone();
    if !host.diagnostics.is_empty() {
        return Err("hostBlocked".into());
    }
    if host
        .unsupported_session_options
        .iter()
        .any(|o| o != "SendEnv")
    {
        return Err("sessionOptions".into());
    }
    let mut route = resolve_jumps(&snapshot.hosts, &host)?;
    route.push(host.clone());
    let id = format!("files:{}", uuid::Uuid::new_v4());
    let cancel = CancellationToken::new();
    state
        .files
        .session_cancels
        .lock()
        .unwrap()
        .insert(id.clone(), cancel.clone());
    bind(state.inner(), &app);
    state.files.sessions.lock().unwrap().insert(
        id.clone(),
        files::Session {
            id: id.clone(),
            host_id: host.id.clone(),
            host_name: host.name.clone(),
            phase: "connecting".into(),
            fingerprint: None,
            endpoint: None,
            error: None,
            route: route.iter().map(|h| h.id.clone()).collect(),
        },
    );
    state
        .files
        .route_keys
        .lock()
        .unwrap()
        .insert(id.clone(), crate::service_control::identity(&route));
    let manager = state.files.clone();
    let sid = id.clone();
    let active: sessions::Active = Arc::new(move || {
        manager
            .sessions
            .lock()
            .unwrap()
            .get(&sid)
            .is_some_and(|s| s.phase != "disconnected")
    });
    let (hops, observer) = sessions::credentials(
        state.inner().clone(),
        app.clone(),
        &route,
        &request.secrets,
        &request.remember_host_ids,
        active.clone(),
    )?;
    let manager = state.files.clone();
    let sid = id.clone();
    let notify: tunnel::Notify =
        Arc::new(move |r| manager.session_change(&sid, |s| s.phase = r.status));
    let manager = state.files.clone();
    let sid = id.clone();
    let prompt = sessions::prompt(
        state.inner().clone(),
        id.clone(),
        active,
        Arc::new(move |endpoint, fingerprint| {
            manager.session_change(&sid, |s| {
                s.phase = "verifying-host".into();
                s.endpoint = Some(endpoint);
                s.fingerprint = Some(fingerprint);
            })
        }),
    );
    let task_state = state.inner().clone();
    let sid = id.clone();
    let job = tokio::spawn(async move {
        let result = async {
            let connection = tunnel::connect(
                hops,
                None,
                &cancel,
                &notify,
                prompt,
                &Arc::new(Mutex::new(Runtime::default())),
                Some(observer),
            )
            .await
            .map_err(|e| {
                match e.kind {
                    FailureKind::Authentication => "authenticationFailed",
                    FailureKind::HostKey => "hostKeyMismatch",
                    FailureKind::Timeout => "connectionTimeout",
                    _ => "connectionFailed",
                }
                .to_owned()
            })?
            .ok_or("cancelled")?;
            if cancel.is_cancelled() {
                return Err("cancelled".into());
            }
            let current = task_state.snapshot();
            if !route.iter().all(|h| {
                current
                    .hosts
                    .iter()
                    .any(|v| h.id == v.id && h.same_connection(v))
            }) {
                return Err("routeChanged".into());
            }
            let channel = connection.open_session().await.map_err(err)?;
            channel.request_subsystem(true, "sftp").await.map_err(err)?;
            let raw = RawSftpSession::new(channel.into_stream());
            raw.set_timeout(15);
            let version = raw.init().await.map_err(|_| "sftpUnavailable".to_owned())?;
            if cancel.is_cancelled() {
                return Err("cancelled".into());
            }
            task_state.files.remotes.lock().unwrap().insert(
                sid.clone(),
                Fs::Remote(Arc::new(Remote {
                    raw,
                    extensions: version.extensions,
                    _connection: connection,
                })),
            );
            Ok::<_, String>(())
        }
        .await;
        task_state.trust.lock().unwrap().remove(&sid);
        task_state.files.session_change(&sid, |s| {
            s.fingerprint = None;
            s.phase = if result.is_ok() {
                "connected"
            } else {
                "disconnected"
            }
            .into();
            s.error = result.err();
        });
    });
    state.files.track(job);
    state.files.publish();
    Ok(id)
}
#[tauri::command]
pub async fn file_list(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::WebviewWindow,
    session: Option<String>,
    path: String,
) -> Result<files::Directory, String> {
    command_api::local(&window)?;
    state.files.directory(session, path).await
}
#[tauri::command]
pub async fn file_sources(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::WebviewWindow,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    command_api::local(&window)?;
    state.files.ref_paths(paths).await
}
#[tauri::command]
pub async fn file_submit(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request_id: String,
    sources: Vec<String>,
    target: String,
) -> Result<String, String> {
    command_api::local(&window)?;
    state.allow_launch()?;
    bind(state.inner(), &app);
    state.files.submit(request_id, sources, target).await
}
#[tauri::command]
pub async fn file_control(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    action: String,
    session: Option<String>,
    source_session: Option<String>,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.allow_launch()?;
    state
        .files
        .control_between(&id, &action, session, source_session)
        .await
}
#[tauri::command]
pub fn file_disconnect(
    state: tauri::State<Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    command_api::local(&window)?;
    if let Some(c) = state.files.session_cancels.lock().unwrap().remove(&id) {
        c.cancel();
    }
    state.files.remotes.lock().unwrap().remove(&id);
    state.files.release_refs(&id);
    state.trust.lock().unwrap().remove(&id);
    state
        .files
        .session_change(&id, |s| s.phase = "disconnected".into());
    Ok(())
}
#[tauri::command]
pub async fn file_mutate(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::WebviewWindow,
    action: String,
    id: String,
    name: String,
) -> Result<(), String> {
    command_api::local(&window)?;
    state.allow_launch()?;
    state.files.mutate(&action, &id, &name).await
}
#[tauri::command]
pub async fn file_pick(window: tauri::WebviewWindow, folder: bool) -> Result<Vec<String>, String> {
    command_api::local(&window)?;
    tokio::task::spawn_blocking(move || {
        let d = rfd::FileDialog::new();
        let paths = if folder {
            d.pick_folders()
        } else {
            d.pick_files()
        };
        paths
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                p.to_str()
                    .map(str::to_owned)
                    .ok_or("invalidName".to_owned())
            })
            .collect()
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn file_reveal(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    command_api::local(&window)?;
    let e = state.files.entry(&id)?;
    if e.session.is_some() {
        return Err("invalidRequest".into());
    }
    #[cfg(windows)]
    {
        let path = files::fs::display_path(&e.path);
        tokio::process::Command::new("explorer.exe")
            .arg(format!("/select,{path}"))
            .creation_flags(0x08000000)
            .spawn()
            .map_err(err)?;
    }
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(&e.path)
            .spawn()
            .map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn file_open_target(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    command_api::local(&window)?;
    let path = state.files.local_target(&id)?;
    let path = Fs::Local.canonical(&path).await?;
    if Fs::Local
        .meta(&path)
        .await?
        .is_none_or(|m| m.kind != "directory")
    {
        return Err("notDirectory".into());
    }
    let path = files::fs::display_path(&path);
    #[cfg(windows)]
    {
        tokio::process::Command::new("explorer.exe")
            .arg(path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(err)?;
    }
    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("/usr/bin/open")
            .arg(path)
            .spawn()
            .map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn file_preview(
    state: tauri::State<'_, Arc<AppState>>,
    window: tauri::WebviewWindow,
    id: String,
    expanded: bool,
) -> Result<tauri::ipc::Response, String> {
    command_api::local(&window)?;
    let _slot = state
        .files
        .preview_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(err)?;
    let e = state.files.entry(&id)?;
    let ext = std::path::Path::new(&e.path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let image = ["png", "jpg", "jpeg", "webp", "gif"].contains(&ext.as_str());
    if !image
        && [
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar", "7z", "exe", "dll",
            "mp4", "mp3", "mov",
        ]
        .contains(&ext.as_str())
    {
        return Err("previewUnsupported".into());
    }
    let limit = if image {
        20 * 1024 * 1024
    } else if expanded {
        5 * 1024 * 1024
    } else {
        1024 * 1024
    };
    let (mut bytes, truncated) = state.files.preview(&id, limit).await?;
    if image {
        if truncated {
            return Err("previewLimit".into());
        }
        bytes = tokio::task::spawn_blocking(move || {
            use image::ImageReader;
            let reader = ImageReader::new(std::io::Cursor::new(&bytes))
                .with_guessed_format()
                .map_err(err)?;
            let (w, h) = reader.into_dimensions().map_err(err)?;
            if u64::from(w) * u64::from(h) > 40_000_000 {
                return Err("previewLimit".into());
            }
            let image = image::load_from_memory(&bytes).map_err(err)?;
            let mut output = std::io::Cursor::new(Vec::new());
            image
                .write_to(&mut output, image::ImageFormat::Png)
                .map_err(err)?;
            if output.get_ref().len() > 20 * 1024 * 1024 {
                return Err("previewLimit".into());
            }
            Ok::<_, String>(output.into_inner())
        })
        .await
        .map_err(err)??;
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    // This fixture tests AppState ownership with real local I/O. Encrypted SFTP is
    // tested independently by files::tests; no server success is inferred here.
    #[tokio::test]
    async fn file_work_participates_in_update_cleanup_and_protects_jump_hosts() {
        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("source");
        let dst = root.path().join("target");
        std::fs::create_dir(&src).unwrap();
        std::fs::create_dir(&dst).unwrap();
        std::fs::write(src.join("data"), b"isolated").unwrap();
        let state = AppState::isolated(root.path().join("connections.json"));
        let files = &state.files;
        files.sessions.lock().unwrap().insert(
            "fixture".into(),
            files::Session {
                id: "fixture".into(),
                host_id: "target-host".into(),
                host_name: "fixture".into(),
                phase: "connected".into(),
                fingerprint: None,
                endpoint: None,
                error: None,
                route: vec!["jump-host".into(), "target-host".into()],
            },
        );
        files
            .route_keys
            .lock()
            .unwrap()
            .insert("fixture".into(), "isolated-route".into());
        files
            .remotes
            .lock()
            .unwrap()
            .insert("fixture".into(), Fs::Local);
        let source = files
            .directory(None, src.to_str().unwrap().into())
            .await
            .unwrap();
        let target = files
            .directory(Some("fixture".into()), dst.to_str().unwrap().into())
            .await
            .unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        files
            .submit(id.clone(), vec![source.entries[0].id.clone()], target.id)
            .await
            .unwrap();
        assert!(files.busy_host("jump-host"));
        let work = state.active_work_ids().await;
        assert!(work.contains(&format!("files:{id}")));
        state.prepare_update(&work).await.unwrap();
        assert!(files.active_ids().is_empty());
        assert!(files.closing.load(std::sync::atomic::Ordering::SeqCst));
        state.finish_update_attempt();
        assert!(!files.closing.load(std::sync::atomic::Ordering::SeqCst));
        assert!(!dst.join("data").exists());
    }
}
