import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import {
  createdCanvasLayout,
  oppositeSide,
  type CanvasCreation,
} from "./canvas-creation";
import { emptyHost, emptyRule } from "./rule-model";
import { readPortPlacements } from "./port-placement";

describe("creation from the local card edge", () => {
  const rule = { ...emptyRule("new"), id: "created" };
  const data = { hosts: [{ ...emptyHost(), id: "new" }], rules: [rule] };
  const creation = (side: Position): CanvasCreation => ({
    ruleId: "created",
    hostId: "new",
    newHost: true,
    placement: { side, offset: 0.35 },
  });
  it("places measured cards in the trigger direction and retains the exact source offset", () => {
    for (const side of Object.values(Position)) {
      const layout = createdCanvasLayout(
        data,
        creation(side),
        { local: { x: 100, y: 200 } },
        {},
        {
          "host:new": { width: 600, height: 300 },
        },
      );
      const host = layout.positions["host:new"];
      if (side === Position.Top) expect(host.y + 300).toBe(200 - 220);
      if (side === Position.Bottom) expect(host.y).toBe(200 + 164 + 220);
      if (side === Position.Left) expect(host.x + 600).toBe(100 - 220);
      if (side === Position.Right) expect(host.x).toBe(100 + 200 + 220);
      expect(layout.portPlacements.created).toEqual({ side, offset: 0.35 });
      expect(
        readPortPlacements(JSON.stringify(layout.portPlacements)).created,
      ).toEqual(creation(side).placement);
      expect(oppositeSide(oppositeSide(side))).toBe(side);
      expect(oppositeSide(side)).not.toBe(side);
    }
  });
  it("avoids an occupied slot on the same side without moving existing cards", () => {
    const current = { local: { x: 0, y: 0 }, "host:old": { x: 420, y: -60 } };
    const result = createdCanvasLayout(
      {
        hosts: data.hosts,
        rules: [{ ...emptyRule("old"), id: "old-rule" }, rule],
      },
      creation(Position.Right),
      current,
      {},
    );
    expect(result.positions["host:old"]).toEqual(current["host:old"]);
    expect(result.positions["host:new"].x).toBe(420);
    expect(
      Math.abs(result.positions["host:new"].y - current["host:old"].y),
    ).toBeGreaterThan(224);
  });
  it("keeps a reused host in place while routing the new connection from its chosen edge", () => {
    const positions = {
      local: { x: 0, y: 0 },
      "host:new": { x: 700, y: -450 },
    };
    const placements = { other: { side: Position.Right, offset: 0.8 } };
    const result = createdCanvasLayout(
      data,
      { ...creation(Position.Left), newHost: false },
      positions,
      placements,
    );
    expect(result.positions).toBe(positions);
    expect(result.portPlacements.other).toEqual(placements.other);
    expect(result.portPlacements.created.side).toBe(Position.Left);
  });
});
