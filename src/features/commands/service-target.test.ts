import { describe, it, expect } from "vitest";
import {
  serviceTarget,
  resolveTrayServiceRequest,
  groupServicesByHost,
} from "./service-target";
import { newService, newAction } from "./command-model";
import { emptyRule } from "@/features/tunnels/rule-model";
const data = {
  rules: [
    { ...emptyRule("host-a"), id: "a" },
    { ...emptyRule("host-b"), id: "b" },
    { ...emptyRule("unrelated"), id: "other" },
  ],
};
describe("forward-provided service execution target", () => {
  it("resolves tray operations only from the current revision and exact saved forward/action", () => {
    const service = {
      ...newService("ignored-host"),
      id: "service",
      revision: "v1",
      ruleIds: ["a", "b"],
      actions: [newAction("start", "启动")],
    };
    const snapshot = { ...data, services: [service] };
    const request = {
      serviceId: service.id,
      revision: service.revision,
      ruleId: "b",
      actionId: service.actions[0].id,
      stopTerminal: false,
      command: "untrusted command",
    };
    expect(resolveTrayServiceRequest(snapshot, request)).toEqual({
      service,
      action: service.actions[0],
      ruleId: "b",
    });
    for (const invalid of [
      { ...request, revision: "old" },
      { ...request, ruleId: "other" },
      { ...request, serviceId: "missing" },
      { ...request, actionId: "removed" },
      { ...request, stopTerminal: true },
    ])
      expect(resolveTrayServiceRequest(snapshot, invalid)).toBeUndefined();
    service.actions[0].mode = "terminal";
    expect(
      resolveTrayServiceRequest(snapshot, { ...request, stopTerminal: true })
        ?.action,
    ).toBe(service.actions[0]);
    service.actions[0].kind = "logs";
    expect(
      resolveTrayServiceRequest(snapshot, { ...request, stopTerminal: true }),
    ).toBeUndefined();
  });
  it("takes the host from the selected forward, ignoring the former independent service host", () => {
    const template = {
      ...newService(""),
      hostIds: ["host-a", "host-b"],
      executionHostId: "legacy-host",
      ruleIds: ["a", "b"],
    };
    expect(serviceTarget(template, data, "a")?.hostId).toBe("host-a");
    expect(serviceTarget(template, data, "b")?.hostId).toBe("host-b");
    expect(serviceTarget(template, data, "other")).toBeUndefined();
    expect(serviceTarget(template, data)).toBeUndefined();
  });
  it("executes directly only on an explicitly associated host without inventing a forward", () => {
    const service = { ...newService("host-a"), id: "service" };
    expect(serviceTarget(service, { rules: [] }, "host:host-a")).toEqual({
      id: "host:host-a",
      hostId: "host-a",
    });
    expect(serviceTarget(service, { rules: [] }, "host:other")).toBeUndefined();
    expect(serviceTarget(service, { rules: [] })).toEqual({
      id: "host:host-a",
      hostId: "host-a",
    });
  });
  it("groups shared services under each host and keeps unassigned services separate", () => {
    const service = {
      ...newService(""),
      id: "shared",
      hostIds: ["host-a", "host-b"],
    };
    const unassigned = { ...newService(""), id: "unassigned" };
    const groups = groupServicesByHost([service, unassigned], {
      ...data,
      hosts: [],
    });
    expect(groups.map((g) => g.hostId)).toEqual(["host-a", "host-b", ""]);
    expect(groups[0].services[0]).toBe(service);
    expect(groups[1].services[0]).toBe(service);
    expect(groups[2].services[0]).toBe(unassigned);
  });
  it("permits a single reference but never invents a host for an unbound template", () => {
    expect(
      serviceTarget(
        { ...newService(""), hostIds: undefined, ruleIds: ["a"] },
        data,
      )?.hostId,
    ).toBe("host-a");
    expect(
      serviceTarget(
        { ...newService(""), executionHostId: "legacy-host" },
        data,
      ),
    ).toBeUndefined();
    expect(
      serviceTarget({ ...newService(""), ruleIds: ["deleted"] }, data),
    ).toBeUndefined();
  });
});
