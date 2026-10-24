import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalActions } from "@/components/tunnel-form";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import {
  CopyIcon,
  ClipboardPasteIcon,
  SearchIcon,
  BroomSparklesIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  XIcon,
} from "lucide-react";
import * as bridge from "@/lib/bridge";
import type { TerminalFrame, TerminalSession } from "@/types";
import {
  displayPaste,
  needsPasteReview,
  terminalShortcutAction,
} from "./terminal-model";

function solidColor(value: string, fallback: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  return (
    "#" +
    [...ctx.getImageData(0, 0, 1, 1).data]
      .slice(0, 3)
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}
export default function TerminalView({
  session,
  clientId,
  visible,
  onError,
}: {
  session: TerminalSession;
  clientId: string;
  visible: boolean;
  onError: (error: string) => void;
}) {
  const { t } = useTranslation("terminal");
  const container = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    search = useRef<SearchAddon | null>(null);
  const current = useRef({ session, onError, t });
  current.current = { session, onError, t };
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  const [keyboardAnchor, setKeyboardAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  const openSearch = () => {
    setShowSearch(true);
    requestAnimationFrame(() => searchInput.current?.focus());
  };
  const openContextMenu = () => {
    const rect =
      terminal.current?.textarea?.getBoundingClientRect() ||
      container.current?.getBoundingClientRect();
    if (!rect) return;
    setKeyboardAnchor({ x: rect.left, y: rect.bottom });
    setCanCopy(!!terminal.current?.getSelection());
    setMenuOpen(true);
  };
  const copy = async () => {
    const selected = terminal.current?.getSelection();
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected);
    } catch {
      onError(t("clipboardFallback"));
    }
  };
  const reviewPaste = (text: string) => {
    if (new TextEncoder().encode(text).length > 256 * 1024) {
      onError(t("error.inputLimit"));
      return;
    }
    if (needsPasteReview(text)) setPaste(text);
    else terminal.current?.paste(text);
  };
  const pasteClipboard = async () => {
    try {
      reviewPaste(await navigator.clipboard.readText());
    } catch {
      onError(t("clipboardFallback"));
    }
  };
  const callbacks = useRef({
    copy,
    reviewPaste,
    pasteClipboard,
    openSearch,
    openContextMenu,
  });
  callbacks.current = {
    copy,
    reviewPaste,
    pasteClipboard,
    openSearch,
    openContextMenu,
  };
  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    queueMicrotask(() => {
      if (disposed) return;
      let pendingBytes = 0,
        inputSequence = 0,
        lastFrame = 0,
        failedInput = false,
        resizing = 0;
      let queue = Promise.resolve();
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      const term = new Terminal({
        cols: session.cols,
        rows: session.rows,
        scrollback: 5000,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        cursorBlink: !reduced.matches,
        screenReaderMode: true,
        allowProposedApi: false,
        linkHandler: {
          activate: (_event, url) => {
            if (/^https?:\/\//i.test(url))
              void bridge
                .openExternalUrl(url)
                .catch(() =>
                  current.current.onError(
                    current.current.t("error.linkFailed"),
                  ),
                );
          },
        },
      });
      const fit = new FitAddon(),
        finder = new SearchAddon();
      term.loadAddon(fit);
      term.loadAddon(finder);
      const clipboardGuard = term.parser.registerOscHandler(52, () => true);
      term.open(element);
      term.textarea?.setAttribute(
        "aria-label",
        `${current.current.t("input")} ${session.endpoint}`,
      );
      terminal.current = term;
      search.current = finder;
      setReady(true);
      const send = (bytes: Uint8Array) => {
        if (
          disposed ||
          failedInput ||
          current.current.session.finishedAt !== null
        )
          return;
        if (pendingBytes + bytes.length > 256 * 1024) {
          current.current.onError(current.current.t("error.inputLimit"));
          return;
        }
        pendingBytes += bytes.length;
        for (let start = 0; start < bytes.length; start += 4096) {
          const part = [...bytes.slice(start, start + 4096)];
          queue = queue
            .then(async () => {
              if (disposed || failedInput) return;
              const sequence = inputSequence + 1;
              try {
                await bridge.terminalInput(
                  session.id,
                  clientId,
                  sequence,
                  part,
                );
                inputSequence = sequence;
              } catch {
                failedInput = true;
                current.current.onError(current.current.t("error.inputFailed"));
                void bridge.closeTerminal(session.id, clientId).catch(() => {});
              }
            })
            .finally(() => {
              pendingBytes -= part.length;
            });
        }
      };
      const data = term.onData((text) => send(new TextEncoder().encode(text)));
      const binary = term.onBinary((text) =>
        send(Uint8Array.from(text, (c) => c.charCodeAt(0))),
      );
      term.attachCustomKeyEventHandler((event) => {
        if (event.isComposing || event.type !== "keydown") return true;
        const action = terminalShortcutAction(event);
        if (!action) return true;
        event.preventDefault();
        event.stopPropagation();
        if (action === "copy") void callbacks.current.copy();
        else if (action === "paste") void callbacks.current.pasteClipboard();
        else if (action === "find") callbacks.current.openSearch();
        else if (action === "clear") term.clear();
        else callbacks.current.openContextMenu();
        return false;
      });
      const onPaste = (event: ClipboardEvent) => {
        if (!event.clipboardData) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacks.current.reviewPaste(
          event.clipboardData.getData("text/plain"),
        );
      };
      element.addEventListener("paste", onPaste, true);
      const updateTheme = () => {
        const style = getComputedStyle(element),
          get = (key: string, fallback: string) =>
            solidColor(
              style.getPropertyValue(key).trim() || fallback,
              fallback,
            );
        const background = get("--oria-color-bg", "#151515"),
          foreground = get("--oria-color-fg", "#dddddd");
        const dark =
          parseInt(background.slice(1, 3), 16) * 299 +
            parseInt(background.slice(3, 5), 16) * 587 +
            parseInt(background.slice(5, 7), 16) * 114 <
          128000;
        const palette = dark
          ? [
              "#555555",
              "#e06c75",
              "#98c379",
              "#e5c07b",
              "#61afef",
              "#c678dd",
              "#56b6c2",
              "#d0d0d0",
              "#808080",
              "#ff7b86",
              "#b1de8d",
              "#ffdc91",
              "#86c5ff",
              "#e59bff",
              "#80d8e3",
              "#ffffff",
            ]
          : [
              "#202020",
              "#a22b35",
              "#337222",
              "#806000",
              "#205aab",
              "#833fa3",
              "#006b78",
              "#555555",
              "#666666",
              "#b82c36",
              "#356a26",
              "#806000",
              "#2457a1",
              "#8036a2",
              "#006a76",
              "#222222",
            ];
        const names = [
          "black",
          "red",
          "green",
          "yellow",
          "blue",
          "magenta",
          "cyan",
          "white",
          "brightBlack",
          "brightRed",
          "brightGreen",
          "brightYellow",
          "brightBlue",
          "brightMagenta",
          "brightCyan",
          "brightWhite",
        ];
        term.options.theme = {
          ...Object.fromEntries(
            names.map((name, index) => [name, palette[index]]),
          ),
          background,
          foreground,
          cursor: foreground,
          cursorAccent: background,
          selectionBackground: get("--oria-color-primary", "#3178a0") + "55",
        };
      };
      updateTheme();
      const themes = new MutationObserver(updateTheme);
      themes.observe(document.documentElement, { attributes: true });
      const onReduced = () => {
        term.options.cursorBlink = !reduced.matches;
      };
      reduced.addEventListener("change", onReduced);
      const resize = () => {
        if (disposed) return;
        cancelAnimationFrame(resizing);
        resizing = requestAnimationFrame(() => {
          if (disposed || !element.clientWidth || !element.clientHeight) return;
          const proposed = fit.proposeDimensions();
          if (!proposed) return;
          const cols = Math.max(2, Math.min(500, proposed.cols)),
            rows = Math.max(1, Math.min(300, proposed.rows));
          if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
          if (current.current.session.finishedAt === null)
            void bridge
              .resizeTerminal(session.id, clientId, cols, rows)
              .catch(() => {});
        });
      };
      const sizes = new ResizeObserver(resize);
      sizes.observe(element);
      void document.fonts.ready.then(resize);
      resize();
      const channel = new bridge.Channel<TerminalFrame>();
      channel.onmessage = (frame) => {
        if (disposed || frame.id !== session.id || frame.sequence <= lastFrame)
          return;
        if (frame.sequence !== lastFrame + 1) {
          current.current.onError(current.current.t("error.outputGap"));
          void bridge.closeTerminal(session.id, clientId).catch(() => {});
          return;
        }
        lastFrame = frame.sequence;
        term.write(new Uint8Array(frame.bytes), () => {
          if (!disposed)
            void bridge
              .ackTerminal(session.id, clientId, frame.sequence)
              .catch(() =>
                current.current.onError(current.current.t("error.outputGap")),
              );
        });
      };
      void bridge
        .attachTerminal(session.id, clientId, channel)
        .catch((error) => {
          if (!disposed)
            current.current.onError(
              current.current.t(`error.${String(error)}`, {
                defaultValue: String(error),
              }),
            );
        });
      cleanup = () => {
        cancelAnimationFrame(resizing);
        sizes.disconnect();
        themes.disconnect();
        reduced.removeEventListener("change", onReduced);
        element.removeEventListener("paste", onPaste, true);
        data.dispose();
        binary.dispose();
        clipboardGuard.dispose();
        terminal.current = null;
        search.current = null;
        term.dispose();
        void bridge.detachTerminal(session.id, clientId).catch(() => {});
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [session.id, clientId]);
  useEffect(() => {
    if (!visible || !ready || session.phase !== "running") return;
    // A different feature's modal may still be finishing its close animation.
    // Wait for that modal to leave before focusing once; never steal its focus.
    let frame = 0;
    const dialogs = new MutationObserver(() => schedule());
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
          return;
        dialogs.disconnect();
        terminal.current?.focus();
      });
    };
    dialogs.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      dialogs.disconnect();
    };
  }, [visible, ready, session.phase]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.disableStdin = session.finishedAt !== null;
  }, [session.finishedAt]);
  return (
    <div className="ssh-terminal-view">
      {showSearch && (
        <div
          className="terminal-search-bar"
          role="search"
          aria-label={t("find")}
        >
          <Input
            ref={searchInput}
            type="search"
            className="terminal-search"
            aria-label={t("find")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) search.current?.findPrevious(query);
                else search.current?.findNext(query);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setShowSearch(false);
                terminal.current?.focus();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("previous")}
            onClick={() => search.current?.findPrevious(query)}
          >
            <ArrowUpIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("next")}
            onClick={() => search.current?.findNext(query)}
          >
            <ArrowDownIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("closeSearch")}
            onClick={() => {
              setShowSearch(false);
              terminal.current?.focus();
            }}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      )}
      <ContextMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) {
            setKeyboardAnchor(null);
            setCanCopy(!!terminal.current?.getSelection());
          }
        }}
      >
        <ContextMenuTrigger
          ref={container}
          className="ssh-terminal-screen"
          data-ssh-terminal="true"
          data-selectable="true"
        />
        <ContextMenuContent
          aria-label={t("tools")}
          data-ssh-terminal-menu="true"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            const nativePaste =
              !event.altKey &&
              !event.shiftKey &&
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "v";
            const action =
              terminalShortcutAction(event) ||
              (nativePaste ? "paste" : undefined);
            if (!action) return;
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen(false);
            if (action === "copy") void copy();
            else if (action === "paste" && session.phase === "running" && ready)
              void pasteClipboard();
            else if (action === "find" && ready) openSearch();
            else if (action === "clear" && ready) terminal.current?.clear();
          }}
          anchor={
            keyboardAnchor
              ? {
                  getBoundingClientRect: () =>
                    DOMRect.fromRect({
                      ...keyboardAnchor,
                      width: 0,
                      height: 0,
                    }),
                }
              : undefined
          }
          finalFocus={() => {
            if (
              !visible ||
              paste !== null ||
              document.querySelector('[role="dialog"], [role="alertdialog"]')
            )
              return false;
            return showSearch
              ? searchInput.current
              : terminal.current?.textarea || false;
          }}
        >
          <ContextMenuItem disabled={!canCopy} onClick={() => void copy()}>
            <CopyIcon aria-hidden="true" />
            {t("copy")}
            <ContextMenuShortcut>
              {mac ? "⌘C" : "Ctrl+Shift+C"}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={session.phase !== "running" || !ready}
            onClick={() => void pasteClipboard()}
          >
            <ClipboardPasteIcon aria-hidden="true" />
            {t("paste")}
            <ContextMenuShortcut>
              {mac ? "⌘V" : "Ctrl+Shift+V"}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!ready} onClick={openSearch}>
            <SearchIcon aria-hidden="true" />
            {t("find")}
            <ContextMenuShortcut>{mac ? "⌘F" : "Ctrl+F"}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!ready}
            onClick={() => terminal.current?.clear()}
          >
            <BroomSparklesIcon aria-hidden="true" />
            {t("clear")}
            <ContextMenuShortcut>
              {mac ? "⌘K" : "Ctrl+Shift+K"}
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AnimatePresence onExitComplete={() => terminal.current?.focus()}>
        {paste !== null && (
          <Modal
            key="paste"
            title={t("pasteTitle")}
            description={t("pasteHint")}
            close={() => {
              setPaste(null);
              terminal.current?.focus();
            }}
          >
            <pre className="preset-script" data-selectable="true">
              {displayPaste(paste)}
            </pre>
            <ModalActions>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPaste(null);
                  terminal.current?.focus();
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="primary-soft"
                disabled={session.phase !== "running"}
                onClick={() => {
                  terminal.current?.paste(paste);
                  setPaste(null);
                  terminal.current?.focus();
                }}
              >
                {t("sendPaste")}
              </Button>
            </ModalActions>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
