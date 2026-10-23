import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import { emit, listen } from "@tauri-apps/api/event"
import { resolveTheme } from "@oriatheme/core"
import { OriaThemeProvider as RuntimeThemeProvider, useOriaTheme } from "@oriatheme/react"
import type {
  ActiveThemeSnapshotV1,
  OriaThemeConfig,
  PersistedThemeStateV1,
  ThemeStorage,
} from "@oriatheme/runtime-dom"
import { oriaDefaultTheme, oriaPresetThemes } from "@oriatheme/presets"

import {
  applyWindowAppearanceToRoot,
  applyNativeWindowAppearance,
  isWindowsDesktop,
  resolveWindowAppearance,
  themeWindowAppearance,
  WINDOWS_WINDOW_APPEARANCE,
} from "@/components/theme/window-appearance"
import { setWorkWindowAppearance, setWindowAppearance } from "@/lib/bridge"
import {
  WINDOW_APPEARANCE_SETTINGS_STORAGE_KEY,
  useWindowAppearanceSettingsStore,
} from "@/stores/window-appearance-settings-store"

export const AIDE_THEME_STORAGE_KEY = "oria-tunnel-theme"
const AIDE_THEME_STATE_STORAGE_KEY = `${AIDE_THEME_STORAGE_KEY}:state:v1`
const AIDE_THEME_ACTIVE_STORAGE_KEY = `${AIDE_THEME_STORAGE_KEY}:active:v1`
const AIDE_THEME_SYNC_EVENT = "tunnel://theme-settings-changed"
const AIDE_THEME_LOCAL_SYNC_EVENT = "tunnel:theme-settings-changed"

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

function activeThemeSnapshot(state: PersistedThemeStateV1): ActiveThemeSnapshotV1 | null {
  const theme = [...state.customThemes, ...oriaPresetThemes].find(
    (candidate) => candidate.id === state.preference.activeThemeId,
  )
  if (!theme) return null
  return {
    schemaVersion: 1,
    contract: theme.contract,
    themeId: theme.id,
    appearance: state.preference.appearance,
    variablePrefix: "oria",
    lightVariables: resolveTheme(theme, "light").variables,
    darkVariables: resolveTheme(theme, "dark").variables,
  }
}

function writeThemeState(state: PersistedThemeStateV1) {
  globalThis.localStorage?.setItem(AIDE_THEME_STATE_STORAGE_KEY, JSON.stringify(state))
  const active = activeThemeSnapshot(state)
  if (active) {
    globalThis.localStorage?.setItem(AIDE_THEME_ACTIVE_STORAGE_KEY, JSON.stringify(active))
  }
}

export const synchronizedThemeStorage: ThemeStorage = {
  read() {
    const raw = globalThis.localStorage?.getItem(AIDE_THEME_STATE_STORAGE_KEY)
    return raw === null || raw === undefined ? null : JSON.parse(raw)
  },
  write(state) {
    writeThemeState(state)
    globalThis.queueMicrotask(() => {
      globalThis.dispatchEvent?.(new Event(AIDE_THEME_LOCAL_SYNC_EVENT))
      if (isDesktopRuntime()) void emit(AIDE_THEME_SYNC_EVENT, state).catch(() => undefined)
    })
  },
  clear() {
    globalThis.localStorage?.removeItem(AIDE_THEME_STATE_STORAGE_KEY)
    globalThis.localStorage?.removeItem(AIDE_THEME_ACTIVE_STORAGE_KEY)
    globalThis.queueMicrotask(() => {
      globalThis.dispatchEvent?.(new Event(AIDE_THEME_LOCAL_SYNC_EVENT))
      if (isDesktopRuntime()) void emit(AIDE_THEME_SYNC_EVENT, null).catch(() => undefined)
    })
  },
  subscribe(listener) {
    const handleLocalSync = () => listener()
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === AIDE_THEME_STATE_STORAGE_KEY
        || event.key === AIDE_THEME_ACTIVE_STORAGE_KEY
      ) listener()
    }
    globalThis.addEventListener?.(AIDE_THEME_LOCAL_SYNC_EVENT, handleLocalSync)
    globalThis.addEventListener?.("storage", handleStorage as EventListener)

    let disposed = false
    let stopTauriListener: (() => void) | undefined
    if (isDesktopRuntime()) {
      void listen<PersistedThemeStateV1 | null>(AIDE_THEME_SYNC_EVENT, (event) => {
        if (event.payload) writeThemeState(event.payload)
        else {
          globalThis.localStorage?.removeItem(AIDE_THEME_STATE_STORAGE_KEY)
          globalThis.localStorage?.removeItem(AIDE_THEME_ACTIVE_STORAGE_KEY)
        }
        listener()
      }).then((stop) => {
        if (disposed) stop()
        else stopTauriListener = stop
      })
    }

    return () => {
      disposed = true
      globalThis.removeEventListener?.(AIDE_THEME_LOCAL_SYNC_EVENT, handleLocalSync)
      globalThis.removeEventListener?.("storage", handleStorage as EventListener)
      stopTauriListener?.()
    }
  },
}

