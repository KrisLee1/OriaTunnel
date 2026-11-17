import {
  memo,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { exceedsPreviewHeight } from "./shell-editor";
import { indexOutput, styledText, VirtualOutput } from "./virtual-output";
import type { IBufferCell, Terminal } from "@xterm/xterm";

export type OutputRun = { start: number; end: number; style: CSSProperties };

function color(index: number, rgb: boolean) {
  if (rgb) return "#" + index.toString(16).padStart(6, "0");
  if (index < 16) return `var(--terminal-ansi-${index})`;
  if (index >= 232) {
    const grey = 8 + 10 * (index - 232);
    return `rgb(${grey} ${grey} ${grey})`;
  }
  const levels = [0, 95, 135, 175, 215, 255];
  const cube = index - 16;
  return `rgb(${levels[Math.floor(cube / 36)]} ${levels[Math.floor(cube / 6) % 6]} ${levels[cube % 6]})`;
}
function attributes(cell: IBufferCell): CSSProperties {
  let fg = cell.isFgDefault()
    ? undefined
    : color(cell.getFgColor(), cell.isFgRGB());
  let bg = cell.isBgDefault()
    ? undefined
    : color(cell.getBgColor(), cell.isBgRGB());
  if (cell.isInverse())
    [fg, bg] = [bg || "var(--oria-color-bg)", fg || "var(--oria-color-fg)"];
  const decorations = [
    cell.isUnderline() && "underline",
    cell.isStrikethrough() && "line-through",
    cell.isOverline() && "overline",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    color: fg,
    backgroundColor: bg,
    fontWeight: cell.isBold() ? 700 : undefined,
    fontStyle: cell.isItalic() ? "italic" : undefined,
    opacity: cell.isDim() ? 0.6 : undefined,
    textDecorationLine: decorations || undefined,
  };
}

// Capture the emulator's rendered grid. Spaces between columns are real cells,
// and a soft wrap continues the same logical line when the panel changes width.
// ConPTY forwards OSC immediately but paints console cells asynchronously.
// Locate the shell's end marker even if a resize wrapped it or background
// output advanced the cursor before the frame was consumed.
export function powerShellOutputEnd(term: Terminal, marker: string) {
  const buffer = term.buffer.active;
  for (let row = buffer.length - 1; row >= 0; row--) {
    const line = buffer.getLine(row);
    if (!line) continue;
    let text = line.translateToString(true);
    if (!text || !marker.endsWith(text)) continue;
    let first = row;
    while (first > 0 && text.length < marker.length) {
      text = buffer.getLine(--first)!.translateToString(false) + text;
    }
    if (text === marker) return first;
  }
}

// The local shell leaves a concealed '>' above the command. During a ConPTY
// repaint the old viewport can enter scrollback before the new one is painted.
export function powerShellOutputStart(term: Terminal) {
  const buffer = term.buffer.active;
  let start = 0;
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    const text = line?.translateToString(true);
    if (!text) continue;
    if (text !== ">" || !line?.getCell(0)?.isInvisible()) break;
    start = row + 1;
  }
  return start;
}

export function captureOutput(
  term: Terminal,
  withStyles = true,
  endRow = term.buffer.active.length,
  powershell = false,
) {
  const buffer = term.buffer.active,
    cell = buffer.getNullCell();
  const runs: OutputRun[] = [];
  const first = Math.max(
    powershell ? powerShellOutputStart(term) : 0,
    endRow - 5000,
  );
  let output = "",
    lastFg = -1,
    lastBg = -1,
    lastFlags = -1;
  for (let row = first; row < endRow; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    if (row > first && !line.isWrapped) output += "\n";
    const nextWrapped = buffer.getLine(row + 1)?.isWrapped === true;
    const length = line.translateToString(!nextWrapped).length;
    let consumed = 0;
    for (let col = 0; col < line.length && consumed < length; col++) {
      if (!line.getCell(col, cell) || cell.getWidth() === 0) continue;
      const text = cell.getChars() || " ";
      const start = output.length;
      output += cell.isInvisible() ? " ".repeat(cell.getWidth()) : text;
      consumed += text.length;
      if (!withStyles || cell.isAttributeDefault() || runs.length >= 8192)
        continue;
      // xterm exposes color modes as high bits. Compare cells before allocating a CSS run.
      const fg = cell.getFgColorMode() | cell.getFgColor();
      const bg = cell.getBgColorMode() | cell.getBgColor();
      const flags =
        (cell.isBold() ? 1 : 0) |
        (cell.isItalic() ? 2 : 0) |
        (cell.isUnderline() ? 4 : 0) |
        (cell.isDim() ? 8 : 0) |
        (cell.isInverse() ? 16 : 0) |
        (cell.isStrikethrough() ? 32 : 0) |
        (cell.isOverline() ? 64 : 0);
      const last = runs.at(-1);
      if (
        last?.end === start &&
        lastFg === fg &&
        lastBg === bg &&
        lastFlags === flags
      )
        last.end = output.length;
      else {
        runs.push({ start, end: output.length, style: attributes(cell) });
        lastFg = fg;
        lastBg = bg;
        lastFlags = flags;
      }
    }
  }
  return { output: output.replace(/\n+$/u, ""), runs };
}

