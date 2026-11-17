import { useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  CommandKeywords,
  selectedKeywords,
  type KeywordDraft,
} from "./command-keywords";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { type SavedCommand } from "./saved-command-model";

export function SaveCommandPopover({
  anchor,
  command,
  entries,
  persist,
  close,
}: {
  anchor: RefObject<HTMLTextAreaElement | null>;
  command: string;
  entries: SavedCommand[];
  persist: (previous: SavedCommand | null, next: SavedCommand) => Promise<void>;
  close: () => void;
}) {
  const { t } = useTranslation("terminal");
  // Keep the original record so another window's edit is detected on save.
  const [original] = useState(
    () => entries.find((entry) => entry.command === command) ?? null,
  );
  const [keywords, setKeywords] = useState<KeywordDraft>({
    tags: original?.keywords ?? [],
    text: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const values = selectedKeywords(keywords);
  const save = async () => {
    if (pending.current || !values.length) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await persist(original, {
        id: original?.id ?? crypto.randomUUID(),
        command,
        keywords: values,
      });
      close();
      anchor.current?.focus({ preventScroll: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Popover
      open
      modal={false}
      onOpenChange={(open, details) => {
        if (!open && !pending.current) {
          close();
          if (details.reason === "escape-key")
            anchor.current?.focus({ preventScroll: true });
        }
      }}
    >
      <PopoverContent
        data-save-command-popover=""
        anchor={anchor}
        align="start"
        sideOffset={4}
        collisionBoundary={
          anchor.current?.closest(".ssh-terminal-view") ?? undefined
        }
        className="w-[min(22rem,var(--available-width))] p-2"
        aria-label={t("saveCommand")}
        initialFocus={input}
        finalFocus={false}
      >
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <CommandKeywords
            draft={keywords}
            onChange={setKeywords}
            entries={entries}
            inputRef={input}
          />
          <Button type="submit" size="sm" disabled={busy || !values.length}>
            {t("save", { ns: "tunnel" })}
          </Button>
        </form>
        {error && (
          <p role="alert" className="terminal-error">
            {t(error)}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
