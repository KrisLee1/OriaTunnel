import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  WindowAppearance,
  Snapshot,
  Host,
  Rule,
  BatchResult,
  ImportPreview,
  ImportChoices,
  ImportSource,
  ResolvedApplicationIcon,
  UpdateSnapshot,
} from "@/types";
export const desktop = isTauri();
export const updateSnapshot = () => invoke<UpdateSnapshot>("update_snapshot");
export const checkUpdate = () => invoke<UpdateSnapshot>("check_update");
export const downloadUpdate = (version: string) =>
  invoke<UpdateSnapshot>("download_update", { version });
export const setUpdateAutoCheck = (enabled: boolean) =>
  invoke<UpdateSnapshot>("set_update_auto_check", { enabled });
export const updateInstallContext = () =>
  invoke<string[]>("update_install_context");
export const installUpdate = (version: string, expectedWorkIds: string[]) =>
  invoke<UpdateSnapshot>("install_update", { version, expectedWorkIds });
export const setApplicationIcon = (icon: ResolvedApplicationIcon) =>
  invoke<void>("set_application_icon", { icon });
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
export const setHostServices = (
  hostId: string,
  links: import("@/types").ServiceLink[],
) => invoke<Snapshot>("set_host_services", { hostId, links });
export const addDiscoveredHosts = (ids: string[]) =>
  invoke<Snapshot>("add_discovered_hosts", { ids });
export const pickIdentityFile = () =>
  invoke<string | null>("pick_identity_file");
export const pickSshConfigFile = () =>
  invoke<string | null>("pick_ssh_config_file");
export const saveHostMetadata = (host: Host) =>
  invoke<Snapshot>("save_host_metadata", {
    id: host.id,
    name: host.name,
    tags: host.tags,
  });
export const openService = (id: string) => invoke<void>("open_service", { id });
export type ProxyBrowser = "edge" | "chrome" | "firefox";
export const openProxyBrowser = (
  id: string,
  browser: ProxyBrowser,
  serviceId?: string,
) => invoke<void>("open_proxy_browser", { id, browser, serviceId });
export const saveRule = (
  rule: Rule,
  serviceLinks?: import("@/types").ServiceLink[],
) => invoke<Snapshot>("save_rule", { rule, serviceLinks });
export const deleteRule = (id: string) =>
  invoke<Snapshot>("delete_rule", { id });
export const deleteRules = (ids: string[]) =>
  invoke<Snapshot>("delete_rules", { ids });
export const deleteHost = (id: string, expectedRuleIds: string[]) =>
  invoke<Snapshot>("delete_host", { id, expectedRuleIds });
export const hideHost = (id: string, hidden: boolean) =>
  invoke<Snapshot>("hide_host", { id, hidden });
export const setCloseToTray = (enabled: boolean) =>
  invoke<Snapshot>("set_close_to_tray", { enabled });
export const showMainWindow = () => invoke<void>("show_main_window");
export const quitApp = () => invoke<void>("quit_app");
export const undoDelete = () => invoke<Snapshot>("undo_delete");
export const setAutostart = (enabled: boolean) =>
  invoke<Snapshot>("set_autostart", { enabled });
export const startBatch = (
  ids: string[],
  secrets: Record<string, string>,
  rememberHostIds: string[] = [],
) => invoke<BatchResult[]>("start_batch", { ids, secrets, rememberHostIds });
export type PasswordStatus = {
  id: string;
  supported: boolean;
  saved: boolean;
  error: string | null;
};
export const passwordStatus = (ids: string[]) =>
  invoke<PasswordStatus[]>("password_status", { ids });
export const clearPassword = (id: string) =>
  invoke<void>("clear_password", { id });
export const stopBatch = (ids: string[]) =>
  invoke<BatchResult[]>("stop_batch", { ids });
export const exportConfig = (ids: string[], serviceIds: string[] = []) =>
  invoke<string | null>("export_config", {
    ids,
    serviceIds,
    includeKeyPaths: false,
  });
export const previewImport = (source: ImportSource) =>
  invoke<ImportPreview>("preview_import_file", { source });
export const commitImport = (token: string, choices: ImportChoices) =>
  invoke<Snapshot>("commit_import", { token, choices });
