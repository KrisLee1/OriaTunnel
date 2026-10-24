import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionIcon } from "@/features/tunnels/connection-icon";
import {
  Combobox,
  ComboboxValue,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import type { RemoteService } from "@/types";
export function ServicePicker({
  services,
  value,
  onChange,
  disabled,
  actions,
}: {
  services: RemoteService[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  actions?: ReactNode;
}) {
  const { t } = useTranslation("commands");
  const anchor = useComboboxAnchor();
  const selected = services.filter((s) => value.includes(s.id));
  return (
    <div className="field" role="group" aria-label={t("services")}>
      {actions ? (
        <div className="field-heading">
          <span>{t("services")}</span>
          <div className="field-heading-actions">{actions}</div>
        </div>
      ) : (
        <span>{t("services")}</span>
      )}
      <Combobox<RemoteService, true>
        multiple
        items={services}
        value={selected}
        disabled={disabled}
        onValueChange={(items) => onChange(items.map((s) => s.id))}
        itemToStringLabel={(s) => s.name}
        itemToStringValue={(s) => s.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        name="serviceIds"
        autoHighlight
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(selected: RemoteService[]) =>
              selected.map((service) => (
                <ComboboxChip
                  key={service.id}
                  removeLabel={`${t("removeBinding")} ${service.name}`}
                >
                  <ConnectionIcon
                    icon={service.icon}
                    color={service.color ?? null}
                  />
                  {service.name}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput
            aria-label={t("services")}
            placeholder={t("selectServices")}
          />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>{t("noServices")}</ComboboxEmpty>
          <ComboboxList>
            {(service: RemoteService) => (
              <ComboboxItem key={service.id} value={service}>
                <ConnectionIcon
                  icon={service.icon}
                  color={service.color ?? null}
                />
                {service.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
