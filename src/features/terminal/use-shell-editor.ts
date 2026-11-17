import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import {
  commandOutput,
  editorReply,
  environmentNames,
  editorRequest,
  retainBlocks,
  type CommandBlock,
  type ArchivedBlock,
  type Prompt,
} from "./shell-editor";

import { captureOutput } from "./terminal-output";

function useBlockFoldState(
  blocks: CommandBlock[],
  running: CommandBlock | null,
) {
  const [folded, setFolded] = useState<ReadonlyMap<number, boolean>>(new Map());
  const toggle = useCallback(
    (key: number) => setFolded((old) => new Map(old).set(key, !old.get(key))),
    [],
  );
  const foldIfUnset = useCallback(
    (key: number) =>
      setFolded((old) => (old.has(key) ? old : new Map(old).set(key, true))),
    [],
  );
  useEffect(() => {
    const valid = new Set([...blocks.map((b) => b.id), running?.id]);
    setFolded((old) =>
      [...old.keys()].some((k) => !valid.has(k))
        ? new Map([...old].filter(([key]) => valid.has(key)))
        : old,
    );
  }, [blocks, running]);
  return [folded, toggle, foldIfUnset] as const;
}

export function useShellEditor(
  id: string,
  active: boolean,
  error: (key: string) => void,
) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [editing, setEditing] = useState(false);
  const [blocks, setBlocks] = useState<ArchivedBlock[]>([]);
  const [running, setRunning] = useState<CommandBlock | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [foldedCommands, toggleCommand] = useBlockFoldState(blocks, running);
  const [limitedOutputs, toggleOutput, autoLimitOutput] = useBlockFoldState(
    blocks,
    running,
  );
  const editorInput = useRef<HTMLTextAreaElement>(null);
  const send = useRef<((text: string) => boolean) | null>(null);
  const sequence = useRef(0);
  const completedScreen = useRef<ReturnType<typeof captureOutput> | null>(null);
  const state = useRef<{
    prompt: Prompt | null;
    editing: boolean;
    block: CommandBlock | null;
  }>({ prompt: null, editing: false, block: null });
  const pending = useRef(
    new Map<
      number,
      {
        expected: string;
        resolve: (value: string[]) => void;
        reject: () => void;
      }
    >(),
  );
  const enqueue = useCallback((op: string, value: string) => {
    if (
      !state.current.editing ||
      !send.current ||
      new TextEncoder().encode(value).length > 180 * 1024
    )
      return;
    const revision = ++sequence.current;
    if (!send.current(editorRequest(op, revision, value))) return;
    const expected: Record<string, string> = {
      run: "release",
      raw: "release",
      cd: "cwd",
      list: "list",
      edit: "edited",
    };
    return new Promise<string[]>((resolve, reject) => {
      pending.current.set(revision, {
        expected: expected[op] || "matches",
        resolve,
        reject,
      });
    });
  }, []);
  const query = useCallback(
    (op: string, value: string) =>
      enqueue(op, value) || Promise.reject(new Error("notRunning")),
    [enqueue],
  );
  const cancelPending = () => {
    for (const waiter of pending.current.values()) waiter.reject();
    pending.current.clear();
  };
  useEffect(() => {
    if (!active) {
      state.current.editing = false;
      setEditing(false);
      cancelPending();
    }
    return cancelPending;
  }, [active, id]);
  const focus = () =>
    requestAnimationFrame(() =>
      editorInput.current?.focus({ preventScroll: true }),
    );
  const receive = (data: string, term: Terminal) => {
    const reply = editorReply(data, id);
    if (!reply) return true;
    const { kind, fields, revision } = reply;
    if (kind === "outputEnd" && state.current.block?.id === revision) {
      completedScreen.current = captureOutput(term);
      return true;
    }
    if (kind === "ready" && fields.length >= 3 && fields[0].startsWith("/")) {
      cancelPending();
      const old = state.current.block;
      const { output, runs } = completedScreen.current ?? captureOutput(term);
      completedScreen.current = null;
      if (old || output.trim()) {
        const done = old || {
          ...(state.current.prompt || { cwd: fields[0], home: fields[1] }),
          id: ++sequence.current,
          command: "",
          output: "",
        };
        const body = commandOutput(done.command, output);
        const skip = output.length - body.length;
        const block = {
          ...done,
          output: body,
          runs: skip
            ? runs
                .filter((run) => run.end > skip)
                .map((run) => ({
                  ...run,
                  start: Math.max(0, run.start - skip),
                  end: run.end - skip,
                }))
            : runs,
        };
        setBlocks((list) => retainBlocks(list, block));
        if (old?.command && fields[2] === "1")
          setHistory((list) =>
            [old.command, ...list.filter((item) => item !== old.command)].slice(
              0,
              500,
            ),
          );
      }
      const next = {
        cwd: fields[0],
        home: fields[1],
        environments: environmentNames(fields.slice(3)),
      };
      state.current = { prompt: next, editing: true, block: null };
      setPrompt(next);
      setRunning(null);
      setEditing(true);
    } else if (kind === "history" && revision === 0 && state.current.editing) {
      setHistory((list) =>
        [...new Set([...list, ...fields.filter(Boolean)])].slice(0, 500),
      );
    } else {
      const waiter = pending.current.get(revision);
      if (waiter && (kind === waiter.expected || kind === "error")) {
        pending.current.delete(revision);
        if (kind === "error") waiter.reject();
        else waiter.resolve(fields);
      }
    }
    return true;
  };
  const release = (value: string, raw: boolean, term: Terminal) => {
    if (!state.current.editing || !state.current.prompt) return;
    if (new TextEncoder().encode(value).length > 180 * 1024) {
      error("error.inputLimit");
      return;
    }
    const response = enqueue(raw ? "raw" : "run", value);
    if (!response) return;
    state.current.editing = false;
    const block = {
      ...state.current.prompt,
      id: sequence.current,
      command: raw ? "" : value,
      output: "",
    };
    state.current.block = block;
    setRunning(block);
    setEditing(false);
    void response.then(
      () => {
        if (raw) send.current?.(value);
        else {
          if (value) term.paste(value);
          send.current?.("\r");
        }
        if (term.element?.offsetParent) term.focus();
      },
      () => {},
    );
  };
  const changed = useCallback((cwd: string) => {
    if (state.current.prompt && cwd?.startsWith("/")) {
      const next = { ...state.current.prompt, cwd };
      state.current.prompt = next;
      setPrompt(next);
    }
  }, []);
  return {
    prompt,
    editing,
    blocks,
    running,
    history,
    foldedCommands,
    limitedOutputs,
    editorInput,
    send,
    query,
    receive,
    release,
    changed,
    toggleCommand,
    toggleOutput,
    autoLimitOutput,
    focus,
    atPrompt: () => state.current.editing,
    foreground: () => !!state.current.block?.command.trim(),
    clear: () => setBlocks([]),
  };
}
