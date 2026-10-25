import { formatUiError } from "@/lib/ui-message";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectionIcon } from "@/features/tunnels/connection-icon";
import {
  localizedServiceTemplates,
  applyLaunchTemplate,
  groupServiceTemplates,
  serviceTemplateGroups,
  type ServiceTemplateGroup,
} from "./service-template-catalog";
import type { ServiceTemplate } from "@/types";
import { directServiceTemplate } from "./direct-service-templates";
import * as bridge from "@/lib/bridge";

export function ServiceTemplateDialog({
  close,
  apply,
}: {
  close: () => void;
  apply: (template: ServiceTemplate) => void;
}) {
  const { t } = useTranslation("commands");
  const id = useId();
  const [kind, setKind] = useState("nginx");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dismiss = () => {
    mounted.current = false;
    close();
  };
  const options = localizedServiceTemplates(t);
  const categoryNames = Object.fromEntries(
    serviceTemplateGroups.map((category) => [
      category,
      t(`templates.groups.${category}`),
    ]),
  ) as Record<ServiceTemplateGroup, string>;
  const groups = groupServiceTemplates(options, search, categoryNames);
  const selected = groups
    .flatMap((group) => group.templates)
    .find((option) => option.id === kind);
  return (
    <Modal
      title={t("templates.title")}
      description={t("templates.hint")}
      close={dismiss}
      className="max-w-3xl sm:max-w-3xl"
    >
      <form
        id={`${id}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          if (pending.current) return;
          const preset = selected;
          if (!preset) return;
          pending.current = true;
          setBusy(true);
          setError("");
          void (async () => {
            if (preset.manager === "direct")
              return directServiceTemplate(preset);
            const base = await bridge.previewServiceTemplate(
              preset.manager,
              preset.resource,
            );
            return applyLaunchTemplate(base, preset, preset.launch);
          })()
            .then((template) => {
              if (!mounted.current) return;
              apply({
                ...template,
                actions: template.actions.map((action) => ({
                  ...action,
                  label: t(
                    action.kind === "custom"
                      ? `templates.actions.${action.label}`
                      : `kind.${action.kind}`,
                  ),
                })),
              });
            })
            .catch((error) => {
              if (mounted.current) setError(formatUiError(String(error), t));
            })
            .finally(() => {
              pending.current = false;
              if (mounted.current) setBusy(false);
            });
        }}
      >
        <label className="field" htmlFor={`${id}-search`}>
          <span>{t("templates.search")}</span>
          <Input
            id={`${id}-search`}
            type="search"
            value={search}
            disabled={busy}
            placeholder={t("templates.searchHint")}
            onChange={(event) => {
              setSearch(event.target.value);
              setError("");
            }}
          />
        </label>
        <fieldset className="service-template-choices" disabled={busy}>
          <legend>{t("templates.kind")}</legend>
          {groups.map((group) => (
            <section
              className="service-template-group"
              key={group.category}
              aria-labelledby={`${id}-${group.category}`}
            >
              <h3 id={`${id}-${group.category}`}>{group.name}</h3>
              <div className="service-template-grid">
                {group.templates.map((preset) => (
                  <label className="service-template-option" key={preset.id}>
                    <input
                      type="radio"
                      name={`${id}-template`}
                      value={preset.id}
                      checked={kind === preset.id}
                      onChange={() => {
                        setKind(preset.id);
                        setError("");
                      }}
                    />
                    <ConnectionIcon
                      icon={{ kind: "builtin", value: preset.icon }}
                      color={preset.color}
                    />
                    <span>{preset.name}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="muted" role="status">
              {t("templates.noResults")}
            </p>
          )}
        </fieldset>
        <p className="muted">{t("templates.replaceHint")}</p>
        {error && (
          <p role="alert" className="inline-error">
            {formatUiError(error, t)}
          </p>
        )}
      </form>
      <ModalActions>
        <Button type="button" variant="ghost" onClick={dismiss}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          form={`${id}-form`}
          variant="primary-soft"
          disabled={busy || !bridge.desktop || !selected}
        >
          {t("templates.import")}
        </Button>
      </ModalActions>
    </Modal>
  );
}
