import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ChevronFirstIcon,
  ChevronLastIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { interactionSpring } from "./motion";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "./dropdown-menu";
import {
  isWorkspaceDock,
  resizeWorkspace,
  workspaceDocks,
  workspaceKeyboardSize,
} from "./workspace-layout";
import type { WorkspacePanelState } from "./use-workspace-panel";
import { cn } from "@/lib/utils";
import "./workspace-panel.css";

const icons = {
  bottom: PanelBottomIcon,
  left: PanelLeftIcon,
  right: PanelRightIcon,
};
let activePanel: string | null = null;
const subscribers = new Set<() => void>();
function activate(id: string) {
  if (activePanel === id) return;
  activePanel = id;
  subscribers.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};

export function WorkspacePanel({
  panel,
  title,
  onClose,
  actions,
  className,
  children,
}: {
  panel: WorkspacePanelState;
  title: string;
  onClose: () => void;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation("terminal");
  const top = useSyncExternalStore(
    subscribe,
    () => activePanel,
    () => null,
  );
  const { dock, sideDock, bounds, maximized, open, limit, minimum, size } =
    panel;
  const [present, setPresent] = useState(open);
  const reducedMotion = useReducedMotion();
  const resizeStart = useRef<{
    pointer: number;
    size: number;
    previous: number;
    maximized: boolean;
  } | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      setPresent(true);
      previousFocus.current = document.activeElement as HTMLElement | null;
      activate(panel.storageKey);
    }
  }, [open, panel.storageKey]);
  const DockIcon = icons[dock];
  const ExpandIcon = (dock === "left" ? !maximized : maximized)
    ? ChevronLastIcon
    : ChevronFirstIcon;
  return (
    <motion.aside
      ref={panel.ref}
      className={cn("workspace-panel floating-surface", className)}
      data-dock={dock}
      data-open={open}
      data-maximized={maximized}
      onPointerDownCapture={() => activate(panel.storageKey)}
      onFocusCapture={() => activate(panel.storageKey)}
      initial={false}
      animate={{
        ...bounds,
        opacity: open ? 1 : 0,
        x:
          open || reducedMotion
            ? 0
            : dock === "left"
              ? -bounds.width - panel.viewport.gap
              : dock === "right"
                ? bounds.width + panel.viewport.gap
                : 0,
        y:
          open || reducedMotion || sideDock
            ? 0
            : bounds.height + panel.viewport.gap,
      }}
      transition={
        panel.resizing
          ? { duration: 0 }
          : reducedMotion
            ? { duration: 0, opacity: { duration: 0.08 } }
            : { ...interactionSpring, opacity: { duration: 0.16 } }
      }
      onAnimationComplete={() => {
        if (!open) setPresent(false);
      }}
      style={{
        visibility: open || present ? "visible" : "hidden",
        zIndex: top === panel.storageKey ? 35 : 34,
      }}
      inert={!open}
      aria-hidden={!open}
      aria-label={title}
    >
      <div
        className="workspace-panel-resize"
        role="separator"
        tabIndex={0}
        aria-label={t(sideDock ? "resizeWidth" : "resize")}
        title={t(sideDock ? "resizeWidth" : "resize")}
        aria-orientation={sideDock ? "vertical" : "horizontal"}
        aria-valuemin={Math.min(minimum, limit)}
        aria-valuemax={limit}
        aria-valuenow={maximized ? limit : size}
        onPointerDown={(event) => {
          if (event.button !== 0 || resizeStart.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
          const rect = panel.ref.current?.getBoundingClientRect();
          const current = (sideDock ? rect?.width : rect?.height) || size;
          resizeStart.current = {
            pointer: sideDock ? event.clientX : event.clientY,
            size: current,
            previous: panel.layout.sizes[dock],
            maximized,
          };
          panel.setResizing(true);
          panel.setSize(current);
          panel.setMaximized(false);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const start = resizeStart.current;
          if (start && event.currentTarget.hasPointerCapture(event.pointerId))
            panel.setSize(
              resizeWorkspace(
                dock,
                start.size,
                (sideDock ? event.clientX : event.clientY) - start.pointer,
                limit,
              ),
            );
        }}
        onPointerUp={(event) => {
          resizeStart.current = null;
          panel.setResizing(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          const start = resizeStart.current;
          if (start) {
            panel.setSize(start.previous);
            panel.setMaximized(start.maximized);
          }
          resizeStart.current = null;
          panel.setResizing(false);
        }}
        onLostPointerCapture={() => {
          resizeStart.current = null;
          panel.setResizing(false);
        }}
        onKeyDown={(event) => {
          const next = workspaceKeyboardSize(
            dock,
            event.key,
            maximized ? limit : size,
            limit,
          );
          if (next !== undefined) {
            event.preventDefault();
            panel.setMaximized(false);
            panel.setSize(next);
          }
        }}
      />
      <header className="workspace-panel-header">
        <strong>{title}</strong>
        <div className="workspace-panel-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t(maximized ? "restore" : "maximize")}
            title={t(maximized ? "restore" : "maximize")}
            onClick={() => panel.setMaximized(!maximized)}
          >
            <ExpandIcon
              aria-hidden="true"
              className={sideDock ? undefined : "rotate-90"}
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("position")}
                  title={t("position")}
                />
              }
            >
              <DockIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={dock}
                onValueChange={(value) => {
                  if (isWorkspaceDock(value)) panel.changeDock(value);
                }}
              >
                {workspaceDocks.map((position) => {
                  const Icon = icons[position];
                  return (
                    <DropdownMenuRadioItem key={position} value={position}>
                      <Icon aria-hidden="true" />
                      {t(`dock.${position}`)}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {actions}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("collapse")}
            title={t("collapse")}
            onClick={() => {
              const ownsFocus = panel.ref.current?.contains(
                document.activeElement,
              );
              onClose();
              if (ownsFocus && previousFocus.current?.isConnected)
                previousFocus.current.focus();
            }}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </header>
      {children}
    </motion.aside>
  );
}
