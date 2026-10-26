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
  const next = incoming.map((node) => {
    const old = previous.get(node.id);
    if (!old) return node;
    const keys = Object.keys(node.data);
    const data =
      keys.length === Object.keys(old.data).length &&
      keys.every((key) => {
        const before = old.data[key],
          after = node.data[key];
        return (
          before === after ||
          (Array.isArray(before) &&
            Array.isArray(after) &&
            before.length === after.length &&
            before.every((value, index) => value === after[index]))
        );
      })
        ? old.data
        : node.data;
    const merged = {
      ...old,
      ...node,
      data,
      position: old.dragging ? old.position : node.position,
      measured: old.measured,
      selected: old.selected,
      dragging: old.dragging,
      resizing: old.resizing,
    };
    return Object.keys(merged).every((key) =>
      key === "position"
        ? old.position.x === merged.position.x &&
          old.position.y === merged.position.y
        : old[key as keyof T] === merged[key as keyof T],
    )
      ? old
      : merged;
  });
  return next.length === current.length &&
    next.every((node, index) => node === current[index])
    ? current
    : next;
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
