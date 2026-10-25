import { formatNativeMessage } from "@/lib/native-message";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EyeIcon, EyeClosedIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ModalActions } from "@/components/tunnel-form";
import * as bridge from "@/lib/bridge";
import type { Host } from "@/types";

export function AuthenticationField({
  host,
  value,
  onChange,
  remember,
  onRemember,
  actions,
  hideLabel = false,
}: {
  host: Host;
  value: string;
  onChange: (value: string) => void;
  remember: boolean;
  onRemember: (value: boolean) => void;
  actions?: ReactNode;
  hideLabel?: boolean;
}) {
  const { t } = useTranslation("tunnel");
  const id = useId();
  const inputId = `${id}-password`;
  const identity = JSON.stringify([
    host.id,
    host.address,
    host.port,
    host.user,
    host.authMethod,
  ]);
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const revealed = revealedFor === identity;
  const [status, setStatus] = useState<bridge.PasswordStatus>();
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const lifetime = useRef(0);
  const eligible = host.authMethod === "auto" || host.authMethod === "password";
  const ActionsRow = actions ? ModalActions : "div";
  useEffect(() => {
    let live = true;
    lifetime.current += 1;
    setStatus(undefined);
    setError("");
    setRevealedFor(null);
    if (eligible && bridge.desktop)
      void bridge
        .passwordStatus([host.id])
        .then(([next]) => {
          if (live) setStatus(next);
        })
        .catch(() => {
          if (live) setError("passwordStorageUnavailable");
        });
    return () => {
      live = false;
      lifetime.current += 1;
    };
  }, [
    host.id,
    host.address,
    host.port,
    host.user,
    host.authMethod,
    eligible,
    t,
  ]);
  return (
    <div className={actions ? "space-y-2" : "mb-4 space-y-2"}>
      <div className="field">
        <Label
          htmlFor={inputId}
          className={
            hideLabel ? "sr-only" : "text-xs font-normal text-muted-foreground"
          }
        >
          {host.name} ·{" "}
          {t(
            host.authMethod === "privateKey"
              ? "privateKeyPassphrase"
              : "password",
          )}
        </Label>
        <div className="relative">
          <Input
            id={inputId}
            type={revealed ? "text" : "password"}
            className="pr-10"
            autoComplete="off"
            value={value}
            placeholder={
              status?.saved ? t("savedPasswordPlaceholder") : undefined
            }
            onChange={(e) => onChange(e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-0.5 right-0.5 text-muted-foreground"
            aria-label={t(revealed ? "hidePassword" : "showPassword")}
            title={t(revealed ? "hidePassword" : "showPassword")}
            aria-controls={inputId}
            aria-pressed={revealed}
            onClick={() => setRevealedFor(revealed ? null : identity)}
          >
            {revealed ? (
              <EyeIcon aria-hidden="true" />
            ) : (
              <EyeClosedIcon aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      {eligible && status?.supported && (
        <>
          {(status.saved || status.error) && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="muted">
                {status.saved
                  ? t("passwordSaved")
                  : t("passwordStorageNeedsAttention")}
              </span>
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
                size="sm"
                disabled={clearing}
                onClick={() => {
                  const version = lifetime.current;
                  setClearing(true);
                  void bridge
                    .clearPassword(host.id)
                    .then(() => {
                      if (lifetime.current !== version) return;
                      setStatus({ ...status, saved: false, error: null });
                      onRemember(false);
                      setError("");
                    })
                    .catch((e) => {
                      if (lifetime.current === version)
                        toast.add({
                          title: formatNativeMessage(String(e)),
                          type: "error",
                          timeout: 6000,
                        });
                    })
                    .finally(() => {
                      if (lifetime.current === version) setClearing(false);
                    });
                }}
              >
                {t("clearSavedPassword")}
              </Button>
            </div>
          )}
        </>
      )}
      {(error || status?.error) && (
        <p role="alert" className="text-xs text-destructive">
          {formatNativeMessage(
            error ? t(error, { defaultValue: error }) : status?.error || "",
          )}
        </p>
      )}
      {((eligible && status?.supported) || actions) && (
        <ActionsRow className="authentication-actions flex items-center justify-between gap-3">
          {eligible && status?.supported && (
            <Label
              htmlFor={id}
              className="w-fit min-h-7 cursor-pointer text-sm font-normal"
            >
              <input
                id={id}
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                checked={remember}
                onChange={(event) => onRemember(event.target.checked)}
              />
              {t("rememberPassword")}
            </Label>
          )}
          {actions && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {actions}
            </div>
          )}
        </ActionsRow>
      )}
    </div>
  );
}
