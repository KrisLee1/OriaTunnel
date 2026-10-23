import type { Runtime } from "@/types";

type StatusRuntime = Pick<
  Runtime,
  "status" | "errorKind" | "configurationChanged"
>;
export function runtimeStatus(runtime?: StatusRuntime) {
  const status = runtime?.status || "stopped";
  if (status === "failed" || status === "needs-attention") {
    const labels: Record<string, string> = {
      authentication: "status-authentication-error",
      "host-key": "status-host-key-error",
      network: "status-network-error",
      dns: "status-dns-error",
      timeout: "status-timeout",
      bind: "status-bind-error",
      "forward-denied": "status-forward-error",
      configuration: "status-configuration-error",
      "remote-command": "status-command-error",
    };
    return {
      label:
        labels[runtime?.errorKind || ""] ||
        (runtime?.configurationChanged
          ? "status-configuration-error"
          : "status-connection-error"),
      tone:
        runtime?.errorKind === "authentication" ||
        runtime?.errorKind === "host-key"
          ? "warning"
          : "danger",
    };
  }
  return {
    label: status,
    tone: ["listening", "tested"].includes(status)
      ? "success"
      : [
            "connecting",
            "authenticating",
            "verifying-host",
            "reconnecting",
          ].includes(status)
        ? "warning"
        : "neutral",
  };
}
