use tauri::{ipc::Response, webview::PlatformWebview, WebviewWindow};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use webview2_com::{
    take_pwstr,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment12, ICoreWebView2_17, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
    },
};
use windows::core::{Interface, HSTRING, PWSTR};

// A one-time mapping belongs to this pull only. The renderer consumes its
// read-only bytes before releasing it. No mapping is reused across sessions.
fn post(view: PlatformWebview, id: &str, bytes: &[u8]) -> windows::core::Result<bool> {
    unsafe {
        let core = view.controller().CoreWebView2()?;
        let mut source = PWSTR::null();
        core.Source(&mut source)?;
        if !matches!(
            take_pwstr(source).as_str(),
            "http://tauri.localhost/index.html#vnc" | "https://tauri.localhost/index.html#vnc"
        ) {
            return Ok(false);
        }
        let receiver: ICoreWebView2_17 = core.cast()?;
        let env: ICoreWebView2Environment12 = view.environment().cast()?;
        let buffer = env.CreateSharedBuffer(bytes.len() as u64)?;
        let mut target = std::ptr::null_mut();
        buffer.Buffer(&mut target)?;
        // The mapping has exactly bytes.len() writable bytes and is still private.
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), target, bytes.len());
        let metadata = HSTRING::from(serde_json::json!({ "vncSession": id }).to_string());
        receiver.PostSharedBufferToScript(
            &buffer,
            COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
            &metadata,
        )?;
        Ok(true)
    }
}

pub(super) async fn deliver(
    window: WebviewWindow,
    cancel: CancellationToken,
    id: String,
    packet: Vec<u8>,
) -> Result<Response, String> {
    let (send, result) = oneshot::channel();
    window
        .with_webview(move |view| {
            if !cancel.is_cancelled() {
                // Empty response acknowledges the separate shared-buffer event.
                // Older runtimes and unsupported pages keep the binary IPC path.
                let posted = post(view, &id, &packet).unwrap_or(false);
                let _ = send.send(if posted { Vec::new() } else { packet });
            }
        })
        .map_err(|e| e.to_string())?;
    result
        .await
        .map(Response::new)
        .map_err(|_| "VNC session closed".into())
}
