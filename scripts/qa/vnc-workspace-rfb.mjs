import { createCipheriv, randomBytes } from "node:crypto";
import net from "node:net";
import { once } from "node:events";
import { deflateSync, inflateSync } from "node:zlib";
import assert from "node:assert/strict";

// A real loopback RFB peer with deterministic pixels and Extended Clipboard.
export async function framebuffer({
  password,
  classic = false,
  apple = false,
  width = 320,
  height = 240,
} = {}) {
  const peers = [];
  const server = net.createServer((socket) => {
    const peer = { socket, inputs: [], received: null, ready: false };
    peers.push(peer);
    serve(peer, password, classic, width, height, apple).catch((error) => {
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
    width,
    height,
    peers,
    close() {
      for (const p of peers) p.socket.destroy();
      server.close();
    },
  };
}
async function serve(peer, password, classic, width, height, apple) {
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
  socket.write(apple ? "RFB 003.889\n" : banner);
  assert.equal((await read(12)).toString(), banner);
  const security = password ? 2 : 1;
  socket.write(Buffer.from(apple ? [4, 30, 33, 36, security] : [1, security]));
  assert.equal((await read(1))[0], security);
  if (password) {
    const challenge = randomBytes(16);
    socket.write(challenge);
    const key = Buffer.alloc(8);
    for (let i = 0; i < Math.min(8, password.length); i++) {
      const bits = password.charCodeAt(i).toString(2).padStart(8, "0");
      key[i] = parseInt([...bits].reverse().join(""), 2);
    }
    const cipher = createCipheriv(
      "des-ede3",
      Buffer.concat([key, key, key]),
      null,
    );
    cipher.setAutoPadding(false);
    if (!(await read(16)).equals(cipher.update(challenge))) {
      const reason = Buffer.from("Authentication failed");
      const header = Buffer.alloc(8);
      header.writeUInt32BE(1);
      header.writeUInt32BE(reason.length, 4);
      socket.end(Buffer.concat([header, reason]));
      peer.rejected = true;
      return;
    }
  }
  socket.write(Buffer.alloc(4));
  await read(1);
  const init = Buffer.alloc(24);
  init.writeUInt16BE(width);
  init.writeUInt16BE(height, 2);
  socket.write(init);
  await read(20);
  const encoding = await read(4);
  await read(encoding.readUInt16BE(2) * 4);
  await read(10);
  const frame = Buffer.alloc(16 + width * height * 4, 0);
  frame.writeUInt16BE(1, 2);
  frame.writeUInt16BE(width, 8);
  frame.writeUInt16BE(height, 10);
  for (let i = 16; i < frame.length; i += 4) frame[i] = 77;
  socket.write(frame);
  if (!classic) extended(0x1f000001, Buffer.alloc(4));
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
