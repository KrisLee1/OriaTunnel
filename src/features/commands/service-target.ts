import type { RemoteService, Snapshot } from "@/types";
export const serviceRules = (
  service: RemoteService,
  data: Pick<Snapshot, "rules">,
) => data.rules.filter((r) => service.ruleIds.includes(r.id));
// Never choose the first of several targets implicitly: a service can be reused on different hosts.
export function serviceTarget(
  service: RemoteService,
  data: Pick<Snapshot, "rules">,
  ruleId?: string,
) {
  const rules = serviceRules(service, data);
  return ruleId
    ? rules.find((r) => r.id === ruleId)
    : rules.length === 1
      ? rules[0]
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
