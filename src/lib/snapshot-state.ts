import type { Snapshot } from "@/types";
import { equalJsonValue } from "./json-equal";

function shareItems<T>(before: T[] | undefined, next: T[], key: keyof T): T[] {
  if (!before) return next;
  const saved = new Map(before.map((item) => [item[key], item]));
  const items = next.map((item) => {
    const previous = saved.get(item[key]);
    return previous && equalJsonValue(previous, item) ? previous : item;
  });
  return items.length === before.length &&
    items.every((item, index) => item === before[index])
    ? before
    : items;
}

// Native snapshots remain authoritative. Reuse equal values so a metrics tick
// does not invalidate every saved host, rule, service and unaffected runtime.
export function mergeSnapshot(before: Snapshot, next: Snapshot): Snapshot {
  if (next.revision < before.revision) return before;
  const same = <T>(previous: T, value: T) =>
    equalJsonValue(previous, value) ? previous : value;
  return {
    ...next,
    hosts: shareItems(before.hosts, next.hosts, "id"),
    rules: shareItems(before.rules, next.rules, "id"),
    services: next.services && shareItems(before.services, next.services, "id"),
    runtimes: shareItems(before.runtimes, next.runtimes, "ruleId"),
    addedHostIds: same(before.addedHostIds, next.addedHostIds),
    diagnostics: same(before.diagnostics, next.diagnostics),
    sourceFiles: same(before.sourceFiles, next.sourceFiles),
    activity: same(before.activity, next.activity),
  };
}
