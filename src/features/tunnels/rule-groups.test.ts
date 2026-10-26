import { describe, it, expect } from "vitest";
import { emptyHost, emptyRule } from "./rule-model";
import {
  groupRulesByHost,
  canvasHostGroups,
  groupPositions,
} from "./rule-groups";

describe("connections grouped by SSH profile", () => {
  it("shows added hosts without forwards and creates no synthetic rules or edges", () => {
    const host = { ...emptyHost(), id: "unbound" };
    const groups = canvasHostGroups([], [host]);
    expect(groups).toEqual([{ id: "host:unbound", host, rules: [] }]);
    expect(groupPositions(groups, {})["host:unbound"].x).toBe(480);
  });
  const hosts = ["a", "b"].map((id) => ({
    ...emptyHost(),
    id,
    name: "Same name",
    address: "same.example",
  }));
  const rules = [
    { ...emptyRule("a"), id: "l" },
    { ...emptyRule("b"), id: "r", kind: "R" as const },
    { ...emptyRule("a"), id: "d", kind: "D" as const },
    { ...emptyRule("missing"), id: "lost" },
  ];
  it("combines mixed forwarding types per stable host ID while preserving order and missing references", () => {
    const groups = groupRulesByHost(rules, hosts);
    expect(groups.map((group) => group.id)).toEqual([
      "host:a",
      "host:b",
      "host:missing",
    ]);
    expect(groups[0].rules.map((rule) => rule.id)).toEqual(["l", "d"]);
    expect(groups[1].host?.id).toBe("b");
    expect(groups[2].host).toBeUndefined();
    expect(groups.flatMap((group) => group.rules)).toHaveLength(rules.length);
    expect(groupRulesByHost([], hosts)).toEqual([]);
  });
  it("keeps current host positions and spaces variable-height cards", () => {
    const groups = groupRulesByHost(rules, hosts);
    const saved = {
      local: { x: 10, y: 20 },
      "host:a": { x: 600, y: 35 },
      "host:b": { x: -500, y: 45 },
    };
    const positions = groupPositions(groups, saved);
    expect(positions["host:a"]).toEqual(saved["host:a"]);
    expect(positions["host:b"]).toEqual(saved["host:b"]);
    expect(positions["host:missing"].y).toBeGreaterThan(
      positions["host:a"].y + 400,
    );
    expect(groupPositions(groups, {})["host:b"].x).toBeLessThan(0);
    expect(groupPositions(groups, {})["host:a"].x).toBeGreaterThan(0);
    expect(saved["host:a"]).toEqual({ x: 600, y: 35 });
  });
});
