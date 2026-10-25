import { formatNativeMessage } from "@/lib/native-message";
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { ServerPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, ModalActions } from "@/components/tunnel-form";
import type {
  ConnectionOptions,
  Host,
  Rule,
  RemoteService,
  ServiceLink,
} from "@/types";
import { defaultConnection, rulePath } from "./rule-model";
import { ServicePicker } from "@/features/commands/service-picker";
import { ServiceProtocolPicker } from "./service-protocol";
import { ConnectionColorPicker } from "./connection-color";
import { ConnectionIconPicker } from "./connection-icon";
import { HostPicker } from "@/features/hosts/host-picker";
import { ParameterField, ParameterSwitch } from "@/components/parameter-field";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

export function ConnectionFields({
  value,
  onChange,
}: {
  value: ConnectionOptions;
  onChange: (v: ConnectionOptions) => void;
}) {
  const { t } = useTranslation("tunnel");
  return (
    <div className="parameter-fields connection-fields">
      {(
        [
          [
            "connectTimeoutSecs",
            "connectTimeoutTitle",
            "-o ConnectTimeout",
            "connectTimeoutHint",
            1,
            600,
          ],
          [
            "keepaliveIntervalSecs",
            "keepaliveIntervalTitle",
            "-o ServerAliveInterval",
            "keepaliveIntervalHint",
            0,
            3600,
          ],
          [
            "keepaliveMax",
            "keepaliveMax",
            "-o ServerAliveCountMax",
            "keepaliveMaxHint",
            1,
            100,
          ],
        ] as const
      ).map(([key, label, parameter, description, min, max]) => (
        <ParameterField
          label={t(label)}
          parameter={parameter}
          description={t(description)}
          key={key}
          layout="inline"
          unit={t(key === "keepaliveMax" ? "unitAttempts" : "unitSeconds")}
        >
          <Input
            type="number"
            required
            min={min}
            max={max}
            value={value[key]}
            onChange={(e) =>
              onChange({ ...value, [key]: Number(e.target.value) })
            }
          />
        </ParameterField>
      ))}
    </div>
  );
}

