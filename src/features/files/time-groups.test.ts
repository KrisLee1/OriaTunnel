import { describe, expect, it } from "vitest";
import { groupByTime, TIME_HEADING_HEIGHT } from "./time-groups";
import { fileSectionLayout } from "./file-section-layout";
import { sorted, type Entry, type Task } from "./api";
import { groupTransfers, orderTransfers } from "./transfer-list";

const day = (year: number, month: number, date: number) =>
  +new Date(year, month - 1, date);
describe("local calendar groups", () => {
  it("keeps one group per bucket for name-sorted files and puts missing timestamps last in both directions", () => {
    const today = day(2026, 11, 18);
    const entries = [
      undefined,
      day(2026, 11, 5),
      today + 300,
      day(2026, 10, 31),
      today,
      day(2026, 11, 17),
      day(2026, 11, 12),
      day(2025, 10, 5),
    ];
    const groups = groupByTime(entries, (stamp) => stamp, today, true);
    expect(groups.map((g) => g.time.key)).toEqual([
      "today",
      "yesterday",
      "pastWeek",
      "thisMonth",
      day(2026, 10, 1),
      day(2025, 10, 1),
      "unknownTime",
    ]);
    expect(groups[0].items).toEqual([today + 300, today]);
    expect(
      groupByTime(entries, (stamp) => stamp, today, false).at(-1)?.time.key,
    ).toBe("unknownTime");
  });
  it("includes the preceding month's final days in the past week across a year boundary", () => {
    const today = day(2026, 1, 2);
    expect(
      groupByTime(
        [day(2025, 12, 26), day(2025, 12, 27), day(2026, 1, 1)],
        (n) => n,
        today,
        true,
      ).map((g) => g.time.key),
    ).toEqual(["yesterday", "pastWeek", day(2025, 12, 1)]);
  });
  it("sorts actual creation timestamps independently of modification, with unknown dates last", () => {
    const entries = [
      { id: "new", name: "a", created: 8, modified: 1 },
      { id: "old", name: "z", created: 2, modified: 9 },
      { id: "missing", name: "b", modified: 7 },
    ] as Entry[];
    for (const descending of [false, true]) {
      expect(
        sorted(entries, "", true, "created", descending).map((e) => e.id),
      ).toEqual(
        descending ? ["new", "old", "missing"] : ["old", "new", "missing"],
      );
    }
  });
  it("starts each icon group on a new row even when the previous row is only partially filled", () => {
    const items = [{} as Entry, {} as Entry];
    const layout = fileSectionLayout(
      [
        { time: { key: "today", start: 1 }, items },
        { time: { key: "yesterday", start: 0 }, items },
      ],
      3,
      100,
    );
    expect(layout.sections.map((s) => s.contentTop)).toEqual([
      TIME_HEADING_HEIGHT,
      100 + 2 * TIME_HEADING_HEIGHT,
    ]);
    expect(layout.height).toBe(200 + 2 * TIME_HEADING_HEIGHT);
  });
  it("preserves chronological pagination, counts the complete group and uses submission time across retries", () => {
    const today = day(2026, 11, 18);
    const tasks = [0, 1, 2, 3].map(
      (id) =>
        ({
          id: String(id),
          started: id === 3 ? today - 1 : today + id,
          finished: today + 10,
        }) as Task,
    );
    for (const order of ["oldest", "newest"] as const) {
      const groups = groupTransfers(
        orderTransfers(tasks, order),
        "time",
        today,
        order,
        2,
      );
      expect(groups.flatMap((g) => g.tasks).map((t) => t.id)).toEqual(
        order === "newest" ? ["2", "1"] : ["3", "0"],
      );
      expect(groups.find((g) => g.time?.key === "today")?.count).toBe(3);
    }
  });
});
