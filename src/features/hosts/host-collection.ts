import type { Host, Snapshot } from "@/types";
import { runtimeStatus } from "@/features/tunnels/runtime-status";

export function addedHosts(
  data: Pick<Snapshot, "hosts" | "rules" | "addedHostIds">,
  confirmedIds: string[] = [],
) {
  const ids = new Set([
    ...(data.addedHostIds ?? []),
    ...confirmedIds,
    ...data.hosts
      .filter((host) => host.source === "manual")
      .map((host) => host.id),
    ...data.rules.map((rule) => rule.hostId),
  ]);
  const byId = new Map(data.hosts.map((host) => [host.id, host]));
  for (const id of ids) {
    for (const jump of byId.get(id)?.proxyJump?.split(",") ?? []) {
      if (byId.has(jump.trim())) ids.add(jump.trim());
    }
  }
  return data.hosts.filter((host) => ids.has(host.id));
}

export function hostFilterStatus(
  host: Host,
  runtime?: Snapshot["runtimes"][number],
) {
  if (!runtime || runtime.status === "stopped")
    return host.diagnostics.length ? "status-configuration-error" : "untested";
  if (runtime.status === "tested") return "tested";
  if (runtime.status === "failed" || runtime.status === "needs-attention")
    return runtimeStatus(runtime).label;
  return null;
}
