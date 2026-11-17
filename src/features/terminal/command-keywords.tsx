import { useMemo, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { commandKeywords, type SavedCommand } from "./saved-command-model";

export type KeywordDraft = { tags: string[]; text: string };
export function selectedKeywords({ tags, text }: KeywordDraft) {
  return commandKeywords([...tags, text].join(","));
}
export function CommandKeywords({
  draft,
  onChange,
  entries,
  inputRef,
}: {
  draft: KeywordDraft;
  onChange: (draft: KeywordDraft) => void;
  entries: SavedCommand[];
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation("terminal");
  const anchor = useComboboxAnchor();
  const known = useMemo(
    () =>
      commandKeywords(
        entries.flatMap((entry) => entry.keywords).join(","),
      ).sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const available = commandKeywords([...known, ...draft.tags].join(","));
  const candidate = draft.text.trim();
  const creating =
    !!candidate &&
    commandKeywords([...available, candidate].join(",")).length >
      available.length;
  const items = creating ? [candidate, ...available] : available;
  return (
    <Combobox<string, true>
      multiple
      autoHighlight
      items={items}
      value={draft.tags}
      inputValue={draft.text}
      onValueChange={(tags) =>
        onChange({ tags: commandKeywords(tags.join(",")), text: "" })
      }
      onInputValueChange={(text, details) => {
        if (details.reason !== "input-change") return;
        const chunks = text.split(/[,，、\n]/u);
        const remaining = chunks.pop() ?? "";
        onChange({
          tags: commandKeywords([...draft.tags, ...chunks].join(",")),
          text: remaining,
        });
      }}
      filter={(tag, input) =>
        tag.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())
      }
    >
      <ComboboxChips ref={anchor} className="min-w-0 flex-1">
        <ComboboxValue>
          {(tags: string[]) =>
            tags.map((tag) => (
              <ComboboxChip
                key={tag}
                removeLabel={t("removeTag", { ns: "tunnel", tag })}
              >
                {tag}
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput
          ref={inputRef}
          aria-label={t("commandKeywords")}
          placeholder={t("tagsPlaceholder", { ns: "tunnel" })}
        />
      </ComboboxChips>
      {!!items.length && (
        <ComboboxContent anchor={anchor} data-command-keyword-options="">
          <ComboboxList>
            {(tag: string) => (
              <ComboboxItem key={tag} value={tag}>
                {creating && tag === candidate
                  ? t("createTag", { ns: "tunnel", tag })
                  : tag}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      )}
    </Combobox>
  );
}
