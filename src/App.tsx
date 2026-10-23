import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { PageTransition, useEntranceMotion } from "./components/ui/motion";
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  useNodesInitialized,
  useUpdateNodeInternals,
  applyNodeChanges,
  type NodeProps,
  type Node,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import {
  ServerPlusIcon,
  GitPullRequestCreateArrowIcon,
  Settings2Icon,
  MonitorIcon,
  ServerIcon,
  ArrowRightIcon,
  PlayIcon,
  SquareIcon,
  MaximizeIcon,
  ZoomInIcon,
  ZoomOutIcon,
  GraphStarIcon,
  ShieldCheckIcon,
  InfoIcon,
  Trash2Icon,
} from "lucide-react";
import { WindowHeader } from "./components/window/window-header";
import { Button } from "./components/ui/button";
import { Toaster, toast } from "./components/ui/toast";
import { Input } from "./components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Field, Modal, ModalActions } from "./components/tunnel-form";
import { ConnectionFields, RuleEditor } from "./features/tunnels/rule-editor";
import { HostSourceSettings } from "./features/hosts/source-settings";
import { HostGroups, type HostGrouping } from "./features/hosts/host-groups";
import { JumpRouteEditor } from "./features/hosts/jump-route-editor";
import { HostTags } from "./features/hosts/host-tags";
import { HostToolbar } from "./features/hosts/host-toolbar";
import { HostTestButton } from "./features/hosts/host-test-button";
import { AuthenticationField } from "./features/hosts/authentication-field";
import { IdentityFilesEditor } from "./features/hosts/identity-files-editor";
import { HostDiscovery } from "./features/hosts/host-discovery";
import { hostAuthLabels } from "./features/hosts/host-auth";
import { addedHosts, hostFilterStatus } from "./features/hosts/host-collection";
import { RuleToolbar } from "./features/tunnels/rule-toolbar";
import { OpenServiceButton } from "./features/tunnels/service-protocol";
import { RuleActions } from "./features/tunnels/rule-actions";
import { ParameterField, ParameterSwitch, ParameterTitle } from "./components/parameter-field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "./components/ui/item";
import { Switch } from "./components/ui/switch";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "./components/ui/select";
import { RuntimeDetails } from "./features/tunnels/runtime-details";
import { bytes, rate } from "./features/tunnels/runtime-format";
import { runtimeStatus } from "./features/tunnels/runtime-status";
import { ActivityView } from "./features/tunnels/activity-view";
import { WorkspaceActions } from "./features/tunnels/workspace-actions";
import { ImportConfig } from "./features/tunnels/import-config";
import { ConnectionIcon } from "./features/tunnels/connection-icon";
import { ConnectionEdge } from "./features/tunnels/connection-edge";
import { LocalPortHandle } from "./features/tunnels/local-port-handle";
import { PORT_LAYOUT_KEY, readPortPlacements, type PortPlacement } from "./features/tunnels/port-placement";
import { canvasLayout, canvasPortId, localPortSide, localCardSize, reconcileCanvasNodes } from "./features/tunnels/canvas-state";
import {
  connectionPorts,
  connectionVisual,
} from "./features/tunnels/connection-visual";
import {
  emptyHost,
  emptyRule,
  rulePath,
  networkChanged,
  jumpHosts,
} from "./features/tunnels/rule-model";
import {
  AppearanceSettings,
  WindowSettings,
} from "./components/settings/appearance-settings";
import * as bridge from "./lib/bridge";
import type {
  Host,
  Rule,
  Runtime,
  Snapshot,
  BatchResult,
} from "./types";
import "./tunnel-i18n";
import {
  groupRulesByHost,
  groupPositions,
} from "./features/tunnels/rule-groups";

