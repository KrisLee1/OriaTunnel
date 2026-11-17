import { CommandHistory } from "./archived-command";
import { CommandHeader, CommandEditor } from "./command-editor";
import {
  captureOutput,
  selectOutputMatch,
  terminalTextRange,
  selectionFragments,
} from "./terminal-output";
import { commandOutput, exceedsPreviewHeight } from "./shell-editor";
import { useShellEditor } from "./use-shell-editor";
import "./shell-editor.css";
import { SearchInput } from "@/components/ui/search-input";
import {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  type TerminalTabControls,
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
  controls,
  visible,
  onError,
}: {
  session: TerminalSession;
  clientId: string;
  controls: Map<string, TerminalTabControls>;
  visible: boolean;
  onError: (error: string) => void;
}) {
  const { t } = useTranslation("terminal");
  const container = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    search = useRef<SearchAddon | null>(null);
  const shell = useShellEditor(
    session.id,
    session.finishedAt === null,
    onError,
  );
  const rawCommand = useRef({ markedPrompt: false, running: false });
  const shellRef = useRef(shell);
  shellRef.current = shell;
  useEffect(() => {
    // An integrated prompt can log out cleanly and let the remote shell save its history.
    // A foreground program or plain PTY is disconnected directly by the workspace.
    const logout = async () => {
      if (!shellRef.current.editing) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          shellRef.current.query("logout", "").catch(() => {}),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 1200);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    };
    controls.set(session.id, {
      logout,
      atPrompt: () => shellRef.current.atPrompt(),
      foreground: () =>
        shellRef.current.foreground() ||
        (!shellRef.current.atPrompt() && rawCommand.current.running) ||
        terminal.current?.buffer.active.type === "alternate",
    });
    return () => {
      controls.delete(session.id);
    };
  }, [controls, session.id]);
  const transcript = useRef<HTMLDivElement>(null);
  const focusInput = useCallback(() => {
    if (shellRef.current.editing) shellRef.current.focus();
    else terminal.current?.focus();
  }, []);
  const menuSelection = useRef("");
  const menuRange = useRef<Range | null>(null);
  const selectedText = () => {
    const selection = window.getSelection();
    if (
      selection?.anchorNode &&
      transcript.current?.contains(selection.anchorNode) &&
      !selection.isCollapsed
    )
      return selection.toString();
    const input = shell.editorInput.current;
    return (
      (input &&
        input === document.activeElement &&
        input.value.slice(input.selectionStart, input.selectionEnd)) ||
      terminal.current?.getSelection() ||
      ""
    );
  };
  const selectedRange = () => {
    const input = shellRef.current.editorInput.current;
    const mirror = input?.parentElement?.querySelector(".shell-mirror");
    if (
      input &&
      mirror &&
      input === document.activeElement &&
      input.selectionStart !== input.selectionEnd
    )
      return (
        terminalTextRange(mirror, input.selectionStart, input.selectionEnd) ??
        null
      );
    const selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      selection.isCollapsed ||
      !transcript.current?.contains(selection.anchorNode) ||
      !selection.anchorNode?.parentElement?.closest("pre")
    )
      return null;
    return selection.getRangeAt(0).cloneRange();
  };
  const rememberSelection = () => {
    menuSelection.current = selectedText();
    menuRange.current = selectedRange();
    setCanCopy(!!menuSelection.current);
  };
  const clearScreen = () => {
    shellRef.current.clear();
    terminal.current?.clear();
  };
  const pasteText = (value: string) => {
    const input = shellRef.current.editorInput.current;
    if (!input) {
      terminal.current?.paste(value);
      return;
    }
    input.focus();
    // insertText dispatches the native input event, preserving textarea undo and selection.
    document.execCommand("insertText", false, value);
  };
  const current = useRef({ session, onError, t });
  current.current = { session, onError, t };
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const lastMatch = useRef({ query: "", index: -1 });
  const findMatch = (backward: boolean) => {
    if (!query) return;
    const found = backward
      ? search.current?.findPrevious(query)
      : search.current?.findNext(query);
    if (found) return;
    const matches: { id: number; part: string; offset: number }[] = [];
    const needle = query.toLocaleLowerCase();
    for (const block of shell.blocks) {
      for (const [part, value] of [
        ["shell-command", block.command && "$ " + block.command],
        ["shell-output-text", block.output],
      ]) {
        const text = value.toLocaleLowerCase();
        for (
          let at = text.indexOf(needle);
          at >= 0;
          at = text.indexOf(needle, at + needle.length)
        )
          matches.push({ id: block.id, part, offset: at });
      }
    }
    if (!matches.length) return;
    const previous =
      lastMatch.current.query === query
        ? lastMatch.current.index
        : backward
          ? 0
          : -1;
    const index =
      (previous + (backward ? -1 : 1) + matches.length) % matches.length;
    lastMatch.current = { query, index };
    const match = matches[index];
    if (shell.foldedCommands.get(match.id)) shell.toggleCommand(match.id);
    if (
      match.part === "shell-output-text" &&
      shell.limitedOutputs.get(match.id)
    )
      shell.toggleOutput(match.id);
    requestAnimationFrame(() => {
      const el = transcript.current?.querySelector(
        `[data-command-block="${match.id}"] .${match.part}`,
      );
      if (el) selectOutputMatch(el, match.offset, match.offset + query.length);
    });
  };
  const [paste, setPaste] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const latestCommand = useMemo(() => {
    if (shell.running?.command.trim()) return shell.running.id;
    for (let i = shell.blocks.length - 1; i >= 0; i--) {
      if (shell.blocks[i].command.trim()) return shell.blocks[i].id;
    }
  }, [shell.blocks, shell.running]);
  const liveCommandFolded =
    !!shell.running && shell.foldedCommands.get(shell.running.id);
  const liveCommand =
    !fullScreen && !liveCommandFolded && shell.running?.command
      ? shell.running
      : null;
  const liveFolded =
    !!liveCommand && !!shell.limitedOutputs.get(liveCommand.id);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const term = terminal.current,
      screen = container.current,
      pane = transcript.current;
    const output = screen?.parentElement,
      viewport = output?.parentElement,
      header = viewport?.previousElementSibling;
    if (
      !liveCommand ||
      !ready ||
      !term ||
      !screen ||
      !pane ||
      !output ||
      !viewport ||
      !header
    )
      return;
    const grid = screen.querySelector<HTMLElement>(".xterm-screen");
    const scroller = liveFolded ? viewport : pane;
    let frame = 0;
    // Move the PTY grid through the retained rows without resizing the remote terminal.
    const sync = () => {
      const buf = term.buffer.active;
      if (buf.type !== "normal" || !grid?.offsetHeight) return;
      const cell = grid.offsetHeight / term.rows;
      const expected = "$ " + liveCommand.command;
      let echo = "",
        echoRows = 0;
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (!line) break;
        if (i && !line.isWrapped) echo += "\n";
        echo += line.translateToString(!buf.getLine(i + 1)?.isWrapped);
        if (!echo || !expected.startsWith(echo)) break;
        echoRows++;
        if (echo === expected) break;
      }
      const atEnd =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 2;
      let visibleRows = term.rows;
      // Include the active cursor in a live preview, but exclude empty PTY rows below it.
      if (buf.baseY === 0 || liveFolded) {
        while (
          visibleRows > buf.cursorY + 1 &&
          !buf.getLine(buf.baseY + visibleRows - 1)?.translateToString(true)
        )
          visibleRows--;
      }
      const gridHeight = screen.offsetHeight + (buf.baseY - echoRows) * cell;
      const contentHeight = Math.max(
        0,
        gridHeight - (term.rows - visibleRows) * cell,
      );
      viewport.toggleAttribute(
        "data-long-output",
        exceedsPreviewHeight(
          contentHeight,
          pane.clientHeight,
          parseFloat(getComputedStyle(header).lineHeight),
        ),
      );
      const height = liveFolded ? contentHeight : Math.max(0, gridHeight);
      if (output.style.height !== height + "px") {
        output.style.height = height + "px";
        if (atEnd) scroller.scrollTop = scroller.scrollHeight;
      }
      screen.style.top = (liveFolded ? 0 : header.clientHeight) + "px";
      const outputTop = output.getBoundingClientRect().top;
      const covered =
        (liveFolded
          ? viewport.getBoundingClientRect().top
          : pane.getBoundingClientRect().top + header.clientHeight) - outputTop;
      const row = Math.max(
        0,
        Math.min(buf.baseY, echoRows + Math.floor(covered / cell)),
      );
      if (buf.viewportY !== row) term.scrollToLine(row);
      // Sticky keeps painted PTY cells on screen during native scroll jumps.
      // Only compensate for the fractional row and the echoed command.
      const stickyOffset = Math.max(
        0,
        Math.min(covered, height - screen.offsetHeight),
      );
      screen.style.transform = `translateY(${(row - echoRows) * cell - stickyOffset}px)`;
    };
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          sync();
        });
    };
    // Let the wheel's native default action scroll the transcript before xterm's
    // wheel handler can consume it. The alternate screen keeps native input.
    const wheel = (event: WheelEvent) => event.stopPropagation();
    output.addEventListener("wheel", wheel, { capture: true, passive: true });
    scroller.addEventListener("scroll", sync, { passive: true });
    const watchers = [term.onWriteParsed(schedule), term.onResize(schedule)];
    const observer = new ResizeObserver(schedule);
    observer.observe(header);
    observer.observe(screen);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      watchers.forEach((w) => w.dispose());
      scroller.removeEventListener("scroll", sync);
      output.removeEventListener("wheel", wheel, true);
      viewport.removeAttribute("data-long-output");
      output.style.height = "";
      screen.style.transform = "";
      screen.style.top = "";
      if (term.buffer.active.type === "normal") term.scrollToBottom();
    };
  }, [liveCommand, liveFolded, ready]);
  useLayoutEffect(() => {
    const pane = transcript.current;
    const surface = pane?.querySelector(".shell-surface");
    if (!visible || fullScreen || !pane || !surface) return;
    let clipped: HTMLElement | null = null;
    const sync = () => {
      // Only the block crossing the top edge can have output behind its header.
      const top = pane.getBoundingClientRect().top;
      const blocks = surface.children;
      let low = 0,
        high = blocks.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (blocks[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
        else high = mid;
      }
      const header = blocks[low]?.firstElementChild;
      const output = header?.nextElementSibling as HTMLElement | null;
      const overlap =
        header && output
          ? header.getBoundingClientRect().bottom -
            output.getBoundingClientRect().top
          : 0;
      if (clipped && (clipped !== output || overlap <= 0))
        clipped.style.removeProperty("clip-path");
      clipped = overlap > 0 && output ? output : null;
      if (clipped && header) {
        // Mask only the strip occupied by the sticky header. A stale inset
        // would hide the entire destination of a fast upward thumb jump.
        const from = Math.max(0, overlap - header.clientHeight);
        clipped.style.clipPath = `polygon(0 0,100% 0,100% ${from}px,0 ${from}px,0 ${overlap}px,100% ${overlap}px,100% 100%,0 100%)`;
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(surface);
    observer.observe(pane);
    pane.addEventListener("scroll", sync, { passive: true });
    return () => {
      observer.disconnect();
      pane.removeEventListener("scroll", sync);
      clipped?.style.removeProperty("clip-path");
    };
  }, [
    visible,
    fullScreen,
    shell.blocks,
    shell.limitedOutputs,
    shell.foldedCommands,
    liveCommand,
  ]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  const [highlights, setHighlights] = useState<
    ReturnType<typeof selectionFragments>
  >([]);
  useLayoutEffect(() => {
    const pane = transcript.current;
    if (!visible || !pane) return;
    if (!menuOpen) {
      menuSelection.current = "";
      menuRange.current = null;
    }
    // Paint the same range before and during the menu. Inactive native selection
    // in WebKit otherwise changes its foreground, background and line-break geometry.
    const registry =
      typeof Highlight !== "undefined" ? CSS.highlights : undefined;
    const name = "oria-terminal-selection";
    const highlight = registry && (registry.get(name) ?? new Highlight());
    if (highlight) registry?.set(name, highlight);
    let previous: Range | null = null;
    let frame = 0;
    const measure = () => {
      if (previous) highlight?.delete(previous);
      previous = menuOpen ? menuRange.current : selectedRange();
      if (previous && previous.commonAncestorContainer.isConnected) {
        highlight?.add(previous);
        setHighlights(selectionFragments(previous, pane));
      } else setHighlights((old) => (old.length ? [] : old));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    if (pane.firstElementChild) observer.observe(pane.firstElementChild);
    document.addEventListener("selectionchange", schedule);
    pane.addEventListener("select", schedule, true);
    pane.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      pane.removeEventListener("scroll", schedule, true);
      pane.removeEventListener("select", schedule, true);
      document.removeEventListener("selectionchange", schedule);
      if (previous) highlight?.delete(previous);
      if (highlight?.size === 0) registry?.delete(name);
    };
  }, [menuOpen, visible]);
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
      shellRef.current.editorInput.current?.getBoundingClientRect() ||
      terminal.current?.textarea?.getBoundingClientRect() ||
      container.current?.getBoundingClientRect();
    if (!rect) return;
    setKeyboardAnchor({ x: rect.left, y: rect.bottom });
    rememberSelection();
    setMenuOpen(true);
  };
  const copy = async (selected = selectedText()) => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected);
    } catch {
      onError("clipboardFallback");
    }
  };
  const reviewPaste = (text: string) => {
    if (new TextEncoder().encode(text).length > 256 * 1024) {
      onError("error.inputLimit");
      return;
    }
    if (needsPasteReview(text)) setPaste(text);
    else pasteText(text);
  };
  const pasteClipboard = async () => {
    try {
      reviewPaste(await navigator.clipboard.readText());
    } catch {
      onError("clipboardFallback");
    }
  };
  const copyBlock = useCallback(
    (value: string) => callbacks.current.copy(value),
    [],
  );
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
      Terminal.strings.promptLabel = current.current.t("input");
      Terminal.strings.tooMuchOutput = current.current.t(
        "screenReaderOutputLimit",
      );
      const term = new Terminal({
        cols: session.cols,
        rows: session.rows,
        scrollback: 5000,
        rightClickSelectsWord: false,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        cursorBlink: !reduced.matches,
        screenReaderMode: true,
        allowProposedApi: false,
        allowTransparency: true,
        linkHandler: {
          activate: (_event, url) => {
            if (/^https?:\/\//i.test(url))
              void bridge
                .openExternalUrl(url)
                .catch(() => current.current.onError("error.linkFailed"));
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
          return false;
        if (pendingBytes + bytes.length > 256 * 1024) {
          current.current.onError("error.inputLimit");
          return false;
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
                current.current.onError("error.inputFailed");
                void bridge.closeTerminal(session.id, clientId).catch(() => {});
              }
            })
            .finally(() => {
              pendingBytes -= part.length;
            });
        }
        return true;
      };
      shellRef.current.send.current = (text) =>
        send(new TextEncoder().encode(text));
      const shellMessages = term.parser.registerOscHandler(6973, (data) => {
        if (current.current.session.serviceId) return false;
        const editor = shellRef.current;
        const handled = editor.receive(data, term);
        if (editor.atPrompt()) rawCommand.current.running = false;
        return handled;
      });
      const markCommand = (payload: string) => {
        const marker = payload.split(";", 1)[0];
        if (marker === "A" || marker === "D") {
          rawCommand.current = { markedPrompt: true, running: false };
        } else if (marker === "C") {
          rawCommand.current.running = true;
        }
        return true;
      };
      const commandMarkers = term.parser.registerOscHandler(133, markCommand);
      const vscodeMarkers = term.parser.registerOscHandler(633, markCommand);
      const alternate = term.buffer.onBufferChange((buffer) => {
        setFullScreen(buffer.type === "alternate");
        const view = shellRef.current;
        if (
          buffer.type === "alternate" &&
          view.running &&
          view.foldedCommands.get(view.running.id)
        )
          view.toggleCommand(view.running.id);
      });
      const data = term.onData((text) => {
        if (
          send(new TextEncoder().encode(text)) &&
          (rawCommand.current.markedPrompt || shellRef.current.prompt) &&
          text.includes("\r")
        ) {
          rawCommand.current.running = true;
        }
      });
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
        else if (action === "clear") clearScreen();
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
        palette.forEach((value, index) =>
          transcript.current?.style.setProperty(
            "--terminal-ansi-" + index,
            value,
          ),
        );
        term.options.theme = {
          ...Object.fromEntries(
            names.map((name, index) => [name, palette[index]]),
          ),
          // Let the shared workspace material provide opacity and blur.
          background: `${background}00`,
          foreground,
          cursor: foreground,
          cursorAccent: background,
          selectionBackground: get("--oria-color-primary", "#3178a0") + "55",
          selectionInactiveBackground:
            get("--oria-color-primary", "#3178a0") + "55",
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
          current.current.onError("error.outputGap");
          void bridge.closeTerminal(session.id, clientId).catch(() => {});
          return;
        }
        lastFrame = frame.sequence;
        term.write(new Uint8Array(frame.bytes), () => {
          if (!disposed)
            void bridge
              .ackTerminal(session.id, clientId, frame.sequence)
              .catch(() => current.current.onError("error.outputGap"));
        });
      };
      void bridge
        .attachTerminal(session.id, clientId, channel)
        .catch((error) => {
          if (!disposed) current.current.onError(String(error));
        });
      cleanup = () => {
        cancelAnimationFrame(resizing);
        sizes.disconnect();
        themes.disconnect();
        reduced.removeEventListener("change", onReduced);
        element.removeEventListener("paste", onPaste, true);
        shellRef.current.send.current = null;
        shellMessages.dispose();
        commandMarkers.dispose();
        vscodeMarkers.dispose();
        alternate.dispose();
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
    Terminal.strings.promptLabel = t("input");
    Terminal.strings.tooMuchOutput = t("screenReaderOutputLimit");
    terminal.current?.textarea?.setAttribute(
      "aria-label",
      `${t("input")} ${session.endpoint}`,
    );
  }, [t, ready, session.endpoint]);
  useEffect(() => {
    if (!visible || !ready || session.phase !== "running") return;
    // A different feature's modal may still be finishing its close animation.
    // Wait for that modal to leave before focusing once; never steal its focus.
    let frame = 0;
    const dialogs = new MutationObserver(() => schedule());
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          document.querySelector(
            '[role="dialog"][data-open], [role="alertdialog"][data-open]',
          )
        )
          return;
        dialogs.disconnect();
        focusInput();
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
    const pane = transcript.current;
    if (
      !pane ||
      !visible ||
      session.phase !== "running" ||
      showSearch ||
      paste !== null ||
      menuOpen
    )
      return;
    const panel = pane.closest<HTMLElement>(".terminal-workspace") ?? pane;
    const controls =
      "button,a,input,textarea,select,[contenteditable=true],[role=option],[role=tab],[role=separator],[role=combobox]";
    const selectable = "pre,.xterm";
    let selecting = false;
    let frame = 0;
    const focusBlank = () => {
      const input = shellRef.current.editorInput.current;
      if (!input || !shellRef.current.editing) {
        terminal.current?.focus();
        return;
      }
      const start = input.selectionStart,
        end = input.selectionEnd,
        direction = input.selectionDirection;
      input.focus({ preventScroll: true });
      input.setSelectionRange(start, end, direction);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (
        event.ctrlKey ||
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        event.target.closest(controls)
      )
        return;
      // WebKit can focus the containing tabpanel before the first drag movement.
      selecting = !!event.target.closest(selectable);
      if (selecting) return;
      event.preventDefault();
      const selection = window.getSelection();
      // Removing the native caret's own Range can leave a focused textarea
      // without an insertion point in WKWebView.
      if (
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode?.parentElement?.closest("pre")
      )
        selection.removeAllRanges();
      focusBlank();
    };
    const endSelection = (event: MouseEvent) => {
      const wasSelecting = selecting;
      selecting = false;
      if (
        !wasSelecting ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.detail > 1
      )
        return;
      // At mouseup the browser has finished creating the selection. A plain click in
      // the empty part of a preformatted line should behave like any other blank area.
      if (
        !window.getSelection()?.toString() &&
        !terminal.current?.hasSelection()
      )
        focusBlank();
    };
    const release = () => {
      selecting = false;
    };
    const recover = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = document.activeElement;
        if (
          selecting ||
          window.getSelection()?.toString() ||
          terminal.current?.hasSelection() ||
          document.querySelector(
            '[role="dialog"][data-open], [role="alertdialog"][data-open], [role="menu"][data-open]',
          )
        )
          return;
        if (
          target === document.body ||
          target === panel ||
          target === pane ||
          target?.matches(
            ".terminal-session-panel,.shell-surface,.ssh-terminal-screen",
          )
        )
          focusBlank();
      });
    };
    const finishBlankClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        !(event.target instanceof Element) ||
        event.target.closest(controls + "," + selectable)
      )
        return;
      // Panel/tab click handlers can run after mousedown and focus their container.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = document.activeElement;
        if (
          target === document.body ||
          target === panel ||
          (target && panel.contains(target) && !target.closest(controls)) ||
          target === shellRef.current.editorInput.current
        )
          focusBlank();
      });
    };
    panel.addEventListener("click", finishBlankClick);
    panel.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", endSelection);
    window.addEventListener("blur", release);
    panel.addEventListener("focusout", recover);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    recover();
    return () => {
      cancelAnimationFrame(frame);
      panel.removeEventListener("click", finishBlankClick);
      panel.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", endSelection);
      window.removeEventListener("blur", release);
      panel.removeEventListener("focusout", recover);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [visible, session.phase, showSearch, paste, menuOpen, shell.editing]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.disableStdin = session.finishedAt !== null;
  }, [session.finishedAt]);
  useEffect(() => {
    const el = transcript.current;
    if (visible && el && shell.prompt && !window.getSelection()?.toString())
      el.scrollTop = el.scrollHeight;
  }, [shell.editing, visible, shell.prompt]);
  return (
    <div className="ssh-terminal-view">
      {showSearch && (
        <div
          className="terminal-search-bar"
          role="search"
          aria-label={t("find")}
        >
          <SearchInput
            ref={searchInput}
            type="search"
            className="terminal-search"
            aria-label={t("find")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                findMatch(e.shiftKey);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setShowSearch(false);
                focusInput();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("previous")}
            onClick={() => findMatch(true)}
          >
            <ArrowUpIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("next")}
            onClick={() => findMatch(false)}
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
              focusInput();
            }}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      )}
      <div
        className={"shell-transcript" + (shell.prompt ? " integrated" : "")}
        data-fullscreen={fullScreen || undefined}
        data-command-running={!!shell.running?.command || undefined}
        data-text-selection={highlights.length > 0 || undefined}
        ref={transcript}
      >
        <ContextMenu
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (open) {
              setKeyboardAnchor(null);
              setCanCopy(!!menuSelection.current);
            }
          }}
        >
          <ContextMenuTrigger
            className="shell-surface"
            onPointerDownCapture={(event) => {
              if (event.button === 2 || (event.button === 0 && event.ctrlKey))
                rememberSelection();
            }}
            onMouseDownCapture={(event) => {
              if (
                (event.button === 2 || (event.button === 0 && event.ctrlKey)) &&
                menuSelection.current
              )
                event.preventDefault();
            }}
            onContextMenuCapture={() => {
              if (!menuSelection.current) rememberSelection();
            }}
            onKeyDown={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("pre") &&
                terminalShortcutAction(event) === "copy"
              ) {
                event.preventDefault();
                void copy();
              }
            }}
            data-ssh-terminal="true"
            data-selectable="true"
          >
            <CommandHistory
              blocks={shell.blocks}
              pane={transcript}
              latestCommand={latestCommand}
              foldedCommands={shell.foldedCommands}
              limitedOutputs={shell.limitedOutputs}
              autoLimit={shell.autoLimitOutput}
              toggleCommand={shell.toggleCommand}
              toggleOutput={shell.toggleOutput}
              copy={copyBlock}
              focus={focusInput}
            />
            <div
              className="shell-current-block"
              data-live-output={!!liveCommand || undefined}
              data-output-folded={liveFolded || undefined}
            >
              <div className="shell-sticky">
                {shell.prompt && (shell.editing || shell.running) && (
                  <CommandHeader
                    key={shell.running?.id ?? "draft"}
                    copy={copy}
                    readCopy={() => {
                      if (!shell.running)
                        return {
                          command: shell.editorInput.current?.value ?? "",
                          output: "",
                        };
                      const term = terminal.current,
                        command = shell.running.command;
                      return {
                        command,
                        output: term
                          ? commandOutput(
                              command,
                              captureOutput(term, false).output,
                            )
                          : "",
                      };
                    }}
                    prompt={shell.running || shell.prompt}
                    directory={
                      shell.editing
                        ? { query: shell.query, changed: shell.changed }
                        : undefined
                    }
                    focus={focusInput}
                    command={shell.running?.command}
                    commandFolded={liveCommandFolded}
                    toggleCommand={
                      shell.running
                        ? () => shell.toggleCommand(shell.running!.id)
                        : undefined
                    }
                    limited={
                      !!shell.running &&
                      shell.limitedOutputs.get(shell.running.id)
                    }
                    toggleOutput={
                      shell.running
                        ? () => shell.toggleOutput(shell.running!.id)
                        : undefined
                    }
                  />
                )}
                {shell.editing &&
                  session.finishedAt === null &&
                  shell.prompt && (
                    <CommandEditor
                      query={shell.query}
                      history={shell.history}
                      inputRef={shell.editorInput}
                      cwd={shell.prompt.cwd}
                      visible={visible}
                      submit={(value) =>
                        terminal.current &&
                        shell.release(value, false, terminal.current)
                      }
                      raw={(value) =>
                        terminal.current &&
                        shell.release(value, true, terminal.current)
                      }
                      review={reviewPaste}
                      shortcut={(action) => {
                        if (action === "find") openSearch();
                        else if (action === "clear") clearScreen();
                        else if (action === "paste") void pasteClipboard();
                        else openContextMenu();
                      }}
                    />
                  )}
                {liveCommand && (
                  <pre
                    className="shell-command"
                    data-selectable="true"
                    tabIndex={-1}
                  >
                    $ {liveCommand.command}
                  </pre>
                )}
              </div>
              <div
                className={
                  liveFolded
                    ? "shell-live-viewport scroll-fade"
                    : "shell-live-viewport"
                }
              >
                <div className="shell-screen-clip">
                  <div
                    ref={container}
                    className={
                      "ssh-terminal-screen" +
                      (shell.editing || (liveCommandFolded && !fullScreen)
                        ? " shell-screen-hidden"
                        : "")
                    }
                  />
                </div>
              </div>
            </div>
          </ContextMenuTrigger>
          {highlights.length > 0 && (
            <div aria-hidden="true" className="shell-selection">
              {highlights.map((rect, i) => (
                <i key={i} style={rect} />
              ))}
            </div>
          )}
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
              if (action === "copy") void copy(menuSelection.current);
              else if (
                action === "paste" &&
                session.phase === "running" &&
                ready
              )
                void pasteClipboard();
              else if (action === "find" && ready) openSearch();
              else if (action === "clear" && ready) clearScreen();
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
                document.querySelector(
                  '[role="dialog"][data-open], [role="alertdialog"][data-open]',
                )
              )
                return false;
              return showSearch
                ? searchInput.current
                : shell.editorInput.current ||
                    terminal.current?.textarea ||
                    false;
            }}
          >
            <ContextMenuItem
              disabled={!canCopy}
              onClick={() => void copy(menuSelection.current)}
            >
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
            <ContextMenuItem disabled={!ready} onClick={clearScreen}>
              <BroomSparklesIcon aria-hidden="true" />
              {t("clear")}
              <ContextMenuShortcut>
                {mac ? "⌘K" : "Ctrl+Shift+K"}
              </ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      <AnimatePresence onExitComplete={focusInput}>
        {paste !== null && (
          <Modal
            key="paste"
            title={t("pasteTitle")}
            description={t("pasteHint")}
            close={() => {
              setPaste(null);
              focusInput();
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
                  focusInput();
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="primary-soft"
                disabled={session.phase !== "running"}
                onClick={() => {
                  pasteText(paste);
                  setPaste(null);
                  focusInput();
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
