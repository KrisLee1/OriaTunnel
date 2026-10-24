import { useEffect, useId, useState, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { AuthenticationField } from "@/features/hosts/authentication-field";
import { jumpHosts } from "@/features/tunnels/rule-model";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  RemoteService,
  ServiceControl,
  ServiceObservation,
  ServiceOperation,
  Snapshot,
} from "@/types";
import * as bridge from "@/lib/bridge";
export const defaultControl = (): ServiceControl => ({
  statusProbe: null,
  healthProbe: null,
  startActionId: null,
  checkAfterActions: false,
  ttlSecs: 60,
});
export const parseCodes = (text: string) =>
  text.trim() ? text.split(",").map((v) => (v.trim() ? Number(v) : NaN)) : [];
// Probe expiry is computed by Rust; this clock only asks for an in-memory snapshot.
export function useServiceObservations(visible: boolean) {
  const [observations, setObservations] = useState<ServiceObservation[]>([]);
  useEffect(() => {
    if (!bridge.desktop || !visible) return;
    let live = true,
      reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const data = await bridge.serviceObservations();
        if (live) setObservations(data);
      } finally {
        reading = false;
      }
    };
    const off = listen<ServiceObservation[]>("service://observations", () => {
      void refresh().catch(() => {});
    });
    void off.then(() => refresh()).catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), 1000);
    return () => {
      live = false;
      clearInterval(timer);
      void off.then((fn) => fn()).catch(() => {});
    };
  }, [visible]);
  return observations;
}
export function ServiceState({
  observation,
}: {
  observation?: ServiceObservation;
}) {
  const { t, i18n } = useTranslation("commands");
  return (
    <dl className="service-facts">
      {(["status", "health"] as const).map((kind) => {
        const fact = observation?.[kind];
        return (
          <div key={kind}>
            <dt>{t(`service.${kind}`)}</dt>
            <dd>
              {t(
                `service.value.${fact?.value || (kind === "status" ? "unknown" : "unverified")}`,
              )}
              {fact?.expired && ` · ${t("service.expired")}`}
              {fact?.checkedAt && (
                <small>
                  {t("service.checkedAt")}{" "}
                  {new Date(fact.checkedAt).toLocaleString(
                    i18n.resolvedLanguage,
                  )}
                </small>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
export function ServiceOperations({
  service,
  data,
  ruleId,
  disabled,
  onOperation,
}: {
  service: RemoteService;
  data: Snapshot;
  ruleId?: string;
  disabled: boolean;
  onOperation: (operation: ServiceOperation, ruleId?: string) => void;
}) {
  const { t } = useTranslation("commands");
  const rules = data.rules.filter((r) => service.ruleIds.includes(r.id));
  const [chosen, setChosen] = useState(
    ruleId || (rules.length === 1 ? rules[0].id : ""),
  );
  const target = ruleId || chosen;
  const control = service.control;
  return (
    <div className="service-operations">
      <div className="inline-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !target || !control?.statusProbe}
          onClick={() => onOperation("checkStatus", target)}
        >
          {t("service.checkStatus")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !target || !control?.healthProbe}
          onClick={() => onOperation("checkHealth", target)}
        >
          {t("service.checkHealth")}
        </Button>
      </div>
      {!!rules.length && (
        <div className="service-connect-row">
          {!ruleId && (
            <Select
              value={target}
              items={rules.map((r) => ({ value: r.id, label: r.name }))}
              onValueChange={(v) => v && setChosen(v)}
            >
              <SelectTrigger aria-label={t("service.connectForward")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rules.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            size="sm"
            variant="primary-soft"
            disabled={disabled || !target || !control?.startActionId}
            onClick={() => onOperation("connect", target)}
          >
            {t("service.connect")}
          </Button>
        </div>
      )}
    </div>
  );
}
function CodesField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[];
  onChange: (codes: number[]) => void;
}) {
  const [text, setText] = useState(value.join(","));
  useEffect(() => {
    const parsed = parseCodes(text);
    if (
      parsed.length !== value.length ||
      parsed.some((n, i) => !Object.is(n, value[i]))
    )
      setText(value.join(","));
  }, [value, text]);
  return (
    <label className="field">
      <span>{label}</span>
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseCodes(e.target.value));
        }}
      />
    </label>
  );
}
export function ControlEditor({
  service,
  onChange,
}: {
  service: RemoteService;
  onChange: (control: ServiceControl) => void;
}) {
  const { t } = useTranslation("commands"),
    id = useId();
  const c = service.control || defaultControl();
  const status = service.actions.filter(
    (a) => a.kind === "status" && a.mode !== "terminal",
  );
  const starts = service.actions.filter(
    (a) => a.kind === "start" && a.mode !== "terminal",
  );
  const patch = (value: Partial<ServiceControl>) =>
    onChange({ ...c, ...value });
  const select = (
    name: string,
    value: string,
    items: { value: string; label: string }[],
    change: (value: string) => void,
  ) => (
    <label className="field">
      <span>{name}</span>
      <Select
        items={items}
        value={value}
        onValueChange={(v) => v !== null && change(v)}
      >
        <SelectTrigger aria-label={name}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
  const number = (
    key: string,
    value: number,
    min: number,
    max: number,
    change: (n: number) => void,
  ) => (
    <label className="field">
      <span>{t(`service.${key}`)}</span>
      <Input
        type="number"
        min={min}
        max={max}
        required
        value={value}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
  const codes = (
    key: string,
    value: number[],
    change: (codes: number[]) => void,
  ) => (
    <CodesField
      key={key}
      label={t(`service.${key}`)}
      value={value}
      onChange={change}
    />
  );
  return (
    <fieldset className="preset-action-editor service-control-settings">
      <legend>{t("service.settings")}</legend>
      <p className="muted">{t("service.probeHint")}</p>
      <div className="service-settings-grid">
        {select(
          t("service.statusAction"),
          c.statusProbe?.actionId || "none",
          [
            { value: "none", label: t("service.disabled") },
            ...status.map((a) => ({ value: a.id, label: a.label })),
          ],
          (actionId) =>
            patch({
              statusProbe:
                actionId === "none"
                  ? null
                  : {
                      actionId,
                      mode: "output",
                      runningCodes: [0],
                      stoppedCodes: [3],
                      failedCodes: [],
                    },
            }),
        )}
        {select(
          t("service.startAction"),
          c.startActionId || "none",
          [
            { value: "none", label: t("service.disabled") },
            ...starts.map((a) => ({ value: a.id, label: a.label })),
          ],
          (startActionId) =>
            patch({
              startActionId: startActionId === "none" ? null : startActionId,
            }),
        )}
        {number("ttl", c.ttlSecs, 1, 3600, (ttlSecs) => patch({ ttlSecs }))}
      </div>
      {c.statusProbe && (
        <>
          {service.actions.find((a) => a.id === c.statusProbe?.actionId)
            ?.confirm && (
            <p className="inline-error">{t("service.statusConfirmHint")}</p>
          )}
          {select(
            t("service.mapping"),
            c.statusProbe.mode,
            ["output", "exitCode", "json"].map((value) => ({
              value,
              label: t(`service.mappingMode.${value}`),
            })),
            (mode) =>
              patch({
                statusProbe: {
                  ...c.statusProbe!,
                  mode: mode as "output" | "exitCode" | "json",
                },
              }),
          )}
          {c.statusProbe.mode === "exitCode" && (
            <div className="preset-action-options">
              {codes(
                "runningCodes",
                c.statusProbe.runningCodes,
                (runningCodes) =>
                  patch({ statusProbe: { ...c.statusProbe!, runningCodes } }),
              )}
              {codes(
                "stoppedCodes",
                c.statusProbe.stoppedCodes,
                (stoppedCodes) =>
                  patch({ statusProbe: { ...c.statusProbe!, stoppedCodes } }),
              )}
              {codes("failedCodes", c.statusProbe.failedCodes, (failedCodes) =>
                patch({ statusProbe: { ...c.statusProbe!, failedCodes } }),
              )}
            </div>
          )}
          {c.statusProbe.mode === "json" && (
            <p className="muted">{t("service.jsonHint")}</p>
          )}
        </>
      )}
      <label className="field service-switch-field" htmlFor={`${id}-health`}>
        {t("service.healthEnabled")}
        <Switch
          id={`${id}-health`}
          checked={!!c.healthProbe}
          onCheckedChange={(enabled) =>
            patch({
              healthProbe: enabled
                ? {
                    command: "",
                    readyCodes: [0],
                    notReadyCodes: [1],
                    repeatable: false,
                    timeoutSecs: 5,
                    intervalSecs: 2,
                    budgetSecs: 60,
                  }
                : null,
            })
          }
        />
      </label>
      {c.healthProbe && (
        <>
          <label className="field" htmlFor={`${id}-command`}>
            {t("service.healthCommand")}
            <textarea
              className="preset-textarea"
              id={`${id}-command`}
              required
              maxLength={65536}
              value={c.healthProbe.command}
              onChange={(e) =>
                patch({
                  healthProbe: { ...c.healthProbe!, command: e.target.value },
                })
              }
            />
          </label>
          <p className="muted">{t("service.remoteProbe")}</p>
          <div className="preset-action-options">
            {codes("readyCodes", c.healthProbe.readyCodes, (readyCodes) =>
              patch({ healthProbe: { ...c.healthProbe!, readyCodes } }),
            )}
            {codes(
              "notReadyCodes",
              c.healthProbe.notReadyCodes,
              (notReadyCodes) =>
                patch({ healthProbe: { ...c.healthProbe!, notReadyCodes } }),
            )}
            {number(
              "probeTimeout",
              c.healthProbe.timeoutSecs,
              1,
              30,
              (timeoutSecs) =>
                patch({ healthProbe: { ...c.healthProbe!, timeoutSecs } }),
            )}
          </div>
          <label
            className="field service-switch-field"
            htmlFor={`${id}-repeat`}
          >
            {t("service.repeatable")}
            <Switch
              id={`${id}-repeat`}
              checked={c.healthProbe.repeatable}
              onCheckedChange={(repeatable) =>
                patch({ healthProbe: { ...c.healthProbe!, repeatable } })
              }
            />
          </label>
          <p className="muted">{t("service.repeatHint")}</p>
          <div className="preset-action-options">
            {number(
              "interval",
              c.healthProbe.intervalSecs,
              1,
              60,
              (intervalSecs) =>
                patch({ healthProbe: { ...c.healthProbe!, intervalSecs } }),
            )}
            {number("budget", c.healthProbe.budgetSecs, 1, 600, (budgetSecs) =>
              patch({ healthProbe: { ...c.healthProbe!, budgetSecs } }),
            )}
          </div>
        </>
      )}
      {c.startActionId && (
        <p className="muted service-control-hint">{t("service.connectHint")}</p>
      )}
      <label className="field service-switch-field" htmlFor={`${id}-after`}>
        {t("service.checkAfter")}
        <Switch
          id={`${id}-after`}
          checked={c.checkAfterActions}
          onCheckedChange={(checkAfterActions) => patch({ checkAfterActions })}
        />
      </label>
    </fieldset>
  );
}

// A credential retry is safe only before any exec in this operation was submitted.
export function CredentialRetry({
  data,
  run,
  onRun,
  onError,
}: {
  data: Snapshot;
  run: import("@/types").CommandRun;
  onRun: (run: import("@/types").CommandRun) => void;
  onError: (error: string) => void;
}) {
  const { t } = useTranslation("commands");
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const service = data.services?.find(
    (s) => s.id === run.serviceId && s.revision === run.serviceRevision,
  );
  if (
    !service ||
    service.executionEnabled === false ||
    run.submitted ||
    run.error !== "authentication"
  )
    return null;
  if (
    run.workflowRuleId &&
    !data.rules.some(
      (r) => r.id === run.workflowRuleId && r.hostId === run.hostId,
    )
  )
    return null;
  const operation = run.actionId.startsWith("$connect:")
    ? "connect"
    : run.actionId === "$status"
      ? "checkStatus"
      : run.actionId === "$health"
        ? "checkHealth"
        : "action";
  const routeIds = [
    run.hostId,
    ...(run.workflowRuleId
      ? [data.rules.find((r) => r.id === run.workflowRuleId)?.hostId]
      : []),
  ];
  const hosts = [
    ...new Map(
      routeIds
        .flatMap((id) => {
          const h = data.hosts.find((h) => h.id === id);
          return h ? [...jumpHosts(data.hosts, h), h] : [];
        })
        .map((h) => [h.id, h]),
    ).values(),
  ];
  const close = () => {
    setOpen(false);
    setValues({});
    setRemember({});
  };
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          requestId.current = crypto.randomUUID();
          setOpen(true);
        }}
      >
        {t("retryAuth")}
      </Button>
      <AnimatePresence>
        {open && (
          <Modal
            key="credential-retry"
            title={t("retryAuth")}
            description={t("executeHint")}
            close={close}
          >
            <code>{run.endpoint}</code>
            <form
              id="service-retry-auth"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                void bridge
                  .runServiceOperation({
                    serviceId: service.id,
                    revision: service.revision,
                    requestId: requestId.current,
                    operation,
                    actionId: operation === "action" ? run.actionId : undefined,
                    ruleId: run.workflowRuleId || undefined,
                    confirmed: true,
                    secrets: values,
                    rememberHostIds: Object.keys(remember).filter(
                      (id) => remember[id],
                    ),
                  })
                  .then((next) => {
                    onRun(next);
                    close();
                  })
                  .catch((e) =>
                    onError(
                      t(`error.${String(e)}`, { defaultValue: String(e) }),
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {hosts
                .filter((h) => h.authMethod !== "agent")
                .map((host) => (
                  <AuthenticationField
                    key={host.id}
                    host={host}
                    value={values[host.id] || ""}
                    onChange={(value) =>
                      setValues((v) => ({ ...v, [host.id]: value }))
                    }
                    remember={!!remember[host.id]}
                    onRemember={(value) =>
                      setRemember((v) => ({ ...v, [host.id]: value }))
                    }
                  />
                ))}
              <ModalActions>
                <Button
                  type="submit"
                  form="service-retry-auth"
                  disabled={busy}
                  variant="primary-soft"
                >
                  {t("execute")}
                </Button>
              </ModalActions>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
