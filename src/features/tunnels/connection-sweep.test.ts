import { describe, expect, it } from "vitest";
import { getBezierPath, Position } from "@xyflow/react";
import { connectionSweep } from "./connection-sweep";
describe("connection sweep without SVG layout reads", () => {
  it("retains the 14–36px band limits and full entry/exit on straight paths", () => {
    for (const length of [10, 100, 1000]) {
      const sweep = connectionSweep(
        `M0,0 C${length / 3},0 ${(length * 2) / 3},0 ${length},0`,
      );
      const [band, gap] = sweep.dasharray.split(" ").map(Number);
      expect(band).toBeCloseTo(Math.min(36, Math.max(14, length * 0.18)), 5);
      expect(gap - band).toBeCloseTo(length, 5);
      expect(parseFloat(sweep.frames[0].strokeDashoffset)).toBe(band);
      expect(parseFloat(sweep.frames[1].strokeDashoffset)).toBe(-gap);
    }
  });
  it("tracks curved geometry accurately and supports actual React Flow path formatting", () => {
    const [band, gap] = connectionSweep("M0,0 C0,100 100,100 100,0")
      .dasharray.split(" ")
      .map(Number);
    expect(gap - band).toBeCloseTo(200, 0);
    const [path] = getBezierPath({
      sourceX: -100,
      sourceY: 20,
      sourcePosition: Position.Right,
      targetX: 400,
      targetY: 200,
      targetPosition: Position.Left,
    });
    const sweep = connectionSweep(path);
    expect(parseFloat(sweep.frames[1].strokeDashoffset)).toBeLessThan(-500);
    expect(sweep.dasharray).not.toMatch(/NaN|Infinity/);
  });
});
