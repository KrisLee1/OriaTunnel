import { useEffect, useRef, useState } from "react"
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window"
import {
  ChevronsLeftRightIcon,
  ChevronsRightLeftIcon,
  CopyIcon,
  MinusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isViewerWindow, viewerWindowAction } from "@/lib/viewer-window"

import type {
  ResolvedWindowControlStyle,
  WindowControlPosition,
} from "@/stores/window-control-settings-store"

export type WindowControlMode = "full" | "close-only"

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export function closeWindow() {
  if (isViewerWindow()) return viewerWindowAction("close").then(() => {})
  return isDesktopRuntime() ? getCurrentWindow().close() : Promise.resolve()
}

export function minimizeWindow() {
  if (isViewerWindow()) return viewerWindowAction("minimize")
  return isDesktopRuntime() ? getCurrentWindow().minimize() : Promise.resolve()
}

/** Toggle maximize/restore and return the resulting state. */
export async function maximizeWindow() {
  if (isViewerWindow()) return viewerWindowAction("toggleMaximize")
  if (!isDesktopRuntime()) return false

  const appWindow = getCurrentWindow()
  await appWindow.toggleMaximize()
  return appWindow.isMaximized()
}

function useWindowState(appWindow: TauriWindow | null, trackNativeWindowState: boolean) {
  const [expanded, setExpanded] = useState(false)
  const [isActive, setIsActive] = useState(() =>
    typeof document === "undefined" ? true : document.hasFocus(),
  )

  useEffect(() => {
    if (!appWindow || !trackNativeWindowState || isViewerWindow()) {
      const syncBrowserFocus = () => setIsActive(document.hasFocus())
      let disposed = false
      const syncSize = () => {
        if (trackNativeWindowState && isViewerWindow()) {
          void viewerWindowAction("isFullscreen").then(value => {
            if (!disposed) setExpanded(value)
          })
        }
      }
      syncSize()
      window.addEventListener("resize", syncSize)
      window.addEventListener("focus", syncBrowserFocus)
      window.addEventListener("blur", syncBrowserFocus)
      document.addEventListener("visibilitychange", syncBrowserFocus)

      return () => {
        disposed = true
        window.removeEventListener("resize", syncSize)
        window.removeEventListener("focus", syncBrowserFocus)
        window.removeEventListener("blur", syncBrowserFocus)
        document.removeEventListener("visibilitychange", syncBrowserFocus)
      }
    }

    let disposed = false
    const disposers: Array<() => void> = []

    const setup = async () => {
      const [stopResized, stopFocusChanged, maximized, focused] = await Promise.all([
        appWindow.onResized(() => {
          void appWindow.isMaximized().then((value) => {
            if (!disposed) setExpanded(value)
          })
        }),
        appWindow.onFocusChanged(({ payload }) => {
          if (!disposed) setIsActive(payload)
        }),
        appWindow.isMaximized(),
        appWindow.isFocused(),
      ])

      if (disposed) {
        stopResized()
        stopFocusChanged()
        return
      }

      disposers.push(stopResized, stopFocusChanged)
      setExpanded(maximized)
      setIsActive(focused)
    }

    void setup().catch(() => undefined)

    return () => {
      disposed = true
      disposers.forEach((dispose) => dispose())
    }
  }, [appWindow, trackNativeWindowState])

  return { isActive, expanded, setExpanded }
}

