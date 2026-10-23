import { useRef } from "react";
import { Handle, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { CSSProperties, PointerEvent } from "react";
import { canvasPortId } from "./canvas-state";
import { projectPort, type PortPlacement } from "./port-placement";

export function LocalPortHandle({
  port,
  offset,
  onChange,
  onDragChange,
}: {
  port: {
    ruleId: string;
    side: Position;
    type: "source" | "target";
    label: string;
    name: string;
    color: string;
    custom?: PortPlacement;
  };
  offset: number;
  onChange: (id: string, value: PortPlacement | null, commit: boolean) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const { t } = useTranslation("tunnel");
  const drag = useRef<{
    id: number;
    rect: DOMRect;
    width: number;
    height: number;
    original: PortPlacement | null;
  } | null>(null);
  const horizontal =
    port.side === Position.Top || port.side === Position.Bottom;
  const placement: CSSProperties = horizontal
    ? { left: `${offset * 100}%` }
    : { top: `${offset * 100}%` };
  const update = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    return projectPort(
      ((event.clientX - current.rect.left) * current.width) /
        current.rect.width,
      ((event.clientY - current.rect.top) * current.height) /
        current.rect.height,
      current.width,
      current.height,
    );
  };
  const cancel = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    onChange(port.ruleId, current.original, true);
    onDragChange(false);
  };
  return (
    <Handle
      id={canvasPortId(port.ruleId, port.type)}
      type={port.type}
      position={port.side}
      className="connection-port local-port-handle nodrag nopan"
      isConnectable={false}
      isConnectableStart={false}
      isConnectableEnd={false}
      role="button"
      tabIndex={0}
      aria-label={`${port.name} · ${port.label} · ${t("movePortHint")}`}
      title={`${port.name} · ${port.label} · ${t("movePortHint")}`}
      style={
        {
          ...placement,
          "--connection-color": port.color,
        } as CSSProperties
      }
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        const card = event.currentTarget.closest<HTMLElement>(".local-card");
        if (!card) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = {
          id: event.pointerId,
          rect: card.getBoundingClientRect(),
          width: card.offsetWidth,
          height: card.offsetHeight,
          original: port.custom || null,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        onDragChange(true);
      }}
      onPointerMove={(event) => {
        const value = update(event);
        if (value) {
          event.stopPropagation();
          onChange(port.ruleId, value, false);
        }
      }}
      onPointerUp={(event) => {
        const value = update(event);
        if (!value) return;
        event.stopPropagation();
        drag.current = null;
        onChange(port.ruleId, value, true);
        onDragChange(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onChange(port.ruleId, null, true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.stopPropagation();
          cancel();
          return;
        }
        if (["Delete", "Backspace"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          onChange(port.ruleId, null, true);
          return;
        }
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault();
        event.stopPropagation();
        const side = event.shiftKey
          ? (
              {
                ArrowUp: Position.Top,
                ArrowDown: Position.Bottom,
                ArrowLeft: Position.Left,
                ArrowRight: Position.Right,
              } as Record<string, Position>
            )[event.key]
          : port.side;
        onChange(
          port.ruleId,
          {
            side,
            offset: Math.max(
              0.1,
              Math.min(
                0.9,
                offset +
                  (event.key === "ArrowUp" || event.key === "ArrowLeft"
                    ? -0.05
                    : 0.05),
              ),
            ),
          },
          true,
        );
      }}
    >
      <span className="connection-port-label">{port.label}</span>
    </Handle>
  );
}
