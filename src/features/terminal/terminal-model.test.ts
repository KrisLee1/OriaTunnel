import { describe, expect, it } from "vitest";
import {
  displayPaste,
  mergeSessions,
  needsPasteReview,
  terminalEditingShortcut,
  terminalNeedsCredentials,
  terminalShortcutAction,
  terminalStateTone,
  serviceForegroundSession,
} from "./terminal-model";
import type { TerminalSession, RemoteService } from "@/types";
import { emptyHost } from "@/features/tunnels/rule-model";
import i18n from "@/i18n";
describe("terminal input and lifecycle", () => {
  it("selects only this client's active foreground start terminal on the exact service and forward", () => {
    const service = {
      id: "dsh",
      actions: [
        { id: "start", kind: "start", mode: "terminal" },
        { id: "logs", kind: "logs", mode: "terminal" },
      ],
    } as RemoteService;
    const current = {
      id: "target",
      serviceId: "dsh",
      actionId: "start",
      ruleId: "forward",
      clientId: "client",
      finishedAt: null,
    } as TerminalSession;
    const others = [
      { ...current, id: "other-service", serviceId: "other" },
      { ...current, id: "other-rule", ruleId: "other" },
      { ...current, id: "other-client", clientId: "other" },
      { ...current, id: "logs", actionId: "logs" },
      { ...current, id: "shell", serviceId: null, actionId: null },
      { ...current, id: "finished", finishedAt: 10 },
    ];
    expect(
      serviceForegroundSession(
        [...others, current],
        service,
        "forward",
        "client",
      ),
    ).toBe(current);
    expect(
      serviceForegroundSession(others, service, "forward", "client"),
    ).toBeUndefined();
    expect(
      serviceForegroundSession([current], service, undefined, "client"),
    ).toBeUndefined();
    expect(
      serviceForegroundSession(
        [current],
        { ...service, actions: [{ ...service.actions[0], mode: "command" }] },
        "forward",
        "client",
      ),
    ).toBeUndefined();
  });
  it("routes application shortcuts without intercepting remote control keys or native paste", () => {
    const plain = {
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(
      terminalShortcutAction({
        ...plain,
        key: "c",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("copy");
    expect(
      terminalShortcutAction({
        ...plain,
        key: "v",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("paste");
    expect(terminalShortcutAction({ ...plain, key: "f", ctrlKey: true })).toBe(
      "find",
    );
    expect(
      terminalShortcutAction({
        ...plain,
        key: "k",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("clear");
    for (const [key, action] of [
      ["c", "copy"],
      ["f", "find"],
      ["k", "clear"],
    ])
      expect(terminalShortcutAction({ ...plain, key, metaKey: true })).toBe(
        action,
      );
    for (const key of ["c", "d", "z", "u", "l", "k", "v"])
      expect(
        terminalShortcutAction({ ...plain, key, ctrlKey: true }),
      ).toBeUndefined();
    expect(
      terminalShortcutAction({ ...plain, key: "v", metaKey: true }),
    ).toBeUndefined();
    expect(
      terminalShortcutAction({
        ...plain,
        key: "c",
        metaKey: true,
        altKey: true,
      }),
    ).toBeUndefined();
  });
  it("supports the terminal menu keys while keeping debugger keys guarded", () => {
    const plain = {
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    for (const event of [
      { ...plain, key: "ContextMenu" },
      { ...plain, key: "F10", shiftKey: true },
    ]) {
      expect(terminalShortcutAction(event)).toBe("contextMenu");
      expect(terminalEditingShortcut(event)).toBe(true);
    }
    expect(terminalEditingShortcut({ ...plain, key: "F12" })).toBe(false);
    expect(
      terminalEditingShortcut({
        ...plain,
        key: "i",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe(false);
  });
  it("derives dot colors only from Rust session facts and never shows a finished session as connected", () => {
    expect(terminalStateTone({ phase: "running", finishedAt: null })).toBe(
      "success",
    );
    expect(terminalStateTone({ phase: "running", finishedAt: 1 })).toBe(
      "muted",
    );
    expect(terminalStateTone({ phase: "connecting", finishedAt: null })).toBe(
      "pending",
    );
    expect(
      terminalStateTone({ phase: "verifying-host", finishedAt: null }),
    ).toBe("warning");
    expect(terminalStateTone({ phase: "failed", finishedAt: 1 })).toBe(
      "danger",
    );
    expect(terminalStateTone({ phase: "timedOut", finishedAt: 1 })).toBe(
      "warning",
    );
    expect(terminalStateTone({ phase: "disconnected", finishedAt: 1 })).toBe(
      "muted",
    );
  });
  it("reconnects in the original tab position even when events arrive before the IPC response", () => {
    const previous = {
      id: "old",
      revision: 2,
      requestId: "first",
      startedAt: 1,
      finishedAt: 10,
    } as TerminalSession;
    const sibling = {
      ...previous,
      id: "sibling",
      startedAt: 2,
      finishedAt: null,
    };
    const replacement = {
      ...previous,
      id: "new",
      requestId: "reconnect",
      revision: 1,
      startedAt: 20,
      finishedAt: null,
    };
    const replacements = new Map([["reconnect", "old"]]);
    const eventFirst = mergeSessions(
      [previous, sibling],
      [previous, sibling, replacement],
      replacements,
    );
    expect(eventFirst.map((s) => s.id)).toEqual(["new", "sibling"]);
    const running = { ...replacement, revision: 3, phase: "running" };
    const latest = mergeSessions(eventFirst, [running], replacements);
    expect(mergeSessions(latest, [replacement]).map((s) => s.id)).toEqual([
      "new",
      "sibling",
    ]);
    expect(mergeSessions(latest, [replacement])[0].revision).toBe(3);
    const delayed = mergeSessions(
      latest,
      [previous, running, sibling],
      new Map(),
      new Set([previous.id]),
    );
    expect(delayed.map((s) => s.id)).toEqual(["new", "sibling"]);
    const retriedAgain = {
      ...running,
      id: "newer",
      requestId: "retry-again",
      startedAt: 30,
    };
    expect(
      mergeSessions(
        delayed.map((s) =>
          s.id === running.id ? { ...s, finishedAt: 25 } : s,
        ),
        [retriedAgain],
        new Map([["retry-again", running.id]]),
        new Set([previous.id, running.id]),
      ).map((s) => s.id),
    ).toEqual(["newer", "sibling"]);
  });
  it("does not replace an active session or combine independent sessions on the same host", () => {
    const previous = {
      id: "one",
      hostId: "host",
      requestId: "first",
      revision: 1,
      startedAt: 1,
      finishedAt: null,
    } as TerminalSession;
    const next = { ...previous, id: "two", requestId: "next", startedAt: 2 };
    expect(
      mergeSessions([previous], [next], new Map([["next", "one"]])).map(
        (s) => s.id,
      ),
    ).toEqual(["one", "two"]);
    expect(mergeSessions([previous], [next]).map((s) => s.id)).toEqual([
      "one",
      "two",
    ]);
  });
  it("requests credentials only for an unsubmitted Rust authentication failure with an editable authentication route", () => {
    const host = { ...emptyHost(), id: "host" };
    const session = {
      finishedAt: 1,
      error: "authentication",
      submitted: false,
      serviceId: null,
      routeHostIds: [host.id],
    } as TerminalSession;
    expect(terminalNeedsCredentials(session, [host])).toBe(true);
    expect(
      terminalNeedsCredentials(session, [{ ...host, authMethod: "agent" }]),
    ).toBe(false);
    expect(
      terminalNeedsCredentials({ ...session, submitted: true }, [host]),
    ).toBe(false);
    expect(
      terminalNeedsCredentials({ ...session, serviceId: "preset" }, [host]),
    ).toBe(true);
    expect(
      terminalNeedsCredentials({ ...session, finishedAt: null }, [host]),
    ).toBe(false);
    for (const error of [
      "hostKey",
      "connectionFailed",
      "connectionTimeout",
      "hostBlocked",
    ])
      expect(terminalNeedsCredentials({ ...session, error }, [host])).toBe(
        false,
      );
  });
  it("reviews multiple commands and control characters without changing what will be pasted", () => {
    expect(needsPasteReview("printf ok")).toBe(false);
    expect(needsPasteReview("echo one\necho two")).toBe(true);
    expect(needsPasteReview("echo ok\r")).toBe(true);
    expect(needsPasteReview("\x1b[200~")).toBe(true);
    expect(displayPaste("x\x1b\x07")).toBe("x␛␇");
  });
  it("does not allow an older status to revive an interrupted terminal", () => {
    const old = {
      id: "session",
      revision: 2,
      startedAt: 1,
      phase: "running",
      finishedAt: null,
    } as TerminalSession;
    const ended = { ...old, revision: 9, phase: "interrupted", finishedAt: 10 };
    expect(mergeSessions([ended], [old])).toEqual([ended]);
  });
  it("only exempts the terminal editing chords and keeps debug guards for other keys", () => {
    const ctrl = {
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    };
    expect(terminalEditingShortcut({ ...ctrl, key: "u" })).toBe(true);
    expect(terminalEditingShortcut({ ...ctrl, shiftKey: true, key: "c" })).toBe(
      true,
    );
    expect(terminalEditingShortcut({ ...ctrl, shiftKey: true, key: "i" })).toBe(
      false,
    );
    expect(terminalEditingShortcut({ ...ctrl, key: "F12" })).toBe(false);
  });
  it("has matching terminal text keys in all eight languages", () => {
    const flatten = (v: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(v).flatMap(([k, value]) =>
        typeof value === "object" && value !== null
          ? flatten(value as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      );
    const keys = flatten(i18n.getResourceBundle("en", "terminal"));
    for (const lang of ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "ru"])
      expect(flatten(i18n.getResourceBundle(lang, "terminal"))).toEqual(keys);
  });
});

it("only offers a preset credential retry before exec was submitted", async () => {
  const { unsubmittedPreset } = await import("./terminal-model");
  const service = {
    id: "service",
    ruleIds: ["rule"],
    actions: [{ id: "action", mode: "terminal" }],
  } as unknown as import("@/types").RemoteService;
  const session = {
    serviceId: "service",
    ruleId: "rule",
    actionId: "action",
    error: "authentication",
    submitted: false,
  } as TerminalSession;
  expect(unsubmittedPreset(session, [service])?.action.id).toBe("action");
  expect(
    unsubmittedPreset({ ...session, submitted: true }, [service]),
  ).toBeUndefined();
  expect(
    unsubmittedPreset({ ...session, error: "remoteUnknown" }, [service]),
  ).toBeUndefined();
  expect(
    unsubmittedPreset(session, [{ ...service, executionEnabled: false }]),
  ).toBeUndefined();
  expect(
    unsubmittedPreset(session, [{ ...service, ruleIds: [] }]),
  ).toBeUndefined();
  expect(
    unsubmittedPreset(session, [{ ...service, actions: [] }]),
  ).toBeUndefined();
});

it("bounds retained terminal screens without dropping active sessions", () => {
  const sessions = Array.from(
    { length: 70 },
    (_, index) =>
      ({
        id: String(index),
        revision: 1,
        startedAt: index,
        finishedAt: index === 0 ? null : index + 1,
      }) as TerminalSession,
  );
  const merged = mergeSessions([], sessions);
  expect(merged).toHaveLength(64);
  expect(merged[0].id).toBe("0");
  expect(merged[1].id).toBe("7");
});
