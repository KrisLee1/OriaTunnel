import { formatUiError } from "@/lib/ui-message";
import {
  serviceRules,
  serviceHostIds,
  groupServicesByHost,
  hostServiceTarget,
  serviceTarget,
  resolveTrayServiceRequest,
  type TrayServiceRequest,
} from "./service-target";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ConnectionIcon,
  ConnectionIconPicker,
} from "@/features/tunnels/connection-icon";
import { ConnectionColorPicker } from "@/features/tunnels/connection-color";
import { ServicePicker, ServiceHostPicker } from "./service-picker";
import { ServiceIconStrip } from "./service-icon-strip";
import { ServiceRunningContext } from "./service-running-context";
import { addedHosts } from "@/features/hosts/host-collection";
import {
  CommandInvocationEditor,
  renderInvocation,
  normalizeInvocation,
  CommandEnvironmentEditor,
  isStructuredCommand,
  actionScript,
  editActionScript,
  editActionEnvironment,
  switchActionFormat,
} from "./command-invocation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ConfigExportDialog } from "@/features/tunnels/config-export";
import { ImportConfig } from "@/features/tunnels/import-config";
import { ServiceEnableDialog, ServiceReview } from "./service-review";
import { ServiceTemplateDialog } from "./service-template";
import {
  fillServiceTemplate,
  serviceTemplateCategories,
  serviceCategory,
} from "./service-template-catalog";
import {
  OpenTerminalButton,
  useTerminalWorkspace,
} from "@/features/terminal/terminal-workspace";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence } from "motion/react";
import {
  ListChecksIcon,
  SearchIcon,
  FileInputIcon,
  FileOutputIcon,
  CopyPlusIcon,
  InfoIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  PlusIcon,
  Trash2Icon,
  Settings2Icon,
  BoxesIcon,
  PlayIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Modal,
  ModalActions,
  ModalTitleActions,
} from "@/components/tunnel-form";
import { AuthenticationField } from "@/features/hosts/authentication-field";
import { jumpHosts } from "@/features/tunnels/rule-model";
import * as bridge from "@/lib/bridge";
import type {
  CommandEvent,
  CommandRun,
  Host,
  PresetAction,
  RemoteService,
  Snapshot,
} from "@/types";
import {
  commandActive,
  commandKinds,
  copyService,
  mergeRuns,
  newAction,
  changeActionKind,
  newService,
  OutputDecoder,
  reviewScript,
} from "./command-model";

import {
  CredentialRetry,
  ControlEditor,
  ServiceState,
  ServiceOperations,
  useServiceObservations,
} from "./service-controls";
import type { ServiceOperation } from "@/types";

