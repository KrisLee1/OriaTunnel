import { create } from "zustand"
import { persist } from "zustand/middleware"

export const WINDOW_CONTROL_SETTINGS_STORAGE_KEY = "oria-tunnel-window-controls"

export type WindowControlStyle = "system" | "macos" | "windows"
export type WindowControlPosition = "left" | "right"
export type ResolvedWindowControlStyle = Exclude<WindowControlStyle, "system">

interface WindowControlSettingsState {
  style: WindowControlStyle
  position: WindowControlPosition
  setStyle: (style: WindowControlStyle) => void
  setPosition: (position: WindowControlPosition) => void
}

export function resolveSystemWindowControlStyle(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): ResolvedWindowControlStyle {
  return /windows|win(?:32|64)/i.test(`${platform} ${userAgent}`) ? "windows" : "macos"
}

export function resolveWindowControlStyle(
  style: WindowControlStyle,
): ResolvedWindowControlStyle {
  return style === "system" ? resolveSystemWindowControlStyle() : style
}

export function resolveWindowControlPosition(
  style: WindowControlStyle,
  position: WindowControlPosition,
  systemStyle = resolveSystemWindowControlStyle(),
): WindowControlPosition {
  if (style !== "system") return position
  return systemStyle === "windows" ? "right" : "left"
}

export const useWindowControlSettingsStore = create<WindowControlSettingsState>()(
  persist(
    (set) => ({
      style: "system",
      position: "left",
      setStyle: (style) => set({ style }),
      setPosition: (position) => set({ position }),
    }),
    {
      name: WINDOW_CONTROL_SETTINGS_STORAGE_KEY,
      partialize: (state) => ({
        style: state.style,
        position: state.position,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<WindowControlSettingsState>

        return {
          ...current,
          style:
            saved.style === "system" || saved.style === "macos" || saved.style === "windows"
              ? saved.style
              : current.style,
          position:
            saved.position === "left" || saved.position === "right"
              ? saved.position
              : current.position,
        }
      },
    },
  ),
)
