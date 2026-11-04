import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
export type SelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export function marqueeHits(
  ids: string[],
  rect: SelectionRect,
  width: number,
  columns: number,
  rowHeight: number,
  gapX = 0,
  gapY = 0,
) {
  if (rect.width <= 0 || rect.height <= 0 || width <= 0) return [];
  const colWidth = width / columns,
    hits: string[] = [];
  const first = Math.max(0, Math.floor(rect.top / rowHeight) * columns);
  const end = Math.min(
    ids.length,
    Math.ceil((rect.top + rect.height) / rowHeight) * columns,
  );
  for (let i = first; i < end; i++) {
    const left = (i % columns) * colWidth + gapX / 2;
    const top = Math.floor(i / columns) * rowHeight + gapY / 2;
    if (
      left < rect.left + rect.width &&
      left + colWidth - gapX > rect.left &&
      top < rect.top + rect.height &&
      top + rowHeight - gapY > rect.top
    )
      hits.push(ids[i]);
  }
  return hits;
}
export function mergeMarquee(
  base: string[],
  hits: string[],
  mode: "replace" | "add" | "toggle",
) {
  if (mode === "replace") return hits;
  const next = new Set(base);
  for (const id of hits) {
    if (mode === "toggle" && next.has(id)) next.delete(id);
    else next.add(id);
  }
  return [...next];
}
type Gesture = {
  id: number;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  active: boolean;
  base: string[];
  mode: "replace" | "add" | "toggle";
  item?: string;
  ctrl: boolean;
  shift: boolean;
};
export function useMarqueeSelection({
  viewport,
  ids,
  columns,
  rowHeight,
  gapX = 0,
  gapY = 0,
  selected,
  onChange,
  onClick,
  onActivate,
}: {
  viewport: RefObject<HTMLDivElement | null>;
  ids: string[];
  columns: number;
  rowHeight: number;
  gapX?: number;
  gapY?: number;
  selected: string[];
  onChange: (ids: string[]) => void;
  onClick: (id: string, ctrl: boolean, shift: boolean) => void;
  onActivate: (id: string) => void;
}) {
  const [box, setBox] = useState<SelectionRect | null>(null);
  const gesture = useRef<Gesture | null>(null),
    frame = useRef(0),
    suppressClick = useRef(false),
    suppressActivation = useRef(false),
    last = useRef(selected);
  const latest = useRef({
    ids,
    columns,
    rowHeight,
    gapX,
    gapY,
    onChange,
    onClick,
    onActivate,
  });
  latest.current = {
    ids,
    columns,
    rowHeight,
    gapX,
    gapY,
    onChange,
    onClick,
    onActivate,
  };
  const paint = () => {
    const g = gesture.current,
      el = viewport.current;
    if (!g || !g.active || !el) return;
    const bounds = el.getBoundingClientRect();
    const x =
      Math.max(0, Math.min(el.clientWidth, g.clientX - bounds.left)) +
      el.scrollLeft;
    const y =
      Math.max(0, Math.min(el.clientHeight, g.clientY - bounds.top)) +
      el.scrollTop;
    const rect = {
      left: Math.min(g.x, x),
      top: Math.min(g.y, y),
      width: Math.abs(g.x - x),
      height: Math.abs(g.y - y),
    };
    setBox((previous) =>
      previous &&
      Object.keys(rect).every(
        (key) =>
          previous[key as keyof SelectionRect] ===
          rect[key as keyof SelectionRect],
      )
        ? previous
        : rect,
    );
    const p = latest.current;
    const next = mergeMarquee(
      g.base,
      marqueeHits(
        p.ids,
        rect,
        el.clientWidth,
        p.columns,
        p.rowHeight,
        p.gapX,
        p.gapY,
      ),
      g.mode,
    );
    if (
      next.length !== last.current.length ||
      next.some((id, i) => id !== last.current[i])
    ) {
      last.current = next;
      p.onChange(next);
    }
  };
  const autoScroll = () => {
    const g = gesture.current,
      el = viewport.current;
    if (!g?.active || !el) return;
    const r = el.getBoundingClientRect();
    const edge = 28;
    const delta =
      g.clientY < r.top + edge
        ? -Math.min(20, (r.top + edge - g.clientY) / 2)
        : g.clientY > r.bottom - edge
          ? Math.min(20, (g.clientY - r.bottom + edge) / 2)
          : 0;
    if (delta) {
      el.scrollTop += delta;
      paint();
    }
    frame.current = requestAnimationFrame(autoScroll);
  };
  const finish = (cancel = false) => {
    const g = gesture.current;
    if (!g) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    gesture.current = null;
    setBox(null);
    if (cancel) latest.current.onChange(g.base);
    else if (!g.active) {
      if (g.item) latest.current.onClick(g.item, g.ctrl, g.shift);
      else if (g.mode === "replace") latest.current.onChange([]);
    }
    suppressClick.current = true;
    suppressActivation.current = cancel || g.active;
  };
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return {
    box,
    handlers: {
      onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
        // Portal menus share the React ancestry, but are outside this viewport.
        if (!event.currentTarget.contains(event.target as Node)) return;
        suppressClick.current = false;
        suppressActivation.current = false;
        if (
          document.querySelector(
            '[data-slot="context-menu-content"][data-open], [data-slot="dropdown-menu-content"][data-open]',
          )
        )
          return;
        if (event.button !== 0 || event.pointerType === "touch") return;
        // Control-click opens the native context menu on macOS.
        if (event.ctrlKey && /Mac|iPhone|iPad/.test(navigator.platform)) return;
        const target = event.target as Element;
        if (target.closest("button,input,a,summary")) return;
        const row = target.closest<HTMLElement>("[data-file-entry]");
        if (row) {
          const identity = [
            row.querySelector(".files-artwork"),
            row.querySelector(".files-entry-name > span:last-child"),
          ];
          if (
            identity.some((node) => {
              const r = node?.getBoundingClientRect();
              return (
                r &&
                event.clientX >= r.left &&
                event.clientX <= r.right &&
                event.clientY >= r.top &&
                event.clientY <= r.bottom
              );
            })
          )
            return;
        }
        const el = event.currentTarget,
          r = el.getBoundingClientRect();
        gesture.current = {
          id: event.pointerId,
          x: event.clientX - r.left + el.scrollLeft,
          y: event.clientY - r.top + el.scrollTop,
          clientX: event.clientX,
          clientY: event.clientY,
          active: false,
          base: selected,
          mode:
            event.ctrlKey || event.metaKey
              ? "toggle"
              : event.shiftKey
                ? "add"
                : "replace",
          item: row?.dataset.fileEntry,
          ctrl: event.ctrlKey || event.metaKey,
          shift: event.shiftKey,
        };
        last.current = selected;
        suppressClick.current = false;
        event.stopPropagation();
        event.preventDefault();
        el.focus({ preventScroll: true });
        el.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        g.clientX = event.clientX;
        g.clientY = event.clientY;
        if (!g.active) {
          const el = event.currentTarget,
            r = el.getBoundingClientRect();
          if (
            Math.hypot(
              event.clientX - r.left + el.scrollLeft - g.x,
              event.clientY - r.top + el.scrollTop - g.y,
            ) < 4
          )
            return;
          g.active = true;
          frame.current = requestAnimationFrame(autoScroll);
        }
        event.stopPropagation();
        paint();
      },
      onPointerUp: () => finish(),
      onPointerCancel: () => finish(true),
      onLostPointerCapture: () => finish(true),
      onClickCapture: (event: React.MouseEvent) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      },
      onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => {
        if (
          suppressActivation.current ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        // Pointer capture retargets blank-row clicks to the viewport. Resolve
        // the actual row under the pointer so its full width can be opened.
        const row = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-file-entry]");
        const id = row?.dataset.fileEntry;
        if (id && row && event.currentTarget.contains(row)) {
          event.preventDefault();
          latest.current.onActivate(id);
        }
      },
    },
    cancel: () => finish(true),
  };
}
