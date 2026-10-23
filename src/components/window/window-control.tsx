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

import type {
  ResolvedWindowControlStyle,
  WindowControlPosition,
} from "@/stores/window-control-settings-store"

export type WindowControlMode = "full" | "close-only"

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export function closeWindow() {
  return isDesktopRuntime() ? getCurrentWindow().close() : Promise.resolve()
}

export function minimizeWindow() {
  return isDesktopRuntime() ? getCurrentWindow().minimize() : Promise.resolve()
}

/** Toggle maximize/restore and return the resulting state. */
export async function maximizeWindow() {
  if (!isDesktopRuntime()) return false

  const appWindow = getCurrentWindow()
  await appWindow.toggleMaximize()
  return appWindow.isMaximized()
}

function useWindowState(appWindow: TauriWindow | null, trackNativeWindowState: boolean) {
  const [isMaximized, setIsMaximized] = useState(false)
  const [isActive, setIsActive] = useState(() =>
    typeof document === "undefined" ? true : document.hasFocus(),
  )

  useEffect(() => {
    if (!appWindow || !trackNativeWindowState) {
      const syncBrowserFocus = () => setIsActive(document.hasFocus())
      window.addEventListener("focus", syncBrowserFocus)
      window.addEventListener("blur", syncBrowserFocus)
      document.addEventListener("visibilitychange", syncBrowserFocus)

      return () => {
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
            if (!disposed) setIsMaximized(value)
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
      setIsMaximized(maximized)
      setIsActive(focused)
    }

    void setup().catch(() => undefined)

    return () => {
      disposed = true
      disposers.forEach((dispose) => dispose())
    }
  }, [appWindow, trackNativeWindowState])

  return { isActive, isMaximized, setIsMaximized }
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
  const { isActive, isMaximized, setIsMaximized } = useWindowState(
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

  const handleMaximize = async () => {
    if (!appWindow) return
    setIsMaximized(await maximizeWindow())
  }

  const labels = {
    close: t("windowControls.actions.close"),
    minimize: t("windowControls.actions.minimize"),
    maximize: t(isMaximized ? "windowControls.actions.restore" : "windowControls.actions.maximize"),
  }

  if (style === "windows") {
    const iconClassName = "size-3.5 opacity-85"
    const buttonRadiusClassName = "rounded-[min(var(--radius-md),8px)]"

    return (
      <div
        ref={controlsRef}
        data-window-active={isActive}
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
              onClick={() => void handleMaximize()}
              aria-label={labels.maximize}
              title={labels.maximize}
              className={buttonRadiusClassName}
            >
              {isMaximized ? (
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
            onClick={() => void handleMaximize()}
            aria-label={labels.maximize}
            title={labels.maximize}
            className={cn(
              lightClassName,
              isActive ? "border-green-500/50! bg-green-400!" : inactiveClassName,
            )}
          >
            {isMaximized ? (
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
