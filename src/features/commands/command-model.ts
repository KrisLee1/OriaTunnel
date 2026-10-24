import type {
  CommandEvent,
  CommandRun,
  PresetAction,
  RemoteService,
} from "@/types";
export const commandKinds = [
  "start",
  "stop",
  "restart",
  "status",
  "logs",
  "custom",
] as const;
export const commandActive = (run: CommandRun) => run.finishedAt === null;
export function mergeRuns(current: CommandRun[], incoming: CommandRun[]) {
  const byId = new Map(current.map((run) => [run.id, run]));
  for (const run of incoming)
    if (!byId.has(run.id) || byId.get(run.id)!.revision <= run.revision)
      byId.set(run.id, run);
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
}
export function newAction(
  kind: PresetAction["kind"],
  label: string,
): PresetAction {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    command: "",
    timeoutSecs: kind === "status" ? 15 : 60,
    successCodes: [0],
    confirm: ["stop", "restart", "custom"].includes(kind),
  };
}
export function changeActionKind(
  action: PresetAction,
  kind: PresetAction["kind"],
  labels: Record<PresetAction["kind"], string>,
): PresetAction {
  return {
    ...action,
    kind,
    label:
      !action.label || Object.values(labels).includes(action.label)
        ? labels[kind]
        : action.label,
    confirm: ["stop", "restart", "custom"].includes(kind),
  };
}
export function newService(_hostId: string, ruleId?: string): RemoteService {
  return {
    id: "",
    name: "",
    executionHostId: "",
    category: "other",
    ruleIds: ruleId ? [ruleId] : [],
    revision: "",
    noLocalEnvironment: true,
    actions: [],
  };
}
export function copyService(source: RemoteService): RemoteService {
  const copy = structuredClone(source);
  const ids = new Map(
    copy.actions.map((action) => [action.id, crypto.randomUUID()]),
  );
  copy.id = "";
  copy.revision = "";
  copy.executionHostId = "";
  copy.ruleIds = [];
  copy.actions = copy.actions.map((action) => ({
    ...action,
    id: ids.get(action.id)!,
  }));
  if (copy.control) {
    if (copy.control.statusProbe)
      copy.control.statusProbe.actionId = ids.get(
        copy.control.statusProbe.actionId,
      )!;
    if (copy.control.startActionId)
      copy.control.startActionId = ids.get(copy.control.startActionId)!;
  }
  return copy;
}
// Separate decoders preserve partial UTF-8 bytes without mixing stderr into stdout.
export class OutputDecoder {
  private decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  private sequence = 0;
  private text = "";
  accept(event: CommandEvent) {
    if (event.reset) {
      this.decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
      this.sequence = 0;
      this.text = "";
    }
    for (const chunk of event.output) {
      if (chunk.sequence <= this.sequence) continue;
      const text = this.decoders[chunk.stream].decode(
        new Uint8Array(chunk.bytes),
        { stream: true },
      );
      // E1 is a text viewer, not an ANSI terminal. Never interpret escape sequences.
      this.text += text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) =>
        c === "\x7f" ? "␡" : String.fromCharCode(0x2400 + c.charCodeAt(0)),
      );
      this.sequence = chunk.sequence;
    }
    this.text = this.text.slice(-2 * 1024 * 1024);
    return this.text;
  }
}

// Render invisible control/bidi characters visibly in reviews; never change saved bytes.
export function reviewScript(text: string) {
  return text.replace(
    /[\x00-\x08\x0b-\x1f\x7f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g,
    (c) => {
      const code = c.charCodeAt(0);
      return code < 32
        ? String.fromCharCode(0x2400 + code)
        : code === 127
          ? "␡"
          : `\\u${code.toString(16).padStart(4, "0")}`;
    },
  );
}
