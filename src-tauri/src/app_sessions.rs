//! Shared credential and trust adaptation for user-initiated SSH sessions.
use super::*;
pub(super) type Active = Arc<dyn Fn() -> bool + Send + Sync>;
pub(super) type TrustChanged = Arc<dyn Fn(String, String) + Send + Sync>;
pub(super) fn credentials(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    route: &[Host],
    secrets: &BTreeMap<String, String>,
    remember: &[String],
    active: Active,
) -> Result<(Vec<tunnel::HopRequest>, tunnel::PasswordObserver), String> {
    let mut saves = BTreeMap::new();
    let mut hops = Vec::new();
    for h in route {
        let supplied = secrets.get(&h.id).cloned().unwrap_or_default();
        if !supplied.is_empty()
            && remember.contains(&h.id)
            && matches!(h.auth_method, AuthMethod::Auto | AuthMethod::Password)
        {
            saves.insert(h.id.clone(), state.vault.epoch(&h.id));
        }
        let secret = if supplied.is_empty()
            && matches!(h.auth_method, AuthMethod::Auto | AuthMethod::Password)
        {
            state.vault.read(h)?.unwrap_or_default()
        } else {
            supplied.into()
        };
        let expected = state
            .config
            .lock()
            .unwrap()
            .trusted_keys
            .get(&format!("{}:{}", h.address, h.port))
            .cloned();
        hops.push(tunnel::HopRequest {
            host: h.clone(),
            secret,
            expected,
        });
    }
    let observer: tunnel::PasswordObserver = Arc::new(move |host, password, method| {
        let Some(epoch) = saves.get(&host.id) else {
            return;
        };
        if !active()
            || !state.snapshot().hosts.iter().any(|h| {
                h.id == host.id
                    && h.diagnostics.is_empty()
                    && crate::credentials::binding(h) == crate::credentials::binding(host)
            })
        {
            return;
        }
        if let Err(error) = state.vault.save(host, password, method, *epoch) {
            let _ = app.emit("tunnel://password-error", error);
        }
    });
    Ok((hops, observer))
}
pub(super) fn prompt(
    state: Arc<AppState>,
    id: String,
    active: Active,
    changed: TrustChanged,
) -> tunnel::TrustPrompt {
    Arc::new(move |endpoint, fingerprint, reply| {
        if !active() {
            return;
        }
        state.trust.lock().unwrap().insert(
            id.clone(),
            PendingTrust {
                run_id: id.clone(),
                endpoint: endpoint.clone(),
                fingerprint: fingerprint.clone(),
                reply,
            },
        );
        changed(endpoint, fingerprint);
    })
}
