import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "@/i18n";
import "@/tunnel-i18n";
import { activityRows } from "./activity-model";
import { ActivityList } from "./activity-list";
import {
  ACTIVITY_PAGE_SIZE,
  activityItems,
  activityOffsets,
  activityRange,
} from "./activity-window";

const rows = activityRows({
  hosts: [],
  rules: [],
  activity: Array.from({ length: 1000 }, (_, index) => ({
    timestamp: 10000 + index,
    ruleId: `forward-${index % 3}`,
    runId: `run-${index}`,
    event: "listening",
    retryCount: 0,
    level: "info",
  })),
});
describe("activity list window and progressive rendering", () => {
  it("covers rapid scroll jumps with three screens on either side and preserves total height", () => {
    const offsets = activityOffsets(activityItems(rows, "none", new Set()));
    for (const top of [0, 100, 8400, 42000, 82000]) {
      const range = activityRange(offsets, top, 600);
      expect(range.before).toBeLessThanOrEqual(Math.max(0, top - 1800));
      expect(offsets[range.end]).toBeGreaterThanOrEqual(
        Math.min(offsets.at(-1)!, top + 2400),
      );
      expect(
        range.before + offsets[range.end] - offsets[range.start] + range.after,
      ).toBe(range.total);
      expect(range.end - range.start).toBeLessThan(55);
    }
  });
  it("keeps stable record identities when live logs arrive and respects collapsed groups", () => {
    const before = activityItems(rows, "forward", new Set());
    const after = activityItems(
      [
        { ...rows[0], record: { ...rows[0].record, timestamp: 20000 } },
        ...rows,
      ],
      "forward",
      new Set(),
    );
    for (const item of before.slice(0, 10))
      expect(after.some((next) => next.key === item.key)).toBe(true);
    const closed = activityItems(
      rows,
      "forward",
      new Set([rows[0].record.ruleId]),
    );
    expect(
      closed.some(
        (item) =>
          item.kind === "group" && item.groupId === rows[0].record.ruleId,
      ),
    ).toBe(true);
    expect(
      closed.some(
        (item) =>
          item.kind === "record" &&
          item.row.record.ruleId === rows[0].record.ruleId,
      ),
    ).toBe(false);
    expect(activityRange([0], 0, 600)).toEqual({
      start: 0,
      end: 0,
      before: 0,
      after: 0,
      total: 0,
    });
  });
  it("only mounts nearby records instead of the entire retained log buffer", () => {
    const html = renderToStaticMarkup(
      <ActivityList rows={rows} grouping="none" viewport={null} />,
    );
    const mounted = (html.match(/class="activity-virtual-entry /g) || [])
      .length;
    expect(mounted).toBeGreaterThan(30);
    expect(mounted).toBeLessThan(ACTIVITY_PAGE_SIZE);
    expect(html).toContain("activity-load-more");
    expect(html).not.toContain("run-0</small>");
  });
});