export const cancelImport = () => invoke<void>("cancel_import");
export const startRule = (
  id: string,
  secret: string,
  jumpSecrets: Record<string, string> = {},
  rememberHostIds: string[] = [],
) => invoke("start_rule", { id, secret, jumpSecrets, rememberHostIds });
export const stopRule = (id: string) => invoke("stop_rule", { id });
export const testHost = (
  id: string,
  secret: string,
  jumpSecrets: Record<string, string> = {},
  rememberHostIds: string[] = [],
) => invoke("test_host", { id, secret, jumpSecrets, rememberHostIds });
export const trustHost = (id: string, runId: string, fingerprint: string) =>
  invoke("trust_host", { id, runId, fingerprint });

export const saveServiceProfile = (service: import("@/types").RemoteService) =>
  invoke<Snapshot>("save_service_profile", { service });
export const deleteServiceProfile = (id: string, revision: string) =>
  invoke<Snapshot>("delete_service_profile", { id, revision });
export const deleteServiceProfiles = (
  services: { id: string; revision: string }[],
) => invoke<Snapshot>("delete_service_profiles", { services });
export const commandRuns = () =>
  invoke<import("@/types").CommandRun[]>("command_runs");
const executionTarget = <T extends { ruleId?: string }>(request: T) => {
  if (!request.ruleId?.startsWith("host:")) return request;
  return { ...request, ruleId: undefined, hostId: request.ruleId.slice(5) };
};
export const startCommand = (request: {
  serviceId: string;
  actionId: string;
  ruleId?: string;
  revision: string;
  requestId: string;
  confirmed: boolean;
  secrets: Record<string, string>;
  rememberHostIds: string[];
}) =>
  invoke<import("@/types").CommandRun>("start_command", {
    request: executionTarget(request),
  });
export const attachCommand = (
  id: string,
  onEvent: Channel<import("@/types").CommandEvent>,
) => invoke<void>("attach_command", { id, onEvent });
export const ackCommand = (id: string, revision: number) =>
  invoke<void>("ack_command", { id, revision });
export const detachCommand = (id: string) =>
  invoke<void>("detach_command", { id });
export const cancelCommand = (id: string) =>
  invoke<void>("cancel_command", { id });
export { Channel };

export const terminalSessions = () =>
  invoke<import("@/types").TerminalSession[]>("terminal_sessions");
export const openTerminal = (request: import("@/types").OpenTerminalRequest) =>
  invoke<import("@/types").TerminalSession>("open_terminal", {
    request: executionTarget(request),
  });
export const attachTerminal = (
  id: string,
  clientId: string,
  onEvent: Channel<import("@/types").TerminalFrame>,
) => invoke<void>("attach_terminal", { id, clientId, onEvent });
export const ackTerminal = (id: string, clientId: string, sequence: number) =>
  invoke<void>("ack_terminal", { id, clientId, sequence });
export const terminalInput = (
  id: string,
  clientId: string,
  sequence: number,
  bytes: number[],
) => invoke<void>("terminal_input", { id, clientId, sequence, bytes });
export const resizeTerminal = (
  id: string,
  clientId: string,
  cols: number,
  rows: number,
) => invoke<void>("resize_terminal", { id, clientId, cols, rows });
export const closeTerminal = (id: string, clientId: string) =>
  invoke<void>("close_terminal", { id, clientId });
export const detachTerminal = (id: string, clientId: string) =>
  invoke<void>("detach_terminal", { id, clientId });
export const forgetTerminal = (id: string, clientId: string) =>
  invoke<void>("forget_terminal", { id, clientId });

export const serviceObservations = () =>
  invoke<import("@/types").ServiceObservation[]>("service_observations");
export const runServiceOperation = (
  request: import("@/types").StartServiceRequest,
) =>
  invoke<import("@/types").CommandRun>("run_service_operation", {
    request: executionTarget(request),
  });

export const stopServiceForward = (runId: string) =>
  invoke<void>("stop_service_forward", { runId });

export const setServiceExecution = (
  id: string,
  revision: string,
  enabled: boolean,
  reviewed: boolean,
) =>
  invoke<Snapshot>("set_service_execution", {
    id,
    revision,
    enabled,
    reviewed,
  });
export const previewServiceTemplate = (kind: string, resource: string) =>
  invoke<import("@/types").ServiceTemplate>("preview_service_template", {
    kind,
    resource,
  });
