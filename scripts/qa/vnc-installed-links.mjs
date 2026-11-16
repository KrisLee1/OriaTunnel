import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { framebuffer } from "./vnc-workspace-rfb.mjs";
import { control, port, until } from "./vnc-native-control.mjs";

const [name, argument, externalResult] = process.argv.slice(2);
if (name === "external") {
  const url = new URL(argument);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.protocol, "vnc:");
  const socket = net.connect(Number(url.port), url.hostname);
  socket.setTimeout(5000, () =>
    socket.destroy(Error("RFB greeting timed out")),
  );
  let banner = "";
  for await (const chunk of socket) {
    banner += chunk.toString();
    if (banner.length >= 12) break;
  }
  assert.equal(banner.slice(0, 12), "RFB 003.008\n");
  fs.writeFileSync(externalResult, argument);
} else {
  assert.match(name, /^OriaV4[a-f0-9]{12}$/);
  const peer = await framebuffer(),
    debug = await port();
  const url = "vnc://127.0.0.1:" + peer.port + "/";
  const ssh = path.join(argument, "empty-ssh");
  const result = path.join(argument, "external.txt");
  fs.writeFileSync(ssh, "");
  const env = {
    ...process.env,
    ORIATUNNEL_TEST_DATA_DIR: path.join(argument, "data"),
    ORIATUNNEL_TEST_SSH_CONFIG: ssh,
    WEBVIEW2_USER_DATA_FOLDER: path.join(argument, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + debug,
  };
  function dispatch(suffix) {
    execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        fileURLToPath(new URL("./vnc-install.ps1", import.meta.url)),
        "-Class",
        name + "." + suffix,
        "-Url",
        url,
      ],
      { env, windowsHide: true, timeout: 20000 },
    );
  }
  const pages = [];
  try {
    for (let i = 0; i < 2; i++) {
      dispatch("VNC");
      const page = await control(
        debug,
        (p) => p.url.includes("#vnc") && !pages.some((w) => w.id === p.id),
      );
      pages.push(page);
      await until(
        () =>
          page.evaluate(
            "(()=>{const c=document.querySelector('[data-vnc-screen]');return c && c.getContext('2d').getImageData(1,1,1,1).data[0]===77})()",
          ),
        "installed viewer pixels",
      );
    }
    assert.equal(peer.peers.filter((p) => p.ready).length, 2);
    const processes = execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        "@(Get-Process -Name " + name + " -ErrorAction SilentlyContinue).Count",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(
      Number(processes.trim()),
      1,
      "two desktops in one installed process",
    );
    dispatch("External");
    await until(() => fs.existsSync(result), "external RFB greeting");
    assert.equal(fs.readFileSync(result, "utf8"), url);
    const main = await control(
      debug,
      (p) => !p.url.includes("#vnc") && p.url.includes("tauri"),
    );
    pages.push(main);
    await main.evaluate(
      "setTimeout(()=>window.__TAURI_INTERNALS__.invoke('quit_app'),0)",
    );
    await until(async () => {
      try {
        await fetch("http://127.0.0.1:" + debug + "/json/list");
        return false;
      } catch {
        return true;
      }
    }, "isolated instance exit");
    await delay(150);
  } finally {
    for (const page of pages) page.socket.close();
    peer.close();
  }
}
