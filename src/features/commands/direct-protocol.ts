import type { DirectProtocol, RemoteService, Rule } from "@/types";
import { serviceCategory } from "./service-template-catalog";

export const directProtocols: Record<DirectProtocol, string> = {
  http: "HTTP", https: "HTTPS", vnc: "VNC", postgresql: "PostgreSQL",
  mysql: "MySQL / MariaDB", mongodb: "MongoDB", redis: "Redis", rediss: "Redis (TLS)",
};

export function directProtocol(service: RemoteService, rules: Rule[], hostId?: string): DirectProtocol | null {
  if (service.directProtocol) return service.directProtocol;
  const linked = new Set(rules.filter((r) =>
    r.hostId === hostId && service.ruleIds.includes(r.id) && r.kind !== "D",
  ).map((r) => r.serviceProtocol).filter((p) => p != null));
  if (linked.size === 1) return [...linked][0];
  const category = serviceCategory(service);
  const identity = service.name + " " + (service.icon?.kind === "builtin" ? service.icon.value : "");
  if (category === "desktop" || /\bvnc\b|tigervnc/i.test(identity)) return "vnc";
  if (/\bpostgres(?:ql)?\b/i.test(identity)) return "postgresql";
  if (/\b(?:mysql|mariadb)\b/i.test(identity)) return "mysql";
  if (/\bmongo(?:db)?\b/i.test(identity)) return "mongodb";
  if (/\b(?:redis|valkey)\b/i.test(identity)) return "redis";
  if (category === "databases" || category === "caches") {
    if (service.port === 5432) return "postgresql";
    if (service.port === 3306) return "mysql";
    if (service.port === 27017) return "mongodb";
    if (service.port === 6379) return "redis";
    if (!/\belasticsearch\b/i.test(identity)) return null;
  }
  if (service.port === 443 || service.port === 8443) return "https";
  if (["web", "development", "inference", "observability", "storage", "other"].includes(category)
      || /\belasticsearch\b/i.test(identity)) return "http";
  return null;
}