const initial: Snapshot = {
  hosts: [],
  rules: [],
  runtimes: [],
  diagnostics: [],
  revision: -1,
  closeToTray: true,
  agentSupported: false,
  sourceFiles: [],
  autoSyncHosts: true,
  activity: [],
  undoCount: 0,
  autostart: false,
  autostartSupported: false,
};
function Status({ runtime }: { runtime?: Runtime }) {
  const { t } = useTranslation("tunnel");
  const status = runtimeStatus(runtime);
  return (
    <span className={`status ${runtime?.status || "stopped"} tone-${status.tone}`} title={runtime?.message || t(status.label)}>
      <i />
      {t(status.label)}
    </span>
  );
}
function useSnapshot() {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const accept = useCallback(
    (next: Snapshot) =>
      setData((prev) => (next.revision >= prev.revision ? next : prev)),
    [],
  );
  useEffect(() => {
    let disposed = false;
    const sub = bridge.desktop
      ? listen<Snapshot>("tunnel://snapshot", (e) => {
          if (!disposed) accept(e.payload);
        })
      : Promise.resolve(() => {});
    void sub
      .then(() => bridge.snapshot())
      .then((next) => {
        if (!disposed) accept(next);
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      void sub.then((stop) => stop());
    };
  }, [accept]);
  return { data, accept, error, setError };
}

export function App() {
  const { t } = useTranslation("tunnel");
  const rowEntrance = useEntranceMotion(4);
  const { data, accept, error, setError } = useSnapshot();
  const [page, setPage] = useState("canvas");
  const [settings, setSettings] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Rule[] | null>(null);
  const [deletingHost, setDeletingHost] = useState<Host | null>(null);
  const [hostDraft, setHostDraft] = useState<Host | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [addedInSession, setAddedInSession] = useState<string[]>([]);
  const [ruleDraft, setRuleDraft] = useState<Rule | null>(null);
  const [focusRuleId, setFocusRuleId] = useState("");
  const [ruleSuspended, setRuleSuspended] = useState(false);
  const [hostFromRule, setHostFromRule] = useState(false);
  const [authHostId, setAuthHostId] = useState<string | null>(null);
  const [authId, setAuthId] = useState<string | null>(null);
  const [jumpSecrets, setJumpSecrets] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedHost, setSelectedHost] = useState("");
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState("");
  const [batchAuth, setBatchAuth] = useState<string[] | null>(null);
  const [batchSecrets, setBatchSecrets] = useState<Record<string, string>>({});
  const [rememberPasswords, setRememberPasswords] = useState<Record<string, boolean>>({});
  useEffect(() => { setRememberPasswords({}); }, [authId, batchAuth]);
  useEffect(() => {
    if (!bridge.desktop) return;
    const unlisten = listen<string>("tunnel://password-error", (e) => setError(e.payload));
    return () => { void unlisten.then((off) => off()).catch(() => {}); };
  }, [setError]);
  const rememberHostIds = () => Object.keys(rememberPasswords).filter((id) => rememberPasswords[id]);
  useEffect(() => {
    if (!error) {
      toast.close("app-error");
      return;
    }
    toast.add({
      id: "app-error",
      title: error,
      type: "error",
      priority: "high",
      timeout: 0,
      onClose: () => setError((current) => current === error ? "" : current),
    });
  }, [error, setError]);
  const notifyBatch = (results: BatchResult[], operation: "start" | "stop") => {
    const accepted = results.filter((result) => result.accepted).length;
    const rejected = results.length - accepted;
    toast.add({
      title: t(rejected ? "batchRequestPartial" : "batchRequestSubmitted", {
        action: t(operation),
        count: accepted,
        rejected,
      }),
      description:
        results.find((result) => !result.accepted)?.error ||
        (rejected ? t("batchRequestFailed") : undefined),
      type: rejected ? "warning" : "info",
      timeout: rejected ? 6000 : 4000,
    });
  };
  const [exporting, setExporting] = useState<string[] | null>(null);
  const action = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError("");
      try {
        const result = await fn();
        if (result && typeof result === "object" && "revision" in result)
          accept(result as Snapshot);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accept, setError],
  );
  const refresh = () => action(bridge.refreshHosts);
  const managedHosts = addedHosts(data, addedInSession);
  const managedHostIds = new Set(managedHosts.map((host) => host.id));
  const openHostDiscovery = (fromRule = false) => {
    setHostFromRule(fromRule);
    setDiscovering(true);
    void refresh();
  };
  useEffect(() => {
    if (!bridge.desktop) return;
    const focus = () => {
      void bridge
        .syncHosts()
        .then(accept)
        .catch((e) => setError(String(e)));
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [accept, setError]);
  const newRule = (hostId = "") => {
    setRuleSuspended(false);
    setRuleDraft(emptyRule(hostId));
  };
  const copyRule = (rule: Rule) => {
    setRuleSuspended(false);
    setRuleDraft({
      ...rule,
      id: "",
      name: rule.name + " (copy)",
      bindPort: 0,
      autoConnect: false,
    });
  };
  const saveDraft = async (launch: boolean) => {
    if (!ruleDraft) return;
    const rule = { ...ruleDraft, id: ruleDraft.id || crypto.randomUUID() };
    const old = data.rules.find((r) => r.id === rule.id);
    const running = data.runtimes.some(
      (r) =>
        r.ruleId === rule.id &&
        !["failed", "stopped", "needs-attention"].includes(r.status),
    );
    const reconnect = !!old && running && networkChanged(old, rule);
    const ok = await action(async () => {
      const result = await bridge.saveRule(rule);
      if (reconnect) await bridge.stopRule(rule.id);
      return result;
    });
    if (ok) {
      setRuleDraft(null);
      setRuleSuspended(false);
      setPage("canvas");
      setFocusRuleId(rule.id);
      if (launch || reconnect) start(rule.id);
    }
  };
  const stop = (id: string) => action(() => bridge.stopRule(id));
  const start = (id: string) => {
    setAuthHostId(null);
    setSecret("");
    setJumpSecrets({});
    setAuthId(id);
  };
  const startHost = (id: string) => {
    setAuthHostId(id);
    setAuthId("host-test:" + id);
    setSecret("");
    setJumpSecrets({});
  };
  const closeHost = () => {
    setHostDraft(null);
    setHostFromRule(false);
  };
  const saveHostDraft = async (test: boolean) => {
    if (!hostDraft) return;
    const host = { ...hostDraft, id: hostDraft.id || crypto.randomUUID() };
    const ok = await action(() =>
      host.source === "config"
        ? bridge.saveHostMetadata(host)
        : bridge.saveHost(host),
    );
    if (ok) {
      if (hostFromRule && ruleDraft)
        setRuleDraft({ ...ruleDraft, hostId: host.id });
      closeHost();
      if (test) startHost(host.id);
    }
  };
  const authTarget = data.hosts.find(
    (h) =>
      h.id === (authHostId || data.rules.find((r) => r.id === authId)?.hostId),
  );
  const duplicateHost =
    hostDraft?.source === "manual" &&
    managedHosts.find(
      (h) =>
        h.id !== hostDraft.id &&
        h.address === hostDraft.address &&
        h.port === hostDraft.port &&
        h.user === hostDraft.user,
    );
  const pending = data.runtimes.find((r) => r.status === "verifying-host");
  const selection = selectedRules.filter((id) =>
    data.rules.some((r) => r.id === id),
  );
  const deletingHostRules = deletingHost
    ? data.rules.filter(
        (r) =>
          r.hostId === deletingHost.id ||
          jumpHosts(
            data.hosts,
            data.hosts.find((h) => h.id === r.hostId),
          ).some((h) => h.id === deletingHost.id),
      )
    : [];
  const batchHosts = data.hosts.filter((h) =>
    (batchAuth || []).some((id) => {
      const rule = data.rules.find((r) => r.id === id);
      const target = data.hosts.find((host) => host.id === rule?.hostId);
      return (
        h.id === target?.id ||
        jumpHosts(data.hosts, target).some((j) => j.id === h.id)
      );
    }),
  );
  const inspected = data.rules.find((r) => r.id === inspecting);
  const active = data.runtimes.filter(
    (r) =>
      !r.ruleId.startsWith("host-test:") &&
      !["failed", "stopped", "tested", "needs-attention"].includes(r.status),
  ).length;
  return (
    <div className="app-shell tunnel-app">
      <WindowHeader
        fixedLeftActions={
          page === "hosts" || page === "canvas" || page === "tunnels" ? (
            <>
              {(page === "hosts" || page === "canvas") && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("addHost")}
                  title={t("addHost")}
                  disabled={!bridge.desktop}
                  onClick={() => openHostDiscovery()}
                >
                  <ServerPlusIcon />
                </Button>
              )}
              {(page === "canvas" || page === "tunnels") && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("add")}
                  title={t("add")}
                  disabled={!bridge.desktop}
                  onClick={() => newRule()}
                >
                  <GitPullRequestCreateArrowIcon />
                </Button>
              )}
            </>
          ) : null
        }
        fixedRightActions={
          <>
            <WorkspaceActions
              count={data.rules.length}
              busy={busy}
              available={bridge.desktop}
              onStartAll={() => {
                setBatchAuth(data.rules.map((r) => r.id));
                setBatchSecrets({});
              }}
              onStopAll={() => {
                void action(async () =>
                  notifyBatch(
                    await bridge.stopBatch(data.rules.map((r) => r.id)),
                    "stop",
                  ),
                );
              }}
            />
          </>
        }
        centerContent={
          <Tabs value={page} onValueChange={setPage}>
            <TabsList variant="soft">
              <TabsTrigger value="canvas">{t("canvas")}</TabsTrigger>
              <TabsTrigger value="tunnels">{t("tunnels")}</TabsTrigger>
              <TabsTrigger value="hosts">{t("hosts")}</TabsTrigger>
              <TabsTrigger value="activity">{t("activity")}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("settings")}
          onClick={() => setSettings(true)}
        >
          <Settings2Icon />
        </Button>
      </WindowHeader>
      {ruleDraft && ruleSuspended && (
        <div className="draft-return overlay">
          <Button size="sm" onClick={() => setRuleSuspended(false)}>
            {t("resumeDraft")}
          </Button>
        </div>
      )}
      <main>
        <PageTransition key={page}>
        {page === "canvas" ? (
          <ReactFlowProvider>
            <TunnelCanvas
              data={data}
              onStart={start}
              onOpenService={(id) => void action(() => bridge.openService(id))}
              onStop={stop}
              onDetails={(rule) => setInspecting(rule.id)}
              onCopy={copyRule}
              onDelete={(rule) => setDeleting([rule])}
              onEdit={(rule) => {
                setRuleSuspended(false);
                setRuleDraft(rule);
              }}
              focusRuleId={focusRuleId}
              onFocusDone={() => setFocusRuleId("")}
            />
          </ReactFlowProvider>
        ) : page === "activity" ? (
          <ActivityView data={data} />
        ) : page === "hosts" ? (
          <Hosts
            data={{ ...data, hosts: managedHosts }}
            busy={busy}
            selected={selectedHost}
            setSelected={setSelectedHost}
            onEdit={setHostDraft}
            onForward={(id) => newRule(id)}
            onTest={startHost}
            onStopTest={(id) => void stop("host-test:" + id)}
            onDelete={setDeletingHost}
            onCopy={(h) =>
              setHostDraft({
                ...h,
                id: "",
                source: "manual",
                sourceFile: undefined,
                fieldSources: {},
                configuredForwards: [],
                hidden: false,
                diagnostics: [],
                name: h.name + " (copy)",
              })
            }
          />
        ) : (
          <ScrollArea
            className="page-scroll-area"
            viewportClassName="page tunnels-page scroll-fade"
          >
            <header className="tunnels-page-heading">
              <h1>{t("tunnels")}</h1>
              <span>{t("currentWorkspace")}</span>
            </header>
            <RuleToolbar
              count={data.rules.length}
              selected={selection.length}
              undoCount={data.undoCount}
              busy={busy}
              available={bridge.desktop}
              onToggleAll={(checked) =>
                setSelectedRules(checked ? data.rules.map((r) => r.id) : [])
              }
              onStart={() => {
                setBatchAuth(selection);
                setBatchSecrets({});
              }}
              onStop={() =>
                void action(async () =>
                  notifyBatch(await bridge.stopBatch(selection), "stop"),
                )
              }
              onDelete={() =>
                setDeleting(data.rules.filter((r) => selection.includes(r.id)))
              }
              onImport={() => setImporting(true)}
              onExport={() => {
                setExporting(
                  selection.length ? selection : data.rules.map((r) => r.id),
                );
              }}
              onUndo={() => void action(bridge.undoDelete)}
            />
            {!data.rules.length ? (
              <Empty title={t("noRules")} body={t("emptyBody")} />
            ) : (
              <div className="rule-list">
                {groupRulesByHost(data.rules, data.hosts).map((group) => (
                  <section className="rule-host-group" key={group.id}>
                    <header className="rule-group-heading">
                      <ServerIcon size={17} />
                      <div>
                        <h2>{group.host?.name || t("sourceMissing")}</h2>
                        {group.host && (
                          <code>
                            {group.host.user}@{group.host.address}:
                            {group.host.port}
                          </code>
                        )}
                      </div>
                      <span className="source-badge">
                        {group.rules.length} {t("tunnels")}
                      </span>
                    </header>
                    {group.rules.map((rule) => {
                      const host = group.host,
                        runtime = data.runtimes.find(
                          (r) => r.ruleId === rule.id,
                        );
                      return (
                        <motion.div className="rule-row themed-surface" key={rule.id} {...rowEntrance}>
                          <input
                            className="rule-select"
                            type="checkbox"
                            aria-label={t("selectRule", { name: rule.name })}
                            checked={selection.includes(rule.id)}
                            onChange={(e) =>
                              setSelectedRules(
                                e.target.checked
                                  ? [...selection, rule.id]
                                  : selection.filter((id) => id !== rule.id),
                              )
                            }
                          />
                          <div className="rule-summary">
                            <strong className="rule-name">
                              <ConnectionIcon icon={rule.icon} color={rule.color} />
                              <span title={rule.name}>{rule.name}</span>
                            </strong>
                            <Status runtime={runtime} />
                          </div>
                          <small className="rule-metrics">
                            {runtime && (
                              <>
                                ↑ {rate(runtime.sentPerSecond)} · ↓{" "}
                                {rate(runtime.receivedPerSecond)} ·{" "}
                                {runtime.connections} {t("connections")}
                              </>
                            )}
                          </small>
                          <small
                            className="rule-route"
                            title={rulePath(
                              rule,
                              host?.name || t("sourceMissing"),
                              t("local"),
                            )}
                          >
                            {rule.kind} ·{" "}
                            {rulePath(
                              rule,
                              host?.name || t("sourceMissing"),
                              t("local"),
                            )}
                          </small>
                          <RuleActions
                            rule={rule}
                            onDetails={(item) => setInspecting(item.id)}
                            onEdit={(item) => {
                              setRuleSuspended(false);
                              setRuleDraft(item);
                            }}
                            onCopy={copyRule}
                            onDelete={(item) => setDeleting([item])}
                          >
                            <RunButton
                              runtime={runtime}
                              start={() => start(rule.id)}
                              stop={() => void stop(rule.id)}
                            />
                          </RuleActions>
                        </motion.div>
                      );
                    })}
                  </section>
                ))}
              </div>
            )}
          </ScrollArea>
        )}
        </PageTransition>
      </main>
      <div className="app-footnote">
        <GraphStarIcon size={13} />
        <span>
          {active} {t("active")}
        </span>
        <span className="footnote-divider" />
        <span>OriaTunnel</span>
      </div>
      {!!data.diagnostics.length && (
        <div className="diagnostics overlay">
          {data.diagnostics.map((d, i) => (
            <div key={i}>{d === "browserPreview" ? t(d) : d}</div>
          ))}
        </div>
      )}
      <Toaster closeLabel={t("cancel")} />
      <AnimatePresence>
      {deleting && (
        <Modal key="delete-rules"
          title={t("confirmDelete")}
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p className="muted">
            {t("deleteRulesHint", { count: deleting.length })}
          </p>
          <ul className="delete-targets">
            {deleting.map((rule) => (
              <li key={rule.id}>{rule.name}</li>
            ))}
          </ul>
          <ModalActions>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void action(() =>
                  deleting.length === 1
                    ? bridge.deleteRule(deleting[0].id)
                    : bridge.deleteRules(deleting.map((r) => r.id)),
                ).then((ok) => {
                  if (ok) {
                    const removed = new Set(deleting.map((r) => r.id));
                    setSelectedRules((ids) =>
                      ids.filter((id) => !removed.has(id)),
                    );
                    setDeleting(null);
                  }
                })
              }
            >
              {t("delete")}
            </Button>
          </ModalActions>
        </Modal>
      )}
      {deletingHost && (
        <Modal key="delete-host"
          title={t("confirmDelete")}
          close={() => {
            if (!busy) setDeletingHost(null);
          }}
        >
          <strong>{deletingHost.name}</strong>
          <p className="muted">
            {t(
              deletingHostRules.length
                ? "deleteHostCascadeHint"
                : "deleteHostOnlyHint",
              { count: deletingHostRules.length },
            )}
          </p>
          {!!deletingHostRules.length && (
            <ul className="delete-targets">
              {deletingHostRules.map((rule) => (
                <li key={rule.id}>{rule.name}</li>
              ))}
            </ul>
          )}
          <p className="muted">{t("deleteUndoHint")}</p>
          <ModalActions>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDeletingHost(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const hostId = deletingHost.id;
                const ids = deletingHostRules.map((r) => r.id);
                void action(() => bridge.deleteHost(hostId, ids)).then((ok) => {
                  if (ok) {
                    setAddedInSession((items) =>
                      items.filter((id) => id !== hostId),
                    );
                    setSelectedRules((items) =>
                      items.filter((id) => !ids.includes(id)),
                    );
                    setSelectedHost((id) => (id === hostId ? "" : id));
                    setDeletingHost(null);
                  }
                });
              }}
            >
              {t("delete")}
            </Button>
          </ModalActions>
        </Modal>
      )}
      {importing && (
        <ImportConfig key="import"
          previewFile={bridge.previewImport}
          cancelPreview={bridge.cancelImport}
          hosts={data.hosts}
          busy={busy}
          close={() => {
            if (!busy) {
              setImporting(false);
              void bridge.cancelImport().catch((e) => setError(String(e)));
            }
          }}
          submit={async (token, choices) => {
            const ok = await action(() => bridge.commitImport(token, choices));
            if (ok) setImporting(false);
            return ok;
          }}
        />
      )}
      {settings && (
        <Modal key="settings"
          title={t("settings")}
          close={() => setSettings(false)}
          className="max-w-3xl sm:max-w-3xl"
        >
          <h3>{t("appearance")}</h3>
          <AppearanceSettings />
          <h3>{t("window")}</h3>
          <WindowSettings />
          <h3>{t("discovery")}</h3>
          <HostSourceSettings
            data={data}
            busy={busy || !bridge.desktop}
            save={(files, autoSync) =>
              action(() => bridge.setHostSources(files, autoSync))
            }
          />
          <h3>{t("trayAndStartup")}</h3>
          <ItemGroup className="settings-section-panel themed-surface gap-0 divide-y divide-border-strong/15 overflow-hidden rounded-xl">
            <Item className="rounded-none border-0 px-3 py-2.5">
              <ItemContent className="min-w-0">
                <ItemTitle>
                  <ParameterTitle
                    label={t("closeToTray")}
                    description={t("closeToTrayHint")}
                    htmlFor="settings-close-to-tray"
                  />
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <Switch
                  id="settings-close-to-tray"
                  checked={data.closeToTray}
                  disabled={busy || !bridge.desktop}
                  onCheckedChange={(checked) =>
                    void action(() => bridge.setCloseToTray(checked))
                  }
                />
              </ItemActions>
            </Item>
            <Item className="rounded-none border-0 px-3 py-2.5">
              <ItemContent className="min-w-0">
                <ItemTitle>
                  <ParameterTitle
                    label={t("autostart")}
                    description={t("autostartHint")}
                    htmlFor="settings-autostart"
                  />
                </ItemTitle>
                {data.autostartError && (
                  <ItemDescription
                    className="line-clamp-none text-xs text-destructive"
                    role="alert"
                  >
                    {data.autostartError}
                  </ItemDescription>
                )}
              </ItemContent>
              <ItemActions>
                <Switch
                  id="settings-autostart"
                  checked={data.autostart}
                  disabled={busy || !bridge.desktop || !data.autostartSupported}
                  onCheckedChange={(checked) =>
                    void action(() => bridge.setAutostart(checked))
                  }
                />
              </ItemActions>
            </Item>
            <Item className="justify-end rounded-none border-0 px-3 py-2.5">
              <Button
                size="sm"
                variant="outline"
                disabled={!bridge.desktop}
                onClick={() => void action(bridge.quitApp)}
              >
                {t("quit")}
              </Button>
            </Item>
          </ItemGroup>
        </Modal>
      )}
      {inspected && (
        <Modal key="runtime-details" title={inspected.name} close={() => setInspecting("")}>
          <RuntimeDetails
            rule={inspected}
            runtime={data.runtimes.find((r) => r.ruleId === inspected.id)}
            hostName={
              data.hosts.find((h) => h.id === inspected.hostId)?.name ||
              t("sourceMissing")
            }
          />
        </Modal>
      )}
      {batchAuth && (
        <Modal key="batch-auth"
          title={t("batchStartTitle", { count: batchAuth.length })}
          description={t("batchAuthHint")}
          close={() => {
            setBatchAuth(null);
            setBatchSecrets({});
          }}
        >
          <form id="batch-auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              const ids = batchAuth;
              const credentials = batchSecrets;
              const remember = rememberHostIds();
              setBatchSecrets({});
              setBatchAuth(null);
              void action(async () =>
                notifyBatch(
                  await bridge.startBatch(ids, credentials, remember),
                  "start",
                ),
              );
            }}
          >
            {batchHosts.map((host) => (
              <AuthenticationField key={host.id} host={host} value={batchSecrets[host.id] || ""}
                onChange={(value) => setBatchSecrets({ ...batchSecrets, [host.id]: value })}
                remember={!!rememberPasswords[host.id]}
                onRemember={(value) => setRememberPasswords((old) => ({ ...old, [host.id]: value }))} />
            ))}
            <ModalActions>
              <Button type="submit" form="batch-auth-form" variant="primary-soft" disabled={busy}>
                {t("startSelected")}
              </Button>
            </ModalActions>
          </form>
        </Modal>
      )}
      {exporting && (
        <Modal key="export"
          title={t("exportTitle", { count: exporting.length })}
          close={() => setExporting(null)}
        >
          <p className="muted">{t("exportHint")}</p>
          <ModalActions>
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const path = await bridge.exportConfig(exporting);
                  if (path)
                    toast.add({
                      title: t("exported"),
                      description: path,
                      type: "success",
                      timeout: 4000,
                    });
                  setExporting(null);
                })
              }
            >
              {t("chooseExportFile")}
            </Button>
          </ModalActions>
        </Modal>
      )}
      {ruleDraft && !ruleSuspended && (
        <Modal key="rule-editor"
          title={t(ruleDraft.id ? "editForward" : "add")}
          close={() => setRuleDraft(null)}
        >
          <RuleEditor
            draft={ruleDraft}
            hosts={managedHosts}
            busy={busy}
            reconnect={
              !!data.rules.find(
                (r) => r.id === ruleDraft.id && networkChanged(r, ruleDraft),
              ) &&
              data.runtimes.some(
                (r) =>
                  r.ruleId === ruleDraft.id &&
                  !["failed", "stopped", "needs-attention"].includes(r.status),
              )
            }
            onChange={setRuleDraft}
            onCancel={() => setRuleDraft(null)}
            onAddHost={() => openHostDiscovery(true)}
            onManageHosts={() => {
              setRuleSuspended(true);
              setPage("hosts");
            }}
            onSave={(launch) => void saveDraft(launch)}
          />
        </Modal>
      )}
      {discovering && (
        <HostDiscovery key="discovery"
          hosts={data.hosts.filter((host) => !managedHostIds.has(host.id))}
          diagnostics={data.diagnostics}
          busy={busy}
          available={bridge.desktop}
          close={() => {
            if (!busy) {
              setDiscovering(false);
              setHostFromRule(false);
            }
          }}
          refresh={() => void refresh()}
          manual={() => {
            setDiscovering(false);
            setHostDraft(emptyHost());
          }}
          select={async (id) => {
            const candidate = data.hosts.find(
              (host) => host.id === id && host.source === "config",
            );
            if (!candidate || busy) return;
            const ok = await action(() => bridge.saveHostMetadata(candidate));
            if (!ok) return;
            setAddedInSession((ids) => (ids.includes(id) ? ids : [...ids, id]));
            if (hostFromRule && ruleDraft)
              setRuleDraft((current) => current && { ...current, hostId: id });
            else {
              setPage("hosts");
              setSelectedHost(id);
            }
            setDiscovering(false);
            setHostFromRule(false);
          }}
        />
      )}
      {hostDraft && (
        <Modal key="host-editor"
          title={hostDraft.id ? t("edit") : t("newHost")}
          close={closeHost}
        >
          <form id="host-editor-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveHostDraft(false);
            }}
          >
            <Field label={t("name")}>
              <Input
                required
                value={hostDraft.name}
                onChange={(e) =>
                  setHostDraft({ ...hostDraft, name: e.target.value })
                }
              />
            </Field>
            <Field label={t("address")}>
              <Input
                required
                disabled={hostDraft.source === "config"}
                value={hostDraft.address}
                onChange={(e) =>
                  setHostDraft({ ...hostDraft, address: e.target.value })
                }
              />
            </Field>
            <fieldset disabled={hostDraft.source === "config"}>
              <div className="form-grid">
                <Field label={t("port")}>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={hostDraft.port}
                    onChange={(e) =>
                      setHostDraft({
                        ...hostDraft,
                        port: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label={t("user")}>
                  <Input
                    required
                    value={hostDraft.user}
                    onChange={(e) =>
                      setHostDraft({ ...hostDraft, user: e.target.value })
                    }
                  />
                </Field>
              </div>
              <IdentityFilesEditor
                value={hostDraft.identityFiles}
                disabled={busy || hostDraft.source === "config"}
                pickFile={bridge.desktop ? bridge.pickIdentityFile : undefined}
                onChange={(identityFiles) =>
                  setHostDraft(
                    (current) => current && { ...current, identityFiles },
                  )
                }
              />
              <Field label={t("authMethod")}>
                <Select
                  items={[
                    { value: "auto", label: t("authAuto") },
                    { value: "password", label: t("authPassword") },
                    { value: "privateKey", label: t("authPrivateKey") },
                    { value: "agent", label: t("authAgent") },
                  ]}
                  value={hostDraft.authMethod}
                  onValueChange={(authMethod) =>
                    authMethod &&
                    setHostDraft({
                      ...hostDraft,
                      authMethod: authMethod as Host["authMethod"],
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="auto">{t("authAuto")}</SelectItem>
                    <SelectItem value="password">
                      {t("authPassword")}
                    </SelectItem>
                    <SelectItem value="privateKey">
                      {t("authPrivateKey")}
                    </SelectItem>
                    <SelectItem value="agent" disabled={!data.agentSupported}>
                      {t("authAgent")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <details className="advanced-fields">
                <summary>{t("advanced")}</summary>
                <div className="advanced-content">
                  <ConnectionFields
                    value={hostDraft.connection}
                    onChange={(connection) =>
                      setHostDraft({ ...hostDraft, connection })
                    }
                  />
                  <div
                    className="field"
                    role="group"
                    aria-label={t("proxyJump")}
                  >
                    <JumpRouteEditor
                      hosts={managedHosts}
                      hostId={hostDraft.id}
                      value={hostDraft.proxyJump}
                      disabled={busy || hostDraft.source === "config"}
                      onChange={(proxyJump) =>
                        setHostDraft({ ...hostDraft, proxyJump })
                      }
                    />
                  </div>
                  <ParameterField
                    label={t("identityAgentTitle")}
                    parameter="-o IdentityAgent"
                    description={t("identityAgentHint")}
                  >
                    <Input
                      value={hostDraft.identityAgent || ""}
                      placeholder={t("systemDefault")}
                      onChange={(e) =>
                        setHostDraft({
                          ...hostDraft,
                          identityAgent: e.target.value || null,
                        })
                      }
                    />
                  </ParameterField>
                  <ParameterSwitch
                    label={t("identitiesOnlyTitle")}
                    parameter="-o IdentitiesOnly"
                    description={t("identitiesOnlyHint")}
                    checked={hostDraft.identitiesOnly}
                    onCheckedChange={(checked) =>
                      setHostDraft({
                        ...hostDraft,
                        identitiesOnly: checked,
                      })
                    }
                  />
                </div>
              </details>
            </fieldset>
            <HostTags
              hosts={managedHosts}
              value={hostDraft.tags}
              onChange={(tags) => setHostDraft({ ...hostDraft, tags })}
            />
            {hostDraft.source === "config" && (
              <p className="muted">{t("metadataHint")}</p>
            )}
            {duplicateHost && (
              <div className="path-preview">
                <p className="muted">
                  {t("duplicateHost")} {duplicateHost.name}
                </p>
                {hostFromRule && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (ruleDraft)
                        setRuleDraft({
                          ...ruleDraft,
                          hostId: duplicateHost.id,
                        });
                      closeHost();
                    }}
                  >
                    {t("useExistingHost")}
                  </Button>
                )}
              </div>
            )}
            <ModalActions>
              <Button type="button" variant="ghost" onClick={closeHost}>
                {t("cancel")}
              </Button>
              <Button
                type="submit" form="host-editor-form"
                variant="primary-soft"
                disabled={busy}
                onClick={(e) => {
                  if (e.currentTarget.form?.reportValidity()) {
                    e.preventDefault();
                    void saveHostDraft(true);
                  }
                }}
              >
                {t("saveTest")}
              </Button>
              <Button type="submit" form="host-editor-form" disabled={busy}>
                {t("save")}
              </Button>
            </ModalActions>
          </form>
        </Modal>
      )}
      {authId && (
        <Modal key="authentication"
          className="authentication-modal max-w-lg sm:max-w-lg"
          title={authTarget ? t("authForHost", { name: authTarget.name }) : t("auth")}
          description={t("authHelp")}
          close={() => {
            setAuthId(null);
            setSecret("");
            setJumpSecrets({});
          }}
        >
          <form id="authentication-form"
            onSubmit={(e) => {
              e.preventDefault();
              const id = authId;
              const once = secret;
              const jumps = jumpSecrets;
              const remember = rememberHostIds();
              setJumpSecrets({});
              setSecret("");
              setAuthId(null);
              void action(() =>
                authHostId
                  ? bridge.testHost(authHostId, once, jumps, remember)
                  : bridge.startRule(id, once, jumps, remember),
              );
            }}
          >
            {jumpHosts(data.hosts, authTarget).map((h) => (
              <AuthenticationField key={h.id} host={h} value={jumpSecrets[h.id] || ""}
                onChange={(value) => setJumpSecrets({ ...jumpSecrets, [h.id]: value })}
                remember={!!rememberPasswords[h.id]}
                onRemember={(value) => setRememberPasswords((old) => ({ ...old, [h.id]: value }))} />
            ))}
            {authTarget ? (
              <AuthenticationField
                host={authTarget}
                hideLabel
                value={secret}
                onChange={setSecret}
                remember={!!rememberPasswords[authTarget.id]}
                onRemember={(value) => setRememberPasswords((old) => ({ ...old, [authTarget.id]: value }))}
                actions={<Button type="submit" form="authentication-form" variant="primary-soft">{t("connect")}</Button>}
              />
            ) : (
              <ModalActions>
                <Button type="submit" form="authentication-form" variant="primary-soft">{t("connect")}</Button>
              </ModalActions>
            )}
          </form>
        </Modal>
      )}
      {pending && (
        <Modal key="trust"
          className="trust-modal max-w-lg sm:max-w-lg"
          title={
            <span className="inline-flex items-center gap-2">
              <ShieldCheckIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
              {t("trust")}
            </span>
          }
          description={t("trustHelp")}
          close={() => void stop(pending.ruleId)}
        >
          <div className="trust-details">
            <strong className="trust-host">{pending.verificationEndpoint}</strong>
            <code className="fingerprint">{pending.fingerprint}</code>
          </div>
          <ModalActions className="trust-actions">
            <Button
              variant="destructive"
              onClick={() => void stop(pending.ruleId)}
            >
              {t("trustReject")}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void action(() =>
                  bridge.trustHost(
                    pending.ruleId,
                    pending.runId,
                    pending.fingerprint!,
                  ),
                )
              }
            >
              {t("trustAccept")}
            </Button>
          </ModalActions>
        </Modal>
      )}
      </AnimatePresence>
    </div>
  );
}