export function WindowControl({
  className,
  position,
  style,
  onClose = closeWindow,
  mode = "full",
}: {
  className?: string
  position: WindowControlPosition
  style: ResolvedWindowControlStyle
  onClose?: () => void | Promise<void>
  mode?: WindowControlMode
}) {
  const { t } = useTranslation()
  const [appWindow] = useState(() => (isDesktopRuntime() ? getCurrentWindow() : null))
  const { isActive, expanded, setExpanded } = useWindowState(
    appWindow,
    mode === "full",
  )
  const controlsRef = useRef<HTMLDivElement>(null)
  const releasedInitialFocusRef = useRef(false)

  useEffect(() => {
    if (!isActive || releasedInitialFocusRef.current) return

    const frame = requestAnimationFrame(() => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLElement
        && controlsRef.current?.contains(activeElement)
      ) {
        activeElement.blur()
      }
      releasedInitialFocusRef.current = true
    })

    return () => cancelAnimationFrame(frame)
  }, [isActive])

  const viewer = isViewerWindow()
  const toggleExpanded = async () => {
    if (!appWindow) return
    const next = viewer ? await viewerWindowAction("toggleFullscreen") : await maximizeWindow()
    setExpanded(next)
  }

  const labels = {
    close: t("windowControls.actions.close"),
    minimize: t("windowControls.actions.minimize"),
    expand: expanded
      ? t("windowControls.actions.restore")
      : viewer ? t("fullscreen", { ns: "vnc" }) : t("windowControls.actions.maximize"),
  }

  if (style === "windows") {
    const iconClassName = "size-3.5 opacity-85"
    const buttonRadiusClassName = "rounded-[min(var(--radius-md),8px)]"

    return (
      <div
        ref={controlsRef}
        data-window-active={isActive}
          data-viewer-fullscreen={(viewer && mode === "full" && expanded) || undefined}
        className={cn(
          "flex h-fit w-fit items-center rounded-xl p-0.5",
          mode === "full" && "overlay",
          position === "right" && "flex-row-reverse",
          className,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void onClose()}
          aria-label={labels.close}
          title={labels.close}
          className={cn(buttonRadiusClassName, "hover:bg-danger/20! hover:text-danger!")}
        >
          <XIcon className={iconClassName} />
        </Button>
        {mode === "full" && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void minimizeWindow()}
              aria-label={labels.minimize}
              title={labels.minimize}
              className={buttonRadiusClassName}
            >
              <MinusIcon className={iconClassName} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void toggleExpanded()}
              aria-label={labels.expand}
              title={labels.expand}
              className={buttonRadiusClassName}
            >
              {expanded ? (
                <CopyIcon className={cn(iconClassName, "rotate-90")} />
              ) : (
                <SquareIcon className={iconClassName} />
              )}
            </Button>
          </>
        )}
      </div>
    )
  }

  const iconClassName = cn(
    "size-2.5 stroke-4 opacity-0 transition-opacity duration-150",
    isActive && "group-hover/window-controls:opacity-60",
  )
  const lightClassName = "size-4 rounded-full border p-0 text-black!"
  const inactiveClassName = "border-muted-foreground/20! bg-muted-foreground/50!"

  return (
    <div
      ref={controlsRef}
      data-window-active={isActive}
        data-viewer-fullscreen={(viewer && mode === "full" && expanded) || undefined}
      className={cn(
        "group/window-controls flex h-fit w-fit items-center gap-2 rounded-xl p-2",
        mode === "full" && "overlay",
        position === "right" && "flex-row-reverse",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={() => void onClose()}
        aria-label={labels.close}
        title={labels.close}
        className={cn(
          lightClassName,
          isActive ? "border-red-500/50! bg-red-400!" : inactiveClassName,
        )}
      >
        <XIcon className={iconClassName} />
      </Button>
      {mode === "full" && (
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void minimizeWindow()}
            aria-label={labels.minimize}
            title={labels.minimize}
            className={cn(
              lightClassName,
              isActive ? "border-amber-400/50! bg-amber-300!" : inactiveClassName,
            )}
          >
            <MinusIcon className={iconClassName} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void toggleExpanded()}
            aria-label={labels.expand}
            title={labels.expand}
            className={cn(
              lightClassName,
              isActive ? "border-green-500/50! bg-green-400!" : inactiveClassName,
            )}
          >
            {expanded ? (
              <ChevronsRightLeftIcon className={cn(iconClassName, "rotate-45")} />
            ) : (
              <ChevronsLeftRightIcon className={cn(iconClassName, "rotate-45")} />
            )}
          </Button>
        </>
      )}
    </div>
  )
}
