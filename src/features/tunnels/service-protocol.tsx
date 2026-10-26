import { ExternalLinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import type { Rule, Runtime, ServiceProtocol } from "@/types";

export function ServiceProtocolPicker({
  value,
  disabled,
  onChange,
}: {
  value: ServiceProtocol | null;
  disabled: boolean;
  onChange: (value: ServiceProtocol | null) => void;
}) {
  const { t } = useTranslation("tunnel");
  return (
    <div className="field">
      <span className="field-label" id="service-protocol-label">
        {t("serviceProtocol")}
      </span>
      <ToggleGroup<ServiceProtocol>
        aria-labelledby="service-protocol-label"
        className="flex flex-wrap gap-1.5"
        value={value ? [value] : []}
        multiple={false}
        disabled={disabled}
        title={disabled ? t("serviceDynamic") : undefined}
        onValueChange={(values) => onChange(values[0] ?? null)}
      >
        {(["http", "https", "vnc"] as const).map((protocol) => (
          <Toggle key={protocol} value={protocol}>
            {protocol.toUpperCase()}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function serviceUnavailableReason(
  rule: Rule,
  runtime?: Pick<Runtime, "status" | "configurationChanged">,
): string | null {
  if (!rule.serviceProtocol) return "serviceSelectProtocol";
  if (rule.kind === "D") return "serviceDynamic";
  if (
    rule.kind === "R" &&
    /^(127\.|::1$|localhost$|.*\.localhost$)/i.test(rule.bindAddress)
  )
    return "serviceRemoteLoopback";
  if (!runtime || runtime.status !== "listening") return "serviceStartFirst";
  if (runtime.configurationChanged) return "serviceReconnect";
  return null;
}

export function OpenServiceButton({
  rule,
  runtime,
  desktop,
  onOpen,
}: {
  rule: Rule;
  runtime?: Pick<Runtime, "status" | "configurationChanged">;
  desktop: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation("tunnel");
  if (!rule.serviceProtocol) return null;
  const reason = desktop
    ? serviceUnavailableReason(rule, runtime)
    : "serviceDesktopOnly";
  return (
    <span
      className="service-open-action nodrag nopan inline-flex"
      title={t(reason || "openService")}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!!reason}
        aria-label={`${t("openService")} ${rule.name}`}
        onClick={() => onOpen(rule.id)}
      >
        <ExternalLinkIcon />
      </Button>
    </span>
  );
}
