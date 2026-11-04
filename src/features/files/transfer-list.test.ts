import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "./api";
import {
  groupTransfers,
  matchesTransfer,
  orderTransfers,
  readTransferListPreferences,
  saveTransferListPreferences,
  transferBatchItems,
  transferHosts,
  transferTarget,
  transferTotalSize,
  TRANSFER_LIST_KEY,
} from "./transfer-list";

const endpoint = (hostId: string, hostName = "Same name") => ({
  hostId,
  hostName,
  sessionId: hostId,
  routeKey: hostId,
  route: [hostId],
});
const task = (values: Partial<Task> = {}): Task => ({
  id: "one",
  hostId: "a",
  hostName: "SSH A",
  sessionId: "session",
  direction: "upload",
  sources: ["C:\\a.txt", "C:\\b.txt"],
  sourceKinds: ["file", "file"],
  target: "/dest",
  phase: "queued",
  bytes: 0,
  total: 100,
  count: 2,
  completed: [],
  skipped: 0,
  revision: 1,
  error: null,
  conflict: null,
  temp: null,
  started: 100,
  finished: null,
  speed: null,
  eta: null,
  ...values,
});
afterEach(() => vi.unstubAllGlobals());

describe("transfer list ordering and grouping", () => {
  it("sorts by submission time without mutating snapshots or reordering on byte updates", () => {
    const input = [
      task({ id: "b", started: 200 }),
      task(),
      task({ id: "a", started: 200 }),
    ];
    expect(orderTransfers(input, "newest").map((t) => t.id)).toEqual([
      "b",
      "a",
      "one",
    ]);
    expect(orderTransfers(input, "oldest").map((t) => t.id)).toEqual([
      "one",
      "a",
      "b",
    ]);
    expect(input.map((t) => t.id)).toEqual(["b", "one", "a"]);
    expect(
      orderTransfers(
        input.map((t) => ({ ...t, bytes: 80, revision: 2 })),
        "newest",
      ).map((t) => t.id),
    ).toEqual(["b", "a", "one"]);
  });
  it("uses frozen relay endpoints and maps older upload/download records to the local endpoint", () => {
    expect(transferHosts(task()).source.id).toBe("local");
    expect(transferHosts(task({ direction: "download" })).target.id).toBe(
      "local",
    );
    const relay = transferHosts(
      task({
        direction: "relay",
        sourceRemote: endpoint("from"),
        targetRemote: endpoint("to"),
      }),
    );
    expect(relay.source.id).toBe("host:from");
    expect(relay.target.id).toBe("host:to");
  });
  it("keeps same-name hosts separate, includes this computer, and retains chronological group order", () => {
    const input = orderTransfers(
      [
        task({ id: "old", started: 10, targetRemote: endpoint("a") }),
        task({ id: "local", started: 20, direction: "download" }),
        task({ id: "new", started: 30, targetRemote: endpoint("b") }),
        task({ id: "b-old", started: 5, targetRemote: endpoint("b") }),
      ],
      "newest",
    );
    const groups = groupTransfers(input, "target");
    expect(groups.map((g) => g.id)).toEqual(["host:b", "local", "host:a"]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["new", "b-old"]);
    expect(groups[0].host?.name).toBe(groups[2].host?.name);
    expect(groupTransfers(input, "none")[0].tasks).toBe(input);
    expect(groupTransfers(input, "source").map((g) => g.id)).toEqual([
      "local",
      "host:a",
    ]);
    expect(
      groupTransfers(
        [task(), task({ direction: "download" }), task({ direction: "relay" })],
        "type",
      ).map((g) => g.direction),
    ).toEqual(["upload", "download", "relay"]);
  });
  it("filters by native task status", () => {
    const relay = task({
      direction: "relay",
      sourceRemote: endpoint("from"),
      targetRemote: endpoint("to"),
      phase: "conflict",
    });
    expect(matchesTransfer(relay, "attention")).toBe(true);
    expect(matchesTransfer(relay, "all")).toBe(true);
    expect(matchesTransfer(relay, "active")).toBe(false);
    expect(matchesTransfer(task({ phase: "partial" }), "finished")).toBe(true);
  });
  it("persists only display preferences and tolerates corrupted or blocked storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(readTransferListPreferences()).toEqual({
      grouping: "type",
      order: "newest",
    });
    saveTransferListPreferences({ grouping: "source", order: "oldest" });
    expect(readTransferListPreferences()).toEqual({
      grouping: "source",
      order: "oldest",
    });
    expect([...values.keys()]).toEqual([TRANSFER_LIST_KEY]);
    values.set(TRANSFER_LIST_KEY, '{"grouping":"bad","order":"newest"}');
    expect(readTransferListPreferences()).toEqual({
      grouping: "type",
      order: "newest",
    });
    values.set(TRANSFER_LIST_KEY, "broken");
    expect(readTransferListPreferences().order).toBe("newest");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    });
    expect(readTransferListPreferences().grouping).toBe("type");
    expect(() =>
      saveTransferListPreferences({ grouping: "type", order: "newest" }),
    ).not.toThrow();
  });
});

