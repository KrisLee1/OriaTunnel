import { invoke } from "@tauri-apps/api/core";

type SharedEvent = {
  additionalData?: { vncSession?: string };
  getBuffer(): ArrayBuffer;
};
type SharedWebview = {
  addEventListener(
    type: "sharedbufferreceived",
    fn: (event: SharedEvent) => void,
  ): void;
  removeEventListener(
    type: "sharedbufferreceived",
    fn: (event: SharedEvent) => void,
  ): void;
  releaseBuffer(buffer: ArrayBuffer): void;
};

export async function readVncPacket(
  id: string,
  signal: AbortSignal,
  applyShared: (packet: ArrayBuffer) => void,
): Promise<ArrayBuffer | null> {
  signal.throwIfAborted();
  const host = (window as Window & { chrome?: { webview?: SharedWebview } })
    .chrome?.webview;
  if (!host?.releaseBuffer) return invoke("vnc_next", { id });

  // Register before invoking: the event and the small IPC acknowledgment can
  // arrive in either order. Only this session's single outstanding pull matches.
  let ready!: () => void;
  const delivery = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let buffer: ArrayBuffer | undefined;
  const listener = (event: SharedEvent) => {
    if (event.additionalData?.vncSession !== id) return;
    buffer = event.getBuffer();
    ready();
  };
  signal.addEventListener("abort", ready, { once: true });
  host.addEventListener("sharedbufferreceived", listener);
  try {
    const packet = await invoke<ArrayBuffer>("vnc_next", { id, shared: true });
    if (packet.byteLength) return packet;
    await delivery;
    signal.throwIfAborted();
    // Decode synchronously into the viewer's framebuffer while the read-only
    // mapping is live. Do not copy or retain the entire IPC packet.
    applyShared(buffer!);
    return null;
  } finally {
    if (buffer) host.releaseBuffer(buffer);
    signal.removeEventListener("abort", ready);
    host.removeEventListener("sharedbufferreceived", listener);
  }
}
