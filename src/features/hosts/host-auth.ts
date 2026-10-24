import type { Host, Runtime } from "@/types";

export const hostAuthLabels: Record<Host["authMethod"], string> = {
  auto: "authAuto",
  password: "authPassword",
  privateKey: "authPrivateKey",
  agent: "authAgent",
};

// A configured key is a useful preference label; the successful Rust result
// takes precedence without changing the host's underlying Auto fallback policy.
export function hostAuthMethod(host: Host, runtime?: Runtime): Host["authMethod"] {
  if (runtime?.authMethodUsed) return runtime.authMethodUsed;
  if (host.authMethod !== "auto") return host.authMethod;
  if (host.identityFiles.some((path) => path.trim() && path !== "none")) return "privateKey";
  if (host.identityAgent && host.identityAgent !== "none") return "agent";
  return "auto";
}

export function needsInitialSecret(hosts: Host[]) {
  return hosts.some((host) => host.authMethod === "password");
}

export type AutomaticAttempt = { previousRunId?: string; hostId?: string };
export function automaticAuthOutcome(attempt: AutomaticAttempt, runtime?: Runtime) {
  if (!runtime || runtime.runId === attempt.previousRunId) return "waiting";
  if (["failed", "needs-attention"].includes(runtime.status))
    return runtime.errorKind === "authentication" ? "prompt" : "done";
  return ["stopped", "tested", "listening"].includes(runtime.status) ? "done" : "waiting";
}
