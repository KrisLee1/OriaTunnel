import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readVncPacket } from "./read-packet";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function sharedHost() {
  const host = Object.assign(new EventTarget(), { releaseBuffer: vi.fn() });
  vi.stubGlobal("window", { chrome: { webview: host } });
  return {
    host,
    post(id: string, buffer: ArrayBuffer) {
      host.dispatchEvent(
        Object.assign(new Event("sharedbufferreceived"), {
          additionalData: { vncSession: id },
          getBuffer: () => buffer,
        }),
      );
    },
  };
}

it.each(["event first", "ack first"])(
  "receives a shared packet with %s",
  async (order) => {
    const { host, post } = sharedHost();
    vi.mocked(invoke).mockResolvedValueOnce(new ArrayBuffer(0));
    const raw = Uint8Array.of(9, 10).buffer;
    const apply = vi.fn((packet: ArrayBuffer) => {
      expect(packet).toBe(raw);
      expect(host.releaseBuffer).not.toHaveBeenCalled();
    });
    const read = readVncPacket("viewer", new AbortController().signal, apply);
    if (order === "ack first") await Promise.resolve();
    post("old session", Uint8Array.of(0).buffer);
    post("viewer", raw);
    expect(await read).toBeNull();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(host.releaseBuffer).toHaveBeenCalledExactlyOnceWith(raw);
  },
);

it("cancels an acknowledged pull when the viewer disconnects", async () => {
  sharedHost();
  vi.mocked(invoke).mockResolvedValueOnce(new ArrayBuffer(0));
  const controller = new AbortController();
  const read = readVncPacket("viewer", controller.signal, vi.fn());
  await Promise.resolve();
  controller.abort();
  await expect(read).rejects.toMatchObject({ name: "AbortError" });
});

it("uses the ordinary response when the host or native mapping is unavailable", async () => {
  const raw = Uint8Array.of(2).buffer;
  vi.mocked(invoke).mockResolvedValue(raw);
  const signal = new AbortController().signal;
  vi.stubGlobal("window", {});
  expect(await readVncPacket("viewer", signal, vi.fn())).toBe(raw);
  expect(invoke).toHaveBeenLastCalledWith("vnc_next", { id: "viewer" });
  const { host } = sharedHost();
  expect(await readVncPacket("viewer", signal, vi.fn())).toBe(raw);
  expect(host.releaseBuffer).not.toHaveBeenCalled();
});
