import { describe, expect, it } from "vitest";
import {
  groupEdge,
  groupPreviewShare,
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
      const result = movePane(
        singles,
        "b",
        { scope: "pane", target: "a", side },
        "ab",
      );
      expect(result[0]).toEqual({
        tab: "a",
        tree: { id: "ab", axis, first: order[0], second: order[1] },
      });
      expect(result[1]).toBe(singles[2]);
    },
  );
  const edges = [
    ["left", 101, 250],
    ["right", 699, 250],
    ["top", 400, 116],
    ["bottom", 400, 384],
  ] as const;
  describe.each(["horizontal", "vertical"] as const)(
    "outer edges of a %s pair",
    (axis) => {
      const pair = movePane(
        singles,
        "b",
        {
          scope: "pane",
          target: "a",
          side: axis === "horizontal" ? "right" : "bottom",
        },
        "ab",
      );
      it.each(edges)(
        "docks a third terminal on the %s across the entire pair",
        (side, x, y) => {
          expect(
            groupEdge({ left: 100, top: 100, width: 600, height: 300 }, x, y),
          ).toBe(side);
          const [result, ...others] = movePane(
            pair,
            "c",
            { scope: "group", target: "a", side },
            "abc",
          );
          expect(others).toEqual([]);
          const root = result.tree;
          if (typeof root === "string") throw Error("expected a split");
          const before = side === "left" || side === "top";
          const expectedAxis =
            side === "left" || side === "right" ? "horizontal" : "vertical";
          expect(root.axis).toBe(expectedAxis);
          expect(before ? root.first : root.second).toBe("c");
          expect(before ? root.second : root.first).toBe(pair[0].tree);
          const share = axis === expectedAxis ? 100 / 3 : 50;
          expect(groupPreviewShare(pair[0].tree, "c", side)).toBeCloseTo(share);
          expect(root.firstSize ?? 50).toBeCloseTo(
            before ? share : 100 - share,
          );
        },
      );
    },
  );

  it("leaves the interior for individual panes, including in small groups", () => {
    const rect = { left: 100, top: 100, width: 150, height: 80 };
    expect(groupEdge(rect, 120, 115)).toBeNull();
    expect(groupEdge(rect, 99, 110)).toBeNull();
    expect(groupEdge(rect, 102, 106)).toBe("left");
    expect(groupEdge(rect, 106, 102)).toBe("top");
  });
  const nested = movePane(
    movePane(singles, "a", { scope: "pane", target: "b", side: "left" }, "ab"),
    "c",
    { scope: "pane", target: "a", side: "bottom" },
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
  it("redocks the group's identifying pane while keeping the remaining split intact", () => {
    const drop = { scope: "group", target: "b", side: "top" } as const;
    const moved = movePane(nested, "b", drop, "outer");
    expect(moved).toEqual([
      {
        tab: "b",
        tree: {
          id: "outer",
          axis: "vertical",
          firstSize: 100 / 3,
          first: "b",
          second: { id: "ac", axis: "vertical", first: "a", second: "c" },
        },
      },
    ]);
    expect(groupPreviewShare(nested[0].tree, "b", "top")).toBeCloseTo(100 / 3);
    expect(movePane(moved, "b", drop, "noop")).toBe(moved);
    expect(groupPreviewShare(moved[0].tree, "b", "top")).toBeNull();
  });
  it("moves one pane within a group without duplication or empty branches", () => {
    for (const source of ["a", "b", "c"]) {
      for (const pane of ["a", "b", "c"]) {
        for (const side of ["left", "right", "top", "bottom"] as SplitSide[]) {
          const result = movePane(
            nested,
            source,
            { scope: "pane", target: pane, side },
            "move",
          );
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
    expect(
      movePane(
        singles,
        "a",
        { scope: "pane", target: "gone", side: "left" },
        "",
      ),
    ).toBe(singles);
    expect(
      movePane(
        singles,
        "gone",
        { scope: "pane", target: "a", side: "left" },
        "",
      ),
    ).toBe(singles);
  });
});
