import type { AppearanceMode } from "@oriatheme/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

import type { WindowAppearance } from "@/types"
import type { WindowAppearanceOverrides } from "@/stores/window-appearance-settings-store"

export type WindowMaterial = "solid" | "translucent"

export interface WindowComponentOpacities {
  surface: number
  overlay: number
}

const windowContentInsetInSpaces = 1.5

export const WINDOWS_WINDOW_APPEARANCE: WindowAppearance = {
  opacity: 82,
  blurRadius: 1,
  cornerRadius: 0,
}

export function isWindowsDesktop(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return /windows|win(?:32|64)/i.test(`${platform} ${userAgent}`)
}

function parseAlpha(value: string): number | null {
  const color = value.trim().toLowerCase()
  if (color === "transparent") return 0

  const hex = color.match(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{1,2})$/i)
  if (hex?.[1]) {
    const alpha = hex[1].length === 1 ? `${hex[1]}${hex[1]}` : hex[1]
    return Number.parseInt(alpha, 16) / 255
  }

  const slashAlpha = color.match(/\/\s*([\d.]+%?)\s*\)$/)
  if (slashAlpha?.[1]) {
    const alpha = Number.parseFloat(slashAlpha[1])
    return slashAlpha[1].endsWith("%") ? alpha / 100 : alpha
  }

  const legacyAlpha = color.match(/^(?:rgba|hsla)\([^,]+,[^,]+,[^,]+,\s*([\d.]+%?)\s*\)$/)
  if (legacyAlpha?.[1]) {
    const alpha = Number.parseFloat(legacyAlpha[1])
    return legacyAlpha[1].endsWith("%") ? alpha / 100 : alpha
  }

  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseUnit(value: string, rootFontSize = 16): number | null {
  const match = value.trim().toLowerCase().match(/^(-?[\d.]+)(px|rem)?$/)
  if (!match?.[1]) return null
  const amount = Number.parseFloat(match[1])
  if (!Number.isFinite(amount)) return null
  return match[2] === "rem" ? amount * rootFontSize : amount
}

function parseOpacity(value: string): number | null {
  const amount = Number.parseFloat(value.trim())
  return Number.isFinite(amount) ? clamp(amount, 0.01, 1) : null
}

export function windowComponentOpacities(windowOpacity: number): WindowComponentOpacities {
  const normalizedOpacity = clamp(windowOpacity / 100, 0.01, 1)

  return {
    surface: Number((0.35 + normalizedOpacity * 0.65).toFixed(3)),
    overlay: Number((0.52 + normalizedOpacity * 0.48).toFixed(3)),
  }
}

export function windowMaterialForSurfaceColor(surfaceRaised: string): WindowMaterial {
  const alpha = parseAlpha(surfaceRaised)
  return alpha !== null && alpha < 1 ? "translucent" : "solid"
}

export function syncWindowMaterial(root: HTMLElement): void {
  const style = root.ownerDocument.defaultView?.getComputedStyle(root)
  const surfaceRaised = style?.getPropertyValue("--oria-color-surface-raised") ?? ""
  root.dataset.aideWindowMaterial = windowMaterialForSurfaceColor(surfaceRaised)
}

export function themeWindowAppearance(
  variables: Record<string, string>,
  rootFontSize = 16,
): WindowAppearance {
  const opacity = Math.round(
    (parseOpacity(variables["--oria-opacity-overlay"] ?? "") ?? 0.82) * 100,
  )
  const blurRadius = Math.round(
    clamp(
      parseUnit(variables["--oria-backdrop-blur-2xl"] ?? "", rootFontSize) ?? 0,
      0,
      64,
    ),
  )
  const innerRadius = parseUnit(variables["--oria-radius-xl"] ?? "", rootFontSize) ?? 12
  const edgeInset =
    (parseUnit(variables["--oria-space"] ?? "", rootFontSize) ?? 4)
    * windowContentInsetInSpaces
  const cornerRadius = Math.round(clamp(innerRadius + edgeInset, 0, 64))

  return { opacity, blurRadius, cornerRadius }
}

export function resolveWindowAppearance(
  theme: WindowAppearance,
  overrides: WindowAppearanceOverrides,
  reduceTransparency = false,
): WindowAppearance {
  return {
    opacity: reduceTransparency ? 100 : (overrides.opacity ?? theme.opacity),
    blurRadius: reduceTransparency ? 0 : (overrides.blurRadius ?? theme.blurRadius),
    cornerRadius: overrides.cornerRadius ?? theme.cornerRadius,
  }
}

export function applyWindowAppearanceToRoot(
  root: HTMLElement,
  appearance: WindowAppearance,
): void {
  const componentOpacities = windowComponentOpacities(appearance.opacity)

  root.style.setProperty("--aide-window-background-opacity", String(appearance.opacity / 100))
  root.style.setProperty("--aide-component-surface-opacity", String(componentOpacities.surface))
  root.style.setProperty("--aide-component-overlay-opacity", String(componentOpacities.overlay))
  root.style.setProperty("--window-rounded", `${appearance.cornerRadius}px`)
  root.dataset.aideWindowMaterial =
    appearance.opacity < 100 || appearance.blurRadius > 0 ? "translucent" : "solid"
}

export function nativeThemeForAppearance(appearance: AppearanceMode): "light" | "dark" | null {
  return appearance === "system" ? null : appearance
}

export async function applyNativeWindowAppearance(appearance: AppearanceMode): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return

  try {
    await getCurrentWindow().setTheme(nativeThemeForAppearance(appearance))
  } catch {
    // Native window themes are unavailable in the browser preview.
  }
}