describe("batch statuses from native evidence", () => {
  it("uses the batch destination directory and sums recorded sizes including skipped sources", () => {
    const batch = task({
      target: "D:\\Downloads",
      destination: "D:\\Downloads\\last.txt",
      sourceDetails: {
        "C:\\a.txt": { destination: "D:\\Downloads\\a (2).txt", size: 3 },
        "C:\\b.txt": { destination: "D:\\Downloads\\b.txt", size: 5 },
      },
      skippedSources: ["C:\\b.txt"],
      bytes: 3,
      total: 3,
    });
    expect(transferTarget(batch)).toBe("D:\\Downloads");
    expect(transferTotalSize(batch)).toBe(8);
    expect(
      transferBatchItems(batch).map((row) => [row.destination, row.size]),
    ).toEqual([
      ["D:\\Downloads\\a (2).txt", 3],
      ["D:\\Downloads\\b.txt", 5],
    ]);
    expect(
      transferTotalSize({ ...batch, sourceDetails: undefined }),
    ).toBeNull();
    expect(
      transferBatchItems({ ...batch, sourceDetails: undefined })[0].destination,
    ).toBeNull();
    expect(
      transferTotalSize({
        ...batch,
        sourceDetails: {
          ...batch.sourceDetails,
          "C:\\a.txt": { destination: "a", size: null },
        },
      }),
    ).toBeNull();
  });
  it("separates completed, skipped, current, conflict and untouched roots", () => {
    const batch = task({
      sources: ["/a", "/b", "/c", "/d"],
      completed: ["/a"],
      skippedSources: ["/b"],
      currentSource: "/c",
      phase: "transferring",
    });
    expect(transferBatchItems(batch).map((i) => i.phase)).toEqual([
      "completed",
      "skipped",
      "transferring",
      "queued",
    ]);
    expect(
      transferBatchItems({
        ...batch,
        phase: "conflict",
        conflictSource: "/d",
      }).map((i) => i.phase),
    ).toEqual(["completed", "skipped", "queued", "conflict"]);
  });
  it("tracks folder descendants without matching adjacent names and does not invent successful files", () => {
    const batch = task({
      sources: ["/dir", "/directory", "/later"],
      sourceKinds: ["directory", "directory", "file"],
      completed: ["/dir/a"],
      currentSource: "/directory/b",
      phase: "failed",
    });
    expect(
      transferBatchItems(batch).map((i) => [i.phase, i.completedCount]),
    ).toEqual([
      ["unconfirmed", 1],
      ["failed", 0],
      ["unconfirmed", 0],
    ]);
    expect(
      transferBatchItems({
        ...batch,
        currentSource: null,
        phase: "partial",
        skippedSources: ["/dir/b"],
      }).map((i) => i.phase),
    ).toEqual(["partial", "unconfirmed", "unconfirmed"]);
    expect(
      transferBatchItems({ ...batch, phase: "completed" }).every(
        (i) => i.phase === "completed",
      ),
    ).toBe(true);
    expect(
      transferBatchItems({
        ...batch,
        currentSource: "/dir/a",
        phase: "partial",
      })[0].phase,
    ).toBe("unconfirmed");
  });
  it("reads older journal entries without optional status fields", () => {
    expect(
      transferBatchItems(
        task({
          sourceKinds: undefined,
          phase: "interrupted",
          commitSource: "C:\\a.txt",
        }),
      ).map((i) => [i.kind, i.phase]),
    ).toEqual([
      ["file", "interrupted"],
      ["file", "unconfirmed"],
    ]);
  });
});
