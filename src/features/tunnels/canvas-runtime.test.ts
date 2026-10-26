import { describe, expect, it } from "vitest";
import { emptyRule } from "./rule-model";
import {
  projectCardRuntimes,
  projectCanvasEdges,
  type CardRuntime,
} from "./canvas-runtime";
import type { Runtime } from "@/types";

const rules = ["a", "b"].map((id) => ({
  ...emptyRule("host"),
  id,
  color: "#67ad98",
}));
const runtimes = (): Runtime[] =>
  rules.map(
    (rule) =>
      ({
        ruleId: rule.id,
        runId: "run",
        status: "listening",
        message: "",
        errorKind: undefined,
        sent: 1024,
        received: 2048,
        configurationChanged: false,
        uptimeSecs: 0,
        history: [],
      }) as unknown as Runtime,
  );
const byRule = (items: CardRuntime[]) =>
  new Map(items.map((item) => [item.ruleId, item]));

describe("canvas updates from native runtime facts", () => {
  it("ignores uptime/history ticks on cards while preserving full snapshots for details", () => {
    const initial = runtimes();
    let cards = projectCardRuntimes(initial);
    const first = cards;
    const edges = projectCanvasEdges(rules, byRule(cards));
    for (let tick = 1; tick <= 120; tick++) {
      const next = structuredClone(initial);
      next.forEach((runtime) => {
        runtime.uptimeSecs = tick;
        runtime.history.push({
          timestamp: tick,
          sentPerSecond: tick,
          receivedPerSecond: 0,
        });
      });
      cards = projectCardRuntimes(next, cards);
      expect(cards).toBe(first);
      expect(projectCanvasEdges(rules, byRule(cards), edges)).toBe(edges);
      expect(next[0].history[0].timestamp).toBe(tick);
    }
  });

  it("updates only the changed card fact and keeps metric-only edges unchanged", () => {
    const incoming = runtimes();
    const initial = projectCardRuntimes(incoming);
    const edges = projectCanvasEdges(rules, byRule(initial));
    incoming[0].sent++;
    const cards = projectCardRuntimes(incoming, initial);
    expect(cards[0].sent).toBe(1025);
    expect(cards[1]).toBe(initial[1]);
    expect(projectCanvasEdges(rules, byRule(cards), edges)).toBe(edges);
    for (const change of [
      { status: "failed", errorKind: "authentication" },
      { message: "native error" },
      { configurationChanged: true },
      { received: 4096 },
    ]) {
      Object.assign(incoming[0], change);
      const next = projectCardRuntimes(incoming, cards);
      expect(next[0]).not.toBe(cards[0]);
      expect(next[0]).toMatchObject(change);
    }
  });

  it("accepts status, color, route, direction, insertion and removal changes", () => {
    const incoming = runtimes();
    const initial = projectCanvasEdges(
      rules,
      byRule(projectCardRuntimes(incoming)),
    );
    incoming[0].status = "failed";
    const failed = projectCanvasEdges(
      rules,
      byRule(projectCardRuntimes(incoming)),
      initial,
    );
    expect(failed[0].data?.state).toBe("stopped");
    expect(failed[1]).toBe(initial[1]);
    const changedRules = [
      rules[0],
      { ...rules[1], kind: "R" as const, hostId: "other", color: "#123456" },
    ];
    const changed = projectCanvasEdges(
      changedRules,
      byRule(projectCardRuntimes(incoming)),
      failed,
    );
    expect(changed[0]).toBe(failed[0]);
    expect(changed[1]).toMatchObject({
      source: "host:other",
      target: "local",
      style: { stroke: "#123456" },
      markerEnd: { color: "#123456" },
    });
    const removed = projectCanvasEdges(
      [changedRules[1]],
      byRule(projectCardRuntimes(incoming)),
      changed,
    );
    expect(removed).toEqual([changed[1]]);
    expect(
      projectCanvasEdges(
        [...changedRules].reverse(),
        byRule(projectCardRuntimes(incoming)),
        changed,
      ),
    ).toEqual([...changed].reverse());
    expect(projectCardRuntimes([], projectCardRuntimes(incoming))).toEqual([]);
  });
});
