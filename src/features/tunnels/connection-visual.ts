import type { Rule, Runtime } from "@/types";

export function connectionVisual(
  rule: Rule,
  runtime?: Pick<Runtime, "status">,
) {
  const state =
    runtime?.status === "listening"
      ? "connected"
      : [
            "connecting",
            "authenticating",
            "verifying-host",
            "reconnecting",
          ].includes(runtime?.status || "")
        ? "connecting"
        : "stopped";
  const color =
    state === "stopped"
      ? "var(--oria-color-muted-fg)"
      : rule.color || "var(--oria-color-accent)";
  return { state, color };
}

// R exposes its listener on the SSH host; D has no fixed remote target port.
export function connectionPorts(rule: Rule, sshPort?: number) {
  return {
    local: String(rule.kind === "R" ? rule.targetPort : rule.bindPort),
    host:
      rule.kind === "D"
        ? `SSH ${sshPort || 22}`
        : String(rule.kind === "R" ? rule.bindPort : rule.targetPort),
  };
}
