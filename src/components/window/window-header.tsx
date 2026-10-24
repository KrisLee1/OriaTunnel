import { Children, Fragment, isValidElement, useEffect, useRef, useState, type MouseEvent, type ReactNode, type CSSProperties } from "react"
import { createPortal } from "react-dom"

import {
  WindowControl,
  maximizeWindow,
  type WindowControlMode,
} from "@/components/window/window-control"
import { cn } from "@/lib/utils"
import {
  resolveWindowControlPosition,
  resolveWindowControlStyle,
  WINDOW_CONTROL_SETTINGS_STORAGE_KEY,
  useWindowControlSettingsStore,
} from "@/stores/window-control-settings-store"

function hasActionContent(content: ReactNode): boolean {
  return Children.toArray(content).some((child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return hasActionContent(child.props.children)
    }
    return child !== ""
  })
}

export function WindowHeader({
  children,
  fixedLeftActions,
  fixedRightActions,
  title,
  centerContent,
  onClose,
  controlMode = "full",
  density = "default",
}: {
  children?: ReactNode
  fixedLeftActions?: ReactNode
  fixedRightActions?: ReactNode
  title?: ReactNode
  centerContent?: ReactNode
  onClose?: () => void | Promise<void>
  controlMode?: WindowControlMode
  density?: "default" | "compact"
}) {
  const position = useWindowControlSettingsStore((state) => state.position)
  const style = useWindowControlSettingsStore((state) => state.style)
  const resolvedStyle = resolveWindowControlStyle(style)
  const resolvedPosition = resolveWindowControlPosition(style, position, resolvedStyle)
  const headerRef = useRef<HTMLElement>(null)
  const [safeInset, setSafeInset] = useState(180)
  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const update = () => {
      const sides = header.querySelectorAll<HTMLElement>('[data-window-header-side]')
      setSafeInset(Math.max(...Array.from(sides, side => side.offsetWidth)) + 16)
    }
    const observer = new ResizeObserver(update)
    header.querySelectorAll('[data-window-header-side]').forEach(side => observer.observe(side))
    update()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === WINDOW_CONTROL_SETTINGS_STORAGE_KEY) {
        void useWindowControlSettingsStore.persist.rehydrate()
      }
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (controlMode !== "full" || event.target !== event.currentTarget) return

    void maximizeWindow()
  }

  const windowControl = (
    <WindowControl
      position={resolvedPosition}
      style={resolvedStyle}
      onClose={onClose}
      mode={controlMode}
    />
  )
  const actionCapsule = (actions: ReactNode, fixedSide?: "left" | "right", mirror = false) => {
    if (!hasActionContent(actions)) return null
    return (
      <div
        className={cn(
          "window-actions overlay flex h-fit w-fit shrink-0 items-center rounded-xl p-0.5",
          mirror && resolvedPosition === "right" && "flex-row-reverse",
        )}
        data-fixed-actions={fixedSide}
        style={{ '--aide-titlebar-button-size': 'calc(var(--spacing) * 7)' } as CSSProperties}
      >
        {actions}
      </div>
    )
  }
  const featureActions = actionCapsule(children, undefined, true)
  const leftControls = (
    <div className="flex h-fit w-fit shrink-0 items-center gap-1" data-window-header-side="left">
      {resolvedPosition === "left" ? windowControl : featureActions}
      {actionCapsule(fixedLeftActions, "left")}
    </div>
  )
  const rightControls = (
    <div className="flex h-fit w-fit shrink-0 items-center gap-1" data-window-header-side="right">
      {actionCapsule(fixedRightActions, "right")}
      {resolvedPosition === "left" ? featureActions : windowControl}
    </div>
  )

  const header = (
    <header
      ref={headerRef}
      data-tauri-drag-region
      onDoubleClick={handleTitlebarDoubleClick}
      className={cn(
        "app-titlebar fixed inset-x-0 top-0 z-40 flex select-none justify-between rounded-t-(--window-rounded)",
        density === "compact" ? "h-8 px-1" : "h-(--aide-chrome-top) px-1 py-1",
      )}
    >
      {leftControls}
      {centerContent ? <div className="header-center" style={{left:safeInset,right:safeInset}}>{centerContent}</div> : title && (
        <div className="pointer-events-none absolute inset-x-[32%] inset-y-0 flex items-center justify-center truncate text-xs font-medium text-muted-foreground">
          {title}
        </div>
      )}
      {rightControls}
    </header>
  )

  // Native chrome must sit outside the isolated app surface, above the workspace; modal scrims can shade it without blocking native dragging.
  return typeof document === "undefined" ? header : createPortal(header, document.body)
}
