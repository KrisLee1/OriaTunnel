import net from "node:net";
import { once } from "node:events";
import { deflateSync, inflateSync } from "node:zlib";
import assert from "node:assert/strict";

// A real loopback RFB peer with deterministic pixels and Extended Clipboard.
export async function framebuffer() {
  const peers = [];
  const server = net.createServer((socket) => {
    const peer = { socket, inputs: [], received: null, ready: false };
    peers.push(peer);
    serve(peer).catch((error) => {
      if (!socket.destroyed) {
        peer.error = error;
        socket.destroy();
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    peers,
    close() {
      for (const p of peers) p.socket.destroy();
      server.close();
    },
  };
}
async function serve(peer) {
  const { socket } = peer;
  const incoming = socket[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  async function read(length) {
    while (buffer.length < length) {
      const { value, done } = await incoming.next();
      if (done) throw Error("closed");
      buffer = Buffer.concat([buffer, value]);
    }
    const packet = buffer.subarray(0, length);
    buffer = buffer.subarray(length);
    return packet;
  }
  function extended(flags, body = Buffer.alloc(0)) {
    const header = Buffer.alloc(12);
    header[0] = 3;
    header.writeInt32BE(-(body.length + 4), 4);
    header.writeUInt32BE(flags, 8);
    socket.write(Buffer.concat([header, body]));
  }
  const banner = "RFB 003.008\n";
  socket.write(banner);
  assert.equal((await read(12)).toString(), banner);
  socket.write(Buffer.from([1, 1]));
  await read(1);
  socket.write(Buffer.alloc(4));
  await read(1);
  const init = Buffer.alloc(24);
  init.writeUInt16BE(320);
  init.writeUInt16BE(240, 2);
  socket.write(init);
  await read(20);
  const encoding = await read(4);
  await read(encoding.readUInt16BE(2) * 4);
  await read(10);
  const frame = Buffer.alloc(16 + 320 * 240 * 4, 0);
  frame.writeUInt16BE(1, 2);
  frame.writeUInt16BE(320, 8);
  frame.writeUInt16BE(240, 10);
  for (let i = 16; i < frame.length; i += 4) frame[i] = 77;
  socket.write(frame);
  extended(0x1f000001, Buffer.alloc(4));
  peer.offer = (text) => {
    peer.offered = text;
    extended(0x08000001);
  };
  peer.ready = true;
  const held = new Set();
  while (true) {
    const code = (await read(1))[0];
    if (code === 6) {
      const n = (await read(7)).readInt32BE(3);
      const payload = await read(Math.abs(n));
      if (n >= 0) continue;
      const flags = payload.readUInt32BE();
      if (flags === 0x08000001) extended(0x02000001);
      if (flags === 0x02000001 && peer.offered !== undefined) {
        const text = Buffer.from(peer.offered.replace(/\r?\n/g, "\r\n") + "\0");
        const size = Buffer.alloc(4);
        size.writeUInt32BE(text.length);
        extended(0x10000001, deflateSync(Buffer.concat([size, text])));
      }
      if (flags === 0x10000001)
        peer.received = inflateSync(payload.subarray(4))
          .subarray(4, -1)
          .toString()
          .replaceAll("\r\n", "\n");
    } else {
      const size = { 3: 9, 4: 7, 5: 5 }[code];
      assert.ok(size);
      const body = await read(size);
      if (code === 4) {
        const key = body.readUInt32BE(3);
        const down = body[0];
        peer.inputs.push({ key, down });
        if (down) held.add(key);
        else held.delete(key);
        if (down && (held.has(0xffe3) || held.has(0xffe4))) {
          if (key === 99 && peer.copySelection !== undefined)
            peer.offer(peer.copySelection);
          if (key === 118) peer.pasted = true;
        }
      }
      if (code === 3) {
        peer.requests = (peer.requests ?? 0) + 1;
        peer.onRequest?.();
      }
      if (code === 5) {
        const point = {
          buttons: body[0],
          x: body.readUInt16BE(1),
          y: body.readUInt16BE(3),
        };
        peer.inputs.push(point);
        peer.onPointer?.(point);
      }
    }
  }
}
