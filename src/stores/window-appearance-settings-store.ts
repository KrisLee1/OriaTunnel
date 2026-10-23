import { create } from "zustand"
import { persist } from "zustand/middleware"

export const WINDOW_APPEARANCE_SETTINGS_STORAGE_KEY = "oria-tunnel-window-appearance"

export interface WindowAppearanceOverrides {
  opacity: number | null
  blurRadius: number | null
  cornerRadius: number | null
}

interface WindowAppearanceSettingsState extends WindowAppearanceOverrides {
  windowsBlurEnabled: boolean
  setOpacity: (value: number | null) => void
  setBlurRadius: (value: number | null) => void
  setCornerRadius: (value: number | null) => void
  setWindowsBlurEnabled: (enabled: boolean) => void
  followTheme: () => void
}

function savedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(max, Math.max(min, value)))
    : null
}

export const useWindowAppearanceSettingsStore = create<WindowAppearanceSettingsState>()(
  persist(
    (set) => ({
      opacity: null,
      blurRadius: null,
      cornerRadius: null,
      windowsBlurEnabled: true,
      setOpacity: (opacity) => set({ opacity: savedNumber(opacity, 1, 100) }),
      setBlurRadius: (blurRadius) => set({ blurRadius: savedNumber(blurRadius, 0, 64) }),
      setCornerRadius: (cornerRadius) =>
        set({ cornerRadius: savedNumber(cornerRadius, 0, 64) }),
      setWindowsBlurEnabled: (windowsBlurEnabled) => set({ windowsBlurEnabled }),
      followTheme: () => set({ opacity: null, blurRadius: null, cornerRadius: null }),
    }),
    {
      name: WINDOW_APPEARANCE_SETTINGS_STORAGE_KEY,
      partialize: ({ opacity, blurRadius, cornerRadius, windowsBlurEnabled }) => ({
        opacity,
        blurRadius,
        cornerRadius,
        windowsBlurEnabled,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<WindowAppearanceSettingsState>
        return {
          ...current,
          opacity: savedNumber(saved.opacity, 1, 100),
          blurRadius: savedNumber(saved.blurRadius, 0, 64),
          cornerRadius: savedNumber(saved.cornerRadius, 0, 64),
          windowsBlurEnabled: typeof saved.windowsBlurEnabled === "boolean"
            ? saved.windowsBlurEnabled
            : current.windowsBlurEnabled,
        }
      },
    },
  ),
)