const noRuns: OutputRun[] = [];
export const TerminalOutput = memo(function TerminalOutput({
  text,
  runs = noRuns,
  limited,
  detailed,
  blockId,
  autoLimit,
}: {
  text: string;
  runs?: OutputRun[];
  limited: boolean;
  detailed: boolean;
  blockId: number;
  autoLimit?: (id: number) => void;
}) {
  const [element, setElement] = useState<HTMLPreElement | null>(null);
  const pages = useMemo(() => indexOutput(text, runs), [text, runs]);
  useLayoutEffect(() => {
    const pane = element?.closest<HTMLElement>(".shell-transcript");
    if (!element || !autoLimit || !pane) return;
    const measure = () => {
      if (!element.clientWidth || !pane.clientHeight) return;
      if (
        exceedsPreviewHeight(
          element.scrollHeight,
          pane.clientHeight,
          parseFloat(getComputedStyle(element).lineHeight),
        )
      )
        autoLimit(blockId);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, blockId, autoLimit]);
  return (
    <pre
      ref={setElement}
      className={
        limited ? "shell-output-text scroll-fade" : "shell-output-text"
      }
      tabIndex={-1}
      data-selectable="true"
    >
      {!detailed ? (
        text
      ) : pages.length > 4 ? (
        element ? (
          <VirtualOutput
            element={element}
            limited={limited}
            text={text}
            runs={runs}
            pages={pages}
          />
        ) : (
          text
        )
      ) : (
        styledText(text, runs, 0, text.length)
      )}
    </pre>
  );
});

// Find across ANSI spans without inserting markup into terminal text.
export function terminalTextRange(el: Element, start: number, end: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0,
    started = false;
  while (walker.nextNode()) {
    const node = walker.currentNode,
      length = node.textContent?.length || 0;
    if (!started && start < at + length) {
      range.setStart(node, start - at);
      started = true;
    }
    if (started && end <= at + length) {
      range.setEnd(node, end - at);
      return range;
    }
    at += length;
  }
}

export function selectOutputMatch(el: Element, start: number, end: number) {
  const range = terminalTextRange(el, start, end);
  if (!range) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const pane = el.closest<HTMLElement>(".shell-transcript");
  if (!pane) return;
  const box = pane.getBoundingClientRect(),
    hit = range.getBoundingClientRect();
  const header = el.closest(".shell-block")?.querySelector(".shell-sticky");
  const top =
    box.top + (header && !header.contains(el) ? header.clientHeight : 0);
  if (hit.top < top || hit.bottom > box.bottom) pane.scrollTop += hit.top - top;
}

// WebKit suppresses native selection paint when the menu takes focus.
// Measure text fragments only, since a Range across ANSI spans can also return element boxes.
export function selectionFragments(range: Range, pane: HTMLElement) {
  const bounds = pane.getBoundingClientRect();
  const root = range.commonAncestorContainer;
  // Large selections may include thousands of retained rows. Geometry is only
  // needed for pages inside the scrollport; offscreen text remains copyable.
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        const el = node as Element;
        if (el.matches(".shell-block,[data-output-page]")) {
          const rect = el.getBoundingClientRect();
          if (
            rect.bottom <= bounds.top ||
            rect.top >= bounds.bottom ||
            !range.intersectsNode(el)
          )
            return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    },
  );
  const rows: { left: number; top: number; width: number; height: number }[] =
    [];
  let previousBlock: Element | null = null;
  let node: Node | null =
    root.nodeType === Node.TEXT_NODE ? root : walker.nextNode();
  while (node) {
    if (range.intersectsNode(node)) {
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      const block = node.parentElement?.closest("pre,.shell-mirror");
      if (block) {
        const box = block.getBoundingClientRect(),
          style = getComputedStyle(block);
        const header = block.matches(".shell-output-text")
          ? block.previousElementSibling
          : null;
        const clipTop = Math.max(
          box.top,
          bounds.top,
          header?.getBoundingClientRect().bottom ?? bounds.top,
        );
        const height = parseFloat(style.lineHeight) || box.height;
        for (const rect of part.getClientRects()) {
          const clipBottom = Math.min(box.bottom, bounds.bottom);
          const lineTop = rect.top + (rect.height - height) / 2;
          const visibleTop = Math.max(clipTop, lineTop);
          const visibleHeight =
            Math.min(clipBottom, lineTop + height) - visibleTop;
          if (
            visibleHeight <= 0 ||
            !rect.width ||
            rect.bottom <= bounds.top ||
            rect.top >= bounds.bottom
          )
            continue;
          const left = rect.left - bounds.left + pane.scrollLeft;
          const top = visibleTop - bounds.top + pane.scrollTop;
          const previous = rows.at(-1);
          if (previous && previousBlock === block) {
            if (Math.abs(previous.top - top) < 1) {
              previous.width = Math.max(
                previous.width,
                left + rect.width - previous.left,
              );
              continue;
            }
            previous.width =
              box.right -
              parseFloat(style.paddingRight) -
              bounds.left +
              pane.scrollLeft -
              previous.left;
          }
          rows.push({ left, top, width: rect.width, height: visibleHeight });
          previousBlock = block;
        }
      }
    }
    node = walker.nextNode();
  }
  return rows;
}
