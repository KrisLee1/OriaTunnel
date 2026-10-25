import { formatUiError } from "@/lib/ui-message";
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  TerminalIcon,
  SquarePlusIcon,
  SquareTerminalIcon,
  XIcon,
  ChevronFirstIcon,
  ChevronLastIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  RotateCwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { interactionSpring } from "@/components/ui/motion";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { HostPicker } from "@/features/hosts/host-picker";
import { AuthenticationField } from "@/features/hosts/authentication-field";
import { addedHosts } from "@/features/hosts/host-collection";
import { jumpHosts } from "@/features/tunnels/rule-model";
import { CommandResult } from "@/features/commands/preset-commands";
import { mergeRuns } from "@/features/commands/command-model";
import * as bridge from "@/lib/bridge";
import type {
  CommandRun,
  PresetAction,
  RemoteService,
  Snapshot,
  TerminalSession,
} from "@/types";
import {
  mergeSessions,
  terminalActive,
  unsubmittedPreset,
  terminalNeedsCredentials,
  terminalStateTone,
  serviceForegroundSession,
} from "./terminal-model";
import {
  workspaceDocks,
  workspaceLayoutKey,
  workspaceMinimum,
  isWorkspaceDock,
  parseWorkspaceLayout,
  clampWorkspaceSize,
  resizeWorkspace,
  workspaceKeyboardSize,
  workspaceBounds,
  workspaceGap,
  workspaceSizeLimit,
  workspaceChromeBottom,
  terminalTabScrollEdges,
} from "./workspace-layout";
const dockIcons = {
  bottom: PanelBottomIcon,
  left: PanelLeftIcon,
  right: PanelRightIcon,
};
const TerminalView = lazy(() => import("./terminal-view"));
interface WorkspaceApi {
  openHost: (hostId?: string) => void;
  openPreset: (
    service: RemoteService,
    action: PresetAction,
    secrets: Record<string, string>,
    rememberHostIds: string[],
    ruleId?: string,
  ) => Promise<void>;
  showCommand: (run: CommandRun) => void;
  serviceBusy: (id: string) => boolean;
  busy: boolean;
  foregroundSession: (
    service: RemoteService,
    ruleId?: string,
  ) => TerminalSession | undefined;
  stopService: (service: RemoteService, ruleId?: string) => Promise<void>;
}
const Context = createContext<WorkspaceApi | null>(null);
export const useTerminalWorkspace = () => useContext(Context);
export function OpenTerminalButton({
  hostId,
  workspace = false,
  onOpen,
}: {
  hostId?: string;
  workspace?: boolean;
  onOpen?: () => void;
}) {
  const api = useTerminalWorkspace();
  const { t } = useTranslation("terminal");
  if (!api) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="nodrag nopan"
      aria-label={t(workspace ? "workspace" : "open")}
      title={t(workspace ? "workspace" : "open")}
      disabled={!bridge.desktop}
      onClick={() => {
        onOpen?.();
        api.openHost(hostId);
      }}
    >
      {workspace ? (
        <TerminalIcon aria-hidden="true" />
      ) : (
        <SquareTerminalIcon aria-hidden="true" />
      )}
    </Button>
  );
}
export function TerminalWorkspaceProvider({
  data,
  children,
}: {
  data: Snapshot;
  children: ReactNode;
}) {
  const { t } = useTranslation("terminal");
  const [clientId] = useState(() => crypto.randomUUID());
  const [sessions, setSessions] = useState<TerminalSession[]>([]),
    [commands, setCommands] = useState<CommandRun[]>([]);
  const [commandTabs, setCommandTabs] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState(false),
    [maximized, setMaximized] = useState(false);
  const [layout, setLayout] = useState(() => {
    try {
      return parseWorkspaceLayout(localStorage.getItem(workspaceLayoutKey));
    } catch {
      return parseWorkspaceLayout(null);
    }
  });
  const { dock } = layout;
  const sideDock = dock !== "bottom";
  const workspaceRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const [tabEdges, setTabEdges] = useState({ left: false, right: false });
  const reducedMotion = useReducedMotion();
  const [present, setPresent] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1180 : window.innerWidth,
    height: typeof window === "undefined" ? 780 : window.innerHeight,
    headerBottom: 38,
    gap: workspaceGap,
  }));
  const sizeLimit = workspaceSizeLimit(dock, viewport);
  const [resizing, setResizing] = useState(false);
  const [error, setError] = useState("");
  const size = clampWorkspaceSize(dock, layout.sizes[dock], sizeLimit);
  const bounds = workspaceBounds(dock, size, maximized, viewport);
  useEffect(() => {
    if (expanded) setPresent(true);
  }, [expanded]);
  const setSize = (value: number) =>
    setLayout((previous) => ({
      ...previous,
      sizes: {
        ...previous.sizes,
        [dock]: clampWorkspaceSize(dock, value, sizeLimit),
      },
    }));
  useEffect(() => {
    if (resizing) return;
    try {
      localStorage.setItem(workspaceLayoutKey, JSON.stringify(layout));
    } catch {
      /* Keep the current layout when local preferences are unavailable. */
    }
  }, [layout, resizing]);
  const [draft, setDraft] = useState<{
    hostId: string;
    noEnvironment: boolean;
    fallback: boolean;
    locked?: boolean;
    replaceId?: string;
    profile?: { service: RemoteService; action: PresetAction; ruleId?: string };
  } | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({}),
    [remember, setRemember] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<TerminalSession | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".app-titlebar");
    const resized = () => {
      // The header's transparent bottom padding is not part of its visible capsules.
      const styles = header ? getComputedStyle(header) : undefined;
      const gap = header ? parseFloat(styles!.paddingLeft) : workspaceGap;
      const headerBottom = header
        ? workspaceChromeBottom(
            header.getBoundingClientRect().bottom,
            parseFloat(styles!.paddingBottom) || 0,
            Array.from(
              header.querySelectorAll(
                "[data-window-header-side], .header-center > *",
              ),
              (child) => child.getBoundingClientRect(),
            )
              .filter((rect) => rect.width > 0 && rect.height > 0)
              .map((rect) => rect.bottom),
          )
        : 38;
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        headerBottom,
        gap: Number.isFinite(gap) ? gap : workspaceGap,
      });
    };
    const observer = new ResizeObserver(resized);
    if (header) {
      observer.observe(header);
      Array.from(header.children).forEach((child) => observer.observe(child));
    }
    resized();
    window.addEventListener("resize", resized);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resized);
    };
  }, []);
  const submitting = useRef(false),
    requests = useRef(new Map<string, string>()),
    dismissed = useRef(new Set<string>());
  const tabKeys = useRef(new Map<string, string>());
  const replacementRequests = useRef(new Map<string, string>());
  const automaticAuthRequests = useRef(new Map<string, string | undefined>());
  const promptedSessions = useRef(new Set<string>());
  const automaticCommandAuth = useRef(new Set<string>());
  const merge = useCallback((next: TerminalSession[]) => {
    const replacements = new Map(replacementRequests.current);
    for (const session of next) {
      const previousId = replacements.get(session.requestId);
      if (previousId && previousId !== session.id) {
        dismissed.current.add(previousId);
        tabKeys.current.set(
          session.id,
          tabKeys.current.get(previousId) || previousId,
        );
        setSelected((id) => (id === previousId ? session.id : id));
      }
    }
    setSessions((old) =>
      mergeSessions(old, next, replacements, dismissed.current),
    );
  }, []);
  const acceptCommand = useCallback(
    (run: CommandRun) => setCommands((old) => mergeRuns(old, [run])),
    [],
  );
  const fail = useCallback((message: string) => setError(message), []);
  useEffect(() => {
    if (!bridge.desktop) return;
    let live = true;
    const terminals = listen<TerminalSession[]>("terminal://sessions", (e) => {
      if (live) merge(e.payload);
    });
    const jobs = listen<CommandRun[]>("command://runs", (e) => {
      if (live) setCommands((old) => mergeRuns(old, e.payload));
    });
    void terminals
      .then(() => bridge.terminalSessions())
      .then((next) => {
        if (live) merge(next);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    void jobs
      .then(() => bridge.commandRuns())
      .then((next) => {
        if (live) setCommands((old) => mergeRuns(old, next));
      })
      .catch(() => {});
    return () => {
      live = false;
      void terminals.then((off) => off()).catch(() => {});
      void jobs.then((off) => off()).catch(() => {});
    };
  }, [merge]);
  const showCommand = useCallback(
    (run: CommandRun) => {
      automaticCommandAuth.current.add(run.id);
      acceptCommand(run);
      setCommandTabs((ids) => (ids.includes(run.id) ? ids : [...ids, run.id]));
      setSelected(run.id);
      setExpanded(true);
    },
    [acceptCommand],
  );
  const openHost = (hostId?: string) => {
    setExpanded(true);
    setError("");
    if (hostId) {
      return connectHost(hostId);
    }
    if (!hostId && (sessions.length || commandTabs.length)) {
      if (!selected) setSelected(sessions[0]?.id || commandTabs[0]);
      return;
    }
    setDraft({
      hostId: hostId || addedHosts(data).find((h) => !h.hidden)?.id || "",
      noEnvironment: true,
      fallback: false,
    });
    setSecrets({});
    setRemember({});
  };
  const trayOpen = useRef(openHost);
  useLayoutEffect(() => {
    trayOpen.current = openHost;
  });
  useEffect(() => {
    if (!bridge.desktop) return;
    let live = true;
    const subscription = listen<{ hostId?: string } | null>(
      "tunnel://open-terminal",
      ({ payload }) => {
        if (live) trayOpen.current(payload?.hostId);
      },
    );
    return () => {
      live = false;
      void subscription.then((off) => off()).catch(() => {});
    };
  }, []);
  const launch = async (
    hostId: string,
    noEnvironment: boolean,
    values: Record<string, string>,
    remembered: string[],
    profile?: { service: RemoteService; action: PresetAction; ruleId?: string },
    options?: { replaceId?: string; automatic?: boolean },
  ) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const previous = options?.replaceId
      ? sessions.find((s) => s.id === options.replaceId && !terminalActive(s))
      : undefined;
    if (options?.replaceId && !previous) {
      submitting.current = false;
      setBusy(false);
      return;
    }
    try {
      const baseKey = profile
        ? `${profile.service.id}:${profile.service.revision}:${profile.action.id}`
        : `shell:${hostId}`;
      const key = previous ? `${baseKey}:replace:${previous.id}` : baseKey;
      const requestId = requests.current.get(key) || crypto.randomUUID();
      requests.current.set(key, requestId);
      if (previous) replacementRequests.current.set(requestId, previous.id);
      if (options?.automatic)
        automaticAuthRequests.current.set(requestId, profile?.service.revision);
      const session = await bridge.openTerminal({
        hostId,
        noLocalEnvironment: profile ? noEnvironment : true,
        clientId,
        requestId,
        cols: 80,
        rows: 24,
        confirmed: true,
        secrets: values,
        rememberHostIds: remembered,
        ...(profile
          ? {
              serviceId: profile.service.id,
              ruleId: profile.ruleId,
              actionId: profile.action.id,
              revision: profile.service.revision,
            }
          : {}),
      });
      requests.current.delete(key);
      merge([session]);
      replacementRequests.current.delete(requestId);
      if (previous)
        void bridge
          .forgetTerminal(previous.id, previous.clientId)
          .catch(() => {});
      setSelected(session.id);
      setExpanded(true);
      setDraft(null);
      setSecrets({});
      setRemember({});
    } catch (e) {
      const message = String(e);
      setError(message);
      throw e;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const connectHost = async (hostId: string, replaceId?: string) => {
    setExpanded(true);
    setDraft(null);
    setSecrets({});
    setRemember({});
    await launch(hostId, true, {}, [], undefined, {
      replaceId,
      automatic: true,
    }).catch(() => {});
  };
  const openPreset: WorkspaceApi["openPreset"] = async (
    service,
    action,
    values,
    remembered,
    ruleId,
  ) => {
    const target = data.rules.find(
      (r) => r.id === ruleId && service.ruleIds.includes(r.id),
    );
    if (!target) throw new Error("serviceTargetRequired");
    await launch(
      target.hostId,
      service.noLocalEnvironment,
      values,
      remembered,
      { service, action, ruleId },
      { automatic: true },
    );
  };
  const close = async (session: TerminalSession) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      if (terminalActive(session))
        await bridge.closeTerminal(session.id, session.clientId);
      await bridge.forgetTerminal(session.id, session.clientId);
      dismissed.current.add(session.id);
      setSessions((old) => old.filter((s) => s.id !== session.id));
      setClosing(null);
      if (selected === session.id)
        setSelected(
          sessions.find((s) => s.id !== session.id)?.id || commandTabs[0] || "",
        );
    } catch (e) {
      setError(String(e));
      setSelected(session.id);
      setExpanded(true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const selectedSession = sessions.find((s) => s.id === selected),
    selectedCommand = commands.find((r) => r.id === selected);
  const retryProfile = unsubmittedPreset(selectedSession, data.services || []);
  const route = draft
    ? data.hosts.find((h) => h.id === draft.hostId)
    : undefined;
  const routeHosts = route ? [...jumpHosts(data.hosts, route), route] : [];
  const trust = sessions.find(
    (s) => s.phase === "verifying-host" && terminalActive(s) && s.fingerprint,
  );
  useEffect(() => {
    if (busy || draft || closing || trust) return;
    const failed = sessions.find(
      (session) =>
        automaticAuthRequests.current.has(session.requestId) &&
        !promptedSessions.current.has(session.id) &&
        session.clientId === clientId &&
        terminalNeedsCredentials(session, data.hosts) &&
        (!session.serviceId ||
          (!!unsubmittedPreset(session, data.services || []) &&
            unsubmittedPreset(session, data.services || [])?.service
              .revision ===
              automaticAuthRequests.current.get(session.requestId) &&
            data.rules.some(
              (r) => r.id === session.ruleId && r.hostId === session.hostId,
            ))),
    );
    if (!failed) return;
    promptedSessions.current.add(failed.id);
    automaticAuthRequests.current.delete(failed.requestId);
    setSelected(failed.id);
    const profile = unsubmittedPreset(failed, data.services || []);
    setDraft({
      hostId: failed.hostId,
      noEnvironment: profile ? profile.service.noLocalEnvironment : true,
      fallback: true,
      locked: true,
      replaceId: failed.id,
      ...(profile ? { profile } : {}),
    });
    setSecrets({});
    setRemember({});
    setError("authentication");
  }, [sessions, data, clientId, busy, draft, closing, trust, t]);
  const tabIds = [...sessions.map((s) => s.id), ...commandTabs];
  const tabSignature = tabIds.join("\0");
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const update = () => {
      const next = terminalTabScrollEdges(
        list.scrollLeft,
        list.clientWidth,
        list.scrollWidth,
      );
      setTabEdges((previous) =>
        previous.left === next.left && previous.right === next.right
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));
    list.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [tabSignature, expanded]);
  const resizeStart = useRef<{
    pointer: number;
    size: number;
    previousSize: number;
    maximized: boolean;
  } | null>(null);
  const DockIcon = dockIcons[dock];
  const ExpandIcon = (dock === "left" ? !maximized : maximized)
    ? ChevronLastIcon
    : ChevronFirstIcon;
  return (
    <Context.Provider
      value={{
        openHost,
        openPreset,
        showCommand,
        serviceBusy: (id) =>
          sessions.some((s) => s.serviceId === id && terminalActive(s)),
        busy,
        foregroundSession: (service, ruleId) =>
          serviceForegroundSession(sessions, service, ruleId, clientId),
        stopService: async (service, ruleId) => {
          const session = serviceForegroundSession(
            sessions,
            service,
            ruleId,
            clientId,
          );
          if (session) await close(session);
        },
      }}
    >
      {children}
      <motion.aside
        ref={workspaceRef}
        className={`terminal-workspace floating-surface ${maximized ? "terminal-maximized" : ""}`}
        data-dock={dock}
        data-open={expanded}
        initial={false}
        animate={{
          ...bounds,
          opacity: expanded ? 1 : 0,
          x:
            expanded || reducedMotion
              ? 0
              : dock === "left"
                ? -bounds.width - viewport.gap
                : dock === "right"
                  ? bounds.width + viewport.gap
                  : 0,
          y:
            expanded || reducedMotion || sideDock
              ? 0
              : bounds.height + viewport.gap,
        }}
        transition={
          resizing
            ? { duration: 0 }
            : reducedMotion
              ? { duration: 0, opacity: { duration: 0.08 } }
              : { ...interactionSpring, opacity: { duration: 0.16 } }
        }
        onAnimationComplete={() => {
          if (!expanded) setPresent(false);
        }}
        style={{ visibility: expanded || present ? "visible" : "hidden" }}
        inert={!expanded}
        aria-hidden={!expanded}
        aria-label={t("workspace")}
      >
        <div
          className="terminal-resize-handle"
          role="separator"
          aria-label={t(sideDock ? "resizeWidth" : "resize")}
          title={t(sideDock ? "resizeWidth" : "resize")}
          aria-orientation={sideDock ? "vertical" : "horizontal"}
          aria-valuemin={Math.min(workspaceMinimum(dock), sizeLimit)}
          aria-valuemax={sizeLimit}
          aria-valuenow={maximized ? sizeLimit : size}
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0 || resizeStart.current) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.focus();
            const rect = workspaceRef.current?.getBoundingClientRect();
            const currentSize = (sideDock ? rect?.width : rect?.height) || size;
            resizeStart.current = {
              pointer: sideDock ? e.clientX : e.clientY,
              size: currentSize,
              previousSize: layout.sizes[dock],
              maximized,
            };
            setResizing(true);
            setSize(currentSize);
            setMaximized(false);
            e.preventDefault();
          }}
          onPointerMove={(e) => {
            const start = resizeStart.current;
            if (start && e.currentTarget.hasPointerCapture(e.pointerId))
              setSize(
                resizeWorkspace(
                  dock,
                  start.size,
                  (sideDock ? e.clientX : e.clientY) - start.pointer,
                  sizeLimit,
                ),
              );
          }}
          onPointerUp={(e) => {
            resizeStart.current = null;
            setResizing(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            const start = resizeStart.current;
            if (start) {
              setLayout((previous) => ({
                ...previous,
                sizes: { ...previous.sizes, [dock]: start.previousSize },
              }));
              setMaximized(start.maximized);
            }
            resizeStart.current = null;
            setResizing(false);
          }}
          onLostPointerCapture={() => {
            resizeStart.current = null;
            setResizing(false);
          }}
          onKeyDown={(e) => {
            const next = workspaceKeyboardSize(
              dock,
              e.key,
              maximized ? sizeLimit : size,
              sizeLimit,
            );
            if (next !== undefined) {
              e.preventDefault();
              setMaximized(false);
              setSize(next);
            }
          }}
        />
        <header className="terminal-workspace-header">
          <strong>{t("workspace")}</strong>
          <div className="terminal-workspace-actions">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t(maximized ? "restore" : "maximize")}
              title={t(maximized ? "restore" : "maximize")}
              onClick={() => setMaximized((v) => !v)}
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
                    type="button"
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
                    if (!isWorkspaceDock(value)) return;
                    setMaximized(false);
                    setLayout((previous) => ({ ...previous, dock: value }));
                  }}
                >
                  {workspaceDocks.map((position) => {
                    const Icon = dockIcons[position];
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("new")}
              title={t("new")}
              onClick={() => {
                setDraft({
                  hostId:
                    selectedSession?.hostId || addedHosts(data)[0]?.id || "",
                  noEnvironment: true,
                  fallback: false,
                });
                setSecrets({});
                setRemember({});
              }}
            >
              <SquarePlusIcon aria-hidden="true" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("collapse")}
              title={t("collapse")}
              onClick={() => setExpanded(false)}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        </header>
        {error && (
          <p className="terminal-error" role="alert">
            {formatUiError(error, t)}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("dismiss")}
              onClick={() => setError("")}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </p>
        )}
        {tabIds.length ? (
          <Tabs
            className="terminal-tabs"
            value={selected}
            onValueChange={(id) => {
              if (typeof id === "string") setSelected(id);
            }}
          >
            <TabsList
              ref={tabListRef}
              variant="line"
              className="terminal-tab-list"
              data-fade-left={tabEdges.left}
              data-fade-right={tabEdges.right}
            >
              {sessions.map((s) => (
                <div
                  className="terminal-tab-entry"
                  key={tabKeys.current.get(s.id) || s.id}
                >
                  <TabsTrigger
                    value={s.id}
                    title={`${s.endpoint} · ${t(`phase.${s.phase}`)}`}
                    aria-label={`${s.label} · ${t(`phase.${s.phase}`)}`}
                  >
                    <span
                      className="terminal-tab-indicator"
                      data-tone={terminalStateTone(s)}
                      aria-hidden="true"
                    />
                    <span className="terminal-tab-label">{s.label}</span>
                  </TabsTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t("closeTab")} ${s.label}`}
                    onClick={() =>
                      terminalActive(s) ? setClosing(s) : void close(s)
                    }
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {commandTabs.map((id) => (
                <div className="terminal-tab-entry" key={id}>
                  <TabsTrigger value={id}>
                    {(commands
                      .find((r) => r.id === id)
                      ?.actionLabel?.startsWith("$")
                      ? t(
                          `service.${commands.find((r) => r.id === id)!.actionLabel.slice(1)}`,
                          { ns: "commands" },
                        )
                      : commands.find((r) => r.id === id)?.actionLabel) ||
                      t("command")}
                  </TabsTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("closeOutput")}
                    onClick={() => {
                      setCommandTabs((ids) =>
                        ids.filter((value) => value !== id),
                      );
                      if (selected === id)
                        setSelected(tabIds.find((value) => value !== id) || "");
                    }}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </TabsList>
            {selectedSession && (
              <div className="terminal-identity">
                <code title={selectedSession.endpoint}>
                  {selectedSession.endpoint}
                </code>
                <span className="sr-only" role="status">
                  {t(`phase.${selectedSession.phase}`)}
                </span>
                {(selectedSession.exitCode !== null ||
                  selectedSession.exitSignal) && (
                  <span className="terminal-session-notice">
                    {selectedSession.exitCode !== null
                      ? `${t("exitCode")}: ${selectedSession.exitCode}`
                      : ""}
                    {selectedSession.exitSignal
                      ? ` · ${selectedSession.exitSignal}`
                      : ""}
                  </span>
                )}
                {selectedSession.error && (
                  <span
                    className="terminal-session-notice text-destructive"
                    title={t(`error.${selectedSession.error}`)}
                  >
                    {t(
                      selectedSession.error === "remoteUnknown"
                        ? "remoteUnknownShort"
                        : `error.${selectedSession.error}`,
                    )}
                  </span>
                )}
                {selectedSession.finishedAt !== null && (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={
                      retryProfile
                        ? t("retryAuth", { ns: "commands" })
                        : t("reconnect")
                    }
                    title={
                      retryProfile
                        ? t("retryAuth", { ns: "commands" })
                        : t("reconnect")
                    }
                    disabled={busy}
                    onClick={() => {
                      if (!retryProfile) {
                        void connectHost(
                          selectedSession.hostId,
                          selectedSession.id,
                        );
                        return;
                      }
                      setDraft({
                        hostId: selectedSession.hostId,
                        noEnvironment: true,
                        fallback: selectedSession.error === "authentication",
                        locked: true,
                        replaceId: selectedSession.id,
                        ...(retryProfile
                          ? {
                              profile: retryProfile,
                              noEnvironment:
                                retryProfile.service.noLocalEnvironment,
                            }
                          : {}),
                      });
                      setSecrets({});
                      setRemember({});
                    }}
                  >
                    <RotateCwIcon aria-hidden="true" />
                  </Button>
                )}
              </div>
            )}
            <div className="terminal-view-area">
              <Suspense fallback={<p className="muted">{t("loading")}</p>}>
                {sessions.map((s) => (
                  <TabsContent
                    className="terminal-session-panel"
                    keepMounted
                    value={s.id}
                    key={tabKeys.current.get(s.id) || s.id}
                    aria-label={s.label}
                  >
                    {s.clientId === clientId ? (
                      <TerminalView
                        key={s.id}
                        session={s}
                        clientId={clientId}
                        visible={expanded && selected === s.id}
                        onError={fail}
                      />
                    ) : (
                      <div className="terminal-ended-screen" />
                    )}
                  </TabsContent>
                ))}
              </Suspense>
              {selectedCommand && commandTabs.includes(selectedCommand.id) && (
                <div className="terminal-command-panel">
                  <CommandResult
                    key={selectedCommand.id}
                    data={data}
                    autoPromptCredentials={automaticCommandAuth.current.has(
                      selectedCommand.id,
                    )}
                    onCredentialsPrompt={() =>
                      automaticCommandAuth.current.delete(selectedCommand.id)
                    }
                    onRerun={showCommand}
                    run={selectedCommand}
                    accept={acceptCommand}
                    onError={fail}
                    onCancel={() =>
                      void bridge
                        .cancelCommand(selectedCommand.id)
                        .catch((e) => setError(String(e)))
                    }
                  />
                </div>
              )}
            </div>
          </Tabs>
        ) : (
          <p className="terminal-empty">{t("empty")}</p>
        )}
      </motion.aside>
      <AnimatePresence
        onExitComplete={() => {
          if (!document.querySelector('[role="dialog"], [role="alertdialog"]'))
            document
              .querySelector<HTMLTextAreaElement>(
                ".terminal-session-panel:not([hidden]):not([data-hidden]) .xterm-helper-textarea",
              )
              ?.focus();
        }}
      >
        {draft && (
          <Modal
            key="connect"
            title={
              draft.locked
                ? t("authForHost", { ns: "tunnel", name: route?.name || "" })
                : t("open")
            }
            description={draft.locked ? undefined : t("connectHint")}
            close={() => {
              setDraft(null);
              setSecrets({});
              setRemember({});
            }}
          >
            <form
              id="open-terminal-form"
              onSubmit={(e) => {
                e.preventDefault();
                void launch(
                  draft.hostId,
                  draft.noEnvironment,
                  secrets,
                  Object.keys(remember).filter((id) => remember[id]),
                  draft.profile,
                  {
                    replaceId: draft.replaceId,
                    automatic:
                      !!draft.profile ||
                      Object.values(secrets).every((value) => !value),
                  },
                ).catch(() => {});
              }}
            >
              {draft.profile && (
                <>
                  <code>
                    {route?.user}@{route?.address}:{route?.port}
                  </code>
                  <pre className="preset-script" data-selectable="true">
                    {draft.profile.action.command}
                  </pre>
                </>
              )}
              {!draft.profile && !draft.locked && (
                <HostPicker
                  hosts={addedHosts(data).filter((h) => !h.hidden)}
                  value={draft.hostId}
                  onChange={(hostId) => {
                    setDraft({
                      ...draft,
                      hostId,
                      fallback: false,
                      profile: undefined,
                    });
                    setSecrets({});
                    setRemember({});
                  }}
                />
              )}
              {!draft.profile && draft.locked && route && (
                <code>
                  {route.user}@{route.address}:{route.port}
                </code>
              )}
              {!draft.profile &&
                route?.unsupportedSessionOptions?.includes("SendEnv") && (
                  <p className="muted">{t("noEnvironmentHint")}</p>
                )}
              {error && (
                <p role="alert" className="inline-error">
                  {formatUiError(error, t)}
                </p>
              )}
              {routeHosts
                .filter((h) =>
                  draft.fallback
                    ? h.authMethod !== "agent"
                    : h.authMethod === "password",
                )
                .map((host) => (
                  <AuthenticationField
                    key={host.id}
                    host={host}
                    value={secrets[host.id] || ""}
                    onChange={(value) =>
                      setSecrets((s) => ({ ...s, [host.id]: value }))
                    }
                    remember={!!remember[host.id]}
                    onRemember={(value) =>
                      setRemember((s) => ({ ...s, [host.id]: value }))
                    }
                  />
                ))}
              <ModalActions>
                <Button
                  type="submit"
                  form="open-terminal-form"
                  variant="primary-soft"
                  disabled={busy || !route || !!route.diagnostics.length}
                >
                  {draft.profile
                    ? t("execute", { ns: "commands" })
                    : t("connect")}
                </Button>
              </ModalActions>
            </form>
          </Modal>
        )}
        {closing && (
          <Modal
            key="close"
            title={t("closeTab")}
            description={t("closeHint")}
            close={() => setClosing(null)}
          >
            <code>{closing.endpoint}</code>
            {error && (
              <p role="alert" className="inline-error">
                {formatUiError(error, t)}
              </p>
            )}
            <ModalActions>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setClosing(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void close(closing)}
              >
                {t("disconnect")}
              </Button>
            </ModalActions>
          </Modal>
        )}
        {trust && (
          <Modal
            key="trust"
            title={t("trust")}
            description={t("trustHint")}
            close={() => void bridge.closeTerminal(trust.id, trust.clientId)}
          >
            <strong>{trust.verificationEndpoint}</strong>
            <code className="fingerprint">{trust.fingerprint}</code>
            <ModalActions>
              <Button
                type="button"
                variant="destructive"
                onClick={() =>
                  void bridge.closeTerminal(trust.id, trust.clientId)
                }
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void bridge
                    .trustHost(trust.id, trust.id, trust.fingerprint!)
                    .catch((e) => setError(String(e)))
                }
              >
                {t("trust")}
              </Button>
            </ModalActions>
          </Modal>
        )}
      </AnimatePresence>
    </Context.Provider>
  );
}
