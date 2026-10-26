import { MarkerType, type Edge } from "@xyflow/react";
import type { Rule, Runtime } from "@/types";
import { canvasPortId } from "./canvas-state";
import { connectionVisual } from "./connection-visual";

// Cards display these native facts; detailed histories/rates stay in Snapshot
// for the inspector and list. An uptime tick must not rebuild service menus.
export type CardRuntime = Pick<
  Runtime,
  | "ruleId"
  | "status"
  | "errorKind"
  | "message"
  | "sent"
  | "received"
  | "configurationChanged"
>;

export function projectCardRuntimes(
  runtimes: Runtime[],
  before: CardRuntime[] = [],
): CardRuntime[] {
  const saved = new Map(before.map((runtime) => [runtime.ruleId, runtime]));
  const next = runtimes.map((runtime) => {
    const value: CardRuntime = {
      ruleId: runtime.ruleId,
      status: runtime.status,
      errorKind: runtime.errorKind,
      message: runtime.message,
      sent: runtime.sent,
      received: runtime.received,
      configurationChanged: runtime.configurationChanged,
    };
    const previous = saved.get(runtime.ruleId);
    return previous &&
      (Object.keys(value) as (keyof CardRuntime)[]).every(
        (key) => previous[key] === value[key],
      )
      ? previous
      : value;
  });
  return next.length === before.length &&
    next.every((value, index) => value === before[index])
    ? before
    : next;
}

export function projectCanvasEdges(
  rules: Rule[],
  runtimes: ReadonlyMap<string, CardRuntime>,
  before: Edge[] = [],
): Edge[] {
  const saved = new Map(before.map((edge) => [edge.id, edge]));
  const next = rules.map((rule): Edge => {
    const visual = connectionVisual(rule, runtimes.get(rule.id));
    const host = `host:${rule.hostId}`;
    const source = rule.kind === "R" ? host : "local";
    const target = rule.kind === "R" ? "local" : host;
    const previous = saved.get(rule.id);
    if (
      previous?.source === source &&
      previous.target === target &&
      previous.data?.state === visual.state &&
      previous.style?.stroke === visual.color
    )
      return previous;
    return {
      id: rule.id,
      source,
      target,
      sourceHandle: canvasPortId(rule.id, "source"),
      targetHandle: canvasPortId(rule.id, "target"),
      type: "connection",
      data: { state: visual.state },
      markerEnd: { type: MarkerType.ArrowClosed, color: visual.color },
      className: `connection-edge connection-${visual.state}`,
      style: { strokeWidth: 1.5, stroke: visual.color },
    };
  });
  return next.length === before.length &&
    next.every((edge, index) => edge === before[index])
    ? before
    : next;
}
