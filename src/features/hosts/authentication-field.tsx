import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/tunnel-form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import * as bridge from "@/lib/bridge";
import type { Host } from "@/types";

export function AuthenticationField({
  host,
  value,
  onChange,
  remember,
  onRemember,
}: {
  host: Host;
  value: string;
  onChange: (value: string) => void;
  remember: boolean;
  onRemember: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [status, setStatus] = useState<bridge.PasswordStatus>();
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const lifetime = useRef(0);
  const eligible = host.authMethod === "auto" || host.authMethod === "password";
  useEffect(() => {
    let live = true;
    lifetime.current += 1;
    setStatus(undefined);
    setError("");
    if (eligible && bridge.desktop)
      void bridge
        .passwordStatus([host.id])
        .then(([next]) => {
          if (live) setStatus(next);
        })
        .catch(() => {
          if (live) setError(t("passwordStorageUnavailable"));
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
    <div className="mb-4 space-y-2">
      <Field label={`${host.name} · ${t("password")}`}>
        <Input
          type="password"
          autoComplete="off"
          value={value}
          placeholder={
            status?.saved ? t("savedPasswordPlaceholder") : undefined
          }
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      {eligible && status?.supported && (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor={id}>{t("rememberPassword")}</label>
            <Switch id={id} checked={remember} onCheckedChange={onRemember} />
          </div>
          <p className="muted text-xs">{t("rememberPasswordHint")}</p>
          {(status.saved || status.error) && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="muted">
                {status.saved
                  ? t("passwordSaved")
                  : t("passwordStorageNeedsAttention")}
              </span>
              <Button
                type="button"
                variant="destructive"
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
                      if (lifetime.current === version) setError(String(e));
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
          {error || status?.error}
        </p>
      )}
    </div>
  );
}