export function RuleEditor({
  draft,
  hosts,
  services = [],
  selectedServiceIds,
  onServicesChange,
  busy,
  reconnect,
  onChange,
  onAddHost,
  onManageHosts,
  onManageServices,
  onSave,
  onCancel,
}: {
  draft: Rule;
  hosts: Host[];
  services?: RemoteService[];
  selectedServiceIds?: string[];
  onServicesChange?: (ids: string[]) => void;
  busy: boolean;
  reconnect: boolean;
  onChange: (r: Rule) => void;
  onAddHost: () => void;
  onManageHosts: () => void;
  onManageServices?: () => void;
  onSave: (start: boolean, serviceLinks?: ServiceLink[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const selected = hosts.find((h) => h.id === draft.hostId);
  const formId = useId();
  const [localServiceIds, setLocalServiceIds] = useState(() =>
    services.filter((s) => s.ruleIds.includes(draft.id)).map((s) => s.id),
  );
  const serviceIds = selectedServiceIds ?? localServiceIds;
  const setServiceIds = onServicesChange ?? setLocalServiceIds;
  const save = (launch: boolean) =>
    onSave(
      launch,
      services.map((s) => ({
        id: s.id,
        revision: s.revision,
        selected: serviceIds.includes(s.id),
      })),
    );
  const eligible = selected && !selected.diagnostics.length;
  const change = (r: Partial<Rule>) => onChange({ ...draft, ...r });
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <Field label={t("name")}>
        <Input
          required
          value={draft.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </Field>
      <ConnectionColorPicker
        value={draft.color}
        onChange={(color) => change({ color })}
      />
      <ConnectionIconPicker
        value={draft.icon}
        color={draft.color}
        onChange={(icon) => change({ icon })}
      />
      <HostPicker
        hosts={hosts}
        value={draft.hostId}
        onChange={(hostId) => change({ hostId })}
        actions={
          <>
            <Button type="button" variant="ghost" size="xs" onClick={onAddHost}>
              <ServerPlusIcon aria-hidden="true" />
              {t("addHost")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onManageHosts}
            >
              {t("manageHosts")}
            </Button>
          </>
        }
      />
      {!hosts.length && <p className="muted">{t("noHostsBody")}</p>}
      {selected?.diagnostics.map((d, i) => (
        <p key={i} className="inline-error">
          {formatNativeMessage(d)}
        </p>
      ))}
      <ServicePicker
        services={services}
        value={serviceIds}
        onChange={setServiceIds}
        disabled={busy}
        actions={
          onManageServices && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={onManageServices}
            >
              {t("manageServices", { ns: "commands" })}
            </Button>
          )
        }
      />
      <Field label={t("forwardType")}>
        <Select
          items={[
            { value: "L", label: t("typeL") },
            { value: "R", label: t("typeR") },
            { value: "D", label: t("typeD") },
          ]}
          value={draft.kind}
          onValueChange={(kind) =>
            kind &&
            change({
              kind: kind as Rule["kind"],
              bindAddress: "127.0.0.1",
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value="L">{t("typeL")}</SelectItem>
            <SelectItem value="R">{t("typeR")}</SelectItem>
            <SelectItem value="D">{t("typeD")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <p className="muted form-hint">{t(`example${draft.kind}`)}</p>
      <ServiceProtocolPicker
        value={draft.serviceProtocol}
        disabled={draft.kind === "D"}
        onChange={(serviceProtocol) => change({ serviceProtocol })}
      />
      <div className="form-grid">
        <Field
          label={t(draft.kind === "R" ? "remoteBindAddress" : "bindAddress")}
        >
          <Input
            required
            value={draft.bindAddress}
            onChange={(e) => change({ bindAddress: e.target.value })}
          />
        </Field>
        <Field label={t(draft.kind === "R" ? "remoteBindPort" : "bindPort")}>
          <Input
            type="number"
            min={1}
            max={65535}
            required
            value={draft.bindPort || ""}
            onChange={(e) => change({ bindPort: Number(e.target.value) })}
          />
        </Field>
      </div>
      {draft.kind === "D" ? (
        <p className="muted">{t("socksHint")}</p>
      ) : (
        <div className="form-grid">
          <Field
            label={t(draft.kind === "R" ? "localTargetHost" : "targetHost")}
          >
            <Input
              required
              value={draft.targetHost}
              onChange={(e) => change({ targetHost: e.target.value })}
            />
          </Field>
          <Field label={t("targetPort")}>
            <Input
              type="number"
              min={1}
              max={65535}
              required
              value={draft.targetPort || ""}
              onChange={(e) => change({ targetPort: Number(e.target.value) })}
            />
          </Field>
        </div>
      )}
      {!["127.0.0.1", "::1", "localhost"].includes(draft.bindAddress) && (
        <p className="inline-error">
          {t(
            draft.kind === "R"
              ? "remoteExposure"
              : draft.kind === "D"
                ? "socksLoopback"
                : "localExposure",
          )}
        </p>
      )}
      <details className="advanced-fields rule-advanced">
        <summary>{t("advanced")}</summary>
        <div className="advanced-content">
          <ParameterSwitch
            label={t("noRemoteCommand")}
            parameter="-N"
            description={t("noRemoteCommandHint")}
            checked={draft.noRemoteCommand}
            onCheckedChange={(checked) =>
              change({
                noRemoteCommand: checked,
                remoteCommand: checked ? "" : draft.remoteCommand,
              })
            }
          />
          {!draft.noRemoteCommand && (
            <>
              <ParameterField
                label={t("remoteCommand")}
                parameter="-o RemoteCommand"
                description={t("commandHint")}
              >
                <Input
                  required
                  autoComplete="off"
                  value={draft.remoteCommand}
                  onChange={(e) => change({ remoteCommand: e.target.value })}
                />
              </ParameterField>
            </>
          )}
          <ParameterSwitch
            label={t("autoReconnect")}
            description={t("reconnectPolicyHint")}
            checked={draft.reconnect.enabled}
            onCheckedChange={(checked) =>
              change({
                reconnect: { ...draft.reconnect, enabled: checked },
              })
            }
          />
          {!draft.noRemoteCommand && draft.reconnect.enabled && (
            <>
              <ParameterSwitch
                label={t("repeatCommandOnReconnect")}
                description={t("repeatCommandHint")}
                checked={draft.repeatCommandOnReconnect}
                onCheckedChange={(checked) =>
                  change({ repeatCommandOnReconnect: checked })
                }
              />
            </>
          )}
          {draft.reconnect.enabled && (
            <div className="parameter-fields">
              <ParameterField
                label={t("maxAttempts")}
                description={t("maxAttemptsHint")}
                layout="inline"
                unit={t("unitAttempts")}
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={draft.reconnect.maxAttempts}
                  onChange={(e) =>
                    change({
                      reconnect: {
                        ...draft.reconnect,
                        maxAttempts: Number(e.target.value),
                      },
                    })
                  }
                />
              </ParameterField>
              <ParameterField
                label={t("initialDelayTitle")}
                description={t("initialDelayHint")}
                layout="inline"
                unit={t("unitSeconds")}
              >
                <Input
                  type="number"
                  min={1}
                  max={3600}
                  required
                  value={draft.reconnect.initialDelaySecs}
                  onChange={(e) =>
                    change({
                      reconnect: {
                        ...draft.reconnect,
                        initialDelaySecs: Number(e.target.value),
                      },
                    })
                  }
                />
              </ParameterField>
              <ParameterField
                label={t("maxDelayTitle")}
                description={t("maxDelayHint")}
                layout="inline"
                unit={t("unitSeconds")}
              >
                <Input
                  type="number"
                  min={draft.reconnect.initialDelaySecs}
                  max={3600}
                  required
                  value={draft.reconnect.maxDelaySecs}
                  onChange={(e) =>
                    change({
                      reconnect: {
                        ...draft.reconnect,
                        maxDelaySecs: Number(e.target.value),
                      },
                    })
                  }
                />
              </ParameterField>
            </div>
          )}
          <ParameterSwitch
            label={t("autoConnect")}
            description={t("autoConnectHint")}
            checked={draft.autoConnect}
            onCheckedChange={(checked) => change({ autoConnect: checked })}
          />
          <ParameterSwitch
            label={t("overrideConnection")}
            description={t("overrideConnectionHint")}
            checked={!!draft.connection}
            onCheckedChange={(checked) =>
              change({
                connection: checked
                  ? { ...(selected?.connection || defaultConnection()) }
                  : null,
              })
            }
          />
          {draft.connection ? (
            <ConnectionFields
              value={draft.connection}
              onChange={(connection) => change({ connection })}
            />
          ) : null}
        </div>
      </details>
      <div className="path-preview">
        <small>{t("path")}</small>
        <code>
          {rulePath(draft, selected?.name || t("selectHost"), t("local"))}
        </code>
        <small>{t(`dns${draft.kind}`)}</small>
      </div>
      {reconnect && <p className="inline-error">{t("reconnectHint")}</p>}
      <ModalActions>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          form={formId}
          disabled={
            busy ||
            !eligible ||
            (draft.kind === "D" &&
              !["127.0.0.1", "::1"].includes(draft.bindAddress))
          }
        >
          {t(reconnect ? "saveReconnect" : "save")}
        </Button>
        {!reconnect && (
          <Button
            type="submit"
            form={formId}
            variant="primary-soft"
            disabled={
              busy ||
              !eligible ||
              (draft.kind === "D" &&
                !["127.0.0.1", "::1"].includes(draft.bindAddress))
            }
            onClick={(e) => {
              if (e.currentTarget.form?.reportValidity()) {
                e.preventDefault();
                save(true);
              }
            }}
          >
            {t("saveStart")}
          </Button>
        )}
      </ModalActions>
    </form>
  );
}
