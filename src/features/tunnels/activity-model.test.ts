import { describe, expect, it } from "vitest";
import { activityRows, filterActivity, groupActivity } from "./activity-model";
import { emptyHost, emptyRule } from "./rule-model";
import type { ActivityRecord } from "@/types";

describe("activity filtering and grouping", () => {
  const record = (
    ruleId: string,
    timestamp: number,
    event = "tested",
    errorKind?: string,
  ): ActivityRecord => ({
    ruleId,
    timestamp,
    runId: "run",
    event,
    errorKind,
    level: errorKind ? "warning" : "info",
    retryCount: 0,
  });
  const rows = activityRows({
    hosts: [
      { ...emptyHost(), id: "a", name: "same" },
      { ...emptyHost(), id: "b", name: "same" },
    ],
    rules: [{ ...emptyRule("a"), id: "forward", name: "web" }],
    activity: [
      record("forward", 1, "failed", "network"),
      record("host-test:b", 2),
      record("removed", 3, "stopped"),
      record("forward", 4, "listening", "network"),
    ],
  });
  it("uses stable IDs for same-name hosts, separates host tests and retains deleted forwards", () => {
    expect(groupActivity(rows, "host")).toHaveLength(3);
    expect(rows[0].record.timestamp).toBe(4);
    expect(
      activityRows({
        hosts: [],
        rules: [],
        activity: [record("tie", 1, "connecting"), record("tie", 1, "tested")],
      })[0].record.event,
    ).toBe("tested");
    expect(
      rows.find((row) => row.record.ruleId === "removed")?.hostId,
    ).toBeUndefined();
    expect(rows.find((row) => row.hostTest)?.hostId).toBe("b");
    expect(rows[0].status.label).toBe("listening");
    expect(
      groupActivity(rows, "status").find(
        (group) => group.id === "status-network-error",
      )?.rows,
    ).toHaveLength(1);
  });
  it("combines host, forward, state, warning and text filters without treating tests as forwards", () => {
    const filter = {
      host: "host:a",
      forward: "rule:forward",
      status: "status-network-error",
      warnings: true,
      query: "web",
    };
    expect(filterActivity(rows, filter, (key) => key)).toHaveLength(1);
    expect(
      filterActivity(rows, { ...filter, forward: "host-tests" }, (key) => key),
    ).toHaveLength(0);
    expect(
      filterActivity(
        rows,
        {
          host: "host:b",
          forward: "host-tests",
          status: "all",
          warnings: false,
          query: "",
        },
        (key) => key,
      ),
    ).toHaveLength(1);
    expect(
      filterActivity(
        rows,
        {
          host: "unknown",
          forward: "all",
          status: "all",
          warnings: false,
          query: "removed",
        },
        (key) => key,
      ),
    ).toHaveLength(1);
  });
});