export const AIDE_THEME_OPTIONS = oriaPresetThemes.map((preset) => ({
  id: preset.id,
  name: preset.name,
  theme: preset,
}))

export const aideThemeConfig: OriaThemeConfig = {
  presets: oriaPresetThemes,
  defaultThemeId: oriaDefaultTheme.id,
  defaultAppearance: "system",
  storage: synchronizedThemeStorage,
  storageKey: AIDE_THEME_STORAGE_KEY,
  transition: {
    type: "view-transition",
    duration: 360,
    respectReducedMotion: true,
  },
  attributeAdapter: ({ root, resolvedMode }) => {
    root.classList.toggle("dark", resolvedMode === "dark")
  },
}

function useReduceTransparency() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-transparency: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return reduced
}

function NativeWindowAppearanceSync({
  syncApplicationWindowAppearance,
  syncWorkWindowAppearance,
}: {
  syncApplicationWindowAppearance: boolean
  syncWorkWindowAppearance: boolean
}) {
  const { snapshot } = useOriaTheme()
  const opacity = useWindowAppearanceSettingsStore((state) => state.opacity)
  const blurRadius = useWindowAppearanceSettingsStore((state) => state.blurRadius)
  const cornerRadius = useWindowAppearanceSettingsStore((state) => state.cornerRadius)
  const windowsBlurEnabled = useWindowAppearanceSettingsStore(
    (state) => state.windowsBlurEnabled,
  )
  const reduceTransparency = useReduceTransparency()

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === WINDOW_APPEARANCE_SETTINGS_STORAGE_KEY) {
        void useWindowAppearanceSettingsStore.persist.rehydrate()
      }
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const appearance = useMemo(() => {
    const theme = themeWindowAppearance(snapshot.resolvedTheme.variables)
    if (isWindowsDesktop()) {
      return {
        ...WINDOWS_WINDOW_APPEARANCE,
        opacity: reduceTransparency ? 100 : (opacity ?? theme.opacity),
        blurRadius: windowsBlurEnabled ? WINDOWS_WINDOW_APPEARANCE.blurRadius : 0,
      }
    }
    return resolveWindowAppearance(
      theme,
      { opacity, blurRadius, cornerRadius },
      reduceTransparency,
    )
  }, [
    blurRadius,
    cornerRadius,
    opacity,
    reduceTransparency,
    snapshot.resolvedTheme.variables,
    windowsBlurEnabled,
  ])

  useLayoutEffect(() => {
    applyWindowAppearanceToRoot(document.documentElement, appearance)
  }, [appearance])

  useEffect(() => {
    void applyNativeWindowAppearance(snapshot.preference.appearance)
  }, [snapshot.preference.appearance])

  useEffect(() => {
    if (!syncApplicationWindowAppearance && !syncWorkWindowAppearance) return
    if (!("__TAURI_INTERNALS__" in window)) return
    const frame = window.requestAnimationFrame(() => {
      const syncAppearance = syncWorkWindowAppearance
        ? setWorkWindowAppearance
        : setWindowAppearance
      void syncAppearance(appearance).catch(() => undefined)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [appearance, syncApplicationWindowAppearance, syncWorkWindowAppearance])

  return null
}

export function OriaAideThemeProvider({
  children,
  syncApplicationWindowAppearance = true,
  syncWorkWindowAppearance = false,
}: {
  children: ReactNode
  syncApplicationWindowAppearance?: boolean
  syncWorkWindowAppearance?: boolean
}) {
  return (
    <RuntimeThemeProvider config={aideThemeConfig}>
      <NativeWindowAppearanceSync
        syncApplicationWindowAppearance={syncApplicationWindowAppearance}
        syncWorkWindowAppearance={syncWorkWindowAppearance}
      />
      {children}
    </RuntimeThemeProvider>
  )
}
