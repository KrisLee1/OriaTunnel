import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { FileActivity } from "./transfer-state";

export const filePortId = (kind: "source" | "target", side: Position) =>
  `files-${kind}-${side}`;
export function projectFileEdges(
  activities: FileActivity[],
  nodes: Pick<Node, "id" | "position" | "measured" | "width" | "height">[],
  previous: Edge[] = [],
): Edge[] {
  const locations = new Map(
    nodes.map((node) => [
      node.id,
      {
        x: node.position.x + (node.measured?.width || node.width || 240) / 2,
        y: node.position.y + (node.measured?.height || node.height || 160) / 2,
      },
    ]),
  );
  const groups = new Map<
    string,
    { source: string; target: string; items: FileActivity[] }
  >();
  for (const activity of activities) {
    // Relays are shown as their real two legs through this computer.
    const legs = activity.relay
      ? [
          [activity.source, "local"],
          ["local", activity.target],
        ]
      : [[activity.source, activity.target]];
    for (const [source, target] of legs) {
      if (!locations.has(source) || !locations.has(target) || source === target)
        continue;
      const id = `files:${source}->${target}`;
      const group = groups.get(id) || { source, target, items: [] };
      group.items.push(activity);
      groups.set(id, group);
    }
  }
  const saved = new Map(previous.map((edge) => [edge.id, edge]));
  const result = [...groups].map(([id, group]): Edge => {
    const source = locations.get(group.source)!,
      target = locations.get(group.target)!;
    const dx = target.x - source.x,
      dy = target.y - source.y;
    const direction =
      Math.abs(dx) >= Math.abs(dy)
        ? dx >= 0
          ? Position.Right
          : Position.Left
        : dy >= 0
          ? Position.Bottom
          : Position.Top;
    // Host handles belong to the host heading. Never place file endpoints
    // in the forwarding-rule area, even when the card is very tall.
    const horizontal = dx >= 0 ? Position.Right : Position.Left;
    const from = group.source === "local" ? direction : horizontal;
    const to = {
      left: Position.Right,
      right: Position.Left,
      top: Position.Bottom,
      bottom: Position.Top,
    }[group.target === "local" ? direction : horizontal];
    const moving = group.items.some((item) => item.phase === "transferring");
    const phase = moving
      ? "transferring"
      : group.items.some((item) => item.phase === "directUnknown")
        ? "directUnknown"
        : group.items.some((item) => item.phase === "conflict")
          ? "conflict"
          : group.items.every((item) => item.phase === "paused")
            ? "paused"
            : "preparing";
    const title = [...new Set(group.items.map((item) => item.filename))]
      .slice(0, 3)
      .join("\n");
    const relay = group.items.some((item) => item.relay);
    const taskIds = group.items.map((item) => item.id);
    const taskKey = JSON.stringify(taskIds);
    const sourceHandle = filePortId("source", from),
      targetHandle = filePortId("target", to);
    const before = saved.get(id);
    if (
      before?.sourceHandle === sourceHandle &&
      before.targetHandle === targetHandle &&
      before.data?.moving === moving &&
      before.data?.phase === phase &&
      before.data?.count === group.items.length &&
      before.data?.title === title &&
      before.data?.taskKey === taskKey &&
      before.data?.relay === relay
    )
      return before;
    const color = ["paused", "conflict", "directUnknown"].includes(phase)
      ? "var(--oria-color-warning)"
      : "var(--oria-color-primary)";
    return {
      id,
      source: group.source,
      target: group.target,
      sourceHandle,
      targetHandle,
      type: "file-transfer",
      data: {
        moving,
        phase,
        count: group.items.length,
        title,
        relay,
        taskIds,
        taskKey,
      },
      className: `file-transfer-edge ${moving ? "file-transfer-moving" : ""}`,
      style: { stroke: color, strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });
  return result.length === previous.length &&
    result.every((edge, index) => edge === previous[index])
    ? previous
    : result;
}
