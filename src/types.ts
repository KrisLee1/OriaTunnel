export type ApplicationIconPreference = "system" | "light" | "dark" | "mono";
export type ResolvedApplicationIcon = Exclude<ApplicationIconPreference, "system">;

export interface WindowAppearance {
  opacity: number;
  blurRadius: number;
  cornerRadius: number;
}
export interface Host {
  id: string;
  name: string;
  address: string;
  port: number;
  user: string;
  identityFiles: string[];
  source: string;
  sourceFile?: string;
  diagnostics: string[];
  connection: ConnectionOptions;
  authMethod: "auto" | "password" | "privateKey" | "agent";
  tags: string[];
  hidden: boolean;
  identityAgent: string | null;
  identitiesOnly: boolean;
  proxyJump: string | null;
  algorithms?: {
    ciphers: string | null;
    kexAlgorithms: string | null;
    macs: string | null;
  };
  fieldSources: Record<string, string>;
  configuredForwards: string[];
  unsupportedSessionOptions?: string[];
}
export interface ConnectionOptions {
  connectTimeoutSecs: number;
  keepaliveIntervalSecs: number;
  keepaliveMax: number;
}
export type ServiceProtocol = "http" | "https" | "vnc";
export type RuleIcon = { kind: "builtin" | "emoji"; value: string };
export interface Rule {
  icon: RuleIcon | null;
  serviceProtocol: ServiceProtocol | null;
  id: string;
  name: string;
  color: string | null;
  hostId: string;
  bindAddress: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
  kind: "L" | "R" | "D";
  connection: ConnectionOptions | null;
  noRemoteCommand: boolean;
  remoteCommand: string;
  background: boolean;
  reconnect: {
    enabled: boolean;
    maxAttempts: number;
    initialDelaySecs: number;
    maxDelaySecs: number;
  };
  autoConnect: boolean;
  repeatCommandOnReconnect: boolean;
}
export interface Runtime {
  ruleId: string;
  runId: string;
  status: string;
  message: string;
  fingerprint?: string;
  sent: number;
  received: number;
  connections: number;
  configurationChanged: boolean;
  hostSnapshot?: Host;
  verificationEndpoint?: string;
  errorKind?: string;
  authMethodUsed?: Host["authMethod"];
  desiredRunning: boolean;
  retryCount: number;
  retryAt?: number;
  uptimeSecs: number;
  sentPerSecond?: number;
  receivedPerSecond?: number;
  targetHealth: {
    state?: string;
    checkedAt?: number;
    side?: string;
    method?: string;
  };
  history: {
    timestamp: number;
    sentPerSecond: number;
    receivedPerSecond: number;
  }[];
}
export interface ActivityRecord {
  timestamp: number;
  ruleId: string;
  runId: string;
  event: string;
  errorKind?: string;
  retryCount: number;
  level: string;
}
export interface BatchResult {
  id: string;
  accepted: boolean;
  error?: string;
}
export interface ImportPreview {
  // The preview contains only the Rust-validated allowlist, never the input document.
  token: string;
  fileName: string;
  hosts: {
    id: string;
    name: string;
    endpoint: string;
    conflict: boolean;
    keyPathsOmitted: boolean;
    keyPaths: string[];
    proxyJump?: string;
    blocked: boolean;
  }[];
  rules: {
    id: string;
    name: string;
    hostId: string;
    path: string;
    conflict: boolean;
    listenerConflict: boolean;
    commandOmitted: boolean;
  }[];
}
export type ImportSource =
  | { kind: "upload"; fileName: string; content: string }
  | { kind: "path"; path: string };
export interface ImportChoices {
  ruleIds: string[];
  reuseHosts: Record<string, string>;
  forwardOnly: boolean;
}
export interface Snapshot {
  hosts: Host[];
  addedHostIds?: string[];
  rules: Rule[];
  runtimes: Runtime[];
  diagnostics: string[];
  revision: number;
  closeToTray: boolean;
  agentSupported: boolean;
  sourceFiles: string[];
  autoSyncHosts: boolean;
  activity: ActivityRecord[];
  undoCount: number;
  autostart: boolean;
  autostartSupported: boolean;
  autostartError?: string;
}
