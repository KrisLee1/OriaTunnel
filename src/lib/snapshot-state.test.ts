import { describe, expect, it } from "vitest";
import type { Snapshot, Runtime } from "@/types";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
import { newService } from "@/features/commands/command-model";
import { mergeSnapshot } from "./snapshot-state";

const fixture = (): Snapshot => ({
  hosts: ["a", "b"].map((id) => ({ ...emptyHost(), id })),
  rules: ["a", "b"].map((id) => ({ ...emptyRule(id), id })),
  services: ["a", "b"].map((id) => ({ ...newService(id), id })),
  runtimes: ["a", "b"].map(
    (ruleId) =>
      ({ ruleId, status: "listening", sent: 0, uptimeSecs: 0 }) as Runtime,
  ),
  addedHostIds: ["a", "b"],
  diagnostics: [],
  sourceFiles: [],
  activity: [],
  revision: 1,
  closeToTray: true,
  agentSupported: false,
  autoSyncHosts: false,
  undoCount: 0,
  autostart: false,
  autostartSupported: false,
});
describe("native snapshot structural sharing", () => {
  it("retains saved configuration and unrelated runtimes over repeated live metric updates", () => {
    const initial = fixture();
    let current = initial;
    for (let frame = 1; frame <= 60; frame++) {
      const incoming = structuredClone(current);
      incoming.revision++;
      incoming.runtimes[0].sent = frame * 1024;
      incoming.runtimes[0].uptimeSecs = frame;
      current = mergeSnapshot(current, incoming);
      expect(current.hosts).toBe(initial.hosts);
      expect(current.rules).toBe(initial.rules);
      expect(current.services).toBe(initial.services);
      expect(current.addedHostIds).toBe(initial.addedHostIds);
      expect(current.runtimes[1]).toBe(initial.runtimes[1]);
      expect(current.runtimes[0].sent).toBe(incoming.runtimes[0].sent);
    }
  });
  it("accepts configuration and native failure changes while preserving untouched items", () => {
    const initial = fixture(),
      incoming = structuredClone(initial);
    incoming.revision++;
    incoming.rules[0].targetPort = 3689;
    incoming.services![0].port = 3689;
    incoming.runtimes[0].status = "failed";
    const current = mergeSnapshot(initial, incoming);
    expect(current.rules[0].targetPort).toBe(3689);
    expect(current.rules[1]).toBe(initial.rules[1]);
    expect(current.services![0].port).toBe(3689);
    expect(current.runtimes[0].status).toBe("failed");
    expect(mergeSnapshot(current, initial)).toBe(current);
  });
  it("preserves unchanged activity and accepts equal-revision facts, reorderings and removals", () => {
    const initial = fixture();
    const incoming = structuredClone(initial);
    incoming.rules.reverse();
    incoming.runtimes[0].errorKind = "authentication";
    incoming.runtimes.pop();
    const current = mergeSnapshot(initial, incoming);
    expect(current.rules).toEqual([initial.rules[1], initial.rules[0]]);
    expect(current.rules[0]).toBe(initial.rules[1]);
    expect(current.runtimes).toHaveLength(1);
    expect(current.runtimes[0].errorKind).toBe("authentication");
    expect(current.activity).toBe(initial.activity);
    expect(current.revision).toBe(initial.revision);
  });
});
