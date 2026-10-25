export const workspaceDocks = ["bottom", "left", "right"] as const;
export type WorkspaceDock = (typeof workspaceDocks)[number];
export type WorkspaceLayout = {
  dock: WorkspaceDock;
  sizes: Record<WorkspaceDock, number>;
};
export const workspaceLayoutKey = "oria-tunnel.terminal-layout.v1";
export const workspaceGap = 4;
export function workspaceChromeBottom(
  headerBottom: number,
  paddingBottom: number,
  capsuleBottoms: number[],
) {
  // Capsules may still be moving or measuring during a theme/window change.
  // Never let a transient smaller rectangle move the workspace into the chrome.
  return Math.max(0, headerBottom - paddingBottom, ...capsuleBottoms);
}
export type WorkspaceViewport = {
  width: number;
  height: number;
  headerBottom: number;
  gap?: number;
};
export function workspaceSizeLimit(
  dock: WorkspaceDock,
  viewport: WorkspaceViewport,
) {
  const gap = viewport.gap ?? workspaceGap;
  return Math.max(
    0,
    dock === "bottom"
      ? viewport.height - viewport.headerBottom - gap * 2
      : viewport.width - gap * 2,
  );
}
export function workspaceBounds(
  dock: WorkspaceDock,
  size: number,
  maximized: boolean,
  viewport: WorkspaceViewport,
) {
  const gap = viewport.gap ?? workspaceGap;
  const fullWidth = Math.max(0, viewport.width - gap * 2);
  const fullHeight = workspaceSizeLimit("bottom", viewport);
  const width =
    dock === "bottom" || maximized
      ? fullWidth
      : clampWorkspaceSize(dock, size, fullWidth);
  const height =
    dock !== "bottom" || maximized
      ? fullHeight
      : clampWorkspaceSize(dock, size, fullHeight);
  return {
    left: dock === "right" ? viewport.width - gap - width : gap,
    top: viewport.height - gap - height,
    width,
    height,
  };
}
export const workspaceMinimum = (dock: WorkspaceDock) =>
  dock === "bottom" ? 200 : 280;
export const isWorkspaceDock = (value: unknown): value is WorkspaceDock =>
  workspaceDocks.some((dock) => dock === value);

export function parseWorkspaceLayout(raw: string | null): WorkspaceLayout {
  const layout: WorkspaceLayout = {
    dock: "bottom",
    sizes: { bottom: 320, left: 400, right: 400 },
  };
  try {
    const saved = JSON.parse(raw || "null");
    if (!saved || typeof saved !== "object") return layout;
    if (isWorkspaceDock(saved.dock)) layout.dock = saved.dock;
    for (const dock of workspaceDocks) {
      const size = saved.sizes?.[dock];
      if (
        typeof size === "number" &&
        Number.isFinite(size) &&
        size >= workspaceMinimum(dock) &&
        size <= 10000
      )
        layout.sizes[dock] = size;
    }
  } catch {
    /* Invalid preferences do not prevent opening the workspace. */
  }
  return layout;
}

export function clampWorkspaceSize(
  dock: WorkspaceDock,
  size: number,
  limit: number,
) {
  const maximum = Math.max(0, limit);
  return Math.min(
    Math.max(Math.min(workspaceMinimum(dock), maximum), size),
    maximum,
  );
}

// Pointer deltas follow the physical resize edge: right for left docks, left otherwise.
export function resizeWorkspace(
  dock: WorkspaceDock,
  size: number,
  delta: number,
  limit: number,
) {
  return clampWorkspaceSize(
    dock,
    size + (dock === "left" ? delta : -delta),
    limit,
  );
}

export function workspaceKeyboardSize(
  dock: WorkspaceDock,
  key: string,
  size: number,
  limit: number,
) {
  if (key === "Home") return clampWorkspaceSize(dock, 0, limit);
  if (key === "End") return limit;
  const negative = dock === "bottom" ? "ArrowUp" : "ArrowLeft";
  const positive = dock === "bottom" ? "ArrowDown" : "ArrowRight";
  if (key !== negative && key !== positive) return undefined;
  return resizeWorkspace(dock, size, key === negative ? -20 : 20, limit);
}

export function terminalTabScrollEdges(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
) {
  const maximum = Math.max(0, scrollWidth - clientWidth);
  const position = Math.min(maximum, Math.max(0, scrollLeft));
  return { left: position > 1, right: maximum - position > 1 };
}