interface Filter {
  hostId?: string;
  ruleId?: string;
}
interface ServiceUI {
  data: Pick<Snapshot, "rules">;
  assignHost: (id: string, services: string[]) => Promise<void>;
  running: (service: RemoteService, targetId?: string) => boolean;
  open: (filter: Filter) => void;
  content: ReactNode;
  count: number;
  create: () => void;
  canCreate: boolean;
  services: RemoteService[];
  disabled: (service: RemoteService, ruleId?: string) => boolean;
  execute: (
    service: RemoteService,
    action: PresetAction,
    ruleId?: string,
  ) => void;
}
const Context = createContext<ServiceUI | null>(null);
export function AddServiceButton() {
  const ui = useContext(Context);
  const { t } = useTranslation("commands");
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={t("addService")}
      title={t("addService")}
      disabled={!ui?.canCreate}
      onClick={() => ui?.create()}
    >
      <PlusIcon aria-hidden="true" />
    </Button>
  );
}
export function ServicesPage() {
  const ui = useContext(Context);
  const { t } = useTranslation("commands");
  return (
    <ScrollArea
      className="page-scroll-area"
      viewportClassName="page services-page scroll-fade"
    >
      <header className="services-page-heading">
        <h1>{t("services")}</h1>
        <span aria-live="polite">
          {t("serviceCount", { count: ui?.count ?? 0 })}
        </span>
      </header>
      {ui?.content}
    </ScrollArea>
  );
}
export const ServiceCommandsButton = memo(function ServiceCommandsButton({
  hostId,
  ruleId,
  showName = false,
}: Filter & { showName?: boolean }) {
  const ui = useContext(Context);
  const workspace = useTerminalWorkspace();
  const { t } = useTranslation("commands");
  if (!ui) return null;
  const services = ui.services.filter((s) =>
    ruleId
      ? s.ruleIds.includes(ruleId)
      : hostId
        ? serviceHostIds(s, ui.data).includes(hostId)
        : false,
  );
  if (!services.length) return null;
  const targetId = ruleId || (hostId ? hostServiceTarget(hostId) : undefined);
  return (
    <div className="service-command-icons inline-flex flex-wrap items-center gap-1 nodrag nopan">
      {services.map((service) => {
        const foreground = workspace?.foregroundSession(service, targetId);
        const running = ui.running(service, targetId);
        const color = running
          ? service.color || "var(--oria-color-accent)"
          : "var(--oria-color-muted-fg)";
        const icon = (
          <span
            className="inline-flex shrink-0"
            style={{
              filter: running ? undefined : "grayscale(1)",
              opacity: running ? 1 : 0.7,
            }}
          >
            <ConnectionIcon icon={service.icon} color={color} />
          </span>
        );
        const terminalStop =
          foreground ||
          (service.actions.some(
            (a) => a.kind === "start" && a.mode === "terminal",
          ) &&
            !service.actions.some((a) => a.kind === "stop"));
        return (
          <DropdownMenu key={service.id}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size={showName ? "sm" : "icon-sm"}
                  variant="ghost"
                  className="nodrag nopan"
                  aria-label={`${t("services")} ${service.name}`}
                  title={service.name}
                  disabled={!bridge.desktop}
                />
              }
            >
              {icon}
              {showName && <span>{service.name}</span>}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-48" align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-center gap-2">
                  {icon}
                  <span>{service.name}</span>
                </DropdownMenuLabel>
                {service.actions
                  .filter((a) => !(foreground && a.kind === "stop"))
                  .map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      disabled={ui.disabled(service, targetId)}
                      onClick={() => ui.execute(service, action, targetId)}
                    >
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                {terminalStop && (
                  <DropdownMenuItem
                    disabled={!bridge.desktop || !foreground || workspace?.busy}
                    onClick={() =>
                      void workspace?.stopService(service, targetId)
                    }
                  >
                    {t("kind.stop")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => ui.open({ hostId, ruleId })}>
                {t("manageServices")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </div>
  );
});

export const HostServices = memo(function HostServices({
  hostId,
}: {
  hostId: string;
}) {
  const ui = useContext(Context);
  const { t } = useTranslation("commands");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const serviceCount = (ui?.services || []).filter(
    (s) => ui && serviceHostIds(s, ui.data).includes(hostId),
  ).length;
  if (!ui) return null;
  return (
    <>
      <ServiceIconStrip
        className="host-card-services"
        count={serviceCount}
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("manageServices")}
            title={t("manageServices")}
            disabled={!bridge.desktop}
            onClick={() => {
              setSelected(
                ui.services
                  .filter((s) => serviceHostIds(s, ui.data).includes(hostId))
                  .map((s) => s.id),
              );
              setEditing(true);
            }}
          >
            <BoxesIcon aria-hidden="true" />
          </Button>
        }
      >
        <ServiceCommandsButton hostId={hostId} />
      </ServiceIconStrip>
      {editing && (
        <Modal title={t("manageServices")} close={() => setEditing(false)}>
          <ServicePicker
            services={ui.services}
            value={selected}
            onChange={setSelected}
            disabled={busy}
          />
          <ModalActions>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void ui
                  .assignHost(hostId, selected)
                  .then(() => setEditing(false))
                  .catch((e) =>
                    toast.add({ title: formatUiError(e, t), type: "error" }),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {t("save")}
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  );
});

export function PresetCommandProvider({
  data,
  onSnapshot,
  children,
  page = false,
}: {
  data: Snapshot;
  onSnapshot: (data: Snapshot) => void;
  children: ReactNode;
  page?: boolean;
}) {
  const { t } = useTranslation("commands");
  const workspace = useTerminalWorkspace();
  const [sharing, setSharing] = useState<RemoteService[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [reviewing, setReviewing] = useState<RemoteService | null>(null);
  const [inspectingService, setInspectingService] =
    useState<RemoteService | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const listId = useId();
  const [runs, setRuns] = useState<CommandRun[]>([]);
  const observations = useServiceObservations(true);
  const [selectedRun, setSelectedRun] = useState("");
  const [editing, setEditing] = useState<RemoteService | null>(null);
  const [intent, setIntent] = useState<{
    service: RemoteService;
    action: PresetAction;
    fallback?: boolean;
    operation?: ServiceOperation;
    ruleId?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<RemoteService[] | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const submissions = useRef(new Map<string, string>());
  const knownRuns = useRef(new Map<string, CommandRun>());
  const automaticAuthRuns = useRef(new Set<string>());
  const translate = useRef(t);
  translate.current = t;
  const merge = useCallback((next: CommandRun[]) => {
    for (const run of next) {
      const before = knownRuns.current.get(run.id);
      if (before && before.revision > run.revision) continue;
      if (before && commandActive(before) && !commandActive(run))
        toast.add({
          id: run.id,
          title: `${run.actionLabel.startsWith("$") ? translate.current(`service.${run.actionLabel.slice(1)}`) : run.actionLabel} · ${translate.current(`phase.${run.phase}`)}`,
          description: run.endpoint,
          type: run.phase === "succeeded" ? "success" : "error",
          timeout: 5000,
        });
      knownRuns.current.set(run.id, run);
    }
    setRuns((old) => mergeRuns(old, next));
  }, []);
  const acceptRun = useCallback((run: CommandRun) => merge([run]), [merge]);
  useEffect(() => {
    if (!bridge.desktop) return;
    let live = true;
    const sub = listen<CommandRun[]>("command://runs", (e) => {
      if (live) merge(e.payload);
    });
    void sub
      .then(() => bridge.commandRuns())
      .then((next) => {
        if (live) merge(next);
      })
      .catch(() => {});
    return () => {
      live = false;
      void sub.then((off) => off()).catch(() => {});
    };
  }, [merge]);
  const open = useCallback((next: Filter) => {
    setFilter(next);
    setEditing(null);
    setError("");
    setSelectedRun("");
  }, []);
  useEffect(() => {
    if (!bridge.desktop) return;
    let live = true;
    const subscription = listen("tunnel://open-service-commands", () => {
      if (live) open({});
    });
    return () => {
      live = false;
      void subscription.then((off) => off()).catch(() => {});
    };
  }, [open]);
  const services = (data.services || []).filter((s) =>
    filter?.ruleId
      ? s.ruleIds.includes(filter?.ruleId)
      : filter?.hostId
        ? serviceHostIds(s, data).includes(filter.hostId)
        : true,
  );
  const targetFor = (service: RemoteService, ruleId?: string) =>
    serviceTarget(
      service,
      data,
      ruleId ||
        filter?.ruleId ||
        (filter?.hostId
          ? hostServiceTarget(filter.hostId)
          : targets[service.id]),
    );
  const visibleServices = services.filter((service) => {
    if (!page || filter) return true;
    return (
      (categoryFilter === "all" ||
        serviceCategory(service) === categoryFilter) &&
      `${service.name} ${service.actions.map((a) => a.label).join(" ")} ${t(serviceCategory(service) === "other" ? "categoryOther" : `templates.groups.${serviceCategory(service)}`)}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
    );
  });
  const routeFor = (service: RemoteService, ruleId?: string) => {
    const target = targetFor(service, ruleId);
    const host = data.hosts.find((h) => h.id === target?.hostId);
    return host ? [...jumpHosts(data.hosts, host), host] : [];
  };
  const operationAction = (
    service: RemoteService,
    operation: ServiceOperation,
  ): PresetAction => ({
    id: `$${operation}`,
    kind: operation === "connect" ? "start" : "status",
    label: t(`service.${operation}`),
    command: [
      operation !== "checkHealth" &&
        service.actions.find(
          (a) => a.id === service.control?.statusProbe?.actionId,
        )?.command,
      operation === "connect" &&
        service.actions.find((a) => a.id === service.control?.startActionId)
          ?.command,
      operation !== "checkStatus" && service.control?.healthProbe?.command,
    ]
      .filter(Boolean)
      .join("\n\n"),
    timeoutSecs: 60,
    successCodes: [0],
    confirm: operation === "connect",
  });
  const perform = async (fn: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      const key = String(e);
      setError(key);
      if (!filter && !page)
        toast.add({ title: formatUiError(key, t), type: "error" });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const start = async (
    service: RemoteService,
    action: PresetAction,
    values: Record<string, string>,
    saved: Record<string, boolean>,
    operation?: ServiceOperation,
    ruleId?: string,
  ) => {
    await perform(async () => {
      if (action.mode === "terminal" && workspace) {
        await workspace.openPreset(
          service,
          action,
          values,
          Object.keys(saved).filter((id) => saved[id]),
          ruleId,
        );
        setFilter(null);
        setIntent(null);
        setSecrets({});
        setRemember({});
        return;
      }
      const key = `${service.id}:${service.revision}:${action.id}:${ruleId || ""}`;
      const requestId = submissions.current.get(key) || crypto.randomUUID();
      submissions.current.set(key, requestId);
      const run = operation
        ? await bridge.runServiceOperation({
            serviceId: service.id,
            revision: service.revision,
            requestId,
            operation,
            ruleId,
            confirmed: true,
            secrets: values,
            rememberHostIds: Object.keys(saved).filter((id) => saved[id]),
          })
        : await bridge.startCommand({
            serviceId: service.id,
            actionId: action.id,
            ruleId,
            revision: service.revision,
            requestId,
            confirmed: true,
            secrets: values,
            rememberHostIds: Object.keys(saved).filter((id) => saved[id]),
          });
      submissions.current.delete(key);
      if (!workspace) automaticAuthRuns.current.add(run.id);
      merge([run]);
      setSelectedRun(run.id);
      if (workspace) {
        workspace.showCommand(run);
        setFilter(null);
      }
      setIntent(null);
      setSecrets({});
      setRemember({});
    });
  };
  const execute = (
    service: RemoteService,
    action: PresetAction,
    override?: string,
  ) => {
    const ruleId = targetFor(service, override)?.id;
    if (!ruleId) {
      setError("serviceTargetRequired");
      return;
    }
    setError("");
    setSecrets({});
    setRemember({});
    if (
      action.confirm ||
      routeFor(service, ruleId).some((h) => h.authMethod === "password")
    )
      setIntent({ service, action, ruleId });
    else void start(service, action, {}, {}, undefined, ruleId);
  };
  const executeOperation = (
    service: RemoteService,
    operation: ServiceOperation,
    ruleId?: string,
  ) => {
    setError("");
    setSecrets({});
    setRemember({});
    ruleId = targetFor(service, ruleId)?.id;
    if (!ruleId) {
      setError("serviceTargetRequired");
      return;
    }
    const action = operationAction(service, operation);
    if (
      operation === "connect" ||
      routeFor(service, ruleId).some((h) => h.authMethod === "password")
    )
      setIntent({ service, action, operation, ruleId });
    else void start(service, action, {}, {}, operation, ruleId);
  };
  const selected = runs.find((r) => r.id === selectedRun);
  const retryService =
    selected &&
    (data.services || []).find(
      (s) =>
        s.id === selected.serviceId && s.revision === selected.serviceRevision,
    );
  const retryOperation: ServiceOperation | undefined =
    selected?.actionId.startsWith("$connect:")
      ? "connect"
      : selected?.actionId === "$status"
        ? "checkStatus"
        : selected?.actionId === "$health"
          ? "checkHealth"
          : undefined;
  const retryAction =
    retryService && retryOperation
      ? operationAction(retryService, retryOperation)
      : retryService?.actions.find((a) => a.id === selected?.actionId);
  const trust = runs.find(
    (r) => r.phase === "verifying-host" && commandActive(r) && r.fingerprint,
  );
  const close = () => {
    setFilter(null);
    setEditing(null);
    setIntent(null);
    setDeleting(null);
    setSecrets({});
    setRemember({});
    setError("");
  };
  const isDisabled = (service: RemoteService, ruleId?: string) => {
    const target = targetFor(service, ruleId);
    const host = data.hosts.find((h) => h.id === target?.hostId);
    return (
      !bridge.desktop ||
      busy ||
      !!workspace?.serviceBusy(service.id) ||
      runs.some((r) => r.serviceId === service.id && commandActive(r)) ||
      service.executionEnabled === false ||
      !host ||
      !!host.diagnostics.length
    );
  };
  const trayAction = useRef<(request: TrayServiceRequest) => void>(() => {});
  useLayoutEffect(() => {
    trayAction.current = (request) => {
      const resolved = resolveTrayServiceRequest(data, request);
      if (!resolved) {
        toast.add({
          title: t("error.staleAction"),
          type: "error",
          timeout: 6000,
        });
        return;
      }
      const { service, action, ruleId } = resolved;
      if (request.stopTerminal) {
        if (
          workspace?.foregroundSession(service, ruleId)?.actionId === action.id
        )
          void workspace.stopService(service, ruleId);
        else open({ ruleId });
      } else if (isDisabled(service, ruleId)) open({ ruleId });
      else execute(service, action, ruleId);
    };
  });
  useEffect(() => {
    if (!bridge.desktop) return;
    let live = true;
    const subscription = listen<TrayServiceRequest>(
      "tunnel://tray-service-action",
      ({ payload }) => {
        if (live) trayAction.current(payload);
      },
    );
    return () => {
      live = false;
      void subscription.then((off) => off()).catch(() => {});
    };
  }, []);
  const createService = () => setEditing(newService(filter?.hostId || ""));
  const categoryOptions = [
    { value: "all", label: t("all", { ns: "tunnel" }) },
    ...[...serviceTemplateCategories, "other"].map((category) => ({
      value: category,
      label: t(
        category === "other" ? "categoryOther" : `templates.groups.${category}`,
      ),
    })),
  ];
  const selectedServices = (data.services || []).filter((service) =>
    selectedServiceIds.includes(service.id),
  );
  const selectedVisibleCount = visibleServices.filter((service) =>
    selectedServiceIds.includes(service.id),
  ).length;
  const serviceGroups =
    page && !filter
      ? groupServicesByHost(visibleServices, data)
      : [
          {
            id: "filtered",
            hostId: "",
            host: undefined,
            services: visibleServices,
          },
        ];
  const importButton = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={!bridge.desktop || busy}
      onClick={() => {
        setFilter(null);
        setImporting(true);
      }}
    >
      <FileInputIcon aria-hidden="true" />
      {t("importConfig", { ns: "tunnel" })}
    </Button>
  );
  const renderService = (service: RemoteService) => {
    const bound = serviceRules(service, data);
    const associatedHosts = serviceHostIds(service, data);
    const target = targetFor(service);
    const host = data.hosts.find((h) => h.id === target?.hostId);
    const active =
      workspace?.serviceBusy(service.id) ||
      runs.some((r) => r.serviceId === service.id && commandActive(r));
    const foreground = workspace?.foregroundSession(service, target?.id);
    const terminalStop =
      foreground ||
      (service.actions.some(
        (action) => action.kind === "start" && action.mode === "terminal",
      ) &&
        !service.actions.some((action) => action.kind === "stop"));
    return (
      <li
        className={`themed-surface preset-service ${page && !filter ? "service-row" : ""}`}
        key={service.id}
      >
        {page && !filter && (
          <input
            type="checkbox"
            className="rule-select service-select"
            aria-label={t("batch.select", { name: service.name })}
            checked={selectedServiceIds.includes(service.id)}
            disabled={busy}
            onChange={(event) =>
              setSelectedServiceIds((ids) =>
                event.target.checked
                  ? [...new Set([...ids, service.id])]
                  : ids.filter((id) => id !== service.id),
              )
            }
          />
        )}
        <div className="preset-service-heading">
          <div className="service-card-title">
            <h3 className="service-name">
              <ConnectionIcon
                icon={service.icon}
                color={service.color ?? null}
              />
              <span className="service-name-text" title={service.name}>
                {service.name}
              </span>
              {service.executionEnabled === false && (
                <span className="service-disabled-label">
                  {t("sharing.disabled")}
                </span>
              )}
            </h3>
            {(!page || filter) && (
              <code>
                {host
                  ? `${host.user}@${host.address}:${host.port}`
                  : t(
                      bound.length ? "serviceTargetRequired" : "serviceUnbound",
                    )}
              </code>
            )}
          </div>
          <div className="service-item-actions">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title={t("details", { ns: "tunnel" })}
              aria-label={`${t("details", { ns: "tunnel" })} ${service.name}`}
              aria-haspopup="dialog"
              onClick={() => setInspectingService(service)}
            >
              <InfoIcon aria-hidden="true" />
            </Button>
            {host && (!page || filter) && (
              <OpenTerminalButton hostId={host.id} />
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy || active}
              aria-label={`${t("edit")} ${service.name}`}
              onClick={() => setEditing(structuredClone(service))}
            >
              <Settings2Icon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy || !bridge.desktop}
              title={t("copyService")}
              aria-label={`${t("copyService")} ${service.name}`}
              aria-haspopup="dialog"
              onClick={() => {
                setError("");
                setEditing(copyService(service));
              }}
            >
              <CopyPlusIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy || active}
              aria-label={`${t("delete")} ${service.name}`}
              title={t("delete")}
              aria-haspopup="dialog"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20"
              onClick={() => {
                setError("");
                setDeleting([service]);
              }}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={!bridge.desktop || busy || active}
              title={t(
                service.executionEnabled === false
                  ? "sharing.enableReview"
                  : "sharing.disable",
              )}
              aria-label={`${t(service.executionEnabled === false ? "sharing.enableReview" : "sharing.disable")} ${service.name}`}
              onClick={() => {
                if (service.executionEnabled === false) {
                  setError("");
                  setReviewing(service);
                } else
                  void perform(async () =>
                    onSnapshot(
                      await bridge.setServiceExecution(
                        service.id,
                        service.revision,
                        false,
                        false,
                      ),
                    ),
                  );
              }}
            >
              {service.executionEnabled === false ? (
                <ShieldCheckIcon aria-hidden="true" />
              ) : (
                <ShieldOffIcon aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
        {(!page || filter) &&
          !filter?.hostId &&
          !filter?.ruleId &&
          associatedHosts.length > 1 && (
            <div className="field">
              <span>{t("hosts", { ns: "tunnel" })}</span>
              <Select
                value={target?.id || ""}
                items={associatedHosts.map((id) => ({
                  value: hostServiceTarget(id),
                  label: data.hosts.find((h) => h.id === id)?.name || id,
                }))}
                onValueChange={(value) =>
                  value &&
                  setTargets((old) => ({ ...old, [service.id]: value }))
                }
              >
                <SelectTrigger aria-label={t("hosts", { ns: "tunnel" })}>
                  <SelectValue placeholder={t("serviceTargetRequired")} />
                </SelectTrigger>
                <SelectContent>
                  {associatedHosts.map((id) => (
                    <SelectItem key={id} value={hostServiceTarget(id)}>
                      {data.hosts.find((h) => h.id === id)?.name || id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        {(!page || filter) &&
          observations.some(
            (o) =>
              o.serviceId === service.id &&
              (o.ruleId === target?.id || o.hostId === target?.hostId),
          ) && (
            <ServiceState
              observation={observations.find(
                (o) =>
                  o.serviceId === service.id &&
                  (o.ruleId === target?.id || o.hostId === target?.hostId),
              )}
            />
          )}
        <div
          className={`inline-actions ${page && !filter ? "service-command-summary" : ""}`}
        >
          {page && !filter && (
            <span className="service-command-count">
              {t("commandCount", { count: service.actions.length })}
            </span>
          )}
          {service.actions
            .filter(
              (action) =>
                (page && !filter) || !(foreground && action.kind === "stop"),
            )
            .map((action) =>
              page && !filter ? (
                <span className="source-badge" key={action.id}>
                  {action.label}
                </span>
              ) : (
                <Button
                  key={action.id}
                  type="button"
                  size="sm"
                  variant={action.kind === "start" ? "primary-soft" : "outline"}
                  disabled={isDisabled(service)}
                  onClick={() => execute(service, action)}
                >
                  {action.label}
                </Button>
              ),
            )}
          {(!page || filter) && terminalStop && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={
                !bridge.desktop || busy || !foreground || workspace?.busy
              }
              onClick={() => void workspace?.stopService(service, target?.id)}
            >
              {t("kind.stop")}
            </Button>
          )}
        </div>
        {(!page || filter) &&
          (service.control?.statusProbe || service.control?.healthProbe) && (
            <details className="advanced-fields service-checks">
              <summary>{t("service.checks")}</summary>{" "}
              <ServiceOperations
                service={service}
                data={data}
                ruleId={target?.id}
                disabled={isDisabled(service)}
                onOperation={(operation, ruleId) =>
                  executeOperation(service, operation, ruleId)
                }
              />
            </details>
          )}
      </li>
    );
  };
  const serviceList = (
    <>
      {error && (
        <p role="alert" className="inline-error">
          {formatUiError(error, t)}
        </p>
      )}
      <>
        {page && !filter ? (
          <div className="host-toolbar service-toolbar">
            <div className="host-search">
              <SearchIcon size={16} aria-hidden="true" />
              <Input
                type="search"
                aria-label={t("searchServices")}
                placeholder={t("searchServices")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="host-toolbar-controls">
              <Select
                items={categoryOptions}
                value={categoryFilter}
                onValueChange={(value) => value && setCategoryFilter(value)}
              >
                <SelectTrigger size="sm" aria-label={t("category")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((o) => (
                    <SelectItem value={o.value} key={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="rule-select-all">
                <input
                  type="checkbox"
                  aria-label={t("batch.selectAll")}
                  checked={
                    visibleServices.length > 0 &&
                    selectedVisibleCount === visibleServices.length
                  }
                  ref={(node) => {
                    if (node)
                      node.indeterminate =
                        selectedVisibleCount > 0 &&
                        selectedVisibleCount < visibleServices.length;
                  }}
                  disabled={busy || !visibleServices.length}
                  onChange={(event) =>
                    setSelectedServiceIds((ids) =>
                      event.target.checked
                        ? [
                            ...new Set([
                              ...ids,
                              ...visibleServices.map((service) => service.id),
                            ]),
                          ]
                        : ids.filter(
                            (id) =>
                              !visibleServices.some(
                                (service) => service.id === id,
                              ),
                          ),
                    )
                  }
                />
                {t("batch.selectAll")}
              </label>
              <span className="rule-selection-count" aria-live="polite">
                {t("batch.selected", { count: selectedServices.length })}
              </span>
              {!!selectedServices.length && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    busy ||
                    !bridge.desktop ||
                    selectedServices.some(
                      (service) =>
                        workspace?.serviceBusy(service.id) ||
                        runs.some(
                          (run) =>
                            run.serviceId === service.id && commandActive(run),
                        ),
                    )
                  }
                  onClick={() => {
                    setError("");
                    setDeleting(selectedServices);
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                  {t("batch.deleteSelected")}
                </Button>
              )}

              {importButton}
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  busy ||
                  !bridge.desktop ||
                  (!visibleServices.length && !selectedServices.length)
                }
                onClick={() =>
                  setSharing(
                    selectedServices.length
                      ? selectedServices
                      : visibleServices,
                  )
                }
              >
                <FileOutputIcon aria-hidden="true" />
                {t(
                  selectedServices.length
                    ? "batch.exportSelected"
                    : "batch.exportAll",
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="inline-actions">
            <Button
              type="button"
              size="sm"
              variant="primary-soft"
              disabled={!bridge.desktop || busy}
              onClick={createService}
            >
              <PlusIcon aria-hidden="true" />
              {t("addService")}
            </Button>
            {importButton}
          </div>
        )}
        {!visibleServices.length && (
          <div className="empty">
            <ListChecksIcon size={36} strokeWidth={1} aria-hidden="true" />
            <h2>
              {t(
                services.length ? "emptyResult" : "services",
                services.length ? { ns: "tunnel" } : {},
              )}
            </h2>
            {!services.length && (
              <>
                <p>{t("empty")}</p>
                <Button
                  type="button"
                  variant="primary-soft"
                  disabled={!bridge.desktop || busy}
                  onClick={createService}
                >
                  <PlusIcon aria-hidden="true" />
                  {t("addService")}
                </Button>
              </>
            )}
          </div>
        )}
        <div className="service-page-groups">
          {serviceGroups.map((group) => (
            <section
              className="service-page-group"
              key={group.id}
              aria-labelledby={
                page && !filter ? `${listId}-${group.id}` : undefined
              }
            >
              {page && !filter && (
                <h2 id={`${listId}-${group.id}`}>
                  {group.host?.name ||
                    (group.hostId
                      ? t("sourceMissing", { ns: "tunnel" })
                      : t("unassignedHost"))}{" "}
                  <span>{group.services.length}</span>
                </h2>
              )}
              <ul className="preset-service-list" role="list">
                {group.services.map(renderService)}
              </ul>
            </section>
          ))}
        </div>
        {!!runs.length && (!page || filter) && (
          <div className="preset-history">
            <h3>{t("history")}</h3>
            <div className="inline-actions">
              {runs
                .filter(
                  (r) =>
                    commandActive(r) ||
                    !filter?.hostId ||
                    r.hostId === filter?.hostId,
                )
                .slice(0, 24)
                .map((run) => (
                  <Button
                    key={run.id}
                    type="button"
                    size="sm"
                    variant={run.id === selectedRun ? "primary-soft" : "ghost"}
                    onClick={() => {
                      setSelectedRun(run.id);
                      if (workspace) {
                        workspace.showCommand(run);
                        setFilter(null);
                      }
                    }}
                  >
                    {run.hostName} ·{" "}
                    {run.actionLabel.startsWith("$")
                      ? t(`service.${run.actionLabel.slice(1)}`)
                      : run.actionLabel}{" "}
                    · {t(`phase.${run.phase}`)}
                  </Button>
                ))}
            </div>
          </div>
        )}
        {selected && (!page || filter) && (
          <CommandResult
            key={selected.id}
            data={data}
            autoPromptCredentials={automaticAuthRuns.current.has(selected.id)}
            onCredentialsPrompt={() =>
              automaticAuthRuns.current.delete(selected.id)
            }
            onRerun={(run) => {
              automaticAuthRuns.current.add(run.id);
              acceptRun(run);
              setSelectedRun(run.id);
            }}
            run={selected}
            accept={acceptRun}
            onError={setError}
            onCancel={() =>
              void perform(async () => {
                await bridge.cancelCommand(selected.id);
              })
            }
          />
        )}
        {(!page || filter) &&
          selected?.error === "authentication" &&
          !selected.submitted &&
          retryService &&
          retryService.executionEnabled !== false &&
          retryAction && (
            <Button
              type="button"
              onClick={() => {
                setIntent({
                  service: retryService,
                  action: retryAction,
                  fallback: true,
                  operation: retryOperation,
                  ruleId:
                    selected.workflowRuleId ||
                    hostServiceTarget(selected.hostId),
                });
                setSecrets({});
                setRemember({});
              }}
            >
              {t("retryAuth")}
            </Button>
          )}
      </>
    </>
  );
  const serviceUi = useMemo<ServiceUI>(
    () => ({
      data,
      assignHost: async (hostId, ids) => {
        onSnapshot(
          await bridge.setHostServices(
            hostId,
            (data.services || []).map((s) => ({
              id: s.id,
              revision: s.revision,
              selected: ids.includes(s.id),
            })),
          ),
        );
      },
      running: (service, targetId) => {
        const target = targetFor(service, targetId);
        if (!target) return false;
        const foreground = workspace?.foregroundSession(service, target.id);
        if (foreground?.phase === "running" && foreground.finishedAt === null)
          return true;
        return observations.some(
          (o) =>
            o.serviceId === service.id &&
            o.serviceRevision === service.revision &&
            (o.ruleId === target.id || o.hostId === target.hostId) &&
            !o.status.expired &&
            o.status.value === "running",
        );
      },
      open,
      content: serviceList,
      count: visibleServices.length,
      create: createService,
      canCreate: bridge.desktop && !busy,
      services: data.services || [],
      disabled: isDisabled,
      execute,
    }),
    [
      data.hosts,
      data.rules,
      data.services,
      data.addedHostIds,
      onSnapshot,
      page,
      workspace,
      t,
      sharing,
      importing,
      reviewing,
      inspectingService,
      filter,
      query,
      targets,
      categoryFilter,
      selectedServiceIds,
      runs,
      observations,
      selectedRun,
      editing,
      intent,
      deleting,
      secrets,
      remember,
      busy,
      error,
    ],
  );
  return (
    <Context.Provider value={serviceUi}>
      <ServiceRunningContext.Provider value={serviceUi.running}>
        {children}
      </ServiceRunningContext.Provider>
      <AnimatePresence>
        {inspectingService && (
          <Modal
            key="service-details"
            title={inspectingService.name}
            close={() => setInspectingService(null)}
            className="max-w-3xl sm:max-w-3xl"
          >
            <ServiceReview
              service={inspectingService}
              endpoint={
                serviceRules(inspectingService, data)
                  .map((rule) => rule.name)
                  .join(" · ") || t("serviceUnbound")
              }
            />
          </Modal>
        )}
        {sharing && (
          <ConfigExportDialog
            key="service-export"
            data={data}
            ruleIds={[]}
            initialServiceIds={sharing.map((service) => service.id)}
            close={() => setSharing(null)}
          />
        )}
        {importing && (
          <ImportConfig
            key="service-import"
            hosts={data.hosts}
            busy={busy}
            close={() => {
              setImporting(false);
              void bridge.cancelImport();
            }}
            previewFile={bridge.previewImport}
            cancelPreview={bridge.cancelImport}
            submit={async (token, choices) => {
              if (submitting.current) return false;
              submitting.current = true;
              setBusy(true);
              try {
                onSnapshot(await bridge.commitImport(token, choices));
                setImporting(false);
                if (!page) setFilter({});
                return true;
              } catch (e) {
                setError(String(e));
                throw e;
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          />
        )}
        {reviewing && (
          <ServiceEnableDialog
            key="service-enable"
            service={reviewing}
            endpoint={
              serviceRules(reviewing, data)
                .map((rule) => rule.name)
                .join(" · ") || t("serviceUnbound")
            }
            busy={busy}
            error={formatUiError(error, t)}
            close={() => setReviewing(null)}
            enable={() =>
              void perform(async () => {
                onSnapshot(
                  await bridge.setServiceExecution(
                    reviewing.id,
                    reviewing.revision,
                    true,
                    true,
                  ),
                );
                setReviewing(null);
              })
            }
          />
        )}
        {(filter || (page && editing)) && (
          <Modal
            key="preset-commands"
            title={
              editing
                ? editing.id
                  ? t("editService")
                  : t("addService")
                : t("services")
            }
            close={close}
            className="max-w-3xl sm:max-w-3xl"
          >
            {editing ? (
              <>
                {error && (
                  <p role="alert" className="inline-error">
                    {formatUiError(error, t)}
                  </p>
                )}
                <ServiceEditor
                  key={editing.id || "new"}
                  service={editing}
                  data={data}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(service) =>
                    void perform(async () => {
                      onSnapshot(await bridge.saveServiceProfile(service));
                      setEditing(null);
                    })
                  }
                />
              </>
            ) : (
              serviceList
            )}
          </Modal>
        )}
        {intent && (
          <Modal
            key="command-intent"
            title={intent.action.label}
            description={t("executeHint")}
            close={() => {
              setIntent(null);
              setSecrets({});
              setRemember({});
            }}
          >
            <code className="preset-command-code">
              {(() => {
                const h = routeFor(intent.service, intent.ruleId).at(-1);
                return h
                  ? `${h.user}@${h.address}:${h.port}`
                  : t("serviceTargetRequired");
              })()}
            </code>
            {error && (
              <p role="alert" className="inline-error">
                {formatUiError(error, t)}
              </p>
            )}
            <pre className="preset-script" data-selectable="true">
              {reviewScript(intent.action.command)}
            </pre>
            {intent.operation === "connect" && (
              <p className="muted">
                {t("service.connectReview", {
                  forward: data.rules.find((r) => r.id === intent.ruleId)?.name,
                })}
              </p>
            )}
            <form
              id="command-auth"
              onSubmit={(e) => {
                e.preventDefault();
                void start(
                  intent.service,
                  intent.action,
                  secrets,
                  remember,
                  intent.operation,
                  intent.ruleId,
                );
              }}
            >
              {routeFor(intent.service, intent.ruleId)
                .filter((h) =>
                  intent.fallback
                    ? h.authMethod !== "agent"
                    : h.authMethod === "password",
                )
                .map((host) => (
                  <AuthenticationField
                    key={host.id}
                    host={host}
                    value={secrets[host.id] || ""}
                    onChange={(value) =>
                      setSecrets((old) => ({ ...old, [host.id]: value }))
                    }
                    remember={!!remember[host.id]}
                    onRemember={(value) =>
                      setRemember((old) => ({ ...old, [host.id]: value }))
                    }
                  />
                ))}
              <ModalActions>
                <Button
                  type="submit"
                  form="command-auth"
                  variant="primary-soft"
                  disabled={busy}
                >
                  <PlayIcon aria-hidden="true" />
                  {t("execute")}
                </Button>
              </ModalActions>
            </form>
          </Modal>
        )}
        {deleting && (
          <Modal
            key="delete-service"
            title={t("batch.deleteTitle", { count: deleting.length })}
            description={t("deleteHint")}
            close={() => setDeleting(null)}
          >
            <ul className="delete-targets">
              {deleting.map((service) => (
                <li key={service.id}>{service.name}</li>
              ))}
            </ul>
            {error && (
              <p className="inline-error" role="alert">
                {formatUiError(error, t)}
              </p>
            )}
            <ModalActions>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    onSnapshot(
                      await bridge.deleteServiceProfiles(
                        deleting.map(({ id, revision }) => ({ id, revision })),
                      ),
                    );
                    setSelectedServiceIds((ids) =>
                      ids.filter(
                        (id) => !deleting.some((service) => service.id === id),
                      ),
                    );
                    setDeleting(null);
                  })
                }
              >
                {t("delete")}
              </Button>
            </ModalActions>
          </Modal>
        )}
        {trust && (
          <Modal
            key="command-trust"
            title={t("trust")}
            description={t("trustHint")}
            close={() =>
              void bridge
                .cancelCommand(trust.id)
                .catch((e) => setError(String(e)))
            }
          >
            <strong>{trust.verificationEndpoint}</strong>
            <code className="fingerprint">{trust.fingerprint}</code>
            <ModalActions>
              <Button
                variant="destructive"
                onClick={() => void bridge.cancelCommand(trust.id)}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await bridge.trustHost(
                      trust.id,
                      trust.id,
                      trust.fingerprint!,
                    );
                  })
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

export function ServiceEditor({
  service,
  data,
  busy,
  onSave,
  onCancel,
}: {
  service: RemoteService;
  data: Snapshot;
  busy: boolean;
  onSave: (s: RemoteService) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("commands");
  const id = useId();
  const [draft, setDraft] = useState<RemoteService>(() => ({
    ...service,
    hostIds: serviceHostIds(service, data),
    category: serviceCategory(service),
  }));
  const [templateOpen, setTemplateOpen] = useState(false);
  const actionLabels = Object.fromEntries(
    commandKinds.map((kind) => [kind, t(`kind.${kind}`)]),
  ) as Record<PresetAction["kind"], string>;
  const updateAction = (index: number, patch: Partial<PresetAction>) =>
    setDraft((s) => ({
      ...s,
      actions: s.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    }));
  return (
    <>
      <ModalTitleActions>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={busy || !bridge.desktop}
          onClick={() => setTemplateOpen(true)}
        >
          <FileInputIcon aria-hidden="true" />
          {t("templates.import")}
        </Button>
      </ModalTitleActions>
      <form
        id={`${id}-form`}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.actions.length || draft.control?.healthProbe)
            onSave({
              ...draft,
              actions: draft.actions.map((action) => {
                if (!action.invocation) return action;
                const invocation = normalizeInvocation(action.invocation);
                return {
                  ...action,
                  invocation,
                  command: renderInvocation(invocation),
                };
              }),
              executionHostId: "",
              ruleIds: draft.ruleIds.filter((id) =>
                data.rules.some((rule) => rule.id === id),
              ),
            });
        }}
      >
        <label className="field" htmlFor={`${id}-name`}>
          {t("name")}
          <Input
            id={`${id}-name`}
            required
            maxLength={256}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <div className="field">
          <span>{t("category")}</span>
          <Select
            value={serviceCategory(draft)}
            items={[...serviceTemplateCategories, "other"].map((category) => ({
              value: category,
              label: t(
                category === "other"
                  ? "categoryOther"
                  : `templates.groups.${category}`,
              ),
            }))}
            onValueChange={(category) =>
              category && setDraft({ ...draft, category })
            }
          >
            <SelectTrigger aria-label={t("category")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...serviceTemplateCategories, "other"].map((category) => (
                <SelectItem key={category} value={category}>
                  {t(
                    category === "other"
                      ? "categoryOther"
                      : `templates.groups.${category}`,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ConnectionColorPicker
          fieldLabel={t("serviceColor")}
          value={draft.color ?? null}
          onChange={(color) => setDraft({ ...draft, color })}
        />
        <ServiceHostPicker
          hosts={addedHosts(data)}
          value={draft.hostIds || []}
          onChange={(hostIds) => setDraft({ ...draft, hostIds })}
          disabled={busy}
        />
        <label className="field" htmlFor={`${id}-port`}>
          {t("servicePort")}
          <Input
            id={`${id}-port`}
            type="number"
            min={1}
            max={65535}
            value={draft.port ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                port: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        <ConnectionIconPicker
          fieldLabel={t("serviceIcon")}
          initialCategory="service"
          value={draft.icon ?? null}
          color={draft.color ?? null}
          onChange={(icon) => setDraft({ ...draft, icon })}
        />
        <label className="field service-switch-field" htmlFor={`${id}-env`}>
          {t("noEnvironment")}
          <Switch
            id={`${id}-env`}
            checked={draft.noLocalEnvironment}
            onCheckedChange={(noLocalEnvironment) =>
              setDraft({ ...draft, noLocalEnvironment })
            }
          />
        </label>
        <p id={`${id}-hint`} className="muted">
          {t("scriptHint")}
        </p>
        {draft.actions.map((action, index) => (
          <fieldset
            className="preset-action-editor command-action-editor"
            key={action.id}
          >
            <legend>{action.label || t(`kind.${action.kind}`)}</legend>
            <div className="preset-action-heading command-action-header">
              <div className="field">
                <span>{t("kindLabel")}</span>
                <Select
                  items={commandKinds.map((kind) => ({
                    value: kind,
                    label: t(`kind.${kind}`),
                  }))}
                  value={action.kind}
                  onValueChange={(kind) => {
                    if (kind)
                      updateAction(
                        index,
                        changeActionKind(
                          action,
                          kind as PresetAction["kind"],
                          actionLabels,
                        ),
                      );
                  }}
                >
                  <SelectTrigger aria-label={t("kindLabel")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {commandKinds.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`kind.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="field" htmlFor={`${id}-${action.id}-label`}>
                <span>{t("actionName")}</span>
                <Input
                  id={`${id}-${action.id}-label`}
                  required
                  maxLength={256}
                  value={action.label}
                  onChange={(e) =>
                    updateAction(index, { label: e.target.value })
                  }
                />
              </label>
              <div className="field command-execution-field">
                <span>{t("mode", { ns: "terminal" })}</span>
                <Select
                  value={action.mode || "command"}
                  items={[
                    {
                      value: "command",
                      label: t("modeCommand", { ns: "terminal" }),
                    },
                    {
                      value: "terminal",
                      label: t("modeTerminal", { ns: "terminal" }),
                    },
                  ]}
                  onValueChange={(mode) =>
                    updateAction(index, {
                      mode: mode as "command" | "terminal",
                      timeoutSecs:
                        mode === "command" && action.timeoutSecs === 0
                          ? 60
                          : action.timeoutSecs,
                    })
                  }
                >
                  <SelectTrigger aria-label={t("mode", { ns: "terminal" })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="command">
                      {t("modeCommand", { ns: "terminal" })}
                    </SelectItem>
                    <SelectItem value="terminal">
                      {t("modeTerminal", { ns: "terminal" })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="destructive"
                aria-label={`${t("removeAction")} ${action.label}`}
                disabled={busy}
                onClick={() =>
                  setDraft({
                    ...draft,
                    actions: draft.actions.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
            <ToggleGroup<string>
              value={[isStructuredCommand(action) ? "command" : "script"]}
              multiple={false}
              disabled={busy}
              aria-label={t("builder.mode")}
              className="command-format-toggle window-muted-surface"
              onValueChange={(values) => {
                const format = values[0];
                if (format === "script" || format === "command")
                  updateAction(index, switchActionFormat(action, format));
              }}
            >
              <Toggle value="script">{t("builder.script")}</Toggle>
              <Toggle value="command">{t("builder.title")}</Toggle>
            </ToggleGroup>
            {isStructuredCommand(action) && action.invocation && (
              <CommandInvocationEditor
                value={action.invocation}
                disabled={busy}
                onChange={(invocation) =>
                  updateAction(index, {
                    invocation,
                    command: renderInvocation(normalizeInvocation(invocation)),
                  })
                }
              />
            )}
            <label className="field" htmlFor={`${id}-${action.id}-command`}>
              {t("command")}
              <textarea
                id={`${id}-${action.id}-command`}
                className="preset-textarea"
                required
                rows={4}
                maxLength={65536}
                spellCheck={false}
                aria-describedby={`${id}-hint`}
                value={
                  isStructuredCommand(action)
                    ? action.command
                    : actionScript(action)
                }
                readOnly={isStructuredCommand(action)}
                onChange={(e) =>
                  updateAction(index, {
                    ...editActionScript(action, e.target.value),
                    confirm: ["stop", "restart", "custom"].includes(
                      action.kind,
                    ),
                  })
                }
              />
            </label>
            <CommandEnvironmentEditor
              value={action.invocation?.environment || []}
              disabled={busy}
              onChange={(environment) =>
                updateAction(index, editActionEnvironment(action, environment))
              }
            />
            <div className="preset-action-options command-action-options">
              <label className="field" htmlFor={`${id}-${action.id}-timeout`}>
                <span>
                  {t(
                    action.mode === "terminal" ? "terminalTimeout" : "timeout",
                  )}
                </span>
                <Input
                  id={`${id}-${action.id}-timeout`}
                  type="number"
                  required
                  min={action.mode === "terminal" ? 0 : 1}
                  max={3600}
                  value={action.timeoutSecs}
                  onChange={(e) =>
                    updateAction(index, { timeoutSecs: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field" htmlFor={`${id}-${action.id}-codes`}>
                <span>{t("successCodes")}</span>
                <Input
                  id={`${id}-${action.id}-codes`}
                  required
                  pattern="[0-9]+(,[0-9]+)*"
                  defaultValue={action.successCodes.join(",")}
                  onChange={(e) =>
                    updateAction(index, {
                      successCodes: e.target.value.split(",").map(Number),
                    })
                  }
                />
              </label>
              <label className="field" htmlFor={`${id}-${action.id}-confirm`}>
                <span>{t("confirm")}</span>
                <div className="command-switch-control">
                  <Switch
                    id={`${id}-${action.id}-confirm`}
                    checked={action.confirm}
                    onCheckedChange={(confirm) =>
                      updateAction(index, { confirm })
                    }
                  />
                </div>
              </label>
            </div>
          </fieldset>
        ))}
        <div className="inline-actions service-add-actions">
          {commandKinds.map((kind) => (
            <Button
              type="button"
              size="sm"
              variant="outline"
              key={kind}
              disabled={busy || draft.actions.length >= 32}
              onClick={() =>
                setDraft({
                  ...draft,
                  actions: [
                    ...draft.actions,
                    newAction(kind, t(`kind.${kind}`)),
                  ],
                })
              }
            >
              <PlusIcon aria-hidden="true" />
              {t(`kind.${kind}`)}
            </Button>
          ))}
        </div>
        <ControlEditor
          service={draft}
          onChange={(control) => setDraft({ ...draft, control })}
        />
        <ModalActions>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form={`${id}-form`}
            variant="primary-soft"
            disabled={
              busy || (!draft.actions.length && !draft.control?.healthProbe)
            }
          >
            {t("save")}
          </Button>
        </ModalActions>
      </form>
      <AnimatePresence>
        {templateOpen && (
          <ServiceTemplateDialog
            key="service-template"
            close={() => setTemplateOpen(false)}
            apply={(template) => {
              setDraft((current) => fillServiceTemplate(current, template));
              setTemplateOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
export function CommandResult({
  data,
  onRerun,
  run,
  accept,
  onCancel,
  onError,
  autoPromptCredentials = false,
  onCredentialsPrompt,
}: {
  data?: Snapshot;
  onRerun?: (run: CommandRun) => void;
  run: CommandRun;
  accept: (r: CommandRun) => void;
  onCancel: () => void;
  onError: (s: string) => void;
  autoPromptCredentials?: boolean;
  onCredentialsPrompt?: () => void;
}) {
  const { t, i18n } = useTranslation("commands");
  const observations = useServiceObservations(true);
  const [view, setView] = useState({ run, text: "" });
  const [stream, setStream] = useState<"all" | "stdout" | "stderr">("all");
  const [output, setOutput] = useState({ all: "", stdout: "", stderr: "" });
  const resultElement = useRef<HTMLElement>(null);
  useEffect(() => {
    resultElement.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const follow = useRef(true),
    pre = useRef<HTMLPreElement>(null);
  const clearAt = useRef(0);
  const lastSequence = useRef(0);
  const resetDisplay = useRef(false);
  useEffect(() => {
    let live = true;
    const decoder = new OutputDecoder(),
      stdout = new OutputDecoder(),
      stderr = new OutputDecoder();
    const channel = new bridge.Channel<CommandEvent>();
    channel.onmessage = (event) => {
      if (!live) return;
      lastSequence.current = Math.max(
        lastSequence.current,
        ...event.output.map((c) => c.sequence),
      );
      const visible = {
        ...event,
        reset: event.reset || resetDisplay.current,
        output: event.output.filter((c) => c.sequence > clearAt.current),
      };
      resetDisplay.current = false;
      const text = decoder.accept(visible);
      setOutput({
        all: text,
        stdout: stdout.accept({
          ...visible,
          output: visible.output.filter((c) => c.stream === "stdout"),
        }),
        stderr: stderr.accept({
          ...visible,
          output: visible.output.filter((c) => c.stream === "stderr"),
        }),
      });
      setView({ run: event.run, text });
      accept(event.run);
    };
    void bridge.attachCommand(run.id, channel).catch((e) => {
      if (live) onError(String(e));
    });
    return () => {
      live = false;
      void bridge.detachCommand(run.id).catch(() => {});
    };
  }, [run.id, accept, onError]);
  useEffect(() => {
    void bridge.ackCommand(run.id, view.run.revision).catch(() => {});
    if (follow.current && pre.current)
      pre.current.scrollTop = pre.current.scrollHeight;
  }, [run.id, view]);
  const current =
    view.run.id === run.id && view.run.revision >= run.revision
      ? view.run
      : run;
  return (
    <section
      ref={resultElement}
      className="preset-result"
      aria-label={t("output")}
    >
      <header className="preset-service-heading">
        <div>
          <h3>
            {current.actionLabel.startsWith("$")
              ? t(`service.${current.actionLabel.slice(1)}`)
              : current.actionLabel}
          </h3>
          <code>{current.endpoint}</code>
        </div>
        {commandActive(current) && (
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            {t("cancelTask")}
          </Button>
        )}
      </header>
      <p role="status" aria-live="polite">
        {t(`phase.${current.phase}`)}
        {current.exitCode !== null &&
          ` · ${t("exitCode")}: ${current.exitCode}`}
        {current.exitSignal && ` · ${current.exitSignal}`}
      </p>
      <p className="muted">
        {new Date(current.startedAt).toLocaleString(i18n.resolvedLanguage)}
        {current.finishedAt &&
          ` → ${new Date(current.finishedAt).toLocaleTimeString(i18n.resolvedLanguage)}`}
      </p>
      <ServiceState
        observation={observations.find(
          (o) =>
            o.serviceId === current.serviceId &&
            (current.workflowRuleId
              ? o.ruleId === current.workflowRuleId
              : o.hostId === current.hostId),
        )}
      />
      {data && onRerun && (
        <CredentialRetry
          data={data}
          run={current}
          onRun={onRerun}
          onError={onError}
          autoPrompt={autoPromptCredentials}
          onPrompt={onCredentialsPrompt}
        />
      )}
      {current.error && (
        <p className="inline-error" role="alert">
          {t(`error.${current.error}`)}
        </p>
      )}
      {!!current.steps?.length && (
        <ol className="service-steps" aria-label={t("service.steps")}>
          {current.steps.map((step, index) => (
            <li key={index}>
              <span>
                {t(`service.step.${step.kind}`, {
                  defaultValue: t(`kind.${step.kind}`),
                })}
              </span>
              <span>
                {t(`phase.${step.phase}`)}
                {step.attempt > 1 &&
                  ` · ${t("service.attempts", { count: step.attempt })}`}
                {step.exitCode !== null &&
                  ` · ${t("exitCode")}: ${step.exitCode}`}
              </span>
              {step.error && (
                <small className="inline-error">
                  {t(`error.${step.error}`)}
                </small>
              )}
            </li>
          ))}
        </ol>
      )}
      {current.workflowRuleId && current.actionId.startsWith("$connect") && (
        <div className="inline-actions">
          <span className="muted">
            {t(
              current.workflowForwardCreated
                ? "service.createdForward"
                : "service.preserveForward",
            )}
          </span>
          {current.workflowForwardCreated && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void bridge
                  .stopServiceForward(current.id)
                  .catch((e) => onError(formatUiError(String(e), t)))
              }
            >
              {t("service.stopForward")}
            </Button>
          )}
        </div>
      )}
      {current.phase === "succeeded" &&
        !current.steps?.some(
          (s) => s.kind === "health" && s.phase === "succeeded",
        ) && <p className="muted">{t("notReadiness")}</p>}
      {current.truncated && <p className="muted">{t("truncated")}</p>}
      {current.outputBytes !== undefined && (
        <p className="muted">
          {t("sharing.outputStats", {
            retained: new Intl.NumberFormat(i18n.resolvedLanguage, {
              maximumFractionDigits: 2,
            }).format(current.outputBytes / 1048576),
            discarded: new Intl.NumberFormat(i18n.resolvedLanguage, {
              maximumFractionDigits: 2,
            }).format((current.discardedBytes || 0) / 1048576),
          })}
        </p>
      )}
      <div className="inline-actions">
        {(["all", "stdout", "stderr"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={stream === value ? "primary-soft" : "ghost"}
            onClick={() => setStream(value)}
          >
            {value === "all" ? t("allOutput") : value}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            clearAt.current = lastSequence.current;
            resetDisplay.current = true;
            setOutput({ all: "", stdout: "", stderr: "" });
          }}
        >
          {t("clear")}
        </Button>
      </div>
      <pre
        ref={pre}
        className="preset-output"
        data-selectable="true"
        tabIndex={0}
        aria-label={t("output")}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
      >
        {output[stream] || t("noOutput")}
      </pre>
    </section>
  );
}
