import { Position, type Node } from "@xyflow/react";

export function localPortSide(
  local: { x: number; y: number },
  host: { x: number; y: number },
) {
  const dx = host.x - local.x;
  const dy = host.y - local.y;
  return Math.abs(dy) > Math.abs(dx)
    ? dy < 0
      ? Position.Top
      : Position.Bottom
    : dx < 0
      ? Position.Left
      : Position.Right;
}

export function localCardSize(ports: { side: Position }[]) {
  const count = (side: Position) =>
    ports.filter((port) => port.side === side).length;
  return {
    width: Math.max(
      200,
      (Math.max(count(Position.Top), count(Position.Bottom)) + 1) * 64,
    ),
    height: Math.max(
      164,
      (Math.max(count(Position.Left), count(Position.Right)) + 1) * 30,
    ),
  };
}

// Runtime snapshots replace domain data, while React Flow owns measured geometry
// and interaction state. Dropping measured dimensions hides a node until remeasured.
export function reconcileCanvasNodes<T extends Node>(
  current: T[],
  incoming: T[],
): T[] {
  const previous = new Map(current.map((node) => [node.id, node]));
  return incoming.map((node) => {
    const old = previous.get(node.id);
    if (!old) return node;
    return {
      ...old,
      ...node,
      position: old.dragging ? old.position : node.position,
      measured: old.measured,
      selected: old.selected,
      dragging: old.dragging,
      resizing: old.resizing,
    };
  });
}

// Moving a handle to the other side must not change its identity: the existing
// measured endpoint stays valid while React Flow updates its new coordinates.
export function canvasPortId(ruleId: string, type: "source" | "target") {
  return `${ruleId}-${type}`;
}

export function canvasLayout(
  nodes: Node[],
  saved: Record<string, { x: number; y: number }>,
) {
  return {
    ...saved,
    ...Object.fromEntries(nodes.map((node) => [node.id, node.position])),
  };
}
