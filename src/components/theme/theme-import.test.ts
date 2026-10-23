import { describe, expect, it } from "vitest"
import { exportTheme } from "@oriatheme/core"
import { oriaDefaultTheme } from "@oriatheme/presets"

import {
  generateCustomThemeId,
  parseImportedTheme,
  renameImportedTheme,
} from "@/components/theme/theme-import"
import tauriConfig from "../../../src-tauri/tauri.conf.json"

describe("generateCustomThemeId", () => {
  it("generates a readable slug from the edited name", () => {
    expect(generateCustomThemeId("Midnight Blue", [])).toBe("midnight-blue")
    expect(generateCustomThemeId("Élan Theme", [])).toBe("elan-theme")
  })

  it("generates a stable valid id for names without latin characters", () => {
    const id = generateCustomThemeId("夜间阅读", [])
    expect(id).toMatch(/^theme-[a-z0-9]+$/)
    expect(generateCustomThemeId("夜间阅读", [])).toBe(id)
  })

  it("adds a suffix when a generated id already exists", () => {
    expect(generateCustomThemeId("Midnight Blue", ["midnight-blue", "midnight-blue-2"]))
      .toBe("midnight-blue-3")
  })

  it("keeps ids within the OriaTheme length limit", () => {
    expect(generateCustomThemeId("A".repeat(100), [])).toHaveLength(64)
  })

  it("validates an exported theme and rewrites its imported identity", () => {
    const imported = parseImportedTheme(exportTheme(oriaDefaultTheme))
    expect(imported.ok).toBe(true)
    if (!imported.ok) return

    const renamed = renameImportedTheme(imported.theme, "  Reading Night  ", "reading-night", 42)
    expect(renamed).toMatchObject({
      id: "reading-night",
      name: "Reading Night",
      kind: "custom",
      createdAt: 42,
      updatedAt: 42,
    })
  })
})

describe("theme file drop configuration", () => {
  it("enables native paths for the main WebView drop zones", () => {
    const mainWindow = tauriConfig.app.windows.find((window) => window.label === "main")
    expect(mainWindow).toMatchObject({ dragDropEnabled: true })
  })
})
