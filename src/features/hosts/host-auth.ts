import type { Host } from "@/types";

export const hostAuthLabels: Record<Host["authMethod"], string> = {
  auto: "authAuto",
  password: "authPassword",
  privateKey: "authPrivateKey",
  agent: "authAgent",
};
