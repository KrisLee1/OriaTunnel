import {
  FileActivityContext,
  FileTransferDetailsContext,
  projectFileActivities,
  type FileActivity,
} from "./transfer-state";
import { FileSearchButton } from "./file-search-button";
import { motion } from "motion/react";
import { FilePathNavigation } from "./file-path-navigation";
import { toast } from "@/components/ui/toast";
import { readLocalDirectory, saveLocalDirectory } from "./local-directory";
import { useMarqueeSelection } from "./use-marquee-selection";
import { FileArtwork } from "./file-artwork";
import { FilePropertiesDialog, type FileTarget } from "./file-inspector";
import { FilePreviewDialog } from "./file-preview";
import { TransferQueue } from "./transfer-queue";
import { TransferConflictDialog } from "./transfer-conflict-dialog";
import { conflictKey, useTransferConflict } from "./use-transfer-conflict";
import { useTransferQueue } from "./use-transfer-queue";
import {
  FileLayoutMenu,
  FilePanelGrid,
  useFilePanelLayout,
} from "./file-panel-layout";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { useWorkspacePanel } from "@/components/ui/use-workspace-panel";
import {
  FileOptionsMenu,
  FileSortOptions,
  FileCreateOptions,
} from "./file-options-menu";
import {
  createContext,
  useContext,
  useMemo,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  FolderSync,
  Server,
  ArrowRightLeft,
  HardDrive,
  EyeOff,
  ArrowDownAZ,
  Copy,
  Pencil,
  Info,
  FolderOpen,
  FolderDown,
  File,
  Plus,
  Upload,
  Download,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  List,
  LayoutGrid,
  Eye,
  MoreHorizontal,
  Search,
  Unplug,
  Pause,
  Play,
  X,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { AuthenticationField } from "@/features/hosts/authentication-field";
import { useNativeFileDrop } from "@/hooks/use-native-file-drop";
import * as bridge from "@/lib/bridge";
import type { Snapshot as AppSnapshot } from "@/types";
import {
  api,
  active,
  sorted,
  selection,
  size,
  type Directory,
  type Entry,
  type Snapshot,
  type Session,
  type Task,
  type TransferFolder,
} from "./api";
import "./files.css";
const Context = createContext<{ open: (host?: string) => void; count: number }>(
  { open: () => {}, count: 0 },
);
export function OpenFilesButton({ hostId }: { hostId?: string }) {
  const c = useContext(Context);
  const { t } = useTranslation("files");
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={t("title")}
      aria-label={t("title")}
      disabled={!isTauri()}
      onClick={() => c.open(hostId)}
    >
      <FolderSync />
      {!hostId && c.count > 0 && <span className="files-badge">{c.count}</span>}
    </Button>
  );
}
type Drag = { side: "local" | "remote"; ids: string[]; x: number; y: number };
type ModalAction = {
  kind: "rename" | "mkdir" | "createText" | "delete" | "properties";
  id: string;
  name: string;
  entry?: Entry;
  ids?: string[];
  remote: boolean;
  target?: FileTarget;
};
export function FileWorkspaceProvider({
  data,
  children,
}: {
  data: AppSnapshot;
  children: ReactNode;
}) {
  const { t } = useTranslation("files");
  const [open, setOpen] = useState(false),
    [host, setHost] = useState(""),
    [sourceHost, setSourceHost] = useState(""),
    [sourceSid, setSourceSid] = useState<string | null>(null),
    [sid, setSid] = useState<string | null>(null),
    [snapshot, updateSnapshot] = useState<Snapshot>({
      revision: 0,
      sessions: [],
      tasks: [],
      warning: null,
    }),
    [refresh, setRefresh] = useState(0);
  const panel = useWorkspacePanel({
    open,
    storageKey: "oria-tunnel.files-workspace.v1",
    defaults: { dock: "bottom", sizes: { bottom: 480, left: 440, right: 440 } },
    minimums: { bottom: 360, left: 360, right: 360 },
  });
  const [auth, setAuth] = useState<Session | null>(null),
    [secrets, setSecrets] = useState<Record<string, string>>({}),
    [remember, setRemember] = useState<string[]>([]),
    [action, setAction] = useState<ModalAction | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<FileTarget | null>(null),
    [drag, setDrag] = useState<Drag | null>(null);
  const {
    queue,
    changeQueue,
    panelRef: queuePanelRef,
    onResize: resizeQueue,
  } = useTransferQueue();
  const fileLayout = useFilePanelLayout(
    { width: panel.bounds.width - 16, height: panel.bounds.height - 40 },
    queue,
  );
  const savedDirectories = useRef<Record<string, string>>({});
  const connectionGeneration = useRef({ local: 0, remote: 0 });
  const authSide = useRef<"local" | "remote">("remote");
  const dirs = useRef<{ local: Directory | null; remote: Directory | null }>({
      local: null,
      remote: null,
    }),
    dragRef = useRef<Drag | null>(null),
    authSeen = useRef(new Set<string>()),
    mounted = useRef(true);
  const setSnapshot = useCallback(
    (next: Snapshot) =>
      updateSnapshot((current) =>
        next.revision >= current.revision ? next : current,
      ),
    [],
  );
  const stateRef = useRef(snapshot);
  stateRef.current = snapshot;
  const conflict = useTransferConflict(snapshot.tasks);
  const showError = useCallback(
    (message: string) => {
      if (message)
        toast.add({
          type: "error",
          title: t("title"),
          description: t(message, { defaultValue: message }),
          timeout: 6000,
        });
    },
    [t],
  );
  const [initialLocalDirectory] = useState(readLocalDirectory);
  const warningSeen = useRef<string | null>(null);
  useEffect(() => {
    const warning = snapshot.warning;
    if (warning && warning !== warningSeen.current)
      toast.add({
        type: "warning",
        title: t("title"),
        description: t(warning, { defaultValue: warning }),
        timeout: 6000,
      });
    warningSeen.current = warning;
  }, [snapshot.warning, t]);
  const perform = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        showError(String(e));
      }
    },
    [showError],
  );
  const connect = useCallback(
    async (
      id: string,
      secrets: Record<string, string> = {},
      remember: string[] = [],
      side: "local" | "remote" = "remote",
    ) => {
      const generation = ++connectionGeneration.current[side];
      if (side === "local") {
        setSourceHost(id);
        setSourceSid(null);
      } else {
        setHost(id);
        setSid(null);
      }
      dirs.current[side] = null;
      await perform(async () => {
        const session = await api.connect(id, secrets, remember);
        if (generation !== connectionGeneration.current[side]) {
          await api.disconnect(session);
          return;
        }
        if (side === "local") setSourceSid(session);
        else setSid(session);
      });
    },
    [perform],
  );
  useEffect(() => {
    mounted.current = true;
    if (!isTauri()) return;
    let live = true;
    const stops: Promise<() => void>[] = [];
    stops.push(
      listen<Snapshot>("files://snapshot", (e) => {
        if (live) setSnapshot(e.payload);
      }),
    );
    stops.push(listen("tunnel://open-files", () => setOpen(true)));
    void Promise.all(stops)
      .then(() => api.snapshot())
      .then((s) => {
        if (live) setSnapshot(s);
      })
      .catch((e) => showError(String(e)));
    return () => {
      live = false;
      mounted.current = false;
      stops.forEach((p) => void p.then((stop) => stop()));
    };
  }, []);
  const current = snapshot.sessions.find((s) => s.id === sid);
  const sourceCurrent = snapshot.sessions.find((s) => s.id === sourceSid);
  const connected = current?.phase === "connected";
  const sourceConnected = sourceCurrent?.phase === "connected";
  const verification = [sourceCurrent, current].find(
    (session) => !!session?.fingerprint,
  );
  useEffect(() => {
    if (auth) return;
    const failed = [sourceCurrent, current].find(
      (session) =>
        session?.error?.toLowerCase().includes("auth") &&
        !authSeen.current.has(session.id) &&
        session.route.some((id) =>
          data.hosts.some(
            (host) => host.id === id && host.authMethod !== "agent",
          ),
        ),
    );
    if (failed) {
      authSeen.current.add(failed.id);
      authSide.current = failed.id === sourceSid ? "local" : "remote";
      setAuth(failed);
      setSecrets({});
      setRemember([]);
    }
  }, [sourceCurrent, current, auth, data.hosts, sourceSid]);
  useEffect(() => {
    if (snapshot.tasks.some(active)) changeQueue(true);
  }, [snapshot.tasks.length]);
  const completeCount = snapshot.tasks.filter(
    (t) => t.phase === "completed" || t.phase === "partial",
  ).length;
  useEffect(() => setRefresh((n) => n + 1), [completeCount]);
  const show = useCallback(
    (id?: string) => {
      setOpen(true);
      if (id) {
        const existing = stateRef.current.sessions.find(
          (s) => s.hostId === id && s.phase === "connected",
        );
        if (existing) {
          setHost(id);
          setSid(existing.id);
        } else void connect(id);
      }
    },
    [connect],
  );
  const transfer = useCallback(
    async (ids: string[], target: string) => {
      await perform(async () => {
        await api.submit(ids, target);
        changeQueue(true);
      });
    },
    [perform],
  );
  const finishDrag = useCallback(
    (event: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-file-target]");
      if (!target || target.dataset.fileSide === d.side) return;
      const id = target.dataset.fileTarget;
      if (id) void transfer(d.ids, id);
    },
    [transfer],
  );
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragRef.current) {
        dragRef.current = { ...dragRef.current, x: e.clientX, y: e.clientY };
        setDrag(dragRef.current);
      }
    };
    const cancel = () => {
      dragRef.current = null;
      setDrag(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [finishDrag]);
  const edit = (a: ModalAction) => {
    setAction(a);
    setName(
      a.kind === "rename"
        ? a.name
        : a.kind === "createText"
          ? t("newTextName")
          : "",
    );
  };
  const mutate = async () => {
    if (!action || busy) return;
    setBusy(true);
    await perform(async () => {
      for (const id of action.ids || [action.id])
        await api.mutate(action.kind, id, name);
      setAction(null);
      setRefresh((n) => n + 1);
    });
    setBusy(false);
  };
  const controlTask = async (task: Task, a: string, applyAll = false) => {
    const { id, hostId } = task;
    if (a === "openTarget") {
      await api.openTarget(id);
      return;
    }
    const s = snapshot.sessions.find(
      (s) => s.hostId === hostId && s.phase === "connected",
    );
    const source =
      task.sourceRemote &&
      snapshot.sessions.find(
        (session) =>
          session.hostId === task.sourceRemote!.hostId &&
          session.phase === "connected",
      );
    if (a === "skip" || a === "keep" || a === "replace") {
      await api.resolveConflict(id, a, applyAll, s?.id, source?.id);
    } else {
      await api.control(id, a, s?.id, source?.id);
    }
  };
  const taskAction = (task: Task, action: string, folder?: TransferFolder) => {
    if (action === "resolveConflict") conflict.show(task);
    else
      void perform(() =>
        action === "openFolder" && folder
          ? api.openTransferFolder(task.id, folder)
          : controlTask(task, action),
      );
  };
  const previousActivities = useRef<FileActivity[]>([]);
  const activities = useMemo(
    () => projectFileActivities(snapshot.tasks, previousActivities.current),
    [snapshot.tasks],
  );
  useLayoutEffect(() => {
    previousActivities.current = activities;
  }, [activities]);
  const activeCount = snapshot.tasks.filter(active).length;
  const context = useMemo(
    () => ({ open: show, count: activeCount }),
    [show, activeCount],
  );
  return (
    <Context.Provider value={context}>
      <FileTransferDetailsContext.Provider value={snapshot.tasks}>
        <FileActivityContext.Provider value={activities}>
          {children}
        </FileActivityContext.Provider>
      </FileTransferDetailsContext.Provider>
      <WorkspacePanel
        panel={panel}
        title={t("title")}
        onClose={() => setOpen(false)}
        className="files-workspace"
        actions={<FileLayoutMenu layout={fileLayout} />}
      >
        <p className="sr-only">{t("description")}</p>
        <FilePanelGrid
          layout={fileLayout}
          queuePanelRef={queuePanelRef}
          onQueueResize={resizeQueue}
          queue={
            <TransferQueue
              tasks={snapshot.tasks}
              expanded={queue}
              orientation={fileLayout.orientation.outer}
              onToggle={() => changeQueue(!queue)}
              onAction={taskAction}
              onClear={() => void perform(() => api.clearHistory())}
            />
          }
        >
          {(["local", "remote"] as const).map((side) => {
            const left = side === "local";
            const remote = !left || !!sourceHost;
            const selectedHost = left ? sourceHost : host;
            const session = left ? sourceSid : sid;
            const status = left ? sourceCurrent : current;
            const ready = !remote || (left ? sourceConnected : connected);
            const otherRemote = left || !!sourceHost;
            const otherReady = left
              ? connected
              : !sourceHost || sourceConnected;
            const otherSide = left ? "remote" : "local";
            const transferKind =
              remote && otherRemote ? "relay" : remote ? "download" : "upload";
            return (
              <FilePane
                key={
                  session ||
                  selectedHost ||
                  (left ? "computer" : "disconnected")
                }
                side={side}
                remote={remote}
                transferKind={transferKind}
                canTransfer={
                  ready &&
                  otherReady &&
                  (!remote || !otherRemote || sourceHost !== host)
                }
                initialPath={
                  savedDirectories.current[side + ":" + selectedHost] ||
                  (!remote ? initialLocalDirectory : undefined)
                }
                refresh={refresh}
                session={remote && ready ? session : null}
                title={
                  <FileEndpointTitle
                    hosts={data.hosts.filter(
                      (host) =>
                        data.addedHostIds?.includes(host.id) ||
                        host.source === "manual",
                    )}
                    host={selectedHost}
                    allowLocal={left}
                    excludeHost={left ? host : sourceHost}
                    status={status}
                    onChange={(id) => {
                      connectionGeneration.current[side]++;
                      if (left) {
                        setSourceHost(id);
                        setSourceSid(null);
                      } else {
                        setHost(id);
                        setSid(null);
                      }
                      dirs.current[side] = null;
                    }}
                    onConnect={() => void connect(selectedHost, {}, [], side)}
                    onDisconnect={() =>
                      session &&
                      void perform(async () => {
                        await api.disconnect(session);
                        if (left) setSourceSid(null);
                        else setSid(null);
                        dirs.current[side] = null;
                      })
                    }
                  />
                }
                status={status}
                onDirectory={(directory) => {
                  dirs.current[side] = directory;
                  if (!remote) saveLocalDirectory(directory.path);
                  savedDirectories.current[side + ":" + selectedHost] =
                    directory.path;
                }}
                onPreview={setPreview}
                onAction={edit}
                onError={showError}
                onTransfer={(ids, explicitTarget) => {
                  const target =
                    explicitTarget ||
                    (otherReady ? dirs.current[otherSide]?.id : undefined);
                  if (target) void transfer(ids, target);
                  else showError("notConnected");
                }}
                onDrag={(value) => {
                  dragRef.current = value;
                  setDrag(value);
                }}
                drag={drag}
                disabledDrop={!open || !!action || !!preview || !!auth}
                onDrop={transfer}
              />
            );
          })}
        </FilePanelGrid>
      </WorkspacePanel>
      {conflict.task &&
        !auth &&
        !action &&
        !preview &&
        !verification?.fingerprint && (
          <TransferConflictDialog
            key={conflictKey(conflict.task)}
            task={conflict.task}
            onResolve={controlTask}
            onClose={() => conflict.dismiss(conflict.task!)}
          />
        )}
      <Dialog
        open={!!verification?.fingerprint && open}
        onOpenChange={() => {}}
      >
        <DialogContent>
          <DialogTitle>{t("verifyHost")}</DialogTitle>
          <DialogDescription>{verification?.endpoint}</DialogDescription>
          <code data-selectable="true">{verification?.fingerprint}</code>
          <Button
            onClick={() =>
              verification?.fingerprint &&
              void perform(() =>
                bridge.trustHost(
                  verification.id,
                  verification.id,
                  verification.fingerprint!,
                ),
              )
            }
          >
            {t("trust")}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              verification &&
              void perform(() => api.disconnect(verification.id))
            }
          >
            {t("cancel")}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!auth}
        onOpenChange={(v) => {
          if (!v) {
            setAuth(null);
            setSecrets({});
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{t("authentication")}</DialogTitle>
          <DialogDescription>{auth?.hostName}</DialogDescription>
          {auth?.route
            .map((id) => data.hosts.find((h) => h.id === id))
            .filter((h) => !!h)
            .map((h) => (
              <AuthenticationField
                key={h.id}
                host={h}
                value={secrets[h.id] || ""}
                onChange={(v) => setSecrets({ ...secrets, [h.id]: v })}
                remember={remember.includes(h.id)}
                onRemember={(v) =>
                  setRemember(
                    v
                      ? [...remember, h.id]
                      : remember.filter((x) => x !== h.id),
                  )
                }
              />
            ))}
          <Button
            onClick={() => {
              if (auth)
                void connect(auth.hostId, secrets, remember, authSide.current);
              setAuth(null);
              setSecrets({});
            }}
          >
            {t("connect")}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!action && action.kind !== "properties"}
        onOpenChange={(v) => !busy && !v && setAction(null)}
      >
        <DialogContent>
          <DialogTitle>{t(action?.kind || "properties")}</DialogTitle>
          <DialogDescription>{action?.name}</DialogDescription>
          {action?.kind !== "properties" && (
            <>
              {action?.kind === "delete" ? (
                <p>{t(action.remote ? "permanentDelete" : "recycleDelete")}</p>
              ) : (
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void mutate()}
                />
              )}
              <Button
                variant={action?.kind === "delete" ? "destructive" : "default"}
                disabled={busy}
                onClick={() => void mutate()}
              >
                {t(busy ? "working" : "confirm")}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <FilePropertiesDialog
        target={action?.kind === "properties" ? action.target || null : null}
        close={() => setAction(null)}
      />
      <FilePreviewDialog
        target={preview}
        close={() => setPreview(null)}
        onSaved={() => setRefresh((n) => n + 1)}
      />
      {drag && (
        <div
          className="files-drag"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {t("transfer")} · {drag.ids.length}
        </div>
      )}
    </Context.Provider>
  );
}
function FileEndpointTitle({
  hosts,
  host,
  allowLocal,
  excludeHost,
  status,
  onChange,
  onConnect,
  onDisconnect,
}: {
  hosts: AppSnapshot["hosts"];
  host: string;
  allowLocal: boolean;
  excludeHost: string;
  status?: Session;
  onChange: (host: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation("files");
  const local = allowLocal && !host;
  const items = [
    ...(allowLocal ? [{ value: ":computer:", label: t("local") }] : []),
    ...hosts.map((host) => ({ value: host.id, label: host.name })),
  ];
  return (
    <>
      <Select
        value={local ? ":computer:" : host}
        items={items}
        onValueChange={(value) => {
          if (value) onChange(value === ":computer:" ? "" : value);
        }}
      >
        <SelectTrigger
          className="files-host-select"
          aria-label={t("chooseHost")}
        >
          <SelectValue placeholder={t("chooseHost")} />
        </SelectTrigger>
        <SelectContent>
          {allowLocal && (
            <SelectItem value=":computer:">
              <HardDrive />
              {t("local")}
            </SelectItem>
          )}
          {hosts.map((host) => (
            <SelectItem
              key={host.id}
              value={host.id}
              disabled={host.id === excludeHost}
            >
              <Server />
              {host.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!local &&
        (status?.phase === "connected" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("disconnect")}
            title={t("disconnect")}
            onClick={onDisconnect}
          >
            <Unplug />
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={
              !host ||
              (!!status &&
                ["connecting", "authenticating", "verifying-host"].includes(
                  status.phase,
                ))
            }
            onClick={onConnect}
          >
            {t("connect")}
          </Button>
        ))}
    </>
  );
}

type PaneProps = {
  initialPath?: string;
  side: "local" | "remote";
  remote: boolean;
  transferKind: "upload" | "download" | "relay";
  canTransfer: boolean;
  title: ReactNode;
  session?: string | null;
  status?: Session;
  refresh: number;
  onDirectory: (d: Directory) => void;
  onPreview: (target: FileTarget) => void;
  onAction: (a: ModalAction) => void;
  onError: (e: string) => void;
  onTransfer: (ids: string[], target?: string) => void;
  onDrag: (d: Drag) => void;
  drag: Drag | null;
  disabledDrop: boolean;
  onDrop: (ids: string[], target: string) => Promise<void>;
};
export function FilePane(p: PaneProps) {
  const { t } = useTranslation("files");
  const [dir, setDir] = useState<Directory | null>(null),
    [editPathRequest, requestPathEdit] = useState(0),
    [query, setQuery] = useState(""),
    [view, setView] = useState(
      () => localStorage.getItem(`oria-tunnel.files-view.${p.side}`) || "list",
    ),
    [hidden, setHidden] = useState(false),
    [sort, setSort] = useState("name"),
    [descending, setDescending] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [hover, setHover] = useState(false),
    [scroll, setScroll] = useState(0),
    [cols, setCols] = useState(3),
    [viewportHeight, setViewportHeight] = useState(400);
  const root = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    anchor = useRef<string | undefined>(undefined),
    history = useRef<string[]>([]),
    cursor = useRef(-1),
    pointer = useRef<{
      x: number;
      y: number;
      id: string;
      ids: string[];
    } | null>(null);
  const canRead = !p.remote || !!p.session;
  const load = useCallback(
    async (next: string, record = true) => {
      const g = ++generation.current;
      setLoading(true);
      try {
        const d = await api.list(p.session || null, next);
        if (g !== generation.current) return false;
        setDir(d);
        setSelected([]);
        setScroll(0);
        p.onDirectory(d);
        if (viewport.current) viewport.current.scrollTop = 0;
        if (!record && cursor.current < 0) {
          history.current = [d.path];
          cursor.current = 0;
        }
        if (record) {
          history.current = history.current.slice(0, cursor.current + 1);
          history.current.push(d.path);
          cursor.current = history.current.length - 1;
        }
        return true;
      } catch (e) {
        if (g === generation.current) p.onError(String(e));
        return false;
      } finally {
        if (g === generation.current) setLoading(false);
      }
    },
    [p.session],
  );
  useEffect(() => {
    if (canRead) void load(dir?.path || p.initialPath || "", false);
    return () => {
      generation.current++;
    };
  }, [p.refresh, p.session, canRead, load]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCols(Math.max(1, Math.floor(el.clientWidth / 110)));
      setViewportHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setSelected([]);
  }, [query, hidden]);
  const items = sorted(dir?.entries || [], query, hidden, sort, descending),
    ordered = items.map((e) => e.id);
  const rowHeight = view === "list" ? 40 : 100;
  const gapY = view === "list" ? 4 : 8;
  const gapX = view === "list" ? 0 : 8;
  const rowCount =
    view === "list" ? items.length : Math.ceil(items.length / cols);
  const start = Math.max(0, Math.floor(scroll / rowHeight) - 5),
    end = Math.min(
      rowCount,
      Math.ceil((scroll + viewportHeight) / rowHeight) + 5,
    );
  const visible =
    view === "list"
      ? items.slice(start, end)
      : items.slice(start * cols, end * cols);
  const chooseEntry = (id: string, ctrl: boolean, shift: boolean) => {
    setSelected(selection(selected, id, ordered, ctrl, shift, anchor.current));
    anchor.current = id;
  };
  const marquee = useMarqueeSelection({
    viewport,
    ids: ordered,
    columns: view === "list" ? 1 : cols,
    rowHeight,
    gapX,
    gapY,
    selected,
    onChange: setSelected,
    onClick: chooseEntry,
  });
  const paneError = useRef("");
  useEffect(() => {
    const value = p.status?.error || "";
    const key = value ? `${p.status?.id}:${value}` : "";
    if (key && key !== paneError.current) p.onError(value);
    paneError.current = key;
  }, [p.status?.id, p.status?.error, p.onError]);
  const dropRef = useRef<HTMLElement | null>(null);
  dropRef.current = root.current;
  useNativeFileDrop(
    dropRef,
    p.remote && canRead && !p.disabledDrop,
    (paths, point) => {
      const hit = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>("[data-file-target]");
      const target = hit?.dataset.fileTarget || dir?.id;
      if (target)
        void api
          .sources(paths)
          .then((ids) => p.onDrop(ids, target))
          .catch((e) => p.onError(String(e)));
    },
    setHover,
  );
  const inspectTarget = (entry: Entry): FileTarget => {
    const drive = !p.remote && dir?.path === ":computer:";
    const sep = !p.remote && dir?.path.includes("\\") ? "\\" : "/";
    return {
      entry,
      path: drive
        ? entry.name
        : (dir?.path.replace(/[\\/]$/, "") || "") + sep + entry.name,
      remote: p.remote,
      hostName: p.status?.hostName,
      drive,
    };
  };
  const openEntry = (e: Entry) => {
    if (!p.remote && dir?.path === ":computer:") {
      void load(e.name);
      return;
    }
    if (e.kind === "directory") {
      const sep = !p.remote && dir?.path.includes("\\") ? "\\" : "/";
      void load(`${dir?.path.replace(/[\\/]$/, "")}${sep}${e.name}`);
    } else if (e.kind === "file") p.onPreview(inspectTarget(e));
    else
      p.onAction({
        kind: "properties",
        id: e.id,
        name: e.name,
        entry: e,
        remote: p.remote,
        target: inspectTarget(e),
      });
  };
  const action = (kind: ModalAction["kind"], e?: Entry) => {
    const item = e || items.find((i) => selected.includes(i.id));
    if ((kind === "mkdir" || kind === "createText") && dir) {
      p.onAction({
        kind,
        id: dir.id,
        name: dir.path,
        remote: p.remote,
      });
    } else if (item)
      p.onAction({
        kind,
        id: item.id,
        name:
          kind === "delete" && selected.includes(item.id) && selected.length > 1
            ? items
                .filter((e) => selected.includes(e.id))
                .map((e) => e.name)
                .join(", ")
            : item.name,
        ids:
          kind === "delete" && selected.includes(item.id)
            ? selected
            : undefined,
        entry: item,
        remote: p.remote,
        target: inspectTarget(item),
      });
  };
  const menu = (e?: Entry) => (
    <ContextMenuContent className="files-options-popup">
      {e ? (
        <>
          <ContextMenuItem
            disabled={selected.includes(e.id) && selected.length > 1}
            onClick={() => openEntry(e)}
          >
            {e.kind === "directory" ? (
              <FolderOpen />
            ) : e.kind === "file" ? (
              <Eye />
            ) : (
              <Info />
            )}
            {t(
              e.kind === "directory"
                ? "open"
                : e.kind === "file"
                  ? "preview"
                  : "properties",
            )}
          </ContextMenuItem>
          {!p.remote && (
            <ContextMenuItem
              onClick={() =>
                void api.reveal(e.id).catch((error) => p.onError(String(error)))
              }
            >
              <FolderOpen />
              {t("reveal")}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!p.canTransfer || dir?.path === ":computer:"}
            onClick={() =>
              p.onTransfer(selected.includes(e.id) ? selected : [e.id])
            }
          >
            {p.transferKind === "relay" ? (
              <ArrowRightLeft />
            ) : p.remote ? (
              <Download />
            ) : (
              <Upload />
            )}
            {t(p.transferKind === "relay" ? "remoteTransfer" : p.transferKind)}
          </ContextMenuItem>
          {p.remote && (
            <ContextMenuItem
              onClick={() =>
                void api
                  .pick(true)
                  .then((paths) => api.sources(paths))
                  .then((ids) => {
                    if (ids[0])
                      p.onTransfer(
                        selected.includes(e.id) ? selected : [e.id],
                        ids[0],
                      );
                  })
                  .catch((error) => p.onError(String(error)))
              }
            >
              <FolderDown />
              {t("downloadTo")}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={
              dir?.path === ":computer:" ||
              (selected.includes(e.id) && selected.length > 1)
            }
            onClick={() => action("rename", e)}
          >
            <Pencil />
            {t("rename")}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              const selectedItems = selected.includes(e.id)
                ? items.filter((item) => selected.includes(item.id))
                : [e];
              const sep = dir?.path.includes("\\") ? "\\" : "/";
              void navigator.clipboard
                .writeText(
                  selectedItems
                    .map((item) =>
                      dir?.path === ":computer:"
                        ? item.name
                        : (dir?.path.replace(/[\\/]$/, "") || "") +
                          sep +
                          item.name,
                    )
                    .join("\n"),
                )
                .catch((error) => p.onError(String(error)));
            }}
          >
            <Copy />
            {t("copyPath")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => action("properties", e)}>
            <Info />
            {t("properties")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={dir?.path === ":computer:"}
            onClick={() => action("delete", e)}
          >
            <Trash2 />
            {t("delete")}
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={!dir?.id}>
              <Plus />
              {t("create")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="files-options-popup">
              <FileCreateOptions
                canCreate={!!dir?.id}
                onCreate={() => action("mkdir")}
                onCreateText={() => action("createText")}
              />
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={() => dir && void load(dir.path, false)}>
            <RefreshCw />
            {t("refresh")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              const value = view === "list" ? "grid" : "list";
              setView(value);
              localStorage.setItem("oria-tunnel.files-view." + p.side, value);
            }}
          >
            {view === "list" ? <LayoutGrid /> : <List />}
            {t(view === "list" ? "iconView" : "listView")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setHidden(!hidden)}>
            {hidden ? <EyeOff /> : <Eye />}
            {t(hidden ? "hideHidden" : "showHidden")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ArrowDownAZ />
              {t("sortBy")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="files-options-popup">
              <FileSortOptions
                sort={sort}
                descending={descending}
                onSortChange={setSort}
                onDescendingChange={setDescending}
              />
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}
    </ContextMenuContent>
  );
  return (
    <section
      ref={root}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "l") {
          event.preventDefault();
          requestPathEdit((n) => n + 1);
        }
      }}
      data-native-file-drop
      data-file-side={p.side}
      data-file-target={canRead && !p.disabledDrop ? dir?.id : undefined}
      className={`files-pane themed-surface ${hover ? "files-drop-hover" : ""}`}
    >
      <div className="files-pane-title">
        <div className="files-pane-heading">{p.title}</div>
        <div className="files-pane-actions">
          <span>
            {selected.length} / {items.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={
              !p.canTransfer ||
              !selected.length ||
              !canRead ||
              dir?.path === ":computer:"
            }
            onClick={() => p.onTransfer(selected)}
          >
            {p.transferKind === "relay" ? (
              <ArrowRightLeft />
            ) : p.remote ? (
              <Download />
            ) : (
              <Upload />
            )}
            {t(p.transferKind === "relay" ? "remoteTransfer" : p.transferKind)}
          </Button>
        </div>
      </div>
      <div className="files-toolbar">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("back")}
          disabled={cursor.current <= 0}
          onClick={() => void load(history.current[--cursor.current], false)}
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("forward")}
          disabled={cursor.current >= history.current.length - 1}
          onClick={() => void load(history.current[++cursor.current], false)}
        >
          <ArrowRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("up")}
          disabled={!dir}
          onClick={() => dir && void load(dir.parent)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("refresh")}
          disabled={!canRead || loading}
          onClick={() => void load(dir?.path || p.initialPath || "", false)}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
        <FilePathNavigation
          path={dir?.path || ""}
          remote={p.remote}
          disabled={!canRead}
          loading={loading}
          editRequest={editPathRequest}
          onNavigate={load}
        />
        <FileSearchButton
          value={query}
          onChange={setQuery}
          disabled={!canRead}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("view")}
          aria-label={t("view")}
          onClick={() => {
            const v = view === "list" ? "grid" : "list";
            setView(v);
            localStorage.setItem(`oria-tunnel.files-view.${p.side}`, v);
          }}
        >
          {view === "list" ? <List /> : <LayoutGrid />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={t("more")}>
                <MoreHorizontal />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="files-options-popup">
            <FileOptionsMenu
              remote={p.remote}
              hidden={hidden}
              sort={sort}
              descending={descending}
              canCreate={!!dir?.id}
              canUpload={!!dir}
              onHiddenChange={setHidden}
              onSortChange={setSort}
              onDescendingChange={setDescending}
              onCreate={() => action("mkdir")}
              onCreateText={() => action("createText")}
              onUpload={(folder) => {
                void api
                  .pick(folder)
                  .then((paths) => api.sources(paths))
                  .then(async (ids) => {
                    if (dir && ids.length) await p.onDrop(ids, dir.id);
                  })
                  .catch((e) => p.onError(String(e)));
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!canRead ? (
        <div className="files-empty">
          {t(p.status?.phase || "notConnected")}
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                ref={viewport}
                {...marquee.handlers}
                className="files-viewport scroll-fade"
                role="grid"
                aria-label={
                  p.status?.hostName || t(p.remote ? "remote" : "local")
                }
                aria-multiselectable="true"
                tabIndex={0}
                onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
                onKeyDown={(e) => {
                  if (!e.currentTarget.contains(e.target as Node)) return;
                  if (e.key === "Escape") marquee.cancel();
                  if ((e.ctrlKey || e.metaKey) && e.key === "a") {
                    e.preventDefault();
                    setSelected(ordered);
                  }
                  if (e.key === "Enter" && selected.length === 1) {
                    const item = items.find((i) => i.id === selected[0]);
                    if (item) openEntry(item);
                  }
                  if (e.key === "Delete") action("delete");
                  if (e.key === "F2") action("rename");
                  if (e.key === " " && selected.length === 1) {
                    e.preventDefault();
                    const entry = items.find((i) => i.id === selected[0]);
                    if (entry) openEntry(entry);
                  }
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const index = ordered.indexOf(selected.at(-1) || "");
                    const next = Math.max(
                      0,
                      Math.min(
                        items.length - 1,
                        index + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    );
                    if (items[next]) {
                      setSelected([items[next].id]);
                      viewport.current?.scrollTo({
                        top:
                          Math.floor(next / (view === "list" ? 1 : cols)) *
                          rowHeight,
                      });
                    }
                  }
                }}
              />
            }
          >
            <div style={{ height: rowCount * rowHeight, position: "relative" }}>
              {visible.map((e, index) => {
                const position =
                  view === "list" ? start + index : start * cols + index;
                const chosen = selected.includes(e.id);
                return (
                  <ContextMenu key={e.id}>
                    <ContextMenuTrigger
                      render={
                        <motion.div
                          initial="rest"
                          animate="rest"
                          whileHover="artwork-hover"
                          whileFocus="artwork-hover"
                          role="row"
                          tabIndex={-1}
                          aria-selected={chosen}
                          className={`files-entry ${view === "grid" ? "files-icon-entry" : ""} ${chosen ? "selected" : ""}`}
                          style={{
                            position: "absolute",
                            top:
                              Math.floor(
                                position / (view === "list" ? 1 : cols),
                              ) *
                                rowHeight +
                              gapY / 2,
                            left:
                              view === "list"
                                ? 0
                                : `calc(${((position % cols) * 100) / cols}% + ${gapX / 2}px)`,
                            width:
                              view === "list"
                                ? "100%"
                                : `calc(${100 / cols}% - ${gapX}px)`,
                            height: rowHeight - gapY,
                          }}
                          data-file-target={
                            e.kind === "directory" && !p.disabledDrop
                              ? e.id
                              : undefined
                          }
                          data-file-side={p.side}
                          data-file-entry={e.id}
                          onContextMenu={() => {
                            if (!chosen) setSelected([e.id]);
                          }}
                          onClick={(event) => {
                            setSelected(
                              selection(
                                selected,
                                e.id,
                                ordered,
                                event.ctrlKey || event.metaKey,
                                event.shiftKey,
                                anchor.current,
                              ),
                            );
                            anchor.current = e.id;
                          }}
                          onDoubleClick={() => openEntry(e)}
                          onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            pointer.current = {
                              x: event.clientX,
                              y: event.clientY,
                              id: e.id,
                              ids: chosen ? selected : [e.id],
                            };
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                          }}
                          onPointerMove={(event) => {
                            const point = pointer.current;
                            if (
                              point &&
                              Math.hypot(
                                event.clientX - point.x,
                                event.clientY - point.y,
                              ) > 8
                            ) {
                              p.onDrag({
                                side: p.side,
                                ids: point.ids,
                                x: event.clientX,
                                y: event.clientY,
                              });
                              pointer.current = null;
                            }
                          }}
                          onPointerUp={() => {
                            pointer.current = null;
                          }}
                        />
                      }
                    >
                      <span
                        role="gridcell"
                        className="files-entry-name"
                        title={e.name}
                      >
                        <FileArtwork
                          name={e.name}
                          kind={
                            !p.remote && dir?.path === ":computer:"
                              ? "drive"
                              : e.kind
                          }
                          large={view === "grid"}
                        />
                        <span>{e.name}</span>
                      </span>
                      {view === "list" && (
                        <>
                          <span role="gridcell" className="files-size">
                            {e.kind === "file" ? size(e.size) : "—"}
                          </span>
                          <span role="gridcell" className="files-date">
                            {e.modified
                              ? new Date(e.modified).toLocaleDateString()
                              : "—"}
                          </span>
                        </>
                      )}
                    </ContextMenuTrigger>
                    {menu(e)}
                  </ContextMenu>
                );
              })}
            </div>
            {marquee.box && (
              <div
                className="files-selection-box"
                aria-hidden="true"
                style={marquee.box}
              />
            )}
            {items.length === 0 && (
              <p className="files-empty">
                {t(loading ? "loading" : query ? "noResults" : "empty")}
              </p>
            )}
          </ContextMenuTrigger>
          {menu()}
        </ContextMenu>
      )}
    </section>
  );
}
