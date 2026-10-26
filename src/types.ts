export type ApplicationIconPreference = "system" | "light" | "dark" | "mono";
export type ResolvedApplicationIcon = Exclude<ApplicationIconPreference, "system">;

export interface WindowAppearance {
  opacity: number;
  blurRadius: number;
  cornerRadius: number;
}
export interface UpdateSnapshot {
  revision: number;
  currentVersion: string;
  phase: "idle" | "checking" | "upToDate" | "available" | "downloading" | "verifying" | "ready" | "preparing" | "installing" | "error";
  unavailable: "notConfigured" | "development" | "unsupported" | null;
  autoCheck: boolean;
  preferenceError: boolean;
  release: { version: string; notes: string } | null;
  downloaded: number;
  total: number | null;
  error: "check" | "download" | "install" | "cleanup" | "activityChanged" | null;
  canDownload: boolean;
  canInstall: boolean;
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
  version?: number;
  services?: ImportServicePreview[];
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
  serviceIds?: string[];
  reuseHosts: Record<string, string>;
  forwardOnly: boolean;
}
export interface Snapshot {
  services?: RemoteService[];
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

export type CommandKind = "start" | "stop" | "restart" | "status" | "logs" | "custom";
export interface CommandArgument { name: string; value: string | null }
export interface CommandEnvironment { name: string; value: string }
export interface CommandInvocation { executable: string; arguments: CommandArgument[]; environment?: CommandEnvironment[]; script?: string }
export interface ServiceLink { id: string; revision: string; selected: boolean }
export interface PresetAction {
  invocation?: CommandInvocation | null;
  mode?: "command" | "terminal";
  id: string; kind: CommandKind; label: string; command: string;
  timeoutSecs: number; successCodes: number[]; confirm: boolean;
}
export interface RemoteService {
  hostIds?: string[];
  port?: number | null;
  category?: string | null;
  color?: string | null; icon?: RuleIcon | null;
  id: string; name: string; executionHostId?: string; ruleIds: string[];
  revision: string; noLocalEnvironment: boolean; actions: PresetAction[]; control?: ServiceControl; executionEnabled?: boolean;
}
export interface CommandRun {
  id: string; requestId: string; serviceId: string; actionId: string; serviceRevision: string;
  hostId: string; hostName: string; endpoint: string; actionLabel: string;
  phase: string; submitted: boolean; exitCode: number | null; exitSignal: string | null;
  error: string | null; startedAt: number; finishedAt: number | null;
  fingerprint: string | null; verificationEndpoint: string | null; revision: number; truncated: boolean;
  outputBytes?:number; discardedBytes?:number;
  steps?: ServiceStep[]; workflowRuleId?: string | null; workflowForwardCreated?: boolean; workflowForwardRunId?: string | null;
}
export interface CommandOutput { sequence: number; stream: "stdout" | "stderr"; bytes: number[] }
export interface CommandEvent { run: CommandRun; output: CommandOutput[]; reset: boolean }

export interface TerminalSession {
  ruleId?:string|null;
  routeHostIds: string[];
  id: string; requestId: string; clientId: string; hostId: string; hostName: string; endpoint: string;
  serviceId: string | null; actionId: string | null; label: string; phase: string; revision: number;
  startedAt: number; finishedAt: number | null; submitted: boolean; exitCode: number | null; exitSignal: string | null; error: string | null;
  fingerprint: string | null; verificationEndpoint: string | null; cols: number; rows: number;
}
export interface TerminalFrame { id: string; sequence: number; bytes: number[] }
export interface OpenTerminalRequest {
  hostId: string; requestId: string; clientId: string; cols: number; rows: number; noLocalEnvironment: boolean;
  serviceId?: string; actionId?: string; ruleId?:string; revision?: string; confirmed: boolean;
  secrets: Record<string, string>; rememberHostIds: string[];
}

export interface ServiceControl {
  statusProbe: {actionId:string;mode:"output"|"exitCode"|"json";runningCodes:number[];stoppedCodes:number[];failedCodes:number[]}|null;
  healthProbe: {command:string;readyCodes:number[];notReadyCodes:number[];repeatable:boolean;timeoutSecs:number;intervalSecs:number;budgetSecs:number}|null;
  startActionId:string|null;checkAfterActions:boolean;ttlSecs:number;
}
export interface ServiceFact {value:string;checkedAt:number|null;validUntil:number|null;sourceRunId:string|null;expired:boolean}
export interface ServiceObservation {hostId?:string|null;ruleId?:string|null;serviceId:string;serviceRevision:string;hostIdentity:string;status:ServiceFact;health:ServiceFact;revision:number}
export interface ServiceStep {kind:string;phase:string;attempt:number;exitCode:number|null;error:string|null;startedAt:number;finishedAt:number|null}
export type ServiceOperation = "action"|"checkStatus"|"checkHealth"|"connect";
export interface StartServiceRequest {serviceId:string;revision:string;requestId:string;operation:ServiceOperation;actionId?:string;ruleId?:string;confirmed:boolean;secrets:Record<string,string>;rememberHostIds:string[]}

export interface ImportServicePreview {
  id:string;name:string;executionHostId:string;endpoint:string;ruleIds:string[];noLocalEnvironment:boolean;actions:PresetAction[];control:ServiceControl;conflict:boolean;
}
export interface ServiceTemplate {category?:string|null;name?:string;color?:string;icon?:RuleIcon;actions:PresetAction[];control:ServiceControl;resource:string;shell:string}
