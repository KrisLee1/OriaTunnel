import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import { projectPort, readPortPlacements } from "./port-placement";

describe("manual local port placement", () => {
  it("projects a drag onto all four edges and keeps labels away from corners", () => {
    expect(projectPort(80, 1, 200, 164)).toEqual({
      side: Position.Top,
      offset: 0.4,
    });
    expect(projectPort(199, 82, 200, 164)).toEqual({
      side: Position.Right,
      offset: 0.5,
    });
    expect(projectPort(100, 163, 200, 164)).toEqual({
      side: Position.Bottom,
      offset: 0.5,
    });
    expect(projectPort(1, 82, 200, 164)).toEqual({
      side: Position.Left,
      offset: 0.5,
    });
    expect(projectPort(-100, -1, 200, 164).offset).toBe(0.14);
    expect(projectPort(300, 165, 200, 164).offset).toBe(0.86);
  });
  it("normalizes correctly when the canvas is zoomed or panned", () => {
    const pointer = { x: 388, y: 232 };
    const rect = { left: 348, top: 150, width: 100, height: 82 };
    expect(
      projectPort(
        ((pointer.x - rect.left) * 200) / rect.width,
        ((pointer.y - rect.top) * 164) / rect.height,
        200,
        164,
      ),
    ).toEqual({ side: Position.Bottom, offset: 0.4 });
  });
  it("restores valid saved endpoints and rejects corrupt or out-of-range values", () => {
    const valid = { side: Position.Left, offset: 0.35 };
    expect(
      readPortPlacements(
        JSON.stringify({
          rule: valid,
          badSide: { side: "inside", offset: 0.2 },
          badOffset: { side: Position.Top, offset: 3 },
          missing: null,
        }),
      ),
    ).toEqual({ rule: valid });
    for (const value of [null, "invalid", "[]", "null", "42"])
      expect(readPortPlacements(value)).toEqual({});
  });
});
