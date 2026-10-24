import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ServiceReview } from "@/features/commands/service-review";
import type { Snapshot } from "@/types";
import * as bridge from "@/lib/bridge";
import { toast } from "@/components/ui/toast";
export function ConfigExportDialog({
  data,
  ruleIds,
  initialServiceIds = [],
  close,
}: {
  data: Snapshot;
  ruleIds: string[];
  initialServiceIds?: string[];
  close: () => void;
}) {
  const { t } = useTranslation("commands");
  const serviceExport = initialServiceIds.length > 0;
  const [include, setInclude] = useState(serviceExport);
  const [selected, setSelected] = useState(initialServiceIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const services = (data.services || []).filter(
    (service) => !serviceExport || initialServiceIds.includes(service.id),
  );
  return (
    <Modal
      title={t("exportConfig", { ns: "tunnel" })}
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="config-export-summary">
        {ruleIds.length > 0 && (
          <span>{t("sharing.exportRules", { count: ruleIds.length })}</span>
        )}
        {include && (
          <span>{t("serviceCount", { count: selected.length })}</span>
        )}
      </div>
      {!serviceExport && services.length > 0 && (
        <label className="field service-switch-field">
          <span>{t("sharing.includeCommands")}</span>
          <Switch
            checked={include}
            disabled={busy}
            onCheckedChange={setInclude}
          />
        </label>
      )}
      {include && (
        <div className="config-export-services">
          {services.map((service) => (
            <section key={service.id} className="import-entry themed-surface">
              <label className="check-field config-export-service-heading">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(service.id)}
                  onChange={(event) =>
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, service.id]
                        : ids.filter((id) => id !== service.id),
                    )
                  }
                />
                <strong>{service.name}</strong>
                <span className="muted">
                  {t("commandCount", { count: service.actions.length })}
                </span>
              </label>
              <details className="config-export-review">
                <summary>{t("sharing.review")}</summary>
                <ServiceReview
                  service={service}
                  endpoint={t("boundTargetHint")}
                />
              </details>
            </section>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <ModalActions>
        <Button type="button" variant="ghost" disabled={busy} onClick={close}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          variant="primary-soft"
          disabled={busy || (!ruleIds.length && (!include || !selected.length))}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            setError("");
            void bridge
              .exportConfig(ruleIds, include ? selected : [])
              .then((path) => {
                if (path) {
                  toast.add({
                    title: t("exported", { ns: "tunnel" }),
                    description: path,
                    type: "success",
                  });
                  close();
                }
              })
              .catch((error) =>
                setError(
                  t(`error.${String(error)}`, { defaultValue: String(error) }),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {t("chooseExportFile", { ns: "tunnel" })}
        </Button>
      </ModalActions>
    </Modal>
  );
}
