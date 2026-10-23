import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  WindowAppearance,
  Snapshot,
  Host,
  Rule,
  BatchResult,
  ImportPreview,
  ImportChoices,
  ImportSource,
} from "@/types";
export const desktop = isTauri();
export const openExternalUrl = (url: string) =>
  invoke<void>("open_external_url", { url });
export const setWindowAppearance = (appearance: WindowAppearance) =>
  desktop ? invoke("set_window_appearance", { appearance }) : Promise.resolve();
export const setWorkWindowAppearance = setWindowAppearance;
export const snapshot = () =>
  desktop
    ? invoke<Snapshot>("snapshot")
    : Promise.resolve({
        hosts: [],
        rules: [],
        runtimes: [],
        diagnostics: ["browserPreview"],
        revision: 0,
        closeToTray: true,
        agentSupported: false,
        sourceFiles: [],
        autoSyncHosts: true,
        activity: [],
        undoCount: 0,
        autostart: false,
        autostartSupported: false,
      });
export const refreshHosts = () =>
  invoke<Snapshot>("refresh_hosts", { manual: true });
export const syncHosts = () =>
  invoke<Snapshot>("refresh_hosts", { manual: false });
export const setHostSources = (files: string[], autoSync: boolean) =>
  invoke<Snapshot>("set_host_sources", { files, autoSync });
export const saveHost = (host: Host) => invoke<Snapshot>("save_host", { host });
export const pickIdentityFile = () => invoke<string | null>("pick_identity_file");
export const pickSshConfigFile = () => invoke<string | null>("pick_ssh_config_file");
export const saveHostMetadata = (host: Host) =>
  invoke<Snapshot>("save_host_metadata", {
    id: host.id,
    name: host.name,
    tags: host.tags,
  });
export const saveRule = (rule: Rule) => invoke<Snapshot>("save_rule", { rule });
export const deleteRule = (id: string) =>
  invoke<Snapshot>("delete_rule", { id });
export const deleteHost = (id: string) =>
  invoke<Snapshot>("delete_host", { id });
export const hideHost = (id: string, hidden: boolean) =>
  invoke<Snapshot>("hide_host", { id, hidden });
export const setCloseToTray = (enabled: boolean) =>
  invoke<Snapshot>("set_close_to_tray", { enabled });
export const quitApp = () => invoke<void>("quit_app");
export const undoDelete = () => invoke<Snapshot>("undo_delete");
export const setAutostart = (enabled: boolean) =>
  invoke<Snapshot>("set_autostart", { enabled });
export const startBatch = (ids: string[], secrets: Record<string, string>) =>
  invoke<BatchResult[]>("start_batch", { ids, secrets });
export const stopBatch = (ids: string[]) =>
  invoke<BatchResult[]>("stop_batch", { ids });
export const exportConfig = (ids: string[]) =>
  invoke<string | null>("export_config", { ids, includeKeyPaths: false });
export const previewImport = (source: ImportSource) =>
  invoke<ImportPreview>("preview_import_file", { source });
export const commitImport = (token: string, choices: ImportChoices) =>
  invoke<Snapshot>("commit_import", { token, choices });
export const cancelImport = () => invoke<void>("cancel_import");
export const startRule = (
  id: string,
  secret: string,
  jumpSecrets: Record<string, string> = {},
) => invoke("start_rule", { id, secret, jumpSecrets });
export const stopRule = (id: string) => invoke("stop_rule", { id });
export const testHost = (
  id: string,
  secret: string,
  jumpSecrets: Record<string, string> = {},
) => invoke("test_host", { id, secret, jumpSecrets });
export const trustHost = (id: string, runId: string, fingerprint: string) =>
  invoke("trust_host", { id, runId, fingerprint });
