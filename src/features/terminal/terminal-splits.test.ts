import { describe, expect, it } from "vitest";
import {
  movePane,
  paneKeys,
  reconcileGroups,
  splitSide,
  type SplitSide,
} from "./terminal-splits";

const singles = reconcileGroups([], ["a", "b", "c"]);
describe("terminal split layouts", () => {
  it.each([
    ["left", "horizontal", ["b", "a"], 102, 150],
    ["right", "horizontal", ["a", "b"], 498, 150],
    ["top", "vertical", ["b", "a"], 300, 102],
    ["bottom", "vertical", ["a", "b"], 300, 198],
  ] as const)(
    "previews and inserts on the %s edge of a wide pane",
    (side, axis, order, x, y) => {
      const rect = { left: 100, top: 100, width: 400, height: 100 };
      expect(splitSide(rect, x, y)).toBe(side);
      const result = movePane(singles, "b", { pane: "a", side }, "ab");
      expect(result[0]).toEqual({
        tab: "a",
        tree: { id: "ab", axis, first: order[0], second: order[1] },
      });
      expect(result[1]).toBe(singles[2]);
    },
  );
  const nested = movePane(
    movePane(singles, "a", { pane: "b", side: "left" }, "ab"),
    "c",
    { pane: "a", side: "bottom" },
    "ac",
  );
  it("detaches the original target, promotes its sibling tree, and reuses the surviving split", () => {
    const result = movePane(nested, "b", "tabs", "");
    expect(result).toEqual([
      {
        tab: "a",
        tree: { id: "ac", axis: "vertical", first: "a", second: "c" },
      },
      { tab: "b", tree: "b" },
    ]);
    expect(reconcileGroups(result, ["c", "d"])).toEqual([
      { tab: "c", tree: "c" },
      { tab: "d", tree: "d" },
    ]);
  });
  it("moves one pane within a group without duplication or empty branches", () => {
    for (const source of ["a", "b", "c"]) {
      for (const pane of ["a", "b", "c"]) {
        for (const side of ["left", "right", "top", "bottom"] as SplitSide[]) {
          const result = movePane(nested, source, { pane, side }, "move");
          expect(result).toHaveLength(1);
          expect(result[0].tab).toBe(nested[0].tab);
          expect(paneKeys(result[0].tree).sort()).toEqual(["a", "b", "c"]);
          expect(reconcileGroups(result, ["a", "b", "c"])).toBe(result);
        }
      }
    }
  });
  it("ignores stale sources, targets and standalone detach requests", () => {
    expect(movePane(singles, "a", "tabs", "")).toBe(singles);
    expect(movePane(singles, "a", { pane: "gone", side: "left" }, "")).toBe(
      singles,
    );
    expect(movePane(singles, "gone", { pane: "a", side: "left" }, "")).toBe(
      singles,
    );
  });
});
