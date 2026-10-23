import { describe, expect, it } from "vitest";
import { addedHosts, hostFilterStatus } from "./host-collection";
import { groupHosts } from "./host-groups";
import { discoveredHosts } from "./host-discovery";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
import type { Runtime } from "@/types";

describe("added host collection", () => {
  const manual = { ...emptyHost(), id: "manual", name: "same" };
  const discovered = {
    ...emptyHost(),
    id: "candidate",
    source: "config",
    name: "same",
    port: 2222,
    tags: ["prod"],
  };
  const used = {
    ...emptyHost(),
    id: "used",
    source: "config",
    proxyJump: "jump",
  };
  const jump = {
    ...emptyHost(),
    id: "jump",
    source: "config",
    proxyJump: "used",
  };
  const data = {
    hosts: [manual, discovered, used, jump],
    rules: [{ ...emptyRule("used"), id: "rule" }],
  };
  it("keeps discovery candidates out of the main collection while retaining used profiles and their routes", () => {
    expect(addedHosts(data).map((host) => host.id)).toEqual([
      "manual",
      "used",
      "jump",
    ]);
    expect(addedHosts({ ...data, addedHostIds: ["candidate"] })).toContain(
      discovered,
    );
    expect(addedHosts(data, ["candidate"])).toContain(discovered);
    expect(discoveredHosts([manual, discovered], "PROD")).toEqual([discovered]);
    expect(discoveredHosts([manual, discovered], "2222")).toEqual([discovered]);
  });
  it("groups and filters only completed or untested host outcomes, preserving individual errors", () => {
    const runtime = (status: string, errorKind?: string) =>
      ({
        ruleId: "host-test:manual",
        status,
        errorKind,
        configurationChanged: false,
      }) as Runtime;
    expect(hostFilterStatus(manual)).toBe("untested");
    expect(hostFilterStatus(manual, runtime("tested"))).toBe("tested");
    expect(hostFilterStatus(manual, runtime("connecting"))).toBeNull();
    expect(
      hostFilterStatus(manual, runtime("needs-attention", "authentication")),
    ).toBe("status-authentication-error");
    expect(hostFilterStatus(manual, runtime("failed", "network"))).toBe(
      "status-network-error",
    );
    const grouped = Object.fromEntries(
      groupHosts([manual, discovered], "status", [runtime("failed", "dns")]),
    );
    expect(grouped["status-dns-error"]).toEqual([manual]);
    expect(grouped.untested).toEqual([discovered]);
    expect(grouped.testing).toBeUndefined();
  });
});
