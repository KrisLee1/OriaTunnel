import { Position } from "@xyflow/react";
import type { Snapshot } from "@/types";
import type { PortPlacement } from "./port-placement";
import { localCardSize, localPortSide } from "./canvas-state";
import { groupPositions, groupRulesByHost } from "./rule-groups";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
export type CanvasCreation = {
  ruleId: string;
  hostId: string;
  newHost: boolean;
  placement: PortPlacement;
};

export function oppositeSide(side: Position) {
  return {
    top: Position.Bottom,
    bottom: Position.Top,
    left: Position.Right,
    right: Position.Left,
  }[side];
}

export function createdCanvasLayout(
  data: Pick<Snapshot, "rules" | "hosts">,
  creation: CanvasCreation,
  positions: Record<string, Point>,
  placements: Record<string, PortPlacement>,
  measured: Record<string, Size> = {},
) {
  const portPlacements = {
    ...placements,
    [creation.ruleId]: creation.placement,
  };
  if (!creation.newHost) return { positions, portPlacements };
  const groups = groupRulesByHost(data.rules, data.hosts);
  const resolved = groupPositions(groups, positions);
  const local = positions.local || { x: 0, y: 0 };
  const size = localCardSize(
    data.rules.map((rule) => ({
      side:
        portPlacements[rule.id]?.side ||
        localPortSide(local, resolved[`host:${rule.hostId}`]),
    })),
  );
  const id = `host:${creation.hostId}`;
  const hostSize = measured[id] || { width: 360, height: 224 };
  const { side, offset } = creation.placement;
  const vertical = side === Position.Top || side === Position.Bottom;
  const base = vertical
    ? {
        x: local.x + size.width * offset - hostSize.width / 2,
        y:
          side === Position.Top
            ? local.y - 220 - hostSize.height
            : local.y + size.height + 220,
      }
    : {
        x:
          side === Position.Left
            ? local.x - 220 - hostSize.width
            : local.x + size.width + 220,
        y: local.y + size.height * offset - hostSize.height / 2,
      };
  const occupied = groups
    .filter((group) => group.id !== id)
    .map((group) => ({
      ...resolved[group.id],
      ...(measured[group.id] || { width: 360, height: 224 }),
    }));
  const step = (vertical ? hostSize.width : hostSize.height) + 64;
  let position = base;
  for (let attempt = 0; attempt <= occupied.length * 2 + 2; attempt++) {
    const shift =
      attempt === 0
        ? 0
        : Math.ceil(attempt / 2) * step * (attempt % 2 ? 1 : -1);
    position = {
      x: base.x + (vertical ? shift : 0),
      y: base.y + (vertical ? 0 : shift),
    };
    if (
      !occupied.some(
        (other) =>
          position.x < other.x + other.width + 32 &&
          position.x + hostSize.width + 32 > other.x &&
          position.y < other.y + other.height + 32 &&
          position.y + hostSize.height + 32 > other.y,
      )
    )
      break;
  }
  return { positions: { ...positions, [id]: position }, portPlacements };
}
