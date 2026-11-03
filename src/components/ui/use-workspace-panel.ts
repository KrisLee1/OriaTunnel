import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clampWorkspaceSize,
  parseWorkspaceLayout,
  workspaceBounds,
  workspaceChromeBottom,
  workspaceGap,
  workspaceMinimum,
  workspaceSizeLimit,
  type WorkspaceDock,
  type WorkspaceLayout,
} from "./workspace-layout";

export function useWorkspacePanel({
  open,
  storageKey,
  defaults,
  minimums,
}: {
  open: boolean;
  storageKey: string;
  defaults?: WorkspaceLayout;
  minimums?: Partial<Record<WorkspaceDock, number>>;
}) {
  const ref = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState(() => {
    try {
      return parseWorkspaceLayout(localStorage.getItem(storageKey), defaults);
    } catch {
      return parseWorkspaceLayout(null, defaults);
    }
  });
  const { dock } = layout;
  const sideDock = dock !== "bottom";
  const [maximized, setMaximized] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1180 : window.innerWidth,
    height: typeof window === "undefined" ? 780 : window.innerHeight,
    headerBottom: 38,
    gap: workspaceGap,
  }));
  const limit = workspaceSizeLimit(dock, viewport);
  const minimum = minimums?.[dock] ?? workspaceMinimum(dock);
  const clamp = (value: number) =>
    Math.max(Math.min(minimum, limit), clampWorkspaceSize(dock, value, limit));
  const size = clamp(layout.sizes[dock]);
  const bounds = workspaceBounds(dock, size, maximized, viewport);
  const setSize = (value: number) =>
    setLayout((previous) => ({
      ...previous,
      sizes: { ...previous.sizes, [dock]: clamp(value) },
    }));
  const changeDock = (value: WorkspaceDock) => {
    setMaximized(false);
    setLayout((previous) => ({ ...previous, dock: value }));
  };
  useEffect(() => {
    if (resizing) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      /* Local preference failures do not prevent using the panel. */
    }
  }, [storageKey, layout, resizing]);
  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>(".app-titlebar");
    const update = () => {
      const styles = header ? getComputedStyle(header) : undefined;
      const gap = header ? parseFloat(styles!.paddingLeft) : workspaceGap;
      const headerBottom = header
        ? workspaceChromeBottom(
            header.getBoundingClientRect().bottom,
            parseFloat(styles!.paddingBottom) || 0,
            Array.from(
              header.querySelectorAll(
                "[data-window-header-side], .header-center > *",
              ),
              (child) => child.getBoundingClientRect(),
            )
              .filter((rect) => rect.width > 0 && rect.height > 0)
              .map((rect) => rect.bottom),
          )
        : 38;
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        headerBottom,
        gap: Number.isFinite(gap) ? gap : workspaceGap,
      });
    };
    const observer = new ResizeObserver(update);
    if (header) {
      observer.observe(header);
      Array.from(header.children).forEach((child) => observer.observe(child));
    }
    update();
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open]);
  return {
    ref,
    open,
    storageKey,
    layout,
    dock,
    sideDock,
    maximized,
    setMaximized,
    resizing,
    setResizing,
    viewport,
    limit,
    minimum,
    size,
    bounds,
    setSize,
    changeDock,
  };
}
export type WorkspacePanelState = ReturnType<typeof useWorkspacePanel>;
