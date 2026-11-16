import { useSyncExternalStore } from "react";

export type RenderMode = "quality" | "smooth";

const cursorKey = "oria-tunnel.vnc.hide-local-cursor.v1";
const modeKey = "oria-tunnel.vnc.render-mode.v1";
const changed = "oria-tunnel:vnc-display-preferences";

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(changed, notify);
  };
}

function save(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(changed));
}

function cursorHidden() {
  return localStorage.getItem(cursorKey) === "true";
}

export function readRenderMode(): RenderMode {
  return localStorage.getItem(modeKey) === "smooth" ? "smooth" : "quality";
}

export function useVncDisplayPreferences() {
  return {
    hideLocalCursor: useSyncExternalStore(subscribe, cursorHidden, () => false),
    renderMode: useSyncExternalStore(
      subscribe,
      readRenderMode,
      () => "quality" as const,
    ),
  };
}

export function setHideLocalCursor(hidden: boolean) {
  save(cursorKey, String(hidden));
}

export function setRenderMode(mode: RenderMode) {
  save(modeKey, mode);
}
