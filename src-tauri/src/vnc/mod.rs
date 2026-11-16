//! Each native desktop window owns one validated endpoint and one cancellable RFB session.
mod clipboard;
mod frame;
#[cfg(test)]
mod protocol_tests;
mod rfb;
#[cfg(windows)]
mod shared_buffer;
#[cfg(test)]
mod tests;

use serde::Deserialize;
use std::{
    collections::HashMap,
    io,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{ipc::Response, AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::{
    net::TcpStream,
    sync::{mpsc, Mutex as AsyncMutex},
};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

#[derive(Clone, Debug, PartialEq)]
pub struct Endpoint {
    host: String,
    port: u16,
}
impl Endpoint {
    pub fn parse(value: &str) -> Result<Self, String> {
        let bad = || "Invalid VNC address".to_owned();
        if value.len() > 512 || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(bad());
        }
        let (scheme, authority) = value.split_once("://").ok_or_else(bad)?;
        let authority = authority.strip_suffix('/').unwrap_or(authority);
        if !scheme.eq_ignore_ascii_case("vnc")
            || authority.is_empty()
            || authority.contains(['@', '?', '#', '/', '%', '\\'])
        {
            return Err(bad());
        }
        let url = tauri::Url::parse(value).map_err(|_| bad())?;
        let host = url
            .host_str()
            .ok_or_else(bad)?
            .trim_start_matches('[')
            .trim_end_matches(']');
        if host.parse::<IpAddr>().is_err()
            && (host.len() > 253
                || !host.split('.').all(|s| {
                    !s.is_empty()
                        && s.len() <= 63
                        && !s.starts_with('-')
                        && !s.ends_with('-')
                        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                }))
        {
            return Err(bad());
        }
        let port = url.port().unwrap_or(5900);
        if port == 0 || authority.ends_with(':') {
            return Err(bad());
        }
        Ok(Self {
            host: host.into(),
            port,
        })
    }
    pub fn address(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

enum Input {
    Password(Zeroizing<String>, bool),
    Wire(Vec<u8>),
    Clipboard { text: String, keys: Vec<u8> },
}
struct Session {
    credential: Option<crate::credentials::VncCredential>,
    id: String,
    cancel: CancellationToken,
    input: mpsc::Sender<Input>,
    output: AsyncMutex<mpsc::Receiver<Result<Vec<u8>, String>>>,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
struct Viewer {
    endpoint: Endpoint,
    session: Option<Arc<Session>>,
}
#[derive(Default)]
pub struct Viewers(Mutex<HashMap<String, Viewer>>);
impl Viewers {
    pub fn stop(&self, label: &str) {
        if let Some(s) = self
            .0
            .lock()
            .unwrap()
            .get_mut(label)
            .and_then(|v| v.session.take())
        {
            s.cancel.cancel();
        }
    }
    pub fn remove(&self, label: &str) {
        if let Some(s) = self.0.lock().unwrap().remove(label).and_then(|v| v.session) {
            s.cancel.cancel();
        }
    }
    fn session(&self, label: &str, id: &str) -> Result<Arc<Session>, String> {
        self.0
            .lock()
            .unwrap()
            .get(label)
            .and_then(|v| v.session.as_ref())
            .filter(|s| s.id == id)
            .cloned()
            .ok_or_else(|| "VNC session closed".into())
    }
}

pub fn open(app: &AppHandle, endpoint: Endpoint) -> Result<(), String> {
    let snapshot = crate::app::state(app).snapshot();
    let preferred = endpoint.workspace_host(&snapshot);
    open_with_host(app, endpoint, preferred)
}
impl Endpoint {
    fn forwards<'a>(
        &self,
        snapshot: &'a crate::model::Snapshot,
    ) -> Vec<(&'a crate::model::Rule, &'a crate::model::Host)> {
        let mut matches = Vec::new();
        for rule in &snapshot.rules {
            if rule.service_protocol != Some(crate::model::ServiceProtocol::Vnc) {
                continue;
            }
            let Some(runtime) = snapshot.runtimes.iter().find(|r| r.rule_id == rule.id) else {
                continue;
            };
            let Some(host) = &runtime.host_snapshot else {
                continue;
            };
            if crate::service::service_url(rule, host, runtime)
                .ok()
                .and_then(|url| Endpoint::parse(&url).ok())
                .as_ref()
                == Some(self)
            {
                matches.push((rule, host));
            }
        }
        matches
    }
    fn workspace_host(&self, snapshot: &crate::model::Snapshot) -> Option<String> {
        let mut matches: std::collections::BTreeSet<_> = self
            .forwards(snapshot)
            .iter()
            .map(|(r, _)| r.host_id.clone())
            .collect();
        if matches.is_empty() {
            matches.extend(
                snapshot
                    .hosts
                    .iter()
                    .filter(|h| {
                        snapshot.added_host_ids.contains(&h.id)
                            && !h.hidden
                            && h.address
                                .trim_matches(['[', ']'])
                                .eq_ignore_ascii_case(&self.host)
                    })
                    .map(|h| h.id.clone()),
            );
        }
        if matches.len() == 1 {
            matches.pop_first()
        } else {
            None
        }
    }
    fn credential_binding(&self, snapshot: &crate::model::Snapshot) -> Vec<u8> {
        let mut routes: Vec<_> = self
            .forwards(snapshot)
            .into_iter()
            .map(|(r, h)| {
                (
                    &r.id,
                    &r.host_id,
                    crate::credentials::binding(h),
                    &r.target_host,
                    r.target_port,
                )
            })
            .collect();
        routes.sort();
        serde_json::to_vec(&(self.address().to_ascii_lowercase(), routes))
            .expect("VNC address and routes serialize")
    }
}
pub fn open_with_host(
    app: &AppHandle,
    endpoint: Endpoint,
    preferred: Option<String>,
) -> Result<(), String> {
    let label = format!("vnc-{}", uuid::Uuid::new_v4());
    let title = format!("{} · VNC · OriaTunnel", endpoint.address());
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("Missing main window configuration")?
        .clone();
    config.label = label.clone();
    config.url = WebviewUrl::App("index.html#vnc".into());
    config.title = title;
    config.visible = true;
    config.width = 1024.;
    config.height = 720.;
    config.min_width = Some(480.);
    config.min_height = Some(320.);
    config.drag_drop_enabled = true;
    let builder = WebviewWindowBuilder::from_config(app, &config).map_err(|e| e.to_string())?;
    let viewers = app.state::<Viewers>();
    viewers.0.lock().unwrap().insert(
        label.clone(),
        Viewer {
            endpoint,
            session: None,
        },
    );
    app.state::<crate::workspace::Workspaces>()
        .reset(&label, false);
    if let Some(host) = preferred {
        crate::workspace::preferred(app, &label, host);
    }
    if let Err(e) = builder.build() {
        app.state::<crate::workspace::Workspaces>()
            .reset(&label, true);
        viewers.remove(&label);
        return Err(e.to_string());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowAction {
    Close,
    Minimize,
    ToggleMaximize,
    IsMaximized,
    ToggleFullscreen,
    IsFullscreen,
    StartDragging,
}

#[tauri::command]
pub async fn vnc_window_action(window: WebviewWindow, action: WindowAction) -> tauri::Result<bool> {
    match action {
        WindowAction::Close => window.close()?,
        WindowAction::Minimize => window.minimize()?,
        WindowAction::StartDragging => window.start_dragging()?,
        WindowAction::IsMaximized => return window.is_maximized(),
        WindowAction::IsFullscreen => return window.is_fullscreen(),
        WindowAction::ToggleFullscreen => {
            let fullscreen = !window.is_fullscreen()?;
            window.set_fullscreen(fullscreen)?;
            return Ok(fullscreen);
        }
        WindowAction::ToggleMaximize => {
            if window.is_fullscreen()? {
                window.set_fullscreen(false)?;
            }
            let maximized = window.is_maximized()?;
            if maximized {
                window.unmaximize()?;
            } else {
                window.maximize()?;
            }
            return Ok(!maximized);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn vnc_window_theme(window: WebviewWindow, theme: Option<tauri::Theme>) -> tauri::Result<()> {
    window.set_theme(theme)
}

#[tauri::command]
pub fn vnc_endpoint(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
) -> Result<String, String> {
    viewers
        .0
        .lock()
        .unwrap()
        .get(window.label())
        .map(|v| v.endpoint.address())
        .ok_or_else(|| "Unknown VNC window".into())
}

#[tauri::command]
pub fn vnc_begin(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
    skip_saved: Option<bool>,
) -> Result<String, String> {
    let state = crate::app::state(window.app_handle());
    let snapshot = state.snapshot();
    let mut all = viewers.0.lock().unwrap();
    let view = all.get_mut(window.label()).ok_or("Unknown VNC window")?;
    let credential = crate::credentials::SUPPORTED
        .then(|| state.vnc_credential(&view.endpoint.credential_binding(&snapshot)));
    Ok(view.begin(credential, skip_saved.unwrap_or(false)))
}

impl Viewer {
    fn begin(
        &mut self,
        credential: Option<crate::credentials::VncCredential>,
        skip_saved: bool,
    ) -> String {
        let endpoint = self.endpoint.clone();
        if let Some(old) = self.session.take() {
            old.cancel.cancel();
        }
        let cancel = CancellationToken::new();
        let (input, mut commands) = mpsc::channel(32);
        let (out, output) = mpsc::channel(1);
        let id = uuid::Uuid::new_v4().to_string();
        self.session = Some(Arc::new(Session {
            credential: credential.clone(),
            id: id.clone(),
            cancel: cancel.clone(),
            input,
            output: AsyncMutex::new(output),
        }));
        tauri::async_runtime::spawn(async move {
            let connect = async {
                let stream = tokio::time::timeout(
                    Duration::from_secs(15),
                    TcpStream::connect((endpoint.host.as_str(), endpoint.port)),
                )
                .await
                .map_err(|_| crate::native_message::plain("vncTimeout"))?
                .map_err(|e| {
                    crate::native_message::message(
                        "vncUnreachable",
                        serde_json::json!({"detail": e.to_string()}),
                    )
                })?;
                stream.set_nodelay(true).map_err(session_error)?;
                rfb::run(stream, &mut commands, &out, credential.as_ref(), skip_saved)
                    .await
                    .map_err(session_error)
            };
            tokio::select! {
                _ = cancel.cancelled() => {}
                _ = async {
                    if let Err(error) = connect.await {
                        let _ = out.send(Err(error)).await;
                    }
                } => {}
            }
        });
        id
    }
}

fn session_error(error: io::Error) -> String {
    let detail = error.to_string();
    if crate::native_message::key(&detail).is_some() {
        return detail;
    }
    match error.kind() {
        io::ErrorKind::TimedOut => crate::native_message::plain("vncTimeout"),
        io::ErrorKind::InvalidData => crate::native_message::plain("vncProtocol"),
        _ => crate::native_message::message(
            "vncDisconnected",
            serde_json::json!({ "detail": detail }),
        ),
    }
}

#[tauri::command]
pub async fn vnc_next(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
    id: String,
    shared: Option<bool>,
) -> Result<Response, String> {
    let session = viewers.session(window.label(), &id)?;
    let mut output = session.output.lock().await;
    let packet = tokio::select! {
        _=session.cancel.cancelled()=>return Err("VNC session closed".into()),
        msg=output.recv()=>msg.ok_or("VNC disconnected")??,
    };
    #[cfg(windows)]
    if shared == Some(true) && packet.len() >= 512 * 1024 && matches!(packet[0], 9 | 10) {
        return shared_buffer::deliver(window, session.cancel.clone(), id, packet).await;
    }
    #[cfg(not(windows))]
    let _ = shared;
    Ok(Response::new(packet))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    Key {
        keysym: u32,
        down: bool,
    },
    Pointer {
        x: u16,
        y: u16,
        buttons: u8,
    },
    Password {
        password: String,
        #[serde(default)]
        remember: bool,
    },
    Text {
        text: String,
    },
    Paste {
        text: String,
        #[serde(rename = "controlHeld")]
        control_held: bool,
    },
}
fn key_packet(keysym: u32, down: bool) -> [u8; 8] {
    let [a, b, c, d] = keysym.to_be_bytes();
    [4, u8::from(down), 0, 0, a, b, c, d]
}
#[tauri::command]
pub async fn vnc_input(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
    id: String,
    action: Action,
) -> Result<(), String> {
    let session = viewers.session(window.label(), &id)?;
    let input = match action {
        Action::Password { password, remember } => {
            Input::Password(Zeroizing::new(password), remember)
        }
        Action::Text { text } => Input::Clipboard {
            text,
            keys: Vec::new(),
        },
        Action::Paste { text, control_held } => {
            let mut keys = Vec::new();
            if !control_held {
                keys.extend(key_packet(0xffe3, true));
            }
            keys.extend(key_packet(u32::from(b'v'), true));
            keys.extend(key_packet(u32::from(b'v'), false));
            if !control_held {
                keys.extend(key_packet(0xffe3, false));
            }
            Input::Clipboard { text, keys }
        }
        Action::Key { keysym, down } => Input::Wire(key_packet(keysym, down).into()),
        Action::Pointer { x, y, buttons } => {
            let mut data = vec![5, buttons];
            data.extend(x.to_be_bytes());
            data.extend(y.to_be_bytes());
            Input::Wire(data)
        }
    };
    if matches!(&input, Input::Clipboard { text, .. } if text.len() > clipboard::MAX_TEXT) {
        return Err("Clipboard text exceeds 1 MiB".into());
    }
    session
        .input
        .send(input)
        .await
        .map_err(|_| "VNC session closed".into())
}
#[tauri::command]
pub fn vnc_forget_password(
    window: WebviewWindow,
    viewers: tauri::State<'_, Viewers>,
    id: String,
) -> Result<(), String> {
    if let Some(vault) = &viewers.session(window.label(), &id)?.credential {
        vault.forget()?;
    }
    Ok(())
}
#[tauri::command]
pub fn vnc_end(window: WebviewWindow, viewers: tauri::State<'_, Viewers>, id: String) {
    let mut windows = viewers.0.lock().unwrap();
    if let Some(session) = windows
        .get_mut(window.label())
        .and_then(|viewer| viewer.session.take_if(|session| session.id == id))
    {
        session.cancel.cancel();
    }
}

pub fn launch(app: &AppHandle, url: &str, host_id: String, internal: bool) -> Result<(), String> {
    if internal {
        return open_with_host(app, Endpoint::parse(url)?, Some(host_id));
    }
    open_default(app, url)
}

fn open_default(app: &AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let failed = |detail: String| {
        crate::native_message::message("openVncFailed", serde_json::json!({ "e": detail }))
    };
    #[cfg(windows)]
    windows_protocol_handler(windows::core::w!("vnc"))
        .map_err(|error| failed(error.to_string()))?;
    #[allow(deprecated)]
    app.shell()
        .open(url, None)
        .map_err(|e| failed(e.to_string()))
}

#[cfg(windows)]
fn windows_protocol_handler(scheme: windows::core::PCWSTR) -> windows::core::Result<()> {
    use windows::Win32::{
        Foundation::ERROR_NO_ASSOCIATION,
        UI::Shell::{
            AssocQueryStringW, ASSOCF_IS_PROTOCOL, ASSOCSTR_COMMAND, ASSOCSTR_DDECOMMAND,
            ASSOCSTR_DELEGATEEXECUTE, ASSOCSTR_DROPTARGET,
        },
    };
    // A bare URL Protocol marker resolves to its own ProgID even with no
    // handler. Check the resolved verb, including COM-based packaged handlers.
    for field in [
        ASSOCSTR_COMMAND,
        ASSOCSTR_DELEGATEEXECUTE,
        ASSOCSTR_DROPTARGET,
        ASSOCSTR_DDECOMMAND,
    ] {
        let mut length = 0;
        if unsafe { AssocQueryStringW(ASSOCF_IS_PROTOCOL, field, scheme, None, None, &mut length) }
            .is_ok()
            && length > 1
        {
            return Ok(());
        }
    }
    Err(ERROR_NO_ASSOCIATION.to_hresult().into())
}

#[tauri::command]
pub fn choose_default_vnc(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri_plugin_shell::ShellExt;
        #[allow(deprecated)]
        app.shell()
            .open("ms-settings:defaultapps?registeredAppUser=OriaTunnel", None)
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::NSString;
        #[link(name = "CoreServices", kind = "framework")]
        extern "C" {
            fn LSSetDefaultHandlerForURLScheme(
                scheme: *const std::ffi::c_void,
                bundle: *const std::ffi::c_void,
            ) -> i32;
        }
        let scheme = NSString::from_str("vnc");
        let bundle = NSString::from_str(&app.config().identifier);
        let result = unsafe {
            LSSetDefaultHandlerForURLScheme(
                std::ptr::from_ref(&*scheme).cast(),
                std::ptr::from_ref(&*bundle).cast(),
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(format!("Launch Services error {result}"))
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        Err("Unsupported platform".into())
    }
}
