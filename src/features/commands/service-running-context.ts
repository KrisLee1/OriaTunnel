import { createContext, useContext } from "react";
import type { RemoteService } from "@/types";
import { hostServiceTarget } from "./service-target";

// Lifecycle evidence is shared by host and forwarding views. A D listener's
// availability controls browser launch separately from the remote service.
export const ServiceRunningContext = createContext<
  (service: RemoteService, targetId?: string) => boolean
>(() => false);
export function useServiceRunning(
  service: RemoteService | undefined,
  hostId: string,
) {
  const running = useContext(ServiceRunningContext);
  return !!service && running(service, hostServiceTarget(hostId));
}
