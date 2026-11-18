import { describe, expect, it, vi } from "vitest";
import type { Task } from "./api";
import { recoverTransfer } from "./recover-transfer";

const endpoint = (hostId: string) => ({
  hostId,
  hostName: hostId,
  route: [hostId],
  routeKey: hostId,
  sessionId: hostId + "-old",
});
const task: Task = {
  ...endpoint("server"),
  id: "download",
  direction: "download",
  phase: "paused",
  sources: ["/folder"],
  target: "D:/downloads",
  bytes: 0,
  total: 0,
  count: 0,
  completed: [],
  skipped: 0,
  revision: 0,
  speed: null,
  eta: null,
  error: null,
  conflict: null,
  temp: null,
  started: 0,
  finished: null,
};
describe("transfer recovery", () => {
  it.each(["session closed", "notConnected", "sender dropped"])(
    "reconnects to the original host after %s",
    async (error) => {
      const sessionFor = vi
        .fn()
        .mockResolvedValueOnce("old")
        .mockResolvedValueOnce("fresh");
      const control = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue(undefined);
      await recoverTransfer(task, "resume", sessionFor, control);
      expect(sessionFor.mock.calls).toEqual([
        ["server", "server-old", "remote", false],
        ["server", "server-old", "remote", true],
      ]);
      expect(control.mock.calls).toEqual([
        ["download", "resume", "old", undefined],
        ["download", "resume", "fresh", undefined],
      ]);
    },
  );
  it("resolves both relay endpoints before cleaning the unfinished file and continuing", async () => {
    const sessionFor = vi.fn(async (host: string) => host + "-new");
    const control = vi.fn().mockResolvedValue(undefined);
    await recoverTransfer(
      {
        ...task,
        direction: "relay",
        targetRemote: endpoint("dst"),
        sourceRemote: endpoint("src"),
        temp: "partial",
      },
      "resume",
      sessionFor,
      control,
    );
    expect(sessionFor.mock.calls).toEqual([
      ["dst", "dst-old", "remote", false],
      ["src", "src-old", "local", false],
    ]);
    expect(control.mock.calls).toEqual([
      ["download", "cleanup", "dst-new", "src-new"],
      ["download", "resume", "dst-new", "src-new"],
    ]);
  });
  it("stops on cancelled authentication and preserves an uncertain commit for verification", async () => {
    const control = vi.fn().mockRejectedValue("routeChanged");
    await recoverTransfer(task, "resume", async () => undefined, control);
    expect(control).not.toHaveBeenCalled();
    const sessionFor = vi.fn().mockResolvedValue("fresh");
    await expect(
      recoverTransfer(
        { ...task, temp: "partial", error: "commitUnknown" },
        "verify",
        sessionFor,
        control,
      ),
    ).rejects.toBe("routeChanged");
    expect(control.mock.calls).toEqual([
      ["download", "verify", "fresh", undefined],
    ]);
    expect(sessionFor).toHaveBeenCalledTimes(1);
  });
});
