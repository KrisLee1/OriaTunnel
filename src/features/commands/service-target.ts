import type { RemoteService, Snapshot } from "@/types";
// UI selection keys distinguish explicit host execution from a saved forward.
export const hostServiceTarget = (hostId: string) => `host:${hostId}`;
export const serviceHostIds = (
  service: RemoteService,
  data: Pick<Snapshot, "rules">,
) =>
  service.hostIds ?? [
    ...new Set(serviceRules(service, data).map((r) => r.hostId)),
  ];
export const serviceRules = (
  service: RemoteService,
  data: Pick<Snapshot, "rules">,
) => data.rules.filter((r) => service.ruleIds.includes(r.id));
export function groupServicesByHost(
  services: RemoteService[],
  data: Pick<Snapshot, "hosts" | "rules">,
) {
  const groups = new Map<
    string,
    {
      id: string;
      hostId: string;
      host?: Snapshot["hosts"][number];
      services: RemoteService[];
    }
  >();
  for (const service of services) {
    const ids = serviceHostIds(service, data);
    for (const hostId of ids.length ? ids : [""]) {
      if (!groups.has(hostId))
        groups.set(hostId, {
          id: `services:${hostId || "unassigned"}`,
          hostId,
          host: data.hosts.find((h) => h.id === hostId),
          services: [],
        });
      groups.get(hostId)!.services.push(service);
    }
  }
  const order = (hostId: string) => {
    const index = data.hosts.findIndex((h) => h.id === hostId);
    return index < 0 ? data.hosts.length : index;
  };
  return [...groups.values()].sort((a, b) =>
    a.hostId === ""
      ? 1
      : b.hostId === ""
        ? -1
        : order(a.hostId) - order(b.hostId),
  );
}
// Never choose the first of several targets implicitly: a service can be reused on different hosts.
export function serviceTarget(
  service: RemoteService,
  data: Pick<Snapshot, "rules">,
  ruleId?: string,
) {
  if (ruleId?.startsWith("host:")) {
    const hostId = ruleId.slice(5);
    return serviceHostIds(service, data).includes(hostId)
      ? { id: ruleId, hostId }
      : undefined;
  }
  const rules = serviceRules(service, data);
  if (!ruleId && service.hostIds !== undefined) {
    return service.hostIds.length === 1
      ? {
          id: hostServiceTarget(service.hostIds[0]),
          hostId: service.hostIds[0],
        }
      : undefined;
  }
  return ruleId
    ? rules.find((r) => r.id === ruleId)
    : rules.length === 1
      ? rules[0]
      : serviceHostIds(service, data).length === 1
        ? {
            id: hostServiceTarget(serviceHostIds(service, data)[0]),
            hostId: serviceHostIds(service, data)[0],
          }
        : undefined;
}

export interface TrayServiceRequest {
  serviceId: string;
  revision: string;
  ruleId: string;
  actionId: string;
  stopTerminal: boolean;
}
export function resolveTrayServiceRequest(
  data: Pick<Snapshot, "services" | "rules">,
  request: TrayServiceRequest,
) {
  const service = data.services?.find(
    (service) =>
      service.id === request.serviceId && service.revision === request.revision,
  );
  if (!service || !serviceTarget(service, data, request.ruleId))
    return undefined;
  const action = service.actions.find(
    (action) => action.id === request.actionId,
  );
  if (
    !action ||
    (request.stopTerminal &&
      (action.kind !== "start" || action.mode !== "terminal"))
  )
    return undefined;
  return { service, action, ruleId: request.ruleId };
}
