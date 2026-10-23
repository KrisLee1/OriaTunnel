import { useSyncExternalStore } from "react"

import { setApplicationIcon } from "@/lib/bridge"
import type { ApplicationIconPreference, ResolvedApplicationIcon } from "@/types"

export const APPLICATION_ICON_STORAGE_KEY = "oria-tunnel.application-icon.v1"
const APPLICATION_ICON_CHANGE_EVENT = "oria-tunnel:application-icon-change"

export function readStoredApplicationIcon(raw: string | null): ApplicationIconPreference {
  return raw === "light" || raw === "dark" || raw === "mono" ? raw : "system"
}

export function resolveApplicationIcon(
  preference: ApplicationIconPreference,
  systemPrefersDark: boolean,
): ResolvedApplicationIcon {
  if (preference === "system") return systemPrefersDark ? "dark" : "light"
  return preference
}

export function getApplicationIconPreference(): ApplicationIconPreference {
  if (typeof window === "undefined") return "system"
  return readStoredApplicationIcon(window.localStorage.getItem(APPLICATION_ICON_STORAGE_KEY))
}

export function saveApplicationIconPreference(preference: ApplicationIconPreference): void {
  window.localStorage.setItem(APPLICATION_ICON_STORAGE_KEY, preference)
  window.dispatchEvent(new Event(APPLICATION_ICON_CHANGE_EVENT))
}

export function useApplicationIconPreference(): ApplicationIconPreference {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener(APPLICATION_ICON_CHANGE_EVENT, onStoreChange)
      window.addEventListener("storage", onStoreChange)
      return () => {
        window.removeEventListener(APPLICATION_ICON_CHANGE_EVENT, onStoreChange)
        window.removeEventListener("storage", onStoreChange)
      }
    },
    getApplicationIconPreference,
    () => "system",
  )
}

let applicationIconQueue: Promise<void> = Promise.resolve()

export async function applyApplicationIcon(
  preference: ApplicationIconPreference,
  systemPrefersDark: boolean,
): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return
  const icon = resolveApplicationIcon(preference, systemPrefersDark)
  // Keep rapid choices and system changes in order even while native work is pending.
  const update = applicationIconQueue.catch(() => {}).then(() => setApplicationIcon(icon))
  applicationIconQueue = update
  await update
}
