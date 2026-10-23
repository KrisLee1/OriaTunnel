import { Position } from "@xyflow/react";

export type PortPlacement = { side: Position; offset: number };
export const PORT_LAYOUT_KEY = "oria-tunnel-local-ports";
export function readPortPlacements(
  value: string | null,
): Record<string, PortPlacement> {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, PortPlacement] => {
          const port = entry[1] as PortPlacement | null;
          return (
            !!port &&
            Object.values(Position).includes(port.side) &&
            Number.isFinite(port.offset) &&
            port.offset >= 0 &&
            port.offset <= 1
          );
        },
      ),
    );
  } catch {
    return {};
  }
}

// Work in card coordinates, independent of canvas zoom and viewport panning.
export function projectPort(
  x: number,
  y: number,
  width: number,
  height: number,
): PortPlacement {
  const distances = [
    { side: Position.Top, distance: Math.abs(y), offset: x / width },
    { side: Position.Right, distance: Math.abs(x - width), offset: y / height },
    {
      side: Position.Bottom,
      distance: Math.abs(y - height),
      offset: x / width,
    },
    { side: Position.Left, distance: Math.abs(x), offset: y / height },
  ];
  const edge = distances.reduce((best, next) =>
    next.distance < best.distance ? next : best,
  );
  const horizontal =
    edge.side === Position.Top || edge.side === Position.Bottom;
  const margin = Math.min(
    0.25,
    (horizontal ? 28 : 14) / Math.max(1, horizontal ? width : height),
  );
  return {
    side: edge.side,
    offset: Math.max(margin, Math.min(1 - margin, edge.offset)),
  };
}
