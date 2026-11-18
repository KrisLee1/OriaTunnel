import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { groupEdge, splitSide, type PaneDrop } from "./terminal-splits";

export function usePaneDrag(
  list: RefObject<HTMLDivElement | null>,
  move: (source: string, drop: PaneDrop) => void,
) {
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
    handle: Element;
  } | null>(null);
  const [preview, setPreview] = useState<{
    source: string;
    drop: PaneDrop;
  } | null>(null);
  const swallowClick = useRef(false);
  function cancel() {
    const current = gesture.current;
    gesture.current = null;
    if (current?.handle.hasPointerCapture(current.id))
      current.handle.releasePointerCapture(current.id);
    setPreview(null);
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        swallowClick.current = true;
        cancel();
      }
    };
    const lostCapture = (event: PointerEvent) => {
      if (gesture.current?.id === event.pointerId) cancel();
    };
    document.addEventListener("lostpointercapture", lostCapture);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("lostpointercapture", lostCapture);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  function hit(
    event: ReactPointerEvent,
    source: string,
    grouped: boolean,
  ): PaneDrop | null {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element) return null;
    if (list.current?.contains(element)) return grouped ? "tabs" : null;
    const group = element.closest<HTMLElement>("[data-terminal-group]");
    if (!group || !list.current?.closest(".terminal-tabs")?.contains(group))
      return null;
    if (group.hasAttribute("data-split")) {
      const side = groupEdge(
        group.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
      if (side)
        return { scope: "group", target: group.dataset.terminalGroup!, side };
    }
    const pane = element.closest<HTMLElement>("[data-terminal-pane]");
    if (!pane || pane.dataset.terminalPane === source) return null;
    return {
      scope: "pane",
      target: pane.dataset.terminalPane!,
      side: splitSide(
        pane.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      ),
    };
  }
  function handle(source: string, grouped: boolean) {
    return {
      onPointerDown(event: ReactPointerEvent) {
        if (event.button !== 0 || !event.isPrimary || gesture.current) return;
        // Keep the destination tab visible until a click or a completed drop.
        event.preventDefault();
        swallowClick.current = false;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
          handle: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: ReactPointerEvent) {
        const drag = gesture.current;
        if (drag?.id !== event.pointerId) return;
        if (
          !drag.moved &&
          Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5
        )
          return;
        drag.moved = true;
        const next = hit(event, source, grouped);
        setPreview((old) => {
          if (!next) return null;
          const last = old?.drop;
          if (
            last === next ||
            (last &&
              last !== "tabs" &&
              next !== "tabs" &&
              last.scope === next.scope &&
              last.target === next.target &&
              last.side === next.side)
          )
            return old;
          return { source, drop: next };
        });
      },
      onPointerUp(event: ReactPointerEvent) {
        const drag = gesture.current;
        if (drag?.id !== event.pointerId) return;
        const drop = drag.moved && hit(event, source, grouped);
        swallowClick.current = drag.moved;
        cancel();
        if (drop) move(source, drop);
      },
      onPointerCancel(event: ReactPointerEvent) {
        if (gesture.current?.id === event.pointerId) cancel();
      },
      onClickCapture(event: React.MouseEvent) {
        if (event.detail && swallowClick.current) {
          event.stopPropagation();
          event.preventDefault();
          swallowClick.current = false;
        }
      },
    };
  }
  return { preview, handle };
}
