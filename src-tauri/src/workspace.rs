use crate::{
    app::{self, AppState},
    files, model, terminal,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, WebviewWindow};
use tokio_util::sync::CancellationToken;

// A new document gets a new owner even when it reloads in the same native window.
#[derive(Clone)]
pub struct Scope {
    owner: String,
    pub lifetime: CancellationToken,
}
impl Scope {
    pub fn main(&self) -> bool {
        self.owner == "main"
    }
    pub fn session_id(&self, kind: &str) -> String {
        let id = uuid::Uuid::new_v4();
        if self.main() {
            format!("{kind}:{id}")
        } else {
            format!("{kind}:{}:{id}", self.owner)
        }
    }
    pub fn owns(&self, id: &str) -> bool {
        owner(id) == self.owner
    }
    pub fn check(&self, id: &str) -> Result<(), String> {
        if self.lifetime.is_cancelled() || owner(id) != self.owner {
            Err("staleSession".into())
        } else {
            Ok(())
        }
    }
    pub fn check_optional(&self, id: Option<&str>) -> Result<(), String> {
        if let Some(id) = id {
            self.check(id)?;
        }
        Ok(())
    }
}
fn owner(id: &str) -> &str {
    id.split(':')
        .nth(1)
        .filter(|part| part.starts_with("vnc-"))
        .unwrap_or("main")
}
struct Document {
    scope: Scope,
    channel: Option<Channel<Update>>,
    preferred: Option<String>,
}
#[derive(Default)]
pub struct Workspaces {
    documents: Mutex<HashMap<String, Document>>,
    last_hosts: Mutex<Option<Vec<model::Host>>>,
}
#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum Update {
    Hosts {
        hosts: Vec<model::Host>,
        #[serde(rename = "addedHostIds")]
        added_host_ids: Vec<String>,
        preferred: Option<String>,
        revision: u64,
    },
    Terminals(Vec<terminal::Session>),
    Files(files::Snapshot),
    Drop(serde_json::Value),
}
impl Workspaces {
    pub fn reset(&self, label: &str, remove: bool) -> Option<Scope> {
        let mut docs = self.documents.lock().unwrap();
        let previous = docs.remove(label);
        if !remove {
            docs.insert(
                label.into(),
                Document {
                    scope: Scope {
                        owner: if label == "main" {
                            label.into()
                        } else {
                            format!("vnc-{}", uuid::Uuid::new_v4())
                        },
                        lifetime: CancellationToken::new(),
                    },
                    preferred: previous.as_ref().and_then(|d| d.preferred.clone()),
                    channel: None,
                },
            );
        }
        previous.map(|doc| {
            doc.scope.lifetime.cancel();
            doc.scope
        })
    }
    fn file_view(&self, scope: &Scope, mut snapshot: files::Snapshot) -> files::Snapshot {
        let docs = self.documents.lock().unwrap();
        snapshot.sessions.retain(|s| owner(&s.id) == scope.owner);
        snapshot.conflict_ids = Some(
            snapshot
                .tasks
                .iter()
                .filter(|t| t.phase == "conflict")
                .filter(|t| {
                    let from = owner(&t.session_id);
                    from == scope.owner
                        || (scope.main() && !docs.values().any(|d| d.scope.owner == from))
                })
                .map(|t| t.id.clone())
                .collect(),
        );
        snapshot
    }
    fn subscribers(&self) -> Vec<(Scope, Channel<Update>, Option<String>)> {
        self.documents
            .lock()
            .unwrap()
            .values()
            .filter_map(|d| Some((d.scope.clone(), d.channel.clone()?, d.preferred.clone())))
            .collect()
    }
}
pub fn drag_drop(window: &tauri::Window, event: &tauri::DragDropEvent) {
    use serde_json::json;
    let registry = window.state::<Workspaces>();
    let channel = registry
        .documents
        .lock()
        .unwrap()
        .get(window.label())
        .and_then(|doc| doc.channel.clone());
    if let Some(channel) = channel {
        let data = match event {
            tauri::DragDropEvent::Enter { paths, position } => {
                json!({"type":"enter","paths":paths,"position":position})
            }
            tauri::DragDropEvent::Over { position } => json!({"type":"over","position":position}),
            tauri::DragDropEvent::Drop { paths, position } => {
                json!({"type":"drop","paths":paths,"position":position})
            }
            tauri::DragDropEvent::Leave => json!({"type":"leave"}),
            _ => return,
        };
        let _ = channel.send(Update::Drop(data));
    }
}
pub fn scope(window: &WebviewWindow) -> Result<Scope, String> {
    app::command_api::local_origin(window)?;
    window
        .state::<Workspaces>()
        .documents
        .lock()
        .unwrap()
        .get(window.label())
        .map(|d| d.scope.clone())
        .ok_or_else(|| "unauthorizedWindow".into())
}
fn hosts(snapshot: &model::Snapshot, preferred: Option<String>) -> Update {
    let ids = &snapshot.added_host_ids;
    Update::Hosts {
        hosts: snapshot
            .hosts
            .iter()
            .filter(|h| ids.contains(&h.id))
            .cloned()
            .collect(),
        added_host_ids: ids.clone(),
        preferred: preferred.filter(|id| ids.contains(id)),
        revision: snapshot.revision,
    }
}
pub fn preferred(app: &AppHandle, label: &str, host: String) {
    if let Some(doc) = app
        .state::<Workspaces>()
        .documents
        .lock()
        .unwrap()
        .get_mut(label)
    {
        doc.preferred = Some(host);
    }
}
pub fn publish_hosts(app: &AppHandle, snapshot: &model::Snapshot) {
    let registry = app.state::<Workspaces>();
    let subscribers = registry.subscribers();
    if subscribers.is_empty() {
        return;
    }
    // Traffic counters also publish app snapshots. Only forward picker changes.
    let picker: Vec<_> = snapshot
        .hosts
        .iter()
        .filter(|h| snapshot.added_host_ids.binary_search(&h.id).is_ok())
        .cloned()
        .collect();
    {
        let mut last = registry.last_hosts.lock().unwrap();
        if last.as_ref() == Some(&picker) {
            return;
        }
        *last = Some(picker);
    }
    for (_, channel, preferred) in subscribers {
        let _ = channel.send(hosts(snapshot, preferred));
    }
}
pub fn publish_terminals(app: &AppHandle, sessions: Vec<terminal::Session>) {
    for (scope, channel, _) in app.state::<Workspaces>().subscribers() {
        let _ = channel.send(Update::Terminals(
            sessions
                .iter()
                .filter(|s| owner(&s.id) == scope.owner)
                .cloned()
                .collect(),
        ));
    }
    let _ = app.emit_to(
        "main",
        "terminal://sessions",
        sessions
            .into_iter()
            .filter(|s| owner(&s.id) == "main")
            .collect::<Vec<_>>(),
    );
}
pub fn files_for(
    window: &WebviewWindow,
    scope: &Scope,
    snapshot: files::Snapshot,
) -> files::Snapshot {
    window.state::<Workspaces>().file_view(scope, snapshot)
}
pub fn publish_files(app: &AppHandle, snapshot: files::Snapshot) {
    let workspaces = app.state::<Workspaces>();
    for (scope, channel, _) in workspaces.subscribers() {
        let _ = channel.send(Update::Files(
            workspaces.file_view(&scope, snapshot.clone()),
        ));
    }
    let main = workspaces
        .documents
        .lock()
        .unwrap()
        .get("main")
        .map(|d| d.scope.clone());
    if let Some(scope) = main {
        let _ = app.emit_to(
            "main",
            "files://snapshot",
            workspaces.file_view(&scope, snapshot),
        );
    }
}
#[tauri::command]
pub fn vnc_workspace_watch(
    window: WebviewWindow,
    state: tauri::State<Arc<AppState>>,
    updates: Channel<Update>,
) -> Result<(), String> {
    let scope = scope(&window)?;
    let registry = window.state::<Workspaces>();
    let preferred = {
        let mut docs = registry.documents.lock().unwrap();
        let doc = docs
            .get_mut(window.label())
            .filter(|d| d.scope.owner == scope.owner)
            .ok_or("staleSession")?;
        doc.channel = Some(updates.clone());
        *registry.last_hosts.lock().unwrap() = None;
        doc.preferred.clone()
    };
    updates
        .send(hosts(&state.snapshot(), preferred))
        .map_err(|e| e.to_string())?;
    updates
        .send(Update::Terminals(state.workspace_terminals(&scope)))
        .map_err(|e| e.to_string())?;
    updates
        .send(Update::Files(
            registry.file_view(&scope, state.workspace_files()),
        ))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reload_revokes_the_old_document_and_leaves_other_windows_alive() {
        let registry = Workspaces::default();
        for label in ["main", "vnc-a", "vnc-b"] {
            registry.reset(label, false);
        }
        let scope = |label: &str| {
            registry
                .documents
                .lock()
                .unwrap()
                .get(label)
                .unwrap()
                .scope
                .clone()
        };
        let a = scope("vnc-a");
        let b = scope("vnc-b");
        let pty = a.session_id("terminal");
        let files = a.session_id("files");
        assert!(a.check(&pty).is_ok());
        assert!(b.check(&pty).is_err());
        assert!(scope("main").check(&files).is_err());
        registry.reset("vnc-a", false);
        assert!(a.check(&pty).is_err());
        assert!(scope("vnc-a").check(&files).is_err());
        assert!(b.check(&b.session_id("terminal")).is_ok());
        assert!(scope("main").check("terminal:legacy-session").is_ok());
    }
}
