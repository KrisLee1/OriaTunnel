import { ExternalLinkIcon, ScreenShareIcon } from "lucide-react";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useVncClientSettings,
  type VncClient,
} from "@/stores/vnc-client-settings-store";
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
  onOpen: (id: string, internalVnc?: boolean) => void;
}) {
  const { t } = useTranslation("tunnel");
  const { t: vnc } = useTranslation("vnc");
  if (!rule.serviceProtocol) return null;
  const reason = desktop
    ? serviceUnavailableReason(rule, runtime)
    : "serviceDesktopOnly";
  const isVnc = rule.serviceProtocol === "vnc";
  const label = isVnc ? vnc("openVnc") : t("openService");
  function button(open: () => void, asks = false, trigger?: RefObject<HTMLButtonElement | null>) {
    return (
      <span
        className="service-open-action nodrag nopan inline-flex"
        title={reason ? t(reason) : label}
      >
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!!reason}
          aria-label={`${label} ${rule.name}`}
          aria-haspopup={asks ? "dialog" : undefined}
          onClick={open}
        >
          {isVnc ? <ScreenShareIcon /> : <ExternalLinkIcon />}
        </Button>
      </span>
    );
  }
  if (!isVnc) return button(() => onOpen(rule.id));
  return (
    <VncLauncher name={rule.name} disabled={!!reason} onOpen={(internal) => onOpen(rule.id, internal)}>
      {button}
    </VncLauncher>
  );
}

export function VncLauncher({ name, disabled, onOpen, children }: {
  name: string;
  disabled: boolean;
  onOpen: (internal: boolean) => void;
  children: (open: () => void, asks: boolean, trigger: RefObject<HTMLButtonElement | null>) => ReactNode;
}) {
  const { t: vnc } = useTranslation("vnc");
  const { client, remembered, rememberClient } = useVncClientSettings();
  const [selection, setSelection] = useState<VncClient | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const group = useId();
  function open() {
    if (disabled) return;
    if (remembered) onOpen(client === "internal");
    else setSelection(client);
  }
  function confirm(always: boolean) {
    if (!selection || disabled) return;
    if (always) rememberClient(selection);
    setSelection(null);
    onOpen(selection === "internal");
  }
  return (
    <>
      {children(open, !remembered, trigger)}
      {selection !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelection(null);
          }}
        >
          <DialogContent
            closeLabel={vnc("modal.close", { ns: "common" })}
            finalFocus={trigger}
          >
            <DialogHeader>
              <DialogTitle>{vnc("chooseClient")}</DialogTitle>
              <DialogDescription className="break-all">
                {name}
              </DialogDescription>
            </DialogHeader>
            <fieldset className="grid gap-2">
              <legend className="sr-only">{vnc("client")}</legend>
              {(["internal", "system"] as const).map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 has-checked:border-ring has-checked:bg-accent/30"
                >
                  <input
                    type="radio"
                    name={group}
                    value={value}
                    checked={selection === value}
                    onChange={() => setSelection(value)}
                    className="accent-primary"
                  />
                  {vnc(value === "internal" ? "thisAppVnc" : "systemDefaultVnc")}
                </label>
              ))}
            </fieldset>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => confirm(false)}
              >
                {vnc("justOnce")}
              </Button>
              <Button disabled={disabled} onClick={() => confirm(true)}>
                {vnc("always")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
