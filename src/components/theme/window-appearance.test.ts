import { describe, expect, it } from "vitest"

import {
  applyWindowAppearanceToRoot,
  isWindowsDesktop,
  nativeThemeForAppearance,
  resolveWindowAppearance,
  themeWindowAppearance,
  windowComponentOpacities,
  windowMaterialForSurfaceColor,
  WINDOWS_WINDOW_APPEARANCE,
} from "@/components/theme/window-appearance"

describe("Windows window appearance", () => {
  it("detects Windows WebView runtimes", () => {
    expect(isWindowsDesktop("Win32", "Mozilla/5.0")).toBe(true)
    expect(isWindowsDesktop("MacIntel", "Mozilla/5.0 (Macintosh)")).toBe(false)
  })

  it("uses one fixed non-customizable appearance", () => {
    expect(WINDOWS_WINDOW_APPEARANCE).toEqual({
      opacity: 82,
      blurRadius: 1,
      cornerRadius: 0,
    })
  })
})

describe("nativeThemeForAppearance", () => {
  it("releases the native theme override when following the system", () => {
    expect(nativeThemeForAppearance("system")).toBeNull()
  })

  it.each(["light", "dark"] as const)("keeps the explicit %s override", (appearance) => {
    expect(nativeThemeForAppearance(appearance)).toBe(appearance)
  })

  it.each(["#ffffff80", "#fff8", "rgba(255, 255, 255, 0.6)", "rgb(255 255 255 / 60%)", "transparent"])(
    "uses a translucent window for a translucent raised surface (%s)",
    (color) => {
      expect(windowMaterialForSurfaceColor(color)).toBe("translucent")
    },
  )

  it.each(["#ffffff", "#fff", "rgba(255, 255, 255, 1)", "rgb(255 255 255 / 100%)"])(
    "uses a solid window for an opaque raised surface (%s)",
    (color) => {
      expect(windowMaterialForSurfaceColor(color)).toBe("solid")
    },
  )
})

describe("themeWindowAppearance", () => {
  it("uses solid defaults and adds the window edge inset to the theme radius", () => {
    expect(
      themeWindowAppearance({
        "--oria-color-surface-raised": "#ffffff",
        "--oria-opacity-overlay": "0.7",
        "--oria-backdrop-blur-2xl": "48px",
        "--oria-radius-xl": "0",
        "--oria-space": "0.25rem",
      }),
    ).toEqual({ opacity: 100, blurRadius: 0, cornerRadius: 6 })
  })

  it("derives transparent material values and converts rem corner radii", () => {
    expect(
      themeWindowAppearance({
        "--oria-color-surface-raised": "#ffffff80",
        "--oria-opacity-overlay": "0.78",
        "--oria-backdrop-blur-2xl": "60px",
        "--oria-radius-xl": "2rem",
        "--oria-space": "0.5rem",
      }),
    ).toEqual({ opacity: 78, blurRadius: 60, cornerRadius: 44 })
  })
})

describe("resolveWindowAppearance", () => {
  const theme = { opacity: 78, blurRadius: 60, cornerRadius: 48 }

  it("follows the theme independently for settings without overrides", () => {
    expect(
      resolveWindowAppearance(theme, {
        opacity: 55,
        blurRadius: null,
        cornerRadius: 0,
      }),
    ).toEqual({ opacity: 55, blurRadius: 60, cornerRadius: 0 })
  })

  it("honors reduced transparency without discarding the corner preference", () => {
    expect(
      resolveWindowAppearance(
        theme,
        { opacity: 55, blurRadius: 30, cornerRadius: 12 },
        true,
      ),
    ).toEqual({ opacity: 100, blurRadius: 0, cornerRadius: 12 })
  })
})

describe("window component opacity", () => {
  it("keeps component backgrounds solid with a solid window", () => {
    expect(windowComponentOpacities(100)).toEqual({ surface: 1, overlay: 1 })
  })

  it("softens surfaces while keeping overlays more readable", () => {
    expect(windowComponentOpacities(50)).toEqual({ surface: 0.675, overlay: 0.76 })
  })

  it("applies the derived opacity variables to the document root", () => {
    const properties = new Map<string, string>()
    const root = {
      dataset: {} as DOMStringMap,
      style: {
        getPropertyValue: (name: string) => properties.get(name) ?? "",
        setProperty: (name: string, value: string) => properties.set(name, value),
      },
    } as unknown as HTMLElement

    applyWindowAppearanceToRoot(root, { opacity: 50, blurRadius: 24, cornerRadius: 20 })

    expect(root.style.getPropertyValue("--aide-window-background-opacity")).toBe("0.5")
    expect(root.style.getPropertyValue("--aide-component-surface-opacity")).toBe("0.675")
    expect(root.style.getPropertyValue("--aide-component-overlay-opacity")).toBe("0.76")
  })
})
