import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { OutputRun } from "./terminal-output";

type Page = { start: number; end: number; lines: number; firstRun: number };

// Keep hard newlines and soft-wrapped text intact, including a single logical
// line spanning many terminal screens. Offsets are UTF-16, as in OutputRun.
export function indexOutput(text: string, runs: OutputRun[]) {
  const pages: Page[] = [];
  let start = 0,
    end = 0,
    lines = 0,
    firstRun = 0;
  const finish = () => {
    pages.push({ start, end, lines: Math.max(lines, 1), firstRun });
    start = end;
    lines = 0;
    while (firstRun < runs.length && runs[firstRun].end <= start) firstRun++;
  };
  while (end < text.length) {
    const newline = text.indexOf("\n", end);
    const lineEnd = newline < 0 ? text.length : newline + 1;
    while (lineEnd - start > 8192) {
      end = start + 8192;
      if (text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff)
        end--;
      finish();
    }
    end = lineEnd;
    lines++;
    if (lines >= 32) finish();
  }
  if (end > start) finish();
  return pages;
}

export function styledText(
  text: string,
  runs: OutputRun[],
  start: number,
  end: number,
  firstRun = 0,
) {
  const parts: ReactNode[] = [];
  let cursor = start;
  for (let i = firstRun; i < runs.length && runs[i].start < end; i++) {
    const run = runs[i];
    if (run.end <= cursor) continue;
    if (run.start > cursor) parts.push(text.slice(cursor, run.start));
    const next = Math.min(end, run.end);
    parts.push(
      <span key={i} style={run.style}>
        {text.slice(Math.max(cursor, run.start), next)}
      </span>,
    );
    cursor = next;
  }
  if (cursor < end) parts.push(text.slice(cursor, end));
  return parts;
}

export function useWindowDetail(
  visible: boolean,
  node: RefObject<HTMLElement | null>,
) {
  const [detailed, setDetailed] = useState(visible);
  useLayoutEffect(() => {
    if (visible === detailed) return;
    // A native drag or context-menu selection can span both window boundaries.
    // Keep its text nodes alive until the user releases the selection.
    const update = () => {
      const sel = window.getSelection();
      if (
        sel?.rangeCount &&
        !sel.isCollapsed &&
        node.current &&
        sel.getRangeAt(0).intersectsNode(node.current)
      )
        return;
      setDetailed(visible);
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [visible, detailed, node]);
  return detailed;
}

const OutputPage = memo(function OutputPage({
  page,
  text,
  runs,
  visible,
}: {
  page: Page;
  text: string;
  runs: OutputRun[];
  visible: boolean;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const detailed = useWindowDetail(visible, node);
  const content = useMemo(() => {
    if (!detailed) return text.slice(page.start, page.end);
    const rows: ReactNode[] = [];
    let at = page.start,
      run = page.firstRun;
    while (at < page.end) {
      const nl = text.indexOf("\n", at);
      const end = nl < 0 ? page.end : Math.min(nl + 1, page.end);
      rows.push(
        <span key={at} data-output-row="">
          {styledText(text, runs, at, end, run)}
        </span>,
      );
      while (run < runs.length && runs[run].end <= end) run++;
      at = end;
    }
    return rows;
  }, [page, text, runs, detailed]);
  return (
    <span ref={node} data-output-page="">
      {content}
    </span>
  );
});

export function VirtualOutput({
  element,
  limited,
  pages,
  text,
  runs,
}: {
  element: HTMLPreElement;
  limited: boolean;
  pages: Page[];
  text: string;
  runs: OutputRun[];
}) {
  const pane = element.closest<HTMLDivElement>(".shell-transcript");
  const [margin, setMargin] = useState(0);
  const list = useVirtualizer({
    count: pages.length,
    getScrollElement: () => (limited ? element : pane),
    estimateSize: (index) => pages[index].lines * 19,
    scrollMargin: margin,
    overscan: 3,
    useFlushSync: true,
  });
  useLayoutEffect(() => {
    if (!pane) return;
    // Plain-text placeholders already occupy the measured space in normal flow.
    list.shouldAdjustScrollPositionOnItemSizeChange = () => false;
    let lastWidth = -1;
    const measure = () => {
      if (!element.clientWidth) return;
      setMargin(
        limited
          ? 0
          : element.getBoundingClientRect().top -
              pane.getBoundingClientRect().top +
              pane.scrollTop,
      );
      if (lastWidth === element.clientWidth) return;
      lastWidth = element.clientWidth;
      // Read native line breaks. This also measures wide glyphs, blank lines
      // and long wrapped commands accurately after resizing a split pane.
      const children = Array.from(element.children);
      const tops = children.map((child) => child.getBoundingClientRect().top);
      const bottom = children.at(-1)?.getBoundingClientRect().bottom;
      if (bottom === undefined) return;
      const heights = tops.map((top, i) =>
        Math.max(1, (tops[i + 1] ?? bottom) - top),
      );
      heights.forEach((height, i) => list.resizeItem(i, height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(pane);
    const surface = element.closest(".shell-surface");
    if (surface) observer.observe(surface);
    return () => observer.disconnect();
  }, [element, pane, pages, limited, list]);
  const items = list.getVirtualItems();
  const first = items[0]?.index ?? 0,
    last = items.at(-1)?.index ?? 2;
  // Native plain text, rather than empty spacers, covers even arbitrary thumb
  // jumps before the next JS scroll event. Only the window mounts row/ANSI DOM.
  return (
    <>
      {pages.map((page, i) => (
        <OutputPage
          key={page.start}
          page={page}
          text={text}
          runs={runs}
          visible={i >= first && i <= last}
        />
      ))}
    </>
  );
}
