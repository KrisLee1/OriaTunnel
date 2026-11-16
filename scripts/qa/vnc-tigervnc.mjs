// Windows native V2 acceptance, using Cygwin's virtual X display and a debug
// build with embedded frontend assets. Run from the repository root.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { port, until, control } from "./vnc-native-control.mjs";
import path from "node:path";

const output = path.resolve("outputs/vnc-v2");
const cygwin = path.resolve(
  process.env.ORIATUNNEL_XVNC_ROOT ?? path.join(output, "cygwin"),
);
const bin = path.join(cygwin, "bin");
const installed = fs.readFileSync(
  path.join(cygwin, "etc/setup/installed.db"),
  "utf8",
);
assert.match(installed, /^tigervnc-server tigervnc-server-1\.8\.0-3\.tar\./m);
const executable = fs.realpathSync(
  process.argv[2] ?? "src-tauri/target/debug/oria-tunnel.exe",
);
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, "tiger-"));
const ssh = path.join(profile, "empty-ssh");
fs.writeFileSync(ssh, "");
const children = [];
let socket;
let serverLog = "";

function launch(exe, args, options = {}) {
  const child = spawn(exe, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.push(child);
  return child;
}
const password = randomBytes(4).toString("hex");
const passwordFile = path.join(profile, "vnc-auth");
const vncPort = await port();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const vaultTarget =
  "OriaTunnel/vnc/v1/" +
  hash(path.join(profile, "data", "connections.json")) +
  "/" +
  hash(JSON.stringify(["127.0.0.1:" + vncPort, []]));
function serverPassword(value) {
  const encoded = execFileSync(path.join(bin, "vncpasswd.exe"), ["-f"], {
    input: value + "\n",
    windowsHide: true,
  });
  assert.equal(encoded.length, 8);
  fs.writeFileSync(passwordFile, encoded, { mode: 0o600 });
  encoded.fill(0);
}
try {
  serverPassword(password);
  const unixPasswordFile = execFileSync(
    path.join(bin, "cygpath.exe"),
    ["-u", passwordFile],
    { encoding: "utf8" },
  ).trim();
  const server = launch(path.join(bin, "Xvnc.exe"), [
    "-displayfd",
    "1",
    "-nolisten",
    "tcp",
    "-noreset",
    "-localhost",
    "-interface",
    "127.0.0.1",
    "-rfbport",
    String(vncPort),
    "-geometry",
    "640x480",
    "-depth",
    "24",
    "-SecurityTypes",
    "VncAuth",
    "-PasswordFile",
    unixPasswordFile,
    "-Log",
    "*:stderr:30",
  ]);
  let displayNumber = "";
  server.stdout.on("data", (data) => {
    displayNumber += data;
  });
  server.stderr.on("data", (data) => {
    serverLog += data;
  });
  await until(() => {
    if (server.exitCode !== null)
      throw Error("Xvnc exited: " + serverLog.slice(-2000));
    return /^\d+\s*$/.test(displayNumber);
  }, "Xvnc allocated a virtual display");
  const xenv = { ...process.env, DISPLAY: ":" + displayNumber.trim() };
  function xcommand(name, ...args) {
    return execFileSync(path.join(bin, name + ".exe"), args, {
      env: xenv,
      encoding: "utf8",
      windowsHide: true,
    });
  }
  xcommand("xsetroot", "-solid", "#267342");
  // xev receives events on this virtual root only. Keep its output in memory.
  const observer = launch(
    path.join(bin, "stdbuf.exe"),
    ["-oL", "/usr/bin/xev", "-root", "-event", "keyboard", "-event", "mouse"],
    { env: xenv },
  );
  let xevents = "";
  observer.stdout.on("data", (data) => {
    xevents += data;
  });
  const debug = await port();
  launch(executable, ["vnc://127.0.0.1:" + vncPort], {
    env: {
      ...process.env,
      ORIATUNNEL_TEST_DATA_DIR: path.join(profile, "data"),
      ORIATUNNEL_TEST_SSH_CONFIG: ssh,
      WEBVIEW2_USER_DATA_FOLDER: path.join(profile, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + debug,
    },
  });
  const connection = await control(debug);
  socket = connection.socket;
  const { command, evaluate } = connection;
  async function credentials() {
    await until(
      () => evaluate("!!document.querySelector('#vnc-password')"),
      "VncAuth challenge",
    );
  }
  async function submit(value, remember = false) {
    if (remember)
      await evaluate(
        "document.querySelector('.vnc-password [role=checkbox]').click()",
      );
    await evaluate("document.querySelector('#vnc-password').focus()");
    await command("Input.insertText", { text: value });
    await evaluate(
      "document.querySelector('#vnc-password').form.requestSubmit()",
    );
  }
  await credentials();
  for (const [width, height] of [
    [480, 320],
    [1024, 720],
  ]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const centered = await evaluate(
      "(()=>{const f=document.querySelector('.vnc-password'), r=f.getBoundingClientRect(), label=f.querySelector('label').textContent;return Math.abs(r.x+r.width/2-innerWidth/2)<1 && Math.abs(r.y+r.height/2-innerHeight/2)<1 && document.body.innerText.split(label).length===2})()",
    );
    assert.ok(centered, "one centered password prompt");
  }
  fs.writeFileSync(
    path.join(profile, "password-layout.png"),
    Buffer.from((await command("Page.captureScreenshot", {})).data, "base64"),
  );
  await command("Emulation.clearDeviceMetricsOverride", {});
  await evaluate(
    "[...document.querySelectorAll('.vnc-password button')].find(b=>b.textContent==='取消').click()",
  );
  await until(
    () => /Connections: closed:/.test(serverLog),
    "server observed cancel at password prompt",
  );
  const retry = "document.querySelector('.vnc-status [data-slot=empty-content] button')";
  await evaluate(retry + ".click()");
  await credentials();
  await submit("!" + password, true);
  await until(
    () =>
      evaluate(
        "document.querySelector('.vnc-status [data-slot=empty-description] [role=alert]')?.textContent.includes('VNC 认证失败')",
      ),
    "wrong password rejected",
  );
  assert.equal(await evaluate("document.querySelector('.vnc-status [data-slot=empty-title]').textContent"), "已断开");
  const targetAddress = "127.0.0.1:" + vncPort;
  assert.equal(await evaluate("document.querySelector('.vnc-target').textContent"), targetAddress);
  assert.ok(!(await evaluate("document.querySelector('.vnc-status').textContent")).includes(targetAddress));
  fs.writeFileSync(
    path.join(profile, "disconnected.png"),
    Buffer.from((await command("Page.captureScreenshot", {})).data, "base64"),
  );
  assert.equal(
    await evaluate("document.querySelector('canvas').parentElement.hidden"),
    true,
  );
  await evaluate(retry + ".click()");
  await credentials();
  await submit(password, true);
  async function hasPixels(width, height, rgb) {
    return evaluate(
      "(()=>{const c=document.querySelector('canvas');return Number(c.dataset.remoteWidth)===" +
        width +
        " && Number(c.dataset.remoteHeight)===" +
        height +
        " && Array.from(c.getContext('2d').getImageData(10,10,1,1).data).join(',')===" +
        JSON.stringify(rgb + ",255") +
        "})()",
    );
  }
  await until(() => hasPixels(640, 480, "38,115,66"), "first TigerVNC frame");
  async function reloadViewer() {
    const previous = await evaluate("performance.timeOrigin");
    await command("Page.reload", {});
    await until(
      () =>
        evaluate(
          "performance.timeOrigin !== " +
            previous +
            " && !!document.querySelector('.vnc-desktop')",
        ).catch(() => false),
      "new viewer document",
    );
  }
  await reloadViewer();
  await until(
    () => hasPixels(640, 480, "38,115,66"),
    "automatically authenticated with Windows Credential Manager",
  );
  const rotated = randomBytes(4).toString("hex");
  serverPassword(rotated);
  await reloadViewer();
  await credentials();
  await submit(rotated, true);
  await until(
    () => hasPixels(640, 480, "38,115,66"),
    "replaced rejected credential",
  );
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 110,
    y: 2,
  });
  await evaluate(
    "document.querySelector('.app-titlebar button[aria-label=更多]').click()",
  );
  const forget =
    "[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent==='清除已保存密码')";
  await until(
    () => evaluate("!!(" + forget + ")"),
    "forget saved password menu item",
  );
  await evaluate("(" + forget + ").click()");
  await reloadViewer();
  await credentials();
  await submit(rotated);
  await until(
    () => hasPixels(640, 480, "38,115,66"),
    "manual authentication after forgetting",
  );
  const point = await evaluate(
    "(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await command("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: "left",
      clickCount: 1,
    });
  for (const type of ["keyDown", "keyUp"])
    await command("Input.dispatchKeyEvent", {
      type,
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    });
  await until(
    () =>
      /KeyRelease event/.test(xevents) &&
      /keysym 0x61, a/.test(xevents) &&
      /ButtonRelease event/.test(xevents) &&
      /root:\(320,240\)/.test(xevents),
    "remote X input",
  );
  xcommand("xrandr", "-s", "800x600");
  xcommand("xsetroot", "-solid", "#803259");
  await until(
    () => hasPixels(800, 600, "128,50,89"),
    "DesktopSize and repaint",
  );
  fs.writeFileSync(
    path.join(profile, "frame.png"),
    Buffer.from((await command("Page.captureScreenshot", {})).data, "base64"),
  );
  // Probe the negotiated clipboard mode without touching the OS clipboard.
  await evaluate(
    "(()=>{const data=new DataTransfer();data.setData('text/plain','中');document.querySelector('canvas').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));})()",
  );
  await until(
    () =>
      evaluate(
        "document.querySelector('[role=alert]')?.textContent.includes('Latin-1')",
      ),
    "classic clipboard fallback",
  );
  await evaluate(
    "setTimeout(()=>window.__TAURI_INTERNALS__.invoke('vnc_window_action',{action:'close'}),0)",
  );
  await until(
    () =>
      /ZRLE:/.test(serverLog) && /Total:\s+[1-9][\d,.]* rects/.test(serverLog),
    "server encoding statistics",
  );
  assert.match(serverLog, /protocol version 3\.8/);
  assert.match(serverLog, /security type VncAuth\(2\)/);
  const evidence = serverLog
    .split(/\r?\n/)
    .filter((line) =>
      /TigerVNC|protocol version|security type|ZRLE|Total:|solid rectangles|Pixels:|DesktopSize/i.test(
        line,
      ),
    );
  fs.writeFileSync(
    path.join(profile, "result.json"),
    JSON.stringify(
      {
        server: "Cygwin tigervnc-server 1.8.0-3",
        security: "VncAuth",
        encoding: "ZRLE",
        clipboard: "classic Latin-1",
        geometry: ["640x480", "800x600"],
        evidence,
        verified: [
          "cancel closes connection",
          "wrong password rejected",
          "reconnect with password",
          "remember after successful authentication; vault reuse, password rotation and forget",
          "canvas RGB at two sizes",
          "X key and centered pointer",
        ],
      },
      null,
      2,
    ),
  );
  console.log("TigerVNC native acceptance passed:", profile);
} finally {
  // Only the credential for this randomly generated loopback target and test profile.
  spawnSync("cmdkey.exe", ["/delete:" + vaultTarget], {
    windowsHide: true,
    stdio: "ignore",
  });
  socket?.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  fs.rmSync(passwordFile, { force: true });
}
