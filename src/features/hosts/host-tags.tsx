import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Host } from "@/types";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";

export function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

export function HostTags({
  hosts,
  value,
  onChange,
}: {
  hosts: Host[];
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation("tunnel");
  const [query, setQuery] = useState("");
  const anchor = useComboboxAnchor();
  const selected = normalizeTags(value);
  const available = useMemo(
    () =>
      normalizeTags([...hosts.flatMap((host) => host.tags), ...value]).sort(
        (a, b) => a.localeCompare(b),
      ),
    [hosts, value],
  );
  const candidate = query.trim();
  const creating = !!candidate && !available.includes(candidate);
  const items = creating ? [...available, candidate] : available;
  return (
    <div className="field" role="group" aria-label={t("tags")}>
      <span>{t("tags")}</span>
      <Combobox<string, true>
        multiple
        items={items}
        value={selected}
        inputValue={query}
        onInputValueChange={setQuery}
        onValueChange={(tags) => {
          onChange(normalizeTags(tags));
          setQuery("");
        }}
        filter={(item, input) =>
          item.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())
        }
        autoHighlight
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(tags: string[]) =>
              tags.map((tag) => (
                <ComboboxChip key={tag} removeLabel={t("removeTag", { tag })}>
                  {tag}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput
            aria-label={t("tags")}
            placeholder={t("tagsPlaceholder")}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !query.trim() &&
                !event.nativeEvent.isComposing
              )
                event.preventDefault();
            }}
          />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>{t("tagsPlaceholder")}</ComboboxEmpty>
          <ComboboxList>
            {(tag: string) => (
              <ComboboxItem key={tag} value={tag}>
                {creating && tag === candidate ? t("createTag", { tag }) : tag}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