function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="empty">
      <GraphStarIcon size={36} strokeWidth={1} />
      <h2>{title}</h2>
      {body && <p>{body}</p>}
    </div>
  );
}
function RunButton({
  runtime,
  start,
  stop,
}: {
  runtime?: Runtime;
  start: () => void;
  stop: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const active =
    runtime &&
    !["stopped", "failed", "needs-attention"].includes(runtime.status);
  return (
    <Button
      className="nodrag nopan"
      variant={active ? "destructive" : "primary-soft"}
      size="sm"
      onClick={active ? stop : start}
      aria-label={t(active ? "stop" : "start")}
    >
      {active ? <SquareIcon size={14} /> : <PlayIcon size={14} />}{" "}
      {t(active ? "stop" : "start")}
    </Button>
  );
}
function Hosts({
  data,
  busy,
  selected,
  setSelected,
  onEdit,
  onForward,
  onDelete,
  onCopy,
  onTest,
  onStopTest,
}: {
  data: Snapshot;
  busy: boolean;
  selected: string;
  setSelected: (s: string) => void;
  onEdit: (h: Host) => void;
  onForward: (id: string) => void;
  onTest: (id: string) => void;
  onStopTest: (id: string) => void;
  onDelete: (h: Host) => void;
  onCopy: (h: Host) => void;
}) {
  const { t } = useTranslation("tunnel");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const [grouping, setGrouping] = useState<HostGrouping>("tags");
  const list = data.hosts.filter(
    (h) =>
      (filter === "all" ||
        (filter === "errors"
          ? hostFilterStatus(
              h,
              data.runtimes.find(
                (runtime) => runtime.ruleId === `host-test:${h.id}`,
              ),
            )?.startsWith("status-")
          : hostFilterStatus(
              h,
              data.runtimes.find(
                (runtime) => runtime.ruleId === `host-test:${h.id}`,
              ),
            ) === filter)) &&
      `${h.name} ${h.address} ${h.port} ${h.user} ${h.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const host = data.hosts.find((h) => h.id === selected);
  const hostReferences = (h: Host) =>
    data.rules.filter(
      (r) =>
        r.hostId === h.id ||
        jumpHosts(
          data.hosts,
          data.hosts.find((h) => h.id === r.hostId),
        ).some((jump) => jump.id === h.id),
    );
  const references = host ? hostReferences(host) : [];
  const testRuntime = data.runtimes.find(
    (r) => r.ruleId === "host-test:" + host?.id,
  );
  return (
    <ScrollArea
      className="page-scroll-area"
      viewportClassName="page hosts-page scroll-fade"
    >
      <header className="hosts-page-heading">
        <h1>{t("hosts")}</h1>
        <span aria-live="polite">{t("hostCount", { count: list.length })}</span>
      </header>
      <HostToolbar
        query={query}
        filter={filter}
        grouping={grouping}
        onQuery={setQuery}
        onFilter={setFilter}
        onGrouping={setGrouping}
      />
      {!list.length ? (
        <Empty
          title={t(data.hosts.length ? "emptyResult" : "noHosts")}
          body={t("noHostsBody")}
        />
      ) : (
        <HostGroups
          hosts={list}
          runtimes={data.runtimes}
          grouping={grouping}
          selected={host?.id}
          actions={(h, runtime) => {
            const testing =
              !!runtime &&
              !["tested", "failed", "stopped", "needs-attention"].includes(
                runtime.status,
              );
            const usedAsJump = data.hosts.some(
              (other) =>
                other.id !== h.id &&
                jumpHosts(data.hosts, other).some((jump) => jump.id === h.id),
            );
            const disabled = busy || !bridge.desktop;
            return (
              <>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${t("details")} ${h.name}`}
                  aria-haspopup="dialog"
                  title={t("details")}
                  onClick={() => setSelected(h.id)}
                >
                  <InfoIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`${t("edit")} ${h.name}`}
                  title={t("edit")}
                  onClick={() => onEdit(h)}
                >
                  <Settings2Icon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20"
                  disabled={disabled || usedAsJump || testing}
                  aria-label={`${t("delete")} ${h.name}`}
                  title={t(usedAsJump ? "hostUsedAsJump" : "delete")}
                  onClick={() => onDelete(h)}
                >
                  <Trash2Icon />
                </Button>
                <HostTestButton
                  hostName={h.name}
                  runtime={runtime}
                  disabled={disabled || (!!h.diagnostics.length && !testing)}
                  onTest={() => onTest(h.id)}
                  onStop={() => onStopTest(h.id)}
                />
              </>
            );
          }}
        />
      )}
      <AnimatePresence>
      {host && (
        <Modal key={host.id} title={host.name} close={() => setSelected("")}>
          <div className="host-detail">
            <div className="host-detail-badges">
              <span className="source-badge">
                {t(hostAuthLabels[host.authMethod])}
              </span>
              {testRuntime ? (
                <Status runtime={testRuntime} />
              ) : (
                <span className="status">
                  <i />
                  {t("untested")}
                </span>
              )}
            </div>
            {testRuntime?.message && (
              <p
                className={
                  testRuntime.status === "tested"
                    ? "host-test-success"
                    : "inline-error"
                }
              >
                {testRuntime.message}
              </p>
            )}
            <dl>
              <dt>{t("address")}</dt>
              <dd>
                {host.address}:{host.port}
              </dd>
              <dt>{t("user")}</dt>
              <dd>{host.user}</dd>
              <dt>{t("authMethod")}</dt>
              <dd>
                {t(
                  {
                    auto: "authAuto",
                    password: "authPassword",
                    privateKey: "authPrivateKey",
                    agent: "authAgent",
                  }[host.authMethod],
                )}
              </dd>
              <dt>{t("proxyJump")}</dt>
              <dd>
                {jumpHosts(data.hosts, host)
                  .map((h) => h.name)
                  .join(" → ") ||
                  host.proxyJump ||
                  t("directConnection")}
              </dd>
              <dt>{t("identityAgentTitle")}</dt>
              <dd>{host.identityAgent || t("systemDefault")}</dd>
              <dt>{t("tags")}</dt>
              <dd>{host.tags.join(", ") || "—"}</dd>
              <dt>{t("connectTimeout")}</dt>
              <dd>{host.connection.connectTimeoutSecs}</dd>
              <dt>{t("keepaliveInterval")}</dt>
              <dd>{host.connection.keepaliveIntervalSecs}</dd>
              <dt>{t("keepaliveMax")}</dt>
              <dd>{host.connection.keepaliveMax}</dd>
              <dt>{t("identity")}</dt>
              <dd>{host.identityFiles.join("\n") || "—"}</dd>
              {host.sourceFile && (
                <>
                  <dt>{t("source")}</dt>
                  <dd>{host.sourceFile}</dd>
                </>
              )}
            </dl>
            {!!Object.keys(host.fieldSources || {}).length && (
              <details className="advanced-fields">
                <summary>{t("fieldSources")}</summary>
                <dl>
                  {Object.entries(host.fieldSources || {}).map(
                    ([field, source]) => (
                      <div key={field}>
                        <dt>{field}</dt>
                        <dd>{source}</dd>
                      </div>
                    ),
                  )}
                </dl>
              </details>
            )}
            {!!host.configuredForwards?.length && (
              <details className="advanced-fields">
                <summary>{t("sourceForwards")}</summary>
                <p className="muted">{t("sourceForwardsHint")}</p>
                {host.configuredForwards.map((forward, index) => (
                  <p key={index} className="muted">
                    {forward}
                  </p>
                ))}
              </details>
            )}
            {host.source === "config" && (
              <p className="muted">{t("sourceHint")}</p>
            )}
            {!!host.unsupportedSessionOptions?.length && (
              <p className="muted">{t("sessionOptionsHint", { options: host.unsupportedSessionOptions.join(", ") })}</p>
            )}
            {host.diagnostics.map((d, i) => (
              <p className="inline-error" key={i}>
                {d}
              </p>
            ))}
            {!!references.length && (
              <p className="muted">
                {t("deleteHostHint")} {references.map((r) => r.name).join("、")}
              </p>
            )}
            <div className="host-detail-actions">
              {host.source === "config" && (
                <Button
                  variant="ghost"
                  disabled={
                    busy ||
                    !bridge.desktop ||
                    host.diagnostics.some((d) => !d.includes("来源已失效"))
                  }
                  onClick={() => onCopy(host)}
                >
                  {t("copyHost")}
                </Button>
              )}
              <Button
                disabled={busy || !bridge.desktop || !!host.diagnostics.length}
                onClick={() => {
                  onForward(host.id);
                  setSelected("");
                }}
              >
                <GitPullRequestCreateArrowIcon />
                {t("createForward")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      </AnimatePresence>
    </ScrollArea>
  );
}

type CardData = {
  onOpenService: (id: string) => void;
  onPortMove: (
    id: string,
    value: PortPlacement | null,
    commit: boolean,
  ) => void;
  onDetails: (rule: Rule) => void;
  onCopy: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  local: boolean;
  ports: CardPort[];
  rules?: Rule[];
  host?: Host;
  runtimes?: Runtime[];
  count?: number;
  onStart: (id: string) => void;
  onStop: (id: string) => unknown;
  onEdit: (rule: Rule) => void;
};
type CardNode = Node<CardData, "card">;
type CardPort = {
  custom?: PortPlacement;
  ruleId: string;
  side: Position;
  type: "source" | "target";
  label: string;
  name: string;
  color: string;
};
function CardPorts({
  ports,
  local = false,
  labels = true,
  onMove,
  onDragChange,
}: {
  ports: CardPort[];
  local?: boolean;
  labels?: boolean;
  onMove?: CardData["onPortMove"];
  onDragChange?: (dragging: boolean) => void;
}) {
  return ports.map((port) => {
    const peers = ports.filter((item) => item.side === port.side);
    const index = peers.indexOf(port);
    if (local && onMove && onDragChange)
      return (
        <LocalPortHandle
          key={port.ruleId}
          port={port}
          offset={port.custom?.offset ?? (index + 1) / (peers.length + 1)}
          onChange={onMove}
          onDragChange={onDragChange}
        />
      );
    const horizontal =
      port.side === Position.Top || port.side === Position.Bottom;
    const offset = `${((index + 1) / (peers.length + 1)) * 100}%`;
    const placement: CSSProperties =
      local && horizontal ? { left: offset } : { top: local ? offset : "50%" };
    return (
      <Handle
        key={port.ruleId}
        id={canvasPortId(port.ruleId, port.type)}
        type={port.type}
        position={port.side}
        className="connection-port"
        title={`${port.name} · ${port.label}`}
        style={
          {
            ...placement,
            "--connection-color": port.color,
          } as CSSProperties
        }
      >
        {labels && <span className="connection-port-label">{port.label}</span>}
      </Handle>
    );
  });
}
function Card({ id, data: d }: NodeProps<CardNode>) {
  const { t } = useTranslation("tunnel");
  // Opacity only: transforms belong to React Flow and port measurement.
  const entrance = useEntranceMotion(0);
  const updateInternals = useUpdateNodeInternals();
  const [portDragSize, setPortDragSize] = useState<ReturnType<
    typeof localCardSize
  > | null>(null);
  const portLayout = d.ports
    .map(
      (port) =>
        `${port.ruleId}:${port.type}:${port.side}:${port.custom?.offset ?? "auto"}`,
    )
    .join("|");
  useLayoutEffect(() => {
    updateInternals(id);
  }, [id, portLayout, updateInternals]);
  if (d.local)
    return (
      <motion.article
        className="tunnel-card themed-surface local-card"
        {...entrance}
        style={portDragSize || localCardSize(d.ports)}
        aria-label={`${t("local")} · ${d.count || 0} ${t("tunnels")}`}
      >
        <CardPorts
          ports={d.ports}
          local
          onMove={d.onPortMove}
          onDragChange={(dragging) =>
            setPortDragSize(dragging ? localCardSize(d.ports) : null)
          }
        />
        <div className="local-computer" aria-hidden="true">
          <MonitorIcon />
          <strong>{d.count || 0}</strong>
        </div>
        <span className="local-card-title">{t("local")}</span>
      </motion.article>
    );
  return (
    <motion.article className="tunnel-card themed-surface host-card" {...entrance}>
      <div className="card-heading">
        <span className="card-icon">
          <ServerIcon size={21} />
        </span>
        <div className="host-card-heading-content">
          <div className="host-card-heading-row">
            <span className="eyebrow">SSH HOST</span>
            {d.host && (
              <code title={`${d.host.user}@${d.host.address}:${d.host.port}`}>
                {d.host.user}@{d.host.address}:{d.host.port}
              </code>
            )}
          </div>
          <div className="host-card-heading-row">
            <h2 title={d.host?.name || t("sourceMissing")}>
              {d.host?.name || t("sourceMissing")}
            </h2>
            <span className="source-badge">
              {d.rules?.length || 0} {t("tunnels")}
            </span>
          </div>
        </div>
      </div>
      <>
        <div className="host-card-rules">
          {d.rules?.map((rule) => {
            const runtime = d.runtimes?.find((item) => item.ruleId === rule.id);
            return (
              <section
                className="host-card-rule"
                key={rule.id}
                aria-label={rule.name}
                style={
                  {
                    "--connection-color":
                      rule.color || "var(--oria-color-accent)",
                  } as CSSProperties
                }
              >
                <div className="host-rule-heading">
                  <strong className="rule-name">
                    <ConnectionIcon icon={rule.icon} color={rule.color} />
                    <span title={rule.name}>{rule.name}</span>
                  </strong>
                  <Status runtime={runtime} />
                </div>
                <div className="host-rule-meta">
                  <small title={t(`type${rule.kind}`)}>
                    {t(`type${rule.kind}`)}
                  </small>
                  <small className="host-rule-traffic">
                    ↑ {bytes(runtime?.sent || 0)}　↓{" "}
                    {bytes(runtime?.received || 0)}
                  </small>
                </div>
                <div className="port-path">
                  <CardPorts
                    ports={d.ports.filter((p) => p.ruleId === rule.id)}
                    labels={false}
                  />
                  <code>
                    {rule.bindAddress}:
                    <span
                      className={
                        rule.kind === "R" ? "connection-port-number" : undefined
                      }
                    >
                      {rule.bindPort}
                    </span>
                  </code>
                  <ArrowRightIcon size={14} />
                  <code>
                    {rule.kind === "D" ? (
                      <>
                        SOCKS5 · SSH{" "}
                        <span className="connection-port-number">
                          {d.host?.port || 22}
                        </span>
                      </>
                    ) : (
                      <>
                        {rule.targetHost}:
                        <span
                          className={
                            rule.kind === "L"
                              ? "connection-port-number"
                              : undefined
                          }
                        >
                          {rule.targetPort}
                        </span>
                      </>
                    )}
                  </code>
                  <OpenServiceButton
                    rule={rule}
                    runtime={runtime}
                    desktop={bridge.desktop}
                    onOpen={d.onOpenService}
                  />
                </div>
                {runtime?.configurationChanged && (
                  <p className="muted">{t("configUpdated")}</p>
                )}
                {runtime?.message && (
                  <p className="inline-error">{runtime.message}</p>
                )}
                <div className="card-footer">
                  <RuleActions
                    rule={rule}
                    onDetails={d.onDetails}
                    onEdit={d.onEdit}
                    onCopy={d.onCopy}
                    onDelete={d.onDelete}
                  >
                    <RunButton
                      runtime={runtime}
                      start={() => d.onStart(rule.id)}
                      stop={() => void d.onStop(rule.id)}
                    />
                  </RuleActions>
                </div>
              </section>
            );
          })}
        </div>
      </>
    </motion.article>
  );
}
const nodeTypes = { card: Card };
const edgeTypes = { connection: ConnectionEdge };
function TunnelCanvas({
  data,
  onOpenService,
  onStart,
  onStop,
  onEdit,
  onDetails,
  onCopy,
  onDelete,
  focusRuleId,
  onFocusDone,
}: {
  data: Snapshot;
  onOpenService: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => unknown;
  onEdit: (rule: Rule) => void;
  onDetails: (rule: Rule) => void;
  onCopy: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  focusRuleId: string;
  onFocusDone: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const flow = useReactFlow<CardNode>();
  const nodesReady = useNodesInitialized();
  useEffect(() => {
    if (
      focusRuleId &&
      nodesReady &&
      data.rules.some((r) => r.id === focusRuleId)
    ) {
      void flow
        .fitView({
          nodes: [
            {
              id: `host:${data.rules.find((r) => r.id === focusRuleId)!.hostId}`,
            },
          ],
          padding: 0.5,
          maxZoom: 1,
          duration: 200,
        })
        .then(onFocusDone);
    }
  }, [focusRuleId, nodesReady, data.rules, flow, onFocusDone]);
  const [initialViewport] = useState<Viewport | undefined>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("oria-tunnel-viewport") || "null",
      );
      return value &&
        Number.isFinite(value.x) &&
        Number.isFinite(value.y) &&
        value.zoom >= 0.2 &&
        value.zoom <= 2
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  });
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("oria-tunnel-layout") || "{}");
    } catch {
      return {};
    }
  });
  const [portPlacements, setPortPlacements] = useState(() => {
    try {
      return readPortPlacements(localStorage.getItem(PORT_LAYOUT_KEY));
    } catch {
      return {};
    }
  });
  const latestPortPlacements = useRef(portPlacements);
  const onPortMove = useCallback<CardData["onPortMove"]>(
    (id, value, commit) => {
      const next = { ...latestPortPlacements.current };
      if (value) next[id] = value;
      else delete next[id];
      latestPortPlacements.current = next;
      setPortPlacements(next);
      if (commit) {
        try {
          localStorage.setItem(PORT_LAYOUT_KEY, JSON.stringify(next));
        } catch (error) {
          console.error("Unable to save local port layout", error);
        }
      }
    },
    [],
  );
  const projectedNodes = useMemo<CardNode[]>(() => {
    const groups = groupRulesByHost(data.rules, data.hosts);
    const layout = groupPositions(groups, positions);
    const localPorts: CardPort[] = [];
    const hostPorts: Record<string, CardPort[]> = {};
    for (const group of groups) {
      const hostSide =
        layout[group.id].x < (positions.local?.x || 0)
          ? Position.Right
          : Position.Left;
      hostPorts[group.id] = group.rules.map((rule) => {
        const labels = connectionPorts(rule, group.host?.port);
        const color = rule.color || "var(--oria-color-accent)";
        localPorts.push({
          custom: portPlacements[rule.id],
          ruleId: rule.id,
          name: rule.name,
          label: labels.local,
          color,
          side:
            portPlacements[rule.id]?.side ||
            localPortSide(positions.local || { x: 0, y: 0 }, layout[group.id]),
          type: rule.kind === "R" ? "target" : "source",
        });
        return {
          ruleId: rule.id,
          name: rule.name,
          label: labels.host,
          color,
          side: hostSide,
          type: rule.kind === "R" ? "source" : "target",
        };
      });
    }
    return [
      {
        id: "local",
        type: "card",
        position: positions.local || { x: 0, y: 0 },
        data: {
          local: true,
          onPortMove,
          onOpenService,
          onDetails,
          onCopy,
          onDelete,
          ports: localPorts,
          count: data.rules.length,
          onStart,
          onStop,
          onEdit,
        },
      },
      ...groups.map((group) => ({
        id: group.id,
        type: "card" as const,
        position: layout[group.id],
        data: {
          local: false,
          onPortMove,
          onOpenService,
          onDetails,
          onCopy,
          onDelete,
          ports: hostPorts[group.id],
          rules: group.rules,
          host: group.host,
          runtimes: data.runtimes,
          onStart,
          onStop,
          onEdit,
        },
      })),
    ];
  }, [
    data,
    positions,
    portPlacements,
    onPortMove,
    onOpenService,
    onStart,
    onStop,
    onEdit,
    onDetails,
    onCopy,
    onDelete,
  ]);
  const [nodes, setNodes] = useState<CardNode[]>(projectedNodes);
  useLayoutEffect(() => {
    setNodes((current) => reconcileCanvasNodes(current, projectedNodes));
  }, [projectedNodes]);
  const edges = useMemo<Edge[]>(
    () =>
      data.rules.map((rule) => {
        const runtime = data.runtimes.find((r) => r.ruleId === rule.id);
        const hostId = `host:${rule.hostId}`;
        const visual = connectionVisual(rule, runtime);
        return {
          id: rule.id,
          source: rule.kind === "R" ? hostId : "local",
          target: rule.kind === "R" ? "local" : hostId,
          sourceHandle: canvasPortId(rule.id, "source"),
          targetHandle: canvasPortId(rule.id, "target"),
          type: "connection",
          data: { state: visual.state },
          markerEnd: { type: MarkerType.ArrowClosed, color: visual.color },
          className: `connection-edge connection-${visual.state}`,
          style: { strokeWidth: 1.5, stroke: visual.color },
        };
      }),
    [data.rules, data.runtimes],
  );
  return (
    <div className="canvas">
      {!data.rules.length && (
        <div className="canvas-hint">
          <span className="eyebrow">OriaTunnel</span>
          <p>{t("empty")}</p>
        </div>
      )}
      <div className="canvas-mask">
        <ReactFlow<CardNode>
          nodes={nodes}
          defaultViewport={initialViewport}
          onMoveEnd={(_, viewport) => {
            try {
              localStorage.setItem(
                "oria-tunnel-viewport",
                JSON.stringify(viewport),
              );
            } catch (error) {
              console.error("Unable to save canvas viewport", error);
            }
          }}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={(changes) => {
            setNodes((current) => applyNodeChanges(changes, current));
            if (
              changes.some(
                (change) =>
                  change.type === "position" &&
                  change.position &&
                  !change.dragging,
              )
            ) {
              const next = canvasLayout(
                applyNodeChanges(changes, flow.getNodes()),
                positions,
              );
              setPositions(next);
              try {
                localStorage.setItem(
                  "oria-tunnel-layout",
                  JSON.stringify(next),
                );
              } catch (error) {
                console.error("Unable to save canvas layout", error);
              }
            }
          }}
          onNodeDoubleClick={(_, node) =>
            void flow.fitView({
              nodes: [{ id: node.id }],
              padding: 0.5,
              duration: 200,
              maxZoom: 1,
            })
          }
          onEdgeClick={(_, edge) => {
            const rule = data.rules.find((r) => r.id === edge.id);
            if (rule) onEdit(rule);
          }}
          zoomOnDoubleClick={false}
          onDoubleClick={(e) => {
            if (
              (e.target as HTMLElement).classList.contains("react-flow__pane")
            )
              void flow.fitView({ padding: 0.25, duration: 200, maxZoom: 1 });
          }}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          minZoom={0.2}
          maxZoom={2}
          fitView={!initialViewport}
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        >
          <Background gap={24} size={1} />
        </ReactFlow>
      </div>
      <div className="canvas-controls overlay">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("zoomOut")}
          onClick={() => void flow.zoomOut()}
        >
          <ZoomOutIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("fit")}
          onClick={() => void flow.fitView({ padding: 0.25, maxZoom: 1 })}
        >
          <MaximizeIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("zoomIn")}
          onClick={() => void flow.zoomIn()}
        >
          <ZoomInIcon />
        </Button>
      </div>
    </div>
  );
}
