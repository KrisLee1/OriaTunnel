import { PageEmptyState } from "@/components/page-empty-state";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BookText, Pencil, SearchX, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, Modal, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import {
  CommandKeywords,
  selectedKeywords,
  type KeywordDraft,
} from "./command-keywords";
import { Textarea } from "@/components/ui/textarea";
import { SearchInput } from "@/components/ui/search-input";
import {
  type SavedCommand,
  type SavedCommandLibrary,
} from "./saved-command-model";

type Editor = {
  previous: SavedCommand;
  command: string;
  keywords: KeywordDraft;
};
const Context = createContext<{
  entries: SavedCommand[];
  persist: (
    previous: SavedCommand | null,
    next: SavedCommand | null,
  ) => Promise<void>;
  manage: () => void;
} | null>(null);
export const useSavedCommands = () => useContext(Context);
export function SavedCommandsButton() {
  const library = useSavedCommands();
  const { t } = useTranslation("terminal");
  return (
    <Button
      type="button"
      data-saved-commands=""
      variant="ghost"
      size="icon-sm"
      title={t("savedCommands")}
      aria-label={t("savedCommands")}
      onClick={library?.manage}
    >
      <BookText aria-hidden="true" />
    </Button>
  );
}

export function SavedCommandsProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation("terminal");
  const [library, setLibrary] = useState<SavedCommandLibrary>({
    revision: 0,
    entries: [],
  });
  const [opened, setOpened] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const invoker = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const form = useId();
  const accept = useCallback((next: SavedCommandLibrary) => {
    setLibrary((previous) =>
      previous.revision <= next.revision ? next : previous,
    );
    setLoaded(true);
  }, []);
  const refresh = useCallback(async () => {
    try {
      accept(await invoke<SavedCommandLibrary>("saved_terminal_commands"));
      setError("");
    } catch {
      setError("libraryReadError");
    }
  }, [accept]);
  useEffect(() => {
    if (!active || !isTauri()) return;
    let live = true;
    const off = listen("terminal://saved-commands-changed", () => {
      if (live) void refresh();
    });
    void off.then(
      () => {
        if (live) void refresh();
      },
      () => {
        if (live) void refresh();
      },
    );
    return () => {
      live = false;
      void off.then(
        (unlisten) => unlisten(),
        () => {},
      );
    };
  }, [active, refresh]);
  const open = () => {
    invoker.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    setError("");
    setOpened(true);
    void refresh();
  };
  const edit = (entry: SavedCommand) => {
    setError("");
    setEditor({
      previous: entry,
      command: entry.command,
      keywords: { tags: entry.keywords, text: "" },
    });
  };
  const close = () => {
    if (pending.current) return;
    if (editor) {
      setEditor(null);
      setError("");
      return;
    }
    setOpened(false);
    setEditor(null);
    requestAnimationFrame(() => {
      if (invoker.current?.isConnected)
        invoker.current.focus({ preventScroll: true });
    });
  };
  const persist = async (
    previous: SavedCommand | null,
    next: SavedCommand | null,
  ) => {
    try {
      accept(
        await invoke<SavedCommandLibrary>("change_saved_terminal_command", {
          previous,
          next,
        }),
      );
    } catch (e) {
      const reason = String(e);
      if (reason === "libraryConflict") await refresh();
      throw new Error(
        ["libraryConflict", "libraryInvalid", "libraryReadError"].includes(
          reason,
        )
          ? reason
          : "libraryWriteError",
      );
    }
  };
  const change = async (previous: SavedCommand, next: SavedCommand | null) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await persist(previous, next);
      setEditor(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const filtered = library.entries.filter((entry) =>
    [entry.command, ...entry.keywords].some((value) =>
      value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
  );
  return (
    <Context.Provider
      value={{
        entries: library.entries,
        manage: () => {
          open();
          setEditor(null);
        },
        persist,
      }}
    >
      {children}
      {opened && (
        <Modal
          key={editor ? "edit" : "list"}
          title={t(editor ? "saveCommand" : "savedCommands")}
          close={close}
        >
          {editor ? (
            <form
              id={form}
              data-command-library-editor=""
              onSubmit={(e) => {
                e.preventDefault();
                const keywords = selectedKeywords(editor.keywords);
                if (!keywords.length || !editor.command.trim()) return;
                void change(editor.previous, {
                  id: editor.previous.id,
                  command: editor.command,
                  keywords,
                });
              }}
            >
              <Field label={t("command")}>
                <Textarea
                  value={editor.command}
                  required
                  onChange={(e) =>
                    setEditor({ ...editor, command: e.target.value })
                  }
                />
              </Field>
              <div
                className="field"
                role="group"
                aria-label={t("commandKeywords")}
              >
                <span>{t("commandKeywords")}</span>
                <CommandKeywords
                  entries={library.entries}
                  draft={editor.keywords}
                  onChange={(keywords) => setEditor({ ...editor, keywords })}
                />
              </div>
              <ModalActions>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={close}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="submit"
                  form={form}
                  disabled={
                    busy ||
                    !editor.command.trim() ||
                    !selectedKeywords(editor.keywords).length
                  }
                >
                  {t("save", { ns: "tunnel" })}
                </Button>
              </ModalActions>
            </form>
          ) : (
            <>
              <SearchInput
                autoFocus
                value={query}
                aria-label={t("searchLibrary")}
                placeholder={t("searchLibrary")}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div data-command-library-list="" className="grid gap-2">
                {filtered.map((entry) => (
                  <div
                    className="flex min-w-0 items-center gap-1 border-b border-border py-2"
                    key={entry.id}
                  >
                    <div className="min-w-0 flex-1">
                      <code className="block whitespace-pre-wrap break-all">
                        {entry.command}
                      </code>
                      <span className="text-xs text-muted-foreground">
                        {entry.keywords.join(" · ")}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={t("edit", { ns: "tunnel" })}
                      title={t("edit", { ns: "tunnel" })}
                      onClick={() => edit(entry)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={t("delete", { ns: "tunnel" })}
                      title={t("delete", { ns: "tunnel" })}
                      onClick={() => void change(entry, null)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                {loaded && !filtered.length && !error && (
                  <PageEmptyState
                    compact
                    icon={query ? <SearchX /> : <BookText />}
                    title={t(query ? "noMatches" : "savedCommands")}
                    description={!query && t("libraryEmpty")}
                    action={
                      query && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setQuery("")}
                        >
                          {t("clearFilters", { ns: "tunnel" })}
                        </Button>
                      )
                    }
                  />
                )}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="terminal-error">
              {t(error)}
            </p>
          )}
        </Modal>
      )}
    </Context.Provider>
  );
}
