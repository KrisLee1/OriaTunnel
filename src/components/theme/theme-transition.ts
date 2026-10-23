import type { ThemeChangeOptions } from "@oriatheme/runtime-dom"

type TransitionAnchor = {
  getBoundingClientRect(): {
    left: number
    top: number
    width: number
    height: number
  }
}

export type ThemeTransitionEventDetails = {
  readonly event?: Event
  readonly trigger?: TransitionAnchor
}

function eventOrigin(event: Event | undefined) {
  if (!event || !("clientX" in event) || !("clientY" in event)) return null
  const x = event.clientX
  const y = event.clientY
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
    return null
  }
  return { x, y }
}

function isTransitionAnchor(value: unknown): value is TransitionAnchor {
  return typeof value === "object"
    && value !== null
    && "getBoundingClientRect" in value
    && typeof value.getBoundingClientRect === "function"
}

function anchorOrigin(anchor: TransitionAnchor | null | undefined) {
  if (!anchor) return null
  const rect = anchor.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function themeTransitionOptions(
  details?: ThemeTransitionEventDetails | null,
): ThemeChangeOptions {
  const target = details?.event?.target
  const origin = eventOrigin(details?.event)
    ?? anchorOrigin(details?.trigger)
    ?? anchorOrigin(isTransitionAnchor(target) ? target : null)

  return origin ? { animate: true, origin } : { animate: true }
}

export function themeTransitionOptionsFromAnchor(
  anchor?: TransitionAnchor | null,
): ThemeChangeOptions {
  const origin = anchorOrigin(anchor)
  return origin ? { animate: true, origin } : { animate: true }
}
