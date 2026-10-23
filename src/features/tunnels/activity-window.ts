import {
  groupActivity,
  type ActivityGrouping,
  type ActivityRow,
} from "./activity-model";

export const ACTIVITY_PAGE_SIZE = 120;
export const ACTIVITY_OVERSCAN_SCREENS = 3;
export type ActivityItem =
  | {
      kind: "group";
      key: string;
      groupId: string;
      row: ActivityRow;
      count: number;
      height: number;
    }
  | { kind: "record"; key: string; row: ActivityRow; height: number };

export function activityItems(
  rows: ActivityRow[],
  grouping: ActivityGrouping,
  closed: ReadonlySet<string>,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const group of groupActivity(rows, grouping)) {
    if (grouping !== "none") {
      items.push({
        kind: "group",
        key: `group:${grouping}:${group.id}`,
        groupId: group.id,
        row: group.rows[0],
        count: group.rows.length,
        height: 40,
      });
      if (closed.has(group.id)) continue;
    }
    const occurrences = new Map<string, number>();
    group.rows.forEach((row) => {
      const key = `record:${group.id}:${row.record.timestamp}:${row.record.ruleId}:${row.record.runId}:${row.record.event}:${row.record.retryCount}:${row.record.errorKind || ""}`;
      const occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      items.push({
        kind: "record",
        key: `${key}:${occurrence}`,
        row,
        height: 84,
      });
    });
  }
  return items;
}

export function activityOffsets(items: ActivityItem[]) {
  const offsets = [0];
  for (const item of items)
    offsets.push(offsets[offsets.length - 1] + item.height);
  return offsets;
}

export function activityRange(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
) {
  const count = offsets.length - 1;
  const overscan = Math.max(viewportHeight, 1) * ACTIVITY_OVERSCAN_SCREENS;
  const from = Math.max(0, scrollTop - overscan);
  const to = Math.max(0, scrollTop) + Math.max(viewportHeight, 1) + overscan;
  let low = 0,
    high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid + 1] <= from) low = mid + 1;
    else high = mid;
  }
  const start = low;
  high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] < to) low = mid + 1;
    else high = mid;
  }
  return {
    start,
    end: low,
    before: offsets[start],
    after: offsets[count] - offsets[low],
    total: offsets[count],
  };
}
