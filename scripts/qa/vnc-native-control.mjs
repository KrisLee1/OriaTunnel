import net from "node:net";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
export async function port() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const value = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return value;
}
export async function until(read, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(60);
  }
  throw Error("Timed out: " + description);
}
export async function control(
  debug,
  match = (page) => page.url.includes("#vnc"),
) {
  const target = await until(async () => {
    try {
      const pages = await (
        await fetch("http://127.0.0.1:" + debug + "/json/list")
      ).json();
      return pages.find(match);
    } catch {
      return false;
    }
  }, "native VNC window");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, "open");
  let next = 0;
  const requests = new Map();
  socket.addEventListener("message", ({ data }) => {
    const reply = JSON.parse(data);
    requests.get(reply.id)?.(reply);
    requests.delete(reply.id);
  });
  async function command(method, params) {
    const id = ++next;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(Error(method + " timed out"));
      }, 8000);
      requests.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
    });
    socket.send(JSON.stringify({ id, method, params }));
    const reply = await result;
    assert.ok(!reply.error, method + " failed");
    return reply.result;
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    assert.ok(!result.exceptionDetails, "WebView evaluation failed");
    return result.result.value;
  }
  return { command, evaluate, socket, id: target.id };
}
