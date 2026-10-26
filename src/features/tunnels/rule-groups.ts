import type { Host, Rule } from "@/types";

export interface RuleGroup {
  id: string;
  host?: Host;
  rules: Rule[];
}

// Identity is the saved profile, including its user, port and jump route.
export function groupRulesByHost(rules: Rule[], hosts: Host[]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  const byId = new Map(hosts.map((host) => [host.id, host]));
  for (const rule of rules) {
    let group = groups.get(rule.hostId);
    if (!group) {
      group = {
        id: `host:${rule.hostId}`,
        host: byId.get(rule.hostId),
        rules: [],
      };
      groups.set(rule.hostId, group);
    }
    group.rules.push(rule);
  }
  return [...groups.values()];
}

export function canvasHostGroups(rules: Rule[], hosts: Host[]): RuleGroup[] {
  const groups = groupRulesByHost(rules, hosts);
  for (const host of hosts)
    if (!groups.some((group) => group.host?.id === host.id))
      groups.push({ id: `host:${host.id}`, host, rules: [] });
  return groups;
}

type Point = { x: number; y: number };
export function groupPositions(
  groups: RuleGroup[],
  saved: Record<string, Point>,
) {
  const local = saved.local || { x: 0, y: 0 };
  const bottom = { left: local.y, right: local.y };
  return Object.fromEntries(
    groups.map((group) => {
      const side =
        group.rules.length && group.rules.every((rule) => rule.kind === "R")
          ? "left"
          : "right";
      const position = saved[group.id] || {
        x: local.x + (side === "left" ? -480 : 480),
        y: bottom[side],
      };
      bottom[side] = Math.max(
        bottom[side],
        position.y + 150 + group.rules.length * 175 + 70,
      );
      return [group.id, position];
    }),
  );
}
