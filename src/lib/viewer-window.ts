import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function isViewerWindow() {
  return isTauri() && getCurrentWindow().label.startsWith("vnc-");
}

// The native handler takes its target from the IPC caller.
export function viewerWindowAction(
  action:
    | "close"
    | "minimize"
    | "toggleMaximize"
    | "isMaximized"
    | "toggleFullscreen"
    | "isFullscreen"
    | "startDragging",
) {
  return invoke<boolean>("vnc_window_action", { action });
}
