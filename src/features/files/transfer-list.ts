import { active, type Task } from "./api";

export type TransferGrouping = "none" | "target" | "source" | "type";
export type TransferOrder = "newest" | "oldest";
export type TransferListPreferences = {
  grouping: TransferGrouping;
  order: TransferOrder;
};
export const TRANSFER_LIST_KEY = "oria-tunnel.files-transfer-list.v1";
export const transferGroupings: TransferGrouping[] = [
  "none",
  "target",
  "source",
  "type",
];
export const transferOrders: TransferOrder[] = ["newest", "oldest"];
export type TransferHost = { id: string; name: string | null; remote: boolean };

export function transferHosts(task: Task): {
  source: TransferHost;
  target: TransferHost;
} {
  const endpoint = (side: "source" | "target"): TransferHost => {
    const saved = side === "source" ? task.sourceRemote : task.targetRemote;
    const remote =
      !!saved ||
      (side === "source"
        ? task.direction !== "upload"
        : task.direction !== "download");
    return remote
      ? {
          id: `host:${saved?.hostId || task.hostId}`,
          name: saved?.hostName || task.hostName || null,
          remote: true,
        }
      : { id: "local", name: null, remote: false };
  };
  return { source: endpoint("source"), target: endpoint("target") };
}

export function matchesTransfer(task: Task, filter: string) {
  return (
    filter === "all" ||
    (filter === "active"
      ? active(task)
      : filter === "attention"
        ? ["conflict", "failed", "interrupted", "paused"].includes(task.phase)
        : ["completed", "partial", "cancelled"].includes(task.phase))
  );
}

export function orderTransfers(tasks: Task[], order: TransferOrder) {
  const direction = order === "newest" ? -1 : 1;
  return [...tasks].sort(
    (a, b) => (a.started - b.started || a.id.localeCompare(b.id)) * direction,
  );
}

export type TransferGroup = {
  id: string;
  host?: TransferHost;
  direction?: string;
  tasks: Task[];
};
// The input is already time-ordered. First occurrence determines group order.
export function groupTransfers(
  tasks: Task[],
  grouping: TransferGrouping,
): TransferGroup[] {
  if (grouping === "none") return [{ id: "all", tasks }];
  const groups = new Map<string, TransferGroup>();
  for (const task of tasks) {
    const host =
      grouping === "type" ? undefined : transferHosts(task)[grouping];
    const direction = grouping === "type" ? task.direction : undefined;
    const id = host?.id || `type:${direction}`;
    let group = groups.get(id);
    if (!group) {
      group = { id, host, direction, tasks: [] };
      groups.set(id, group);
    }
    group.tasks.push(task);
  }
  return [...groups.values()];
}

export function readTransferListPreferences(): TransferListPreferences {
  const defaults: TransferListPreferences = {
    grouping: "type",
    order: "newest",
  };
  try {
    const value = JSON.parse(localStorage.getItem(TRANSFER_LIST_KEY) || "null");
    return {
      grouping: transferGroupings.includes(value?.grouping)
        ? value.grouping
        : defaults.grouping,
      order: transferOrders.includes(value?.order)
        ? value.order
        : defaults.order,
    };
  } catch {
    return defaults;
  }
}
export function saveTransferListPreferences(value: TransferListPreferences) {
  try {
    localStorage.setItem(TRANSFER_LIST_KEY, JSON.stringify(value));
  } catch {
    /* Session preferences remain usable. */
  }
}

function within(path: string | null | undefined, root: string) {
  if (!path) return false;
  const base = root.replace(/[\\/]+$/, "");
  return (
    path === root || path.startsWith(`${base}/`) || path.startsWith(`${base}\\`)
  );
}
function lowerBound(paths: string[], value: string) {
  let low = 0,
    high = paths.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (paths[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
function descendantCount(paths: string[], root: string) {
  const base = root.replace(/[\\/]+$/, "");
  // '/' and '\\' prefixes end just before '0' and ']' in UTF-16 order.
  return (
    lowerBound(paths, `${base}0`) -
    lowerBound(paths, `${base}/`) +
    lowerBound(paths, `${base}]`) -
    lowerBound(paths, `${base}\\`)
  );
}
export function transferBatchItems(task: Task) {
  const completed = new Set(task.completed);
  const skipped = new Set(task.skippedSources || []);
  const hasDirectories = task.sourceKinds?.includes("directory");
  const completedPaths = hasDirectories ? [...completed].sort() : [];
  const skippedPaths = hasDirectories ? [...skipped].sort() : [];
  return task.sources.map((path, index) => {
    const kind = task.sourceKinds?.[index] || "file";
    const isDirectory = kind === "directory";
    const completedCount = isDirectory
      ? descendantCount(completedPaths, path)
      : Number(completed.has(path));
    const hasSkips = isDirectory && descendantCount(skippedPaths, path) > 0;
    const currentPath = task.currentSource || task.commitSource;
    const current =
      within(currentPath, path) && !completed.has(currentPath || "");
    const conflict = within(task.conflictSource, path);
    const phase = skipped.has(path)
      ? "skipped"
      : completed.has(path) || task.phase === "completed"
        ? "completed"
        : conflict && task.phase === "conflict"
          ? "conflict"
          : isDirectory && task.phase === "partial" && hasSkips
            ? "partial"
            : current && !["conflict", "partial"].includes(task.phase)
              ? task.phase
              : ["failed", "interrupted", "partial"].includes(task.phase)
                ? "unconfirmed"
                : task.phase === "cancelled"
                  ? "cancelled"
                  : "queued";
    const detail = task.sourceDetails?.[path];
    return {
      path,
      kind,
      phase,
      completedCount,
      destination: detail?.destination || null,
      size: detail?.size ?? null,
    };
  });
}
export function transferTarget(task: Task) {
  if (task.sources.length > 1) return task.target;
  const detail = task.sourceDetails?.[task.sources[0]];
  if (detail) return detail.destination;
  if (task.sourceKinds?.[0] === "directory") return task.target;
  if (task.destination) return task.destination;
  const name = task.sources[0]?.split(/[\\/]/).pop();
  return name
    ? `${task.target.replace(/[\\/]$/, "")}${task.direction === "download" && task.target.includes("\\") ? "\\" : "/"}${name}`
    : task.target;
}
export function transferTotalSize(task: Task): number | null {
  let total = 0;
  for (const path of task.sources) {
    const size = task.sourceDetails?.[path]?.size;
    if (size == null) return null;
    total += size;
  }
  return total;
}
