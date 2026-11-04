import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog } from "@/components/ui/dialog";
import { TransferConflictContent } from "./transfer-conflict-dialog";
import {
  conflictKey,
  conflictReducer,
  type ConflictState,
} from "./use-transfer-conflict";
import { TransferItem } from "./transfer-item";
import type { Task } from "./api";

const task = (id = "one", overrides: Partial<Task> = {}): Task => ({
  id,
  hostId: "fixture-host",
  hostName: "Loopback",
  sessionId: "fixture-session",
  direction: "download",
  sources: ["/source/报告.txt"],
  target: "\\\\?\\D:\\目标",
  phase: "conflict",
  bytes: 0,
  total: 84,
  count: 1,
  completed: [],
  skipped: 0,
  revision: 2,
  error: "conflict",
  conflict: "\\\\?\\D:\\目标\\报告.txt",
  temp: null,
  started: 1,
  finished: null,
  speed: null,
  eta: null,
  ...overrides,
});
const initial: ConflictState = { current: null, dismissed: [] };
const sync = (state: ConflictState, tasks: Task[]) =>
  conflictReducer(state, { type: "sync", tasks });
const dismiss = (state: ConflictState, t: Task) =>
  conflictReducer(state, { type: "dismiss", key: conflictKey(t) });

describe("transfer conflict prompts", () => {
  it("automatically prompts for a conflict and keeps that task selected when newer conflicts arrive", () => {
    const first = task(),
      second = task("two");
    const state = sync(initial, [first]);
    expect(state.current).toBe(conflictKey(first));
    expect(sync(state, [second, { ...first, revision: 3 }])).toBe(state);
    expect(
      sync(initial, [task("running", { phase: "transferring" })]).current,
    ).toBeNull();
  });
  it("closing leaves the task waiting, prompts for the next conflict, and permits reopening", () => {
    const first = task(),
      second = task("two");
    const state = sync(dismiss(sync(initial, [first, second]), first), [
      first,
      second,
    ]);
    expect(state.current).toBe(conflictKey(second));
    const closed = sync(dismiss(state, second), [
      { ...first, revision: 4 },
      second,
    ]);
    expect(closed.current).toBeNull();
    const reopened = conflictReducer(closed, {
      type: "open",
      key: conflictKey(first),
    });
    expect(sync(reopened, [first, second]).current).toBe(conflictKey(first));
  });
  it("advances when a task leaves conflict and prompts again for a later conflict episode", () => {
    const first = task(),
      second = task("two");
    const state = sync(sync(initial, [first, second]), [
      task("one", { phase: "queued" }),
      second,
    ]);
    expect(state.current).toBe(conflictKey(second));
    const closed = sync(dismiss(initial, first), [
      task("one", { phase: "queued" }),
    ]);
    expect(sync(closed, [first]).current).toBe(conflictKey(first));
  });
  it("does not let a late response dismiss another conflict, including a new path in the same task", () => {
    const first = task(),
      next = task("one", { conflict: "D:\\other.txt" });
    const state = sync(sync(initial, [first]), [next]);
    expect(sync(dismiss(state, first), [next]).current).toBe(conflictKey(next));
  });
  it("renders the real dialog contents with a normalized path and the three conflict policies", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <TransferConflictContent
          task={task()}
          busy={false}
          applyAll={false}
          onApplyAll={() => {}}
          error=""
          onResolve={() => {}}
        />
      </Dialog>,
    );
    expect(html).toContain('data-slot="dialog-title"');
    expect(html).toContain('data-slot="dialog-footer"');
    expect(html).toContain("D:\\目标\\报告.txt");
    expect(html).not.toContain("\\\\?\\");
    for (const icon of ["skip-forward", "copy-plus", "replace", "hard-drive"])
      expect(html).toContain(`lucide-${icon}`);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain("bg-destructive/10 text-destructive");
    expect(html).toContain("所有文件按此操作");
    expect(html).toContain('data-slot="checkbox"');
    expect(html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0]).not.toContain(
      'checked=""',
    );
  });
  it("prompts again when a different source collides at the same destination", () => {
    const first = task("one", { conflictSource: "/first/a.txt" });
    const next = task("one", { conflictSource: "/second/a.txt" });
    expect(sync(dismiss(sync(initial, [first]), first), [next]).current).toBe(
      conflictKey(next),
    );
  });
  it("keeps failures visible inside the dialog and disables replacement when the server cannot safely replace", () => {
    const render = (busy: boolean) =>
      renderToStaticMarkup(
        <Dialog open>
          <TransferConflictContent
            task={task("remote", {
              direction: "upload",
              error: "replaceUnsupported",
              conflict: "/dest/报告.txt",
            })}
            busy={busy}
            applyAll={false}
            onApplyAll={() => {}}
            error="connectionFailed"
            onResolve={() => {}}
          />
        </Dialog>,
      );
    const html = render(false);
    expect(html).toContain("Loopback");
    expect(html).toContain('role="alert"');
    expect(html.match(/ disabled=""/g)).toHaveLength(1);
    expect(render(true).match(/ disabled=""/g)).toHaveLength(4);
  });
  it("offers a reopen action in the transfer row instead of inline policy buttons or blind resume", () => {
    const html = renderToStaticMarkup(
      <TransferItem task={task()} onAction={() => {}} />,
    );
    expect(html).toContain("lucide-triangle-alert");
    expect(html).not.toContain("lucide-play");
    expect(html).not.toContain("files-transfer-resolve");
    expect(html).not.toContain("lucide-replace");
  });
});
