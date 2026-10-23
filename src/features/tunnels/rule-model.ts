import type { Host, Rule, ConnectionOptions } from "@/types";

export const defaultConnection = (): ConnectionOptions => ({
  connectTimeoutSecs: 15,
  keepaliveIntervalSecs: 15,
  keepaliveMax: 3,
});
export const emptyHost = (): Host => ({
  id: "",
  name: "",
  address: "",
  port: 22,
  user: "",
  identityFiles: [],
  source: "manual",
  diagnostics: [],
  connection: defaultConnection(),
  authMethod: "auto",
  tags: [],
  hidden: false,
  identityAgent: null,
  identitiesOnly: false,
  proxyJump: null,
  fieldSources: {},
  configuredForwards: [],
});
export function jumpHosts(hosts: Host[], target?: Host) {
  const seen = new Set([target?.id]);
  const route: Host[] = [];
  const append = (current?: Host): void => {
    current?.proxyJump?.split(",").forEach((id, index) => {
      if (seen.has(id.trim()) || seen.size >= 9 || route.length >= 8) return;
      const next = hosts.find((h) => h.id === id.trim());
      if (!next) return;
      seen.add(next.id);
      if (index === 0) append(next);
      if (route.length < 8) route.push(next);
    });
  };
  append(target);
  return route;
}
export const emptyRule = (hostId = ""): Rule => ({
  id: "",
  name: "",
  hostId,
  color: null,
  kind: "L",
  bindAddress: "127.0.0.1",
  bindPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  connection: null,
  noRemoteCommand: true,
  remoteCommand: "",
  background: true,
  reconnect: {
    enabled: true,
    maxAttempts: 8,
    initialDelaySecs: 2,
    maxDelaySecs: 60,
  },
  autoConnect: false,
  repeatCommandOnReconnect: false,
});
export function endpoint(host: string, port: number) {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}
export function rulePath(rule: Rule, host: string, local = "此电脑") {
  const bind = endpoint(rule.bindAddress, rule.bindPort);
  const target = endpoint(rule.targetHost, rule.targetPort);
  if (rule.kind === "R") return `${host} ${bind} → ${local} ${target}`;
  if (rule.kind === "D") return `${local} SOCKS5 ${bind} → ${host} (DNS / TCP)`;
  return `${local} ${bind} → ${host} ${target}`;
}
export function networkChanged(before: Rule, after: Rule) {
  const {
    name: _a,
    color: _colorA,
    background: _backgroundA,
    autoConnect: _autoA,
    ...a
  } = before;
  const {
    name: _b,
    color: _colorB,
    background: _backgroundB,
    autoConnect: _autoB,
    ...b
  } = after;
  return JSON.stringify(a) !== JSON.stringify(b);
}
