import { invoke } from "@tauri-apps/api/core";
export type Entry = {
  id: string;
  name: string;
  kind: string;
  size: number;
  modified: number;
  permissions: number | null;
};
export type Directory = {
  id: string;
  path: string;
  parent: string;
  entries: Entry[];
};
export type Session = {
  id: string;
  hostId: string;
  hostName: string;
  phase: string;
  fingerprint: string | null;
  endpoint: string | null;
  error: string | null;
  route: string[];
};
export type RemoteEndpoint = {
  hostId: string;
  hostName: string;
  sessionId: string;
  routeKey: string;
  route: string[];
};
export type Task = {
  id: string;
  hostId: string;
  hostName: string;
  sessionId: string;
  direction: string;
  transport?: "checking" | "direct" | "relay" | "client" | null;
  directPending?: boolean;
  sourceRemote?: RemoteEndpoint | null;
  targetRemote?: RemoteEndpoint | null;
  sources: string[];
  target: string;
  destination?: string | null;
  phase: string;
  bytes: number;
  speed: number | null;
  eta: number | null;
  total: number;
  count: number;
  completed: string[];
  skipped: number;
  revision: number;
  error: string | null;
  conflict: string | null;
  temp: string | null;
  started: number;
  finished: number | null;
};
export type Snapshot = {
  revision: number;
  sessions: Session[];
  tasks: Task[];
  warning: string | null;
};
export const active = (t: Task) =>
  ![
    "completed",
    "partial",
    "failed",
    "cancelled",
    "paused",
    "interrupted",
    "conflict",
  ].includes(t.phase);
export const api = {
  openTarget: (id: string) => invoke("file_open_target", { id }),
  clearHistory: () => invoke("file_clear_history"),
  reveal: (id: string) => invoke("file_reveal", { id }),
  snapshot: () => invoke<Snapshot>("file_snapshot"),
  connect: (
    hostId: string,
    secrets: Record<string, string> = {},
    rememberHostIds: string[] = [],
  ) =>
    invoke<string>("file_connect", {
      request: { hostId, secrets, rememberHostIds },
    }),
  disconnect: (id: string) => invoke("file_disconnect", { id }),
  list: (session: string | null, path: string) =>
    invoke<Directory>("file_list", { session, path }),
  sources: (paths: string[]) => invoke<string[]>("file_sources", { paths }),
  submit: (sources: string[], target: string) =>
    invoke<string>("file_submit", {
      requestId: crypto.randomUUID(),
      sources,
      target,
    }),
  control: (
    id: string,
    action: string,
    session?: string,
    sourceSession?: string,
  ) => invoke("file_control", { id, action, session, sourceSession }),
  mutate: (action: string, id: string, name = "") =>
    invoke("file_mutate", { action, id, name }),
  pick: (folder = false) => invoke<string[]>("file_pick", { folder }),
  preview: (id: string, expanded = false) =>
    invoke<ArrayBuffer>("file_preview", { id, expanded }),
};
export function sorted(
  entries: Entry[],
  query: string,
  hidden: boolean,
  sort: string,
) {
  const items = entries.filter(
    (e) =>
      (hidden || !e.name.startsWith(".")) &&
      e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return items.sort(
    (a, b) =>
      Number(b.kind === "directory") - Number(a.kind === "directory") ||
      (sort === "size"
        ? b.size - a.size
        : sort === "modified"
          ? b.modified - a.modified
          : a.name.localeCompare(b.name)),
  );
}
export function selection(
  current: string[],
  id: string,
  ordered: string[],
  multi: boolean,
  range: boolean,
  anchor?: string,
) {
  if (range && anchor) {
    const a = ordered.indexOf(anchor),
      b = ordered.indexOf(id);
    if (a >= 0 && b >= 0)
      return ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
  }
  return multi
    ? current.includes(id)
      ? current.filter((i) => i !== id)
      : [...current, id]
    : [id];
}
export function size(value: number) {
  if (value < 1024) return `${value} B`;
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(1)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}
export function displayPath(path: string) {
  return path.startsWith("\\\\?\\UNC\\")
    ? "\\\\" + path.slice(8)
    : path.startsWith("\\\\?\\")
      ? path.slice(4)
      : path;
}
export function breadcrumbs(path: string, remote: boolean) {
  if (path === ":computer:") return [];
  if (remote) {
    const parts = path.split("/").filter(Boolean);
    return [
      { label: "/", path: "/" },
      ...parts.map((label, i) => ({
        label,
        path: "/" + parts.slice(0, i + 1).join("/"),
      })),
    ];
  }
  const clean = path.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");
  if (clean.startsWith("\\\\")) {
    const parts = clean.slice(2).split("\\").filter(Boolean);
    return parts
      .map((label, i) => ({
        label: i === 1 ? "\\\\" + parts[0] + "\\" + label : label,
        path: "\\\\" + parts.slice(0, i + 1).join("\\"),
      }))
      .filter((_, i) => i !== 0);
  }
  const sep = clean.includes("\\") ? "\\" : "/";
  const parts = clean.split(sep).filter(Boolean);
  return [
    ...(clean.startsWith("/") ? [{ label: "/", path: "/" }] : []),
    ...parts.map((label, i) => ({
      label,
      path:
        (clean.startsWith("/") ? "/" : "") +
        parts.slice(0, i + 1).join(sep) +
        (i === 0 && sep === "\\" ? "\\" : ""),
    })),
  ];
}
