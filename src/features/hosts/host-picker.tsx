import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Host } from "@/types";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";
import { groupHosts } from "./host-groups";
import { hostAuthLabels } from "./host-auth";

type HostOption = { host: Host; key: string };
type HostOptionGroup = { key: string; label: string; items: HostOption[] };
export function HostPicker({
  hosts,
  value,
  onChange,
}: {
  hosts: Host[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation("tunnel");
  const groups = useMemo<HostOptionGroup[]>(
    () =>
      groupHosts(hosts, "tags").map(([tag, members]) => ({
        key: tag,
        label: tag || t("ungrouped"),
        items: members.map((host) => ({ host, key: `${tag}:${host.id}` })),
      })),
    [hosts, value, t],
  );
  const selected =
    groups
      .flatMap((group) => group.items)
      .find((item) => item.host.id === value) || null;
  return (
    <div className="field" role="group" aria-label={t("host")}>
      <span>{t("host")}</span>
      <Combobox<HostOption>
        items={groups}
        value={selected}
        onValueChange={(option) => onChange(option?.host.id || "")}
        itemToStringLabel={(option) =>
          `${option.host.name} · ${option.host.user}@${option.host.address}:${option.host.port}`
        }
        itemToStringValue={(option) => option.host.id}
        isItemEqualToValue={(a, b) => a.host.id === b.host.id}
        filter={(option, query) =>
          `${option.host.name} ${option.host.user} ${option.host.address} ${option.host.port} ${option.host.tags.join(" ")}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())
        }
        name="hostId"
        required
        autoHighlight
      >
        <ComboboxInput
          aria-label={t("host")}
          placeholder={t("selectHostSearch")}
          triggerLabel={t("showHostOptions")}
        />
        <ComboboxContent>
          <ComboboxEmpty>{t("noMatchingHosts")}</ComboboxEmpty>
          <ComboboxList>
            {(group: HostOptionGroup) => (
              <ComboboxGroup key={group.key} items={group.items}>
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(option: HostOption) => (
                    <ComboboxItem key={option.key} value={option}>
                      <span className="host-option-text">
                        <strong>{option.host.name}</strong>
                        <small>
                          {option.host.user}@{option.host.address}:
                          {option.host.port} ·{" "}
                          {t(hostAuthLabels[option.host.authMethod])}
                          {option.host.diagnostics.length
                            ? ` · ${t("status-configuration-error")}`
                            : ""}
                        </small>
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {value && !selected && (
        <p className="inline-error">{t("sourceMissing")}</p>
      )}
    </div>
  );
}
