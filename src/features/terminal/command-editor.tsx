import { useSavedCommands } from "./saved-commands";
import { matchingCommands } from "./saved-command-model";

import { SaveCommandPopover } from "./save-command-popover";
import {
  useMemo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  File,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { TerminalPath, type DirectoryNavigation } from "./terminal-path";
import {
  completionWord,
  commandTranscript,
  exceedsPreviewHeight,
  insertCandidate,
  promptSymbol,
  type Prompt,
  type ShellQuery,
  type TerminalCopyText,
} from "./shell-editor";
import { needsPasteReview, terminalShortcutAction } from "./terminal-model";

export function CommandHeader({
  prompt,
  directory,
  command,
  commandFolded,
  toggleCommand,
  limited,
  toggleOutput,
  focus,
  readCopy,
  copy,
}: {
  readCopy: () => TerminalCopyText;
  copy: (text: string) => Promise<void>;
  prompt: Prompt;
  directory?: DirectoryNavigation;
  command?: string;
  commandFolded?: boolean;
  toggleCommand?: () => void;
  limited?: boolean;
  toggleOutput?: () => void;
  focus: () => void;
}) {
  const { t } = useTranslation("terminal");
  const [copyText, setCopyText] = useState<TerminalCopyText | null>(null);
  const restoreInput = useRef(false);
  const heading = useRef<HTMLDivElement>(null);
  const [canLimitOutput, setCanLimitOutput] = useState(false);
  const hasOutputAction = !!toggleOutput;
  useLayoutEffect(() => {
    if (!copyText || !hasOutputAction) return;
    const owner = heading.current?.closest<HTMLElement>(
      ".shell-block,.shell-current-block",
    );
    const pane = owner?.closest<HTMLElement>(".shell-transcript");
    if (!owner || !pane) return;
    const pre = owner.querySelector<HTMLElement>(".shell-output-text");
    const live = owner.matches("[data-live-output]")
      ? owner.querySelector<HTMLElement>(".shell-live-viewport")
      : null;
    const measure = () => {
      if (live) {
        setCanLimitOutput(live.hasAttribute("data-long-output"));
        return;
      }
      if (!copyText.output) {
        setCanLimitOutput(false);
        return;
      }
      const lineHeight = parseFloat(getComputedStyle(owner).lineHeight);
      if (pre) {
        setCanLimitOutput(
          exceedsPreviewHeight(pre.scrollHeight, pane.clientHeight, lineHeight),
        );
        return;
      }
      // A collapsed command has no output DOM. Only one more line than the
      // cap is needed for the width-aware measurement, even for a huge record.
      const sample = copyText.output.split("\n", 19).join("\n");
      const probe = document.createElement("pre");
      probe.className = "shell-output-text shell-output-measure";
      probe.textContent = sample;
      owner.appendChild(probe);
      setCanLimitOutput(
        exceedsPreviewHeight(probe.scrollHeight, pane.clientHeight, lineHeight),
      );
      probe.remove();
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(pane);
    if (pre) sizes.observe(pre);
    const changes = new MutationObserver(measure);
    if (live)
      changes.observe(live, {
        attributes: true,
        attributeFilter: ["data-long-output"],
      });
    return () => {
      sizes.disconnect();
      changes.disconnect();
    };
  }, [copyText, hasOutputAction, commandFolded]);
  const keepHeaderVisible = () => {
    // Keep this command visible when shortening a tall output above the viewport.
    const owner = heading.current?.closest(".shell-block,.shell-current-block");
    const pane = owner?.closest(".shell-transcript");
    if (owner && pane) {
      const offset =
        owner.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      if (offset < 0) pane.scrollTop += offset;
    }
  };
  return (
    <div className="shell-heading" ref={heading}>
      {prompt.environments?.map((name) => (
        <span key={name} className="shell-environment" title={name}>
          ({name})
        </span>
      ))}
      <TerminalPath prompt={prompt} directory={directory} focus={focus} />
      {command && toggleCommand && (
        <button
          type="button"
          className="shell-fold"
          aria-expanded={!commandFolded}
          aria-label={t(commandFolded ? "expandCommand" : "collapseCommand", {
            command,
          })}
          onClick={() => {
            if (!commandFolded) keepHeaderVisible();
            toggleCommand();
            requestAnimationFrame(focus);
          }}
        >
          {commandFolded ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>
      )}
      {command && commandFolded && (
        <pre
          tabIndex={-1}
          data-selectable="true"
          className="shell-summary"
          title={command}
        >
          {promptSymbol(prompt.powershell)} {command}
        </pre>
      )}
      <DropdownMenu
        modal={false}
        open={copyText !== null}
        onOpenChange={(next) => {
          if (next) restoreInput.current = false;
          setCopyText(next ? readCopy() : null);
        }}
      >
        <DropdownMenuTrigger
          openOnHover
          delay={0}
          closeDelay={350}
          className={buttonVariants({
            variant: "ghost",
            size: "icon-xs",
            className: "shell-block-more",
          })}
          aria-label={t("blockActions")}
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label={t("blockActions")}
          data-terminal-block-menu=""
          finalFocus={() => {
            if (restoreInput.current) {
              focus();
              return false;
            }
            return true;
          }}
        >
          {(["command", "output", "all"] as const).map((kind) => (
            <DropdownMenuItem
              key={kind}
              data-copy={kind}
              disabled={
                kind === "all"
                  ? !copyText?.command && !copyText?.output
                  : !copyText?.[kind]
              }
              onClick={() => {
                if (!copyText) return;
                const text =
                  kind === "all"
                    ? commandTranscript(copyText, prompt.powershell)
                    : copyText[kind];
                if (text) {
                  restoreInput.current = true;
                  void copy(text);
                }
                setCopyText(null);
              }}
            >
              {t(
                kind === "command"
                  ? "copyCommand"
                  : kind === "output"
                    ? "copyOutput"
                    : "copyAll",
              )}
            </DropdownMenuItem>
          ))}
          {toggleOutput && canLimitOutput && (
            <DropdownMenuItem
              data-output-action={limited ? "expand" : "collapse"}
              onClick={() => {
                restoreInput.current = true;
                if (!limited) keepHeaderVisible();
                toggleOutput();
                setCopyText(null);
              }}
            >
              {t(limited ? "expandOutput" : "collapseOutput")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type Draft = { line: string; cursor: number };
export function CommandEditor({
  query,
  history,
  submit,
  raw,
  review,
  inputRef,
  visible,
  cwd,
  powershell,
  shortcut,
}: {
  query: ShellQuery;
  history: string[];
  submit: (command: string) => void;
  raw: (data: string) => void;
  review: (text: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  visible: boolean;
  cwd: string;
  powershell?: boolean;
  shortcut: (
    action: NonNullable<ReturnType<typeof terminalShortcutAction>>,
  ) => void;
}) {
  const { t } = useTranslation("terminal");
  const [line, setLine] = useState("");
  const [cursor, setCursor] = useState(0);
  const library = useSavedCommands();
  const [manualMode, setMode] = useState<"complete" | "history" | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [saveDraft, setSaveDraft] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [savedChoice, setSavedChoice] = useState<string | null>(null);
  const [remote, setRemote] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const matches = useMemo(
    () =>
      manualMode || dismissed || composing || !library
        ? []
        : matchingCommands(library.entries, line),
    [manualMode, dismissed, composing, library?.entries, line],
  );
  const mode = manualMode ?? (matches.length ? "saved" : null);
  const original = useRef<Draft>({ line: "", cursor: 0 });
  const restore = useRef<number | null>(null);
  const word = completionWord(line, cursor, powershell);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState({ left: 0, top: 20, up: false });
  // Native editing gives the platform ownership of grapheme selection and IME.
  // Mirror the draft and its UTF-8 byte offset into the current shell prompt.
  useEffect(() => {
    if (composing || powershell) return;
    const timer = setTimeout(() => {
      const point = new TextEncoder().encode(line.slice(0, cursor)).length;
      void query("edit", point + " " + line).catch(() => {});
    }, 40);
    return () => clearTimeout(timer);
  }, [line, cursor, query, composing, powershell]);
  useEffect(() => {
    let live = true;
    setRemote([]);
    if (
      (!word.prefix && !mode) ||
      mode === "history" ||
      mode === "saved" ||
      composing
    )
      return;
    const timer = setTimeout(
      () => {
        void query(word.kind, word.prefix).then(
          (result) => {
            if (live) {
              const names = [...new Set(result)];
              if (powershell && word.kind === "commands")
                names.sort((a, b) => a.length - b.length || a.localeCompare(b));
              else names.sort();
              setRemote(names);
            }
          },
          () => {},
        );
      },
      mode ? 0 : 65,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, line, cursor, cwd, mode, composing, powershell]);
  const prefix = mode === "history" ? original.current.line : line;
  const startsWith = (value: string, typed: string) =>
    powershell
      ? value.toLowerCase().startsWith(typed.toLowerCase())
      : value.startsWith(typed);
  const recent = history.filter((value) => startsWith(value, prefix));
  const candidates =
    mode === "saved"
      ? matches.map((entry) => ({
          line: entry.command,
          cursor: entry.command.length,
          label: entry.command,
        }))
      : mode === "history"
        ? recent.map((value) => ({
            line: value,
            cursor: value.length,
            label: value,
          }))
        : [
            ...(line && cursor === line.length
              ? [
                  ...recent,
                  ...(library?.entries ?? [])
                    .map((e) => e.command)
                    .filter((value) => startsWith(value, line)),
                ]
                  .filter((v) => v !== line)
                  .map((value) => ({
                    line: value,
                    cursor: value.length,
                    label: value,
                  }))
              : []),
            ...remote.map((name) => ({
              ...insertCandidate(line, word, name),
              label: name,
            })),
          ].filter(
            (candidate, i, all) =>
              all.findIndex((other) => other.line === candidate.line) === i,
          );
  const historyOpen = mode === "history";
  const rows = historyOpen ? [...candidates].reverse() : candidates;
  const savedIndex = matches.findIndex((entry) => entry.id === savedChoice);
  const selectedRow =
    mode === "saved"
      ? savedIndex
      : historyOpen
        ? rows.length - 1 - index
        : index;
  const ghostIndex = candidates.findIndex(
    (item) => item.line.length > line.length && startsWith(item.line, line),
  );
  const ghost =
    !composing &&
    mode !== "history" &&
    mode !== "saved" &&
    cursor === line.length &&
    !(powershell && dismissed) &&
    ghostIndex >= 0
      ? candidates[ghostIndex].line.slice(line.length)
      : "";
  const apply = (draft: Draft) => {
    setSavedChoice(null);
    restore.current = draft.cursor;
    setLine(draft.line);
    setCursor(draft.cursor);
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(draft.cursor, draft.cursor);
    }
  };
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const resize = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    resize.observe(el);
    return () => resize.disconnect();
  }, [inputRef]);
  useLayoutEffect(() => {
    if (restore.current !== null) {
      inputRef.current?.setSelectionRange(restore.current, restore.current);
      restore.current = null;
    }
    const el = inputRef.current;
    if (el) {
      el.style.height = "0px";
      el.style.height = el.scrollHeight + "px";
    }
    if (mode && anchor.current && el) {
      const caret = anchor.current.getBoundingClientRect(),
        area = el.getBoundingClientRect();
      const pane = el.closest(".ssh-terminal-view")?.getBoundingClientRect();
      const origin = mode === "history" ? area : caret;
      const up =
        !!pane &&
        origin.top - pane.top > 135 &&
        (mode === "history" || pane.bottom - origin.bottom < 135);
      setPlacement({
        left:
          mode === "history"
            ? 0
            : Math.max(0, Math.min(caret.left - area.left, area.width - 260)),
        top: (up ? origin.top - 5 : origin.bottom + 5) - area.top,
        up,
      });
    }
  }, [line, cursor, mode, width, inputRef]);
  useEffect(() => {
    if (
      visible &&
      !window.getSelection()?.toString() &&
      !document.activeElement?.closest(".shell-block pre") &&
      !document.querySelector('[role="dialog"][data-open]')
    )
      inputRef.current?.focus();
  }, [visible, inputRef]);
  useLayoutEffect(() => {
    const menu = list.current;
    const row = menu?.children[selectedRow];
    if (!menu || !(row instanceof HTMLElement)) return;
    const offset = row.offsetTop - menu.scrollTop;
    if (offset < 0) menu.scrollTop = row.offsetTop;
    else if (offset + row.offsetHeight > menu.clientHeight)
      menu.scrollTop = row.offsetTop + row.offsetHeight - menu.clientHeight;
  }, [mode, selectedRow, rows.length]);
  const accept = (i: number) => {
    setDismissed(true);
    if (candidates[i]) apply(candidates[i]);
    setMode(null);
  };
  const preview = (i: number) => {
    if (i < 0) {
      apply(original.current);
      setMode(null);
      return;
    }
    const entry = candidates[Math.min(i, candidates.length - 1)];
    if (entry) {
      setIndex(Math.min(i, candidates.length - 1));
      apply(entry);
    }
  };
  return (
    <div className="shell-edit" data-ssh-terminal="true" data-selectable="true">
      <span className="shell-dollar" aria-hidden="true">
        {promptSymbol(powershell)}
      </span>
      <div className="shell-input-body">
        <div aria-hidden="true" className="shell-mirror">
          <span>{line.slice(0, cursor)}</span>
          <span ref={anchor} className="shell-caret-anchor" />
          {line.slice(cursor)}
          <span className="shell-ghost">{ghost}</span>
        </div>
        <textarea
          ref={inputRef}
          aria-label={t("input")}
          aria-autocomplete="list"
          aria-controls={mode && candidates.length ? listId : undefined}
          aria-activedescendant={
            mode && rows[selectedRow] ? listId + "-" + selectedRow : undefined
          }
          rows={1}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={line}
          onSelect={(e) => setCursor(e.currentTarget.selectionEnd)}
          onPointerDown={() => {
            setDismissed(true);
            setMode(null);
          }}
          onCompositionStart={() => {
            setSavedChoice(null);
            setComposing(true);
            setMode(null);
          }}
          onCompositionEnd={() => setComposing(false)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain");
            if (
              needsPasteReview(text) ||
              new TextEncoder().encode(text).length > 256 * 1024
            ) {
              e.preventDefault();
              review(text);
            }
          }}
          onChange={(e) => {
            setSavedChoice(null);
            setDismissed(false);
            setLine(e.target.value);
            setCursor(e.target.selectionEnd);
            setIndex(0);
            if (mode === "history") setMode(null);
          }}
          onKeyDown={(e) => {
            if (composing || e.nativeEvent.isComposing) return;
            const action = terminalShortcutAction(e);
            if (action && action !== "copy") {
              e.preventDefault();
              shortcut(action);
              return;
            }
            if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
              if (["c", "d", "l", "z", "r"].includes(e.key)) {
                e.preventDefault();
                raw(line + String.fromCharCode(e.key.charCodeAt(0) - 96));
                return;
              }
              if (e.key === "u") {
                e.preventDefault();
                apply({ line: line.slice(cursor), cursor: 0 });
                return;
              }
              if (e.key === "k") {
                e.preventDefault();
                apply({ line: line.slice(0, cursor), cursor });
                return;
              }
            }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            switch (e.key) {
              case "Tab":
                e.preventDefault();
                if (mode === "history" || mode === "saved") {
                  accept(mode === "saved" ? Math.max(0, savedIndex) : index);
                  return;
                }
                if (mode === "complete" && candidates.length)
                  setIndex(
                    (i) =>
                      (i + (e.shiftKey ? -1 : 1) + candidates.length) %
                      candidates.length,
                  );
                else {
                  setIndex(0);
                  setMode("complete");
                }
                break;
              case "ArrowUp":
              case "ArrowDown":
                if (
                  (!mode || (mode === "complete" && !candidates.length)) &&
                  e.key === "ArrowDown"
                ) {
                  if (library && line.trim() && !e.shiftKey) {
                    e.preventDefault();
                    setDismissed(true);
                    setMode(null);
                    setSaveDraft(line);
                  }
                  return;
                }
                e.preventDefault();
                if (!mode) {
                  original.current = { line, cursor };
                  setMode("history");
                  setIndex(0);
                  if (recent[0])
                    apply({ line: recent[0], cursor: recent[0].length });
                } else if (mode === "saved") {
                  const next =
                    e.key === "ArrowDown"
                      ? Math.min(savedIndex + 1, matches.length - 1)
                      : savedIndex < 0
                        ? matches.length - 1
                        : Math.max(0, savedIndex - 1);
                  setSavedChoice(matches[next].id);
                } else if (mode === "history")
                  preview(index + (e.key === "ArrowUp" ? 1 : -1));
                else
                  setIndex((i) =>
                    Math.max(
                      0,
                      Math.min(
                        candidates.length - 1,
                        i + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
                  );
                break;
              case "ArrowRight":
                if (ghost && e.currentTarget.selectionStart === cursor) {
                  e.preventDefault();
                  accept(ghostIndex);
                }
                break;
              case "Escape":
                if (mode) {
                  e.preventDefault();
                  setDismissed(true);
                  if (mode === "history") apply(original.current);
                  setMode(null);
                }
                break;
              case "Enter":
                if (e.shiftKey) return;
                e.preventDefault();
                if (mode === "saved" && savedIndex >= 0) accept(savedIndex);
                else if (mode && mode !== "saved" && candidates.length)
                  accept(index);
                else submit(line);
                break;
            }
          }}
        />
        {saveDraft !== null && library && visible && (
          <SaveCommandPopover
            anchor={inputRef}
            command={saveDraft}
            entries={library.entries}
            persist={library.persist}
            close={() => setSaveDraft(null)}
          />
        )}
        {mode && candidates.length > 0 && (
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={t(
              mode === "history"
                ? "recentCommands"
                : mode === "saved"
                  ? "savedCommands"
                  : "completions",
            )}
            data-mode={mode}
            className="shell-options shell-candidates floating-surface"
            style={{
              left: placement.left,
              maxWidth: `min(52ch, calc(100% - ${placement.left}px))`,
              top: placement.top,
              transform: placement.up ? "translateY(-100%)" : undefined,
            }}
          >
            {rows.map((candidate, i) => (
              <button
                type="button"
                key={mode === "saved" ? matches[i].id : candidate.line}
                id={listId + "-" + i}
                role="option"
                aria-selected={i === selectedRow}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(historyOpen ? rows.length - 1 - i : i)}
              >
                {mode === "complete" &&
                  word.kind !== "commands" &&
                  (candidate.label.endsWith("/") ||
                  (powershell && candidate.label.endsWith("\\")) ? (
                    <Folder size={14} />
                  ) : (
                    <File size={14} />
                  ))}
                <span title={candidate.label}>{candidate.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
