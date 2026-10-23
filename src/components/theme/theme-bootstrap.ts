import { resolveTheme, type AppearanceMode } from "@oriatheme/core"
import { oriaDefaultTheme } from "@oriatheme/presets"
import { bootstrapTheme } from "@oriatheme/runtime-dom"

import { AIDE_THEME_STORAGE_KEY } from "@/components/theme/aide-theme-provider"
import { syncWindowMaterial } from "@/components/theme/window-appearance"

export function readStoredAppearance(raw: string | null): AppearanceMode {
  if (!raw) return "system"

  try {
    const appearance = (JSON.parse(raw) as { appearance?: unknown }).appearance
    return appearance === "light" || appearance === "dark" || appearance === "system" ? appearance : "system"
  } catch {
    return "system"
  }
}

export function bootstrapAideTheme(): AppearanceMode {
  const appearance = readStoredAppearance(localStorage.getItem(`${AIDE_THEME_STORAGE_KEY}:active:v1`))

  bootstrapTheme({
    storageKey: AIDE_THEME_STORAGE_KEY,
    contract: { name: "oria-standard", version: 2 },
  })

  const root = document.documentElement
  if (!root.dataset.oriaTheme) {
    bootstrapTheme({
      snapshot: {
        schemaVersion: 1,
        contract: { name: "oria-standard", version: 2 },
        themeId: oriaDefaultTheme.id,
        appearance: "system",
        variablePrefix: "oria",
        lightVariables: resolveTheme(oriaDefaultTheme, "light").variables,
        darkVariables: resolveTheme(oriaDefaultTheme, "dark").variables,
      },
      contract: { name: "oria-standard", version: 2 },
    })
  }
  root.classList.toggle("dark", root.dataset.oriaMode === "dark")
  syncWindowMaterial(root)
  return appearance
}
