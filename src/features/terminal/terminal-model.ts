import type { TerminalSession, RemoteService, Host } from "@/types";
export function mergeSessions(
  before: TerminalSession[],
  incoming: TerminalSession[],
  replacements: ReadonlyMap<string, string> = new Map(),
  dismissed: ReadonlySet<string> = new Set(),
) {
  const byId = new Map(before.map((s) => [s.id, s]));
  for (const s of incoming)
    if (
      !dismissed.has(s.id) &&
      (!byId.has(s.id) || byId.get(s.id)!.revision <= s.revision)
    )
      byId.set(s.id, s);
  const replaced = new Map<string, TerminalSession>();
  for (const session of incoming) {
    if (dismissed.has(session.id)) continue;
    const previousId = replacements.get(session.requestId);
    if (
      previousId &&
      before.some((old) => old.id === previousId && old.finishedAt !== null)
    )
      replaced.set(previousId, byId.get(session.id)!);
  }
  const ordered: TerminalSession[] = [];
  const seen = new Set<string>();
  const add = (session: TerminalSession) => {
    if (
      !seen.has(session.id) &&
      !replaced.has(session.id) &&
      !dismissed.has(session.id)
    ) {
      ordered.push(session);
      seen.add(session.id);
    }
  };
  for (const previous of before)
    add(replaced.get(previous.id) || byId.get(previous.id)!);
  for (const session of [...byId.values()].sort(
    (a, b) => a.startedAt - b.startedAt,
  ))
    add(session);
  const excess = ordered.length - 64;
  const evicted = new Set(
    ordered
      .filter((session) => session.finishedAt !== null)
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, Math.max(0, excess))
      .map((session) => session.id),
  );
  return ordered.filter((session) => !evicted.has(session.id));
}
export const terminalActive = (s: TerminalSession) => s.finishedAt === null;
export function serviceForegroundSession(
  sessions: TerminalSession[],
  service: RemoteService,
  ruleId: string | undefined,
  clientId: string,
) {
  if (!ruleId) return undefined;
  const starts = new Set(
    service.actions
      .filter((action) => action.kind === "start" && action.mode === "terminal")
      .map((action) => action.id),
  );
  return sessions.find(
    (session) =>
      session.serviceId === service.id &&
      session.ruleId === ruleId &&
      session.clientId === clientId &&
      starts.has(session.actionId || "") &&
      terminalActive(session),
  );
}
export function terminalStateTone(
  session: Pick<TerminalSession, "phase" | "finishedAt">,
) {
  if (session.phase === "failed") return "danger";
  if (session.phase === "timedOut" || session.phase === "verifying-host")
    return "warning";
  if (session.finishedAt !== null) return "muted";
  return session.phase === "running" ? "success" : "pending";
}
export function terminalNeedsCredentials(
  session: TerminalSession,
  hosts: Host[],
) {
  return (
    session.finishedAt !== null &&
    session.error === "authentication" &&
    !session.submitted &&
    !session.serviceId &&
    session.routeHostIds.some((id) =>
      hosts.some((host) => host.id === id && host.authMethod !== "agent"),
    )
  );
}
export const needsPasteReview = (text: string) =>
  /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);
export const displayPaste = (text: string) =>
  text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) =>
    c === "\x7f" ? "␡" : String.fromCharCode(c.charCodeAt(0) + 0x2400),
  );
// Only terminal-specific editing chords bypass WebView guards. Debug shortcuts retain their guards.
export function terminalEditingShortcut(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
) {
  return (
    terminalShortcutAction(e) === "contextMenu" ||
    (e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      ((e.key.toLowerCase() === "u" && !e.shiftKey) ||
        (e.key.toLowerCase() === "c" && e.shiftKey)))
  );
}

export function terminalShortcutAction(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
) {
  const key = e.key.toLowerCase();
  if (
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    (key === "contextmenu" || (e.shiftKey && key === "f10"))
  )
    return "contextMenu";
  if (e.altKey) return undefined;
  const command = e.metaKey && !e.ctrlKey && !e.shiftKey;
  const controlShift = e.ctrlKey && e.shiftKey && !e.metaKey;
  if ((command || controlShift) && key === "c") return "copy";
  if (controlShift && key === "v") return "paste";
  if ((command || (e.ctrlKey && !e.metaKey && !e.shiftKey)) && key === "f")
    return "find";
  if ((command || controlShift) && key === "k") return "clear";
  return undefined;
}

export function unsubmittedPreset(
  session: TerminalSession | undefined,
  services: RemoteService[],
) {
  if (
    !session ||
    session.error !== "authentication" ||
    session.submitted ||
    !session.serviceId
  )
    return undefined;
  const service = services.find((service) => service.id === session.serviceId);
  const action = service?.actions.find(
    (action) => action.id === session.actionId && action.mode === "terminal",
  );
  return service && action
    ? { service, action, ruleId: session.ruleId ?? undefined }
    : undefined;
}
