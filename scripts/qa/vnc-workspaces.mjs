// Windows WebView2 with isolated app data and loopback RFB/SSH/SFTP.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { port, until, control } from "./vnc-native-control.mjs";
import { framebuffer } from "./vnc-workspace-rfb.mjs";

const root = path.resolve("outputs/vnc-v3");
fs.mkdirSync(root, { recursive: true });
const profile = fs.mkdtempSync(path.join(root, "native-"));
const sshConfig = path.join(profile, "empty-ssh");
fs.writeFileSync(sshConfig, "");
const children = [],
  windows = [],
  verified = [];
const mark = (name) => {
  verified.push(name);
  console.log(name);
};
const direct = await framebuffer(),
  forwarded = await framebuffer(),
  debug = await port();
const shellSecret = fs
  .readFileSync("src-tauri/tests/common/terminal_server.rs", "utf8")
  .match(/password == "([^"]+)"/)[1];
const fileSecret = fs
  .readFileSync("src-tauri/src/files/tests.rs", "utf8")
  .match(/if p == "([^"]+)"/)[1];
// Set this only on a disposable test desktop whose clipboard contains the marker.
const marker = process.env.ORIATUNNEL_QA_CLIPBOARD_MARKER;
const env = {
  ...process.env,
  ORIATUNNEL_TEST_DATA_DIR: path.join(profile, "data"),
  ORIATUNNEL_TEST_SSH_CONFIG: sshConfig,
  WEBVIEW2_USER_DATA_FOLDER: path.join(profile, "webview"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    "--remote-debugging-port=" +
    debug +
    " --remote-debugging-address=127.0.0.1 --force-device-scale-factor=1.5",
};
async function fixture(exe, args, pattern) {
  const child = spawn(exe, args, {
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  let output = "",
    error = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (error += b));
  return until(() => {
    if (child.exitCode !== null)
      throw Error("Fixture exited: " + error.slice(-700));
    return Number(pattern.exec(output)?.[1]);
  }, "fixture startup");
}
async function page(match) {
  const w = await control(debug, match);
  windows.push(w);
  return w;
}
const q = (selector) =>
  "document.querySelector(" + JSON.stringify(selector) + ")";
const all = (selector) =>
  "[...document.querySelectorAll(" + JSON.stringify(selector) + ")]";
async function ipc(w, name, args = {}) {
  return w.evaluate(
    "window.__TAURI_INTERNALS__.invoke(" +
      JSON.stringify(name) +
      "," +
      JSON.stringify(args) +
      ")",
  );
}
let focusedPage;
async function hit(w, expr, label) {
  if (focusedPage !== w.id) {
    await w.command("Page.bringToFront", {});
    focusedPage = w.id;
  }
  let previous;
  const point = await until(async () => {
    const next = await w.evaluate(
      "(()=>{const e=" +
        expr +
        ";if(!e||e.disabled)return null;const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2; return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()",
    );
    const stable =
      previous &&
      next &&
      Math.abs(previous.x - next.x) < 0.2 &&
      Math.abs(previous.y - next.y) < 0.2;
    previous = next;
    return stable && next;
  }, label);
  await w.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    ...point,
  });
  await w.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    ...point,
  });
}
async function clickText(w, selector, text) {
  await hit(
    w,
    all(selector) +
      ".find(e=>e.textContent.trim()===" +
      JSON.stringify(text) +
      ")",
    text,
  );
}
const headerButton = (name) =>
  q('.window-actions button[aria-label="' + name + '"]');
async function revealToolbar(w) {
  await w.command("Page.bringToFront", {});
  await w.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 150,
    y: 3,
  });
}
async function tool(w, name) {
  await revealToolbar(w);
  const button = headerButton(name);
  if (await w.evaluate("!!(" + button + "?.getBoundingClientRect().width)")) {
    await hit(w, button, name);
    return;
  }
  await hit(w, q('.app-titlebar button[aria-label="更多"]'), "compact tools");
  await clickText(w, "[role=menuitem]", name);
}
async function startDesktop(w, server) {
  await until(
    () =>
      w.evaluate(
        "document.querySelector('canvas')?.dataset.remoteWidth==='320' && document.querySelector('canvas').getContext('2d').getImageData(1,1,1,1).data[0]===77",
      ),
    "real frame",
  );
  return until(() => {
    const live = server.peers.filter((p) => p.ready && !p.socket.destroyed);
    return live.length === 1 && live[0];
  }, "automatically connected framebuffer peer");
}
async function clipboardShortcut(w, letter) {
  await w.command("Page.bringToFront", {});
  await w.evaluate("document.querySelector('canvas').focus()");
  const ctrl = {
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
  };
  const key = {
    key: letter,
    code: "Key" + letter.toUpperCase(),
    windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0),
  };
  for (const [type, event, modifiers] of [
    ["keyDown", ctrl, 2],
    ["keyDown", key, 2],
    ["keyUp", key, 2],
    ["keyUp", ctrl, 0],
  ]) {
    await w.command("Input.dispatchKeyEvent", { type, ...event, modifiers });
  }
}
async function shell(w, chooseHost = false) {
  await tool(w, "SSH 终端");
  if (chooseHost) {
    await hit(
      w,
      q('[role="dialog"] [role=combobox]'),
      "unassociated link chooses SSH host once",
    );
    await w.command("Input.insertText", { text: "V3 shell" });
    await hit(
      w,
      all("[role=option]") + ".find(e=>e.textContent.includes('V3 shell'))",
      "choose fixture SSH host",
    );
  } else {
    await until(
      async () =>
        (await ipc(w, "terminal_sessions")).some((s) => s.hostId === "v3-pty"),
      "opening terminal starts SSH automatically",
    );
    assert.equal(
      await w.evaluate(
        "!!document.querySelector('[role=dialog] [role=combobox]')",
      ),
      false,
    );
  }
  const field = q('[role="dialog"] input[type=password]');
  await until(() => w.evaluate("!!" + field), "terminal password prompt");
  await w.evaluate(field + ".focus()");
  await w.command("Input.insertText", { text: shellSecret });
  await w.evaluate(q('[role="dialog"] form') + ".requestSubmit()");
  await until(
    () =>
      w.evaluate("!!document.querySelector('textarea.xterm-helper-textarea')"),
    "interactive terminal",
  );
  await shellCommand(w);
}
let commandNumber = 0;
async function shellCommand(w) {
  const n = ++commandNumber;
  const input = q("textarea.xterm-helper-textarea");
  await until(
    () =>
      w.evaluate(
        "document.querySelector('.xterm-rows')?.textContent.includes('oria-e2>')",
      ),
    "fixture shell prompt",
  );
  assert.equal((await ipc(w, "terminal_sessions"))[0].phase, "running");
  await w.command("Page.bringToFront", {});
  await hit(w, q(".xterm-screen"), "focus remote terminal");
  await w.evaluate(input + ".focus()");
  const line = "Write-Output ('ORIA_' + (20 + " + n + "))";
  await w.evaluate(
    "(()=>{const d=new DataTransfer();d.setData('text/plain'," +
      JSON.stringify(line) +
      ");" +
      input +
      ".dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:d}));})()",
  );
  await until(
    () =>
      w.evaluate(
        "document.querySelector('.xterm-rows')?.textContent.includes(" +
          JSON.stringify("(20 + " + n + ")") +
          ")",
      ),
    "remote shell echoed command",
  );
  await w.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    text: "\r",
  });
  await w.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await until(
    () =>
      w.evaluate(
        "document.querySelector('.xterm-rows')?.textContent.includes('ORIA_" +
          (20 + n) +
          "')",
      ),
    "PowerShell output",
  );
}
try {
  const build = path.resolve("src-tauri/target/debug");
  const bins = fs
    .readdirSync(path.join(build, "deps"))
    .filter((f) => /^oria_tunnel_lib-[a-f0-9]+\.exe$/.test(f))
    .sort(
      (a, b) =>
        fs.statSync(path.join(build, "deps", b)).mtimeMs -
        fs.statSync(path.join(build, "deps", a)).mtimeMs,
    );
  const shellPort = await fixture(
    path.join(build, "examples/terminal_fixture.exe"),
    [],
    /ISOLATED_SSH_PORT=(\d+)/,
  );
  const sftpPort = await fixture(
    path.join(build, "deps", bins[0]),
    [
      "files::tests::serve_workspace_fixture",
      "--exact",
      "--ignored",
      "--nocapture",
    ],
    /ISOLATED_SFTP_PORT=(\d+)/,
  );
  children.push(
    spawn(
      process.argv[2] ?? path.join(build, "oria-tunnel.exe"),
      ["vnc://127.0.0.1:" + direct.port],
      { env, stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
    ),
  );
  const main = await page(
      (p) => !p.url.includes("#vnc") && p.url.includes("tauri"),
    ),
    a = await page((p) => p.url.includes("#vnc"));
  await until(
    () => ipc(main, "snapshot").catch(() => false),
    "main window ready",
  );
  const host = (id, name, port) => ({
    id,
    name,
    address: "127.0.0.1",
    port,
    user: "tester",
    identityFiles: [],
    source: "manual",
    diagnostics: [],
    connection: {
      connectTimeoutSecs: 15,
      keepaliveIntervalSecs: 15,
      keepaliveMax: 3,
    },
    authMethod: "password",
    tags: [],
    hidden: false,
    identitiesOnly: false,
    fieldSources: {},
    configuredForwards: [],
  });
  const sh = host("v3-pty", "A · V3 shell", shellPort),
    sftp = host("v3-files", "B · V3 files", sftpPort);
  for (const h of [sh, sftp]) await ipc(main, "save_host", { host: h });
  const directServiceName = "TigerVNC";
  const savedDirect = await ipc(main, "save_service_profile", { service: {
    id: "", name: directServiceName, revision: "", category: "desktop",
    icon: { kind: "builtin", value: "remote-desktop" }, port: forwarded.port,
    hostIds: [sh.id], ruleIds: [], noLocalEnvironment: true, actions: [],
  }});
  assert.equal(savedDirect.rules.length, 0);
  const directService = savedDirect.services.find(s => s.name === directServiceName);
  await clickText(main, "[role=dialog] button", "开始使用");
  await until(() => main.evaluate("!document.querySelector('[role=dialog]')"), "initial preferences closed");
  const hostTrigger = q('.host-card-services button[title="TigerVNC"]');
  await until(() => main.evaluate("!!" + hostTrigger), "host-only service rendered");
  await main.evaluate("document.querySelector('.canvas-controls .lucide-maximize')?.closest('button').click()");
  await hit(main, hostTrigger, "host-only service trigger");
  await until(() => main.evaluate("!!document.querySelector('[role=menu]')"), "host-only service menu");
  await captureChoice(q('[role=menu]'), "host-service-menu");
  await clickText(main, "[role=menuitem]", "打开 " + directServiceName);
  await hit(main, q('[role=dialog] input[value=internal]'), "direct VNC client");
  await clickText(main, "[role=dialog] button", "此次");
  const hostViewer = await nextViewer([a.id]);
  await startDesktop(hostViewer, forwarded);
  assert.equal(await ipc(hostViewer, "vnc_endpoint"), "127.0.0.1:" + forwarded.port);
  await hostViewer.evaluate("setTimeout(()=>window.__TAURI_INTERNALS__.invoke('vnc_window_action',{action:'close'}),0)");
  await until(() => forwarded.peers.every(p => p.socket.destroyed), "direct viewer closed");
  mark("A host-only service with no commands or forward opens its saved port and receives a real framebuffer");
  await ipc(main, "save_service_profile", { service: {
    id: "", name: "Gitea", revision: "", category: "development",
    hostIds: [sh.id], ruleIds: [], port: 3000, noLocalEnvironment: true,
    icon: { kind: "builtin", value: "gitea" },
    actions: ["start", "stop", "restart", "status"].map((kind, index) => ({
      id: kind, kind, label: ["启动", "停止", "重启", "状态"][index], command: "true",
      timeoutSecs: 5, successCodes: [0], confirm: false,
    })),
  }});
  await hit(main, q('.host-card-services button[title="Gitea"]'), "Gitea menu");
  await until(() => main.evaluate("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent==='打开 Gitea')"), "service-name label");
  assert.ok(await main.evaluate("[...document.querySelectorAll('[role=menuitem]')].every(e=>e.querySelector('svg'))"));
  await captureChoice(q('[role=menu]'), "gitea-menu");
  await main.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await main.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const id = "v3-forward",
    bindPort = await port();
  await ipc(main, "save_rule", {
    serviceLinks: [{ id: directService.id, revision: directService.revision, selected: true }],
    rule: {
      id,
      name: "V3 desktop",
      hostId: sh.id,
      serviceProtocol: "vnc",
      kind: "L",
      bindAddress: "127.0.0.1",
      bindPort,
      targetHost: "127.0.0.1",
      targetPort: forwarded.port,
      noRemoteCommand: true,
      remoteCommand: "",
      background: true,
      reconnect: {
        enabled: false,
        maxAttempts: 8,
        initialDelaySecs: 2,
        maxDelaySecs: 60,
      },
      autoConnect: false,
      repeatCommandOnReconnect: false,
    },
  });
  await ipc(main, "start_rule", { id, secret: shellSecret });
  const runtime = async () =>
    (await ipc(main, "snapshot")).runtimes.find((r) => r.ruleId === id);
  const verify = await until(async () => {
    const r = await runtime();
    return r?.fingerprint && r;
  }, "forward host key");
  await ipc(main, "trust_host", {
    id,
    runId: verify.runId,
    fingerprint: verify.fingerprint,
  });
  await until(
    async () => (await runtime()).status === "listening",
    "SSH forward listening",
  );
  await main.evaluate(
    "[...document.querySelectorAll('button')].find(b=>b.textContent==='开始使用')?.click()",
  );
  await main.evaluate(
    "document.querySelector('[role=dialog] button[aria-label=关闭]')?.click()",
  );
  const card = q('button[aria-label="打开 VNC V3 desktop"]');
  const dialog = '[role="dialog"]';
  const radio = (value) => q(dialog + ' input[value="' + value + '"]');
  const cardReady = () =>
    main.evaluate(card + "?.disabled === false").catch(() => false);
  await until(cardReady, "VNC card action");
  assert.ok(await main.evaluate(card + ".querySelector('.lucide-screen-share') !== null"));
  assert.ok(await main.evaluate(card + ".closest('.port-path-actions').querySelector('.service-command-icons .lucide-monitor') !== null"));
  assert.equal(
    await main.evaluate(
      card + ".parentElement.querySelectorAll('button').length",
    ),
    1,
  );
  async function chooseInternal(duration) {
    await main.command("Page.bringToFront", {});
    await main.evaluate(card + ".click()");
    await until(
      () => main.evaluate(radio("system") + "?.checked"),
      "system client preselected",
    );
    await hit(main, radio("internal"), "internal VNC client");
    if (duration === "此次") await captureChoice(q(dialog), "client-dialog");
    await clickText(main, dialog + " button", duration);
  }
  async function captureChoice(element, name) {
    await main.evaluate(
      "(async()=>{await new Promise(requestAnimationFrame);const e=" + element +
      ";await Promise.allSettled(e.parentElement.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished))})()",
    );
    const bounds = await main.evaluate(
      element + ".getBoundingClientRect().toJSON()",
    );
    const { x, y, width, height } = bounds;
    const { data } = await main.command("Page.captureScreenshot", {
      clip: { x, y, width, height, scale: 1 },
    });
    fs.writeFileSync(
      path.join(profile, name + ".png"),
      Buffer.from(data, "base64"),
    );
  }
  async function nextViewer(known) {
    const viewer = await page(
      (p) => p.url.includes("#vnc") && !known.includes(p.id),
    );
    await until(
      () => viewer.evaluate("!!document.querySelector('.vnc-target')?.title"),
      "rule viewer",
    );
    return viewer;
  }
  await chooseInternal("此次");
  const onceViewer = await nextViewer([a.id]);
  await chooseInternal("总是");
  const alwaysViewer = await nextViewer([a.id, onceViewer.id]);
  await main.command("Page.reload", { ignoreCache: true });
  await until(cardReady, "VNC card ready after reload");
  assert.equal(
    await main.evaluate(card + ".hasAttribute('aria-haspopup')"),
    false,
  );
  await main.evaluate(card + ".click()");
  const b = await nextViewer([a.id, onceViewer.id, alwaysViewer.id]);
  for (const viewer of [onceViewer, alwaysViewer]) {
    await viewer.evaluate(
      "setTimeout(()=>window.__TAURI_INTERNALS__.invoke('vnc_window_action',{action:'close'}),0)",
    );
  }
  await hit(main, q('button[aria-label="设置"]'), "main settings");
  const choice = q('[aria-labelledby="vnc-client-label"]');
  await until(
    () => main.evaluate(choice + "?.textContent.includes('使用应用内 VNC')"),
    "remembered client in settings",
  );
  assert.ok(
    await main.evaluate(
      all("button") +
        ".some(e=>e.textContent==='设置为系统默认 VNC' && !e.disabled && e.closest('[data-slot=item]')?.textContent.startsWith('默认 VNC'))",
    ),
  );
  await main.evaluate(choice + ".scrollIntoView({block:'center'})");
  await captureChoice(
    choice + ".closest('[data-slot=item-group]')",
    "client-settings",
  );
  await hit(main, choice, "VNC client select");
  await clickText(main, '[role="option"]', "使用系统默认 VNC");
  await until(
    () => main.evaluate(choice + "?.textContent.includes('使用系统默认 VNC')"),
    "settings overrides remembered choice",
  );
  await main.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await main.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until(() => main.evaluate("!" + choice), "settings closed");
  mark(
    "One VNC card action; Just once asks again, Always skips the chooser after reload, and settings overrides the remembered client",
  );
  await tool(b, "文件传输");
  assert.ok(
    await b.evaluate(
      "document.querySelectorAll('.files-host-select')[1].textContent.includes('V3 shell')",
    ),
  );
  await until(
    async () =>
      (await ipc(b, "file_snapshot")).sessions.some((s) => s.hostId === sh.id),
    "opening file panel connects to the rule SSH host",
  );
  const autoPass = q('[role="dialog"] input[type=password]');
  await until(
    () => b.evaluate("!!" + autoPass),
    "direct file connection requests credentials",
  );
  await b.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await b.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until(() => b.evaluate("!" + autoPass), "file credentials dismissed");
  await hit(b, all(".files-host-select") + "[1]", "SSH file host picker");
  const option =
    all("[role=option]") +
    ".find(e=>e.textContent.trim()===" +
    JSON.stringify(sftp.name) +
    ")";
  await until(() => b.evaluate("!!(" + option + ")"), "SFTP host option");
  await b.evaluate("(" + option + ").click()");
  await clickText(b, '[role="dialog"] button', "信任并连接");
  const pass = q('[role="dialog"] input[type=password]');
  await until(() => b.evaluate("!!" + pass), "SFTP credentials");
  await b.evaluate(pass + ".focus()");
  await b.command("Input.insertText", { text: fileSecret });
  await clickText(b, '[role="dialog"] button', "连接");
  const sid = await until(
    async () =>
      (await ipc(b, "file_snapshot")).sessions.find(
        (s) => s.phase === "connected",
      )?.id,
    "SFTP connected",
  );

  await hit(
    b,
    q('.files-workspace button[aria-label="折叠面板"]'),
    "collapse file panel",
  );
  const pa = await startDesktop(a, direct),
    pb = await startDesktop(b, forwarded);
  await revealToolbar(a);
  await hit(
    a,
    q('.app-titlebar button[aria-label="更多"]'),
    "remote desktop menu",
  );
  await clickText(a, '[role="menuitem"]', "发送 Ctrl+Alt+Del");
  await until(
    () => pa.inputs.some((i) => i.key === 0xffe3 && !i.down),
    "remote Ctrl+Alt+Del",
  );
  assert.deepEqual(
    pa.inputs
      .filter((i) => i.key)
      .slice(-6)
      .map((i) => [i.key, i.down]),
    [
      [0xffe3, 1],
      [0xffe9, 1],
      [0xffff, 1],
      [0xffff, 0],
      [0xffe9, 0],
      [0xffe3, 0],
    ],
  );
  mark(
    "Link and rule viewers connect on open and render real frames; the labeled Ctrl+Alt+Del menu sends the chord",
  );
  await a.command("Emulation.setFocusEmulationEnabled", { enabled: true });
  const origin = await a.evaluate("location.origin");
  if (marker) {
    await a.command("Browser.grantPermissions", {
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
      origin,
    });
    await a.command("Page.bringToFront", {});
    assert.ok(
      await a.evaluate(
        "navigator.clipboard.readText().then(s=>s===" +
          JSON.stringify(marker) +
          ")",
      ),
      "test desktop clipboard marker",
    );
  } else {
    // Exercise the granted API path without replacing the user's system clipboard.
    await a.evaluate(
      "(()=>{let text='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>text,writeText:async value=>{text=value}}});})()",
    );
  }
  const local = "V3 English\n本地中文",
    remote = "Remote English\n远端中文";
  await a.evaluate(
    "navigator.clipboard.writeText(" + JSON.stringify(local) + ")",
  );
  await clipboardShortcut(a, "v");
  await until(
    () => pa.received === local,
    "shortcut pastes local Unicode text over RFB",
  );
  pa.copySelection = remote;
  await clipboardShortcut(a, "c");
  await until(
    () =>
      a.evaluate(
        "navigator.clipboard.readText().then(s=>s.replaceAll('\\r\\n','\\n')===" +
          JSON.stringify(remote) +
          ")",
      ),
    "shortcut copies fresh Unicode text from RFB",
  );
  if (!marker) await a.evaluate("delete navigator.clipboard");
  for (const name of ["clipboard-read", "clipboard-write"])
    await a.command("Browser.setPermission", {
      permission: { name },
      setting: "denied",
      origin,
    });
  await clipboardShortcut(a, "v");
  await until(
    () =>
      a.evaluate(
        "!!document.querySelector('.vnc-desktop textarea:not([readonly])')",
      ),
    "manual paste fallback",
  );
  const fallback = "V3 English\n中文粘贴";
  await a.evaluate(
    "(()=>{let d=new DataTransfer();d.setData('text/plain'," +
      JSON.stringify(fallback) +
      ");document.querySelector('.vnc-desktop textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:d}));})()",
  );
  await until(() => pa.received === fallback, "manual bilingual paste");
  const fallbackRemote = "V3 Remote\n远端文本";
  await until(() => pa.pasted, "remote receives Ctrl+V with Control held");
  pa.copySelection = fallbackRemote;
  await clipboardShortcut(a, "c");
  await until(
    () =>
      a.evaluate(
        "document.querySelector('.vnc-desktop textarea[readonly]')?.value===" +
          JSON.stringify(fallbackRemote),
      ),
    "selectable copy fallback",
  );
  await a.evaluate(
    "document.querySelector('.vnc-desktop textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
  );
  mark(
    marker
      ? "Windows test clipboard exchanged bilingual multiline text; denied read/write recovered"
      : "Ctrl+C/V exchanged bilingual text with an isolated clipboard; denied system permissions opened manual fallbacks",
  );
  await hit(a, q("canvas"), "fit to viewport");
  await until(
    () =>
      pa.inputs.some(
        (i) =>
          i.buttons === 1 &&
          Math.abs(i.x - 160) <= 1 &&
          Math.abs(i.y - 120) <= 1,
      ),
    "fit coordinates",
  );
  await a.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 180,
    y: 180,
  });
  await until(
    () =>
      a.evaluate(
        "document.querySelector('.vnc-floating-header').getBoundingClientRect().bottom<=1",
      ),
    "floating toolbar hides",
  );
  await revealToolbar(a);
  assert.ok(
    await a.evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(document.querySelector('.vnc-floating-header').classList.contains('is-visible')))))",
    ),
    "top edge starts revealing immediately",
  );
  await a.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 180,
    y: 180,
  });
  await delay(200);
  assert.ok(
    await a.evaluate(
      "document.querySelector('.vnc-floating-header').classList.contains('is-visible')",
    ),
    "brief departure keeps toolbar open",
  );
  await revealToolbar(a);
  await delay(750);
  assert.ok(
    await a.evaluate(
      "document.querySelector('.vnc-floating-header').classList.contains('is-visible')",
    ),
    "returning to the top cancels hiding",
  );
  await hit(
    a,
    q('[data-window-active] button[aria-label="全屏"]'),
    "fullscreen window control",
  );
  assert.equal(
    await a.evaluate(
      "document.querySelectorAll('[data-fixed-actions=right] button').length",
    ),
    3,
  );
  await until(
    () => ipc(a, "vnc_window_action", { action: "isFullscreen" }),
    "native fullscreen",
  );
  await revealToolbar(a);
  await hit(
    a,
    q('[data-window-active] button[aria-label="还原"]'),
    "restore window control",
  );
  await until(
    async () =>
      !(await ipc(a, "vnc_window_action", { action: "isFullscreen" })),
    "native window restored",
  );
  for (const maximized of [true, false]) {
    await revealToolbar(a);
    await until(
      () =>
        a.evaluate(
          "document.querySelector('.vnc-floating-header').getBoundingClientRect().top>=-0.5",
        ),
      "titlebar available for double click",
    );
    await a.evaluate(
      "document.querySelector('.app-titlebar').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}))",
    );
    await until(
      async () =>
        (await ipc(a, "vnc_window_action", { action: "isMaximized" })) ===
        maximized,
      "double click toggles native maximization",
    );
    assert.equal(
      await ipc(a, "vnc_window_action", { action: "isFullscreen" }),
      false,
    );
  }
  await revealToolbar(a);
  const zoomRatio = () =>
    a.evaluate(
      "document.querySelector('canvas').getBoundingClientRect().width/320",
    );
  const fitRatio = await zoomRatio();
  await hit(a, headerButton("缩小"), "direct zoom out");
  await until(
    async () => (await zoomRatio()) < fitRatio,
    "smaller remote desktop",
  );
  await hit(a, headerButton("放大"), "direct zoom in");
  await hit(a, headerButton("适应窗口"), "restore fit");
  await until(
    async () => Math.abs((await zoomRatio()) - fitRatio) < 0.01,
    "fits restored window",
  );
  for (let step = 0; step < 10; step++) {
    const ratio = await zoomRatio();
    if (Math.abs(ratio - 1) < 0.001) break;
    await hit(
      a,
      headerButton(ratio > 1 ? "缩小" : "放大"),
      "direct zoom to 100%",
    );
  }
  mark(
    "Floating toolbar reveals at the top, hides over the desktop, and directly controls zoom, fit and native fullscreen",
  );
  await until(
    () =>
      a.evaluate(
        "Math.abs(document.querySelector('canvas').getBoundingClientRect().width-320)<1",
      ),
    "100% scale applied",
  );
  await a.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await a.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await hit(a, q("canvas"), "100% zoom");
  await until(
    () =>
      pa.inputs.filter(
        (i) =>
          i.buttons === 1 &&
          Math.abs(i.x - 160) <= 1 &&
          Math.abs(i.y - 120) <= 1,
      ).length >= 2,
    "100% coordinates",
  );
  assert.ok(await a.evaluate("devicePixelRatio>=1.5"));
  const center = await a.evaluate(
    "(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
  await a.command("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...center,
    deltaX: 0,
    deltaY: 100,
  });
  await until(() => pa.inputs.some((i) => i.buttons === 16), "RFB wheel pulse");
  await a.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...center,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await a.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 4,
    y: center.y,
    button: "left",
    buttons: 1,
  });
  await a.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: 4,
    y: center.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await until(
    () =>
      pa.inputs.some((i) => i.x === 0 && i.buttons === 1) &&
      pa.inputs.some((i) => i.x === 0 && i.buttons === 0),
    "captured drag outside framebuffer",
  );
  for (const type of ["keyDown", "keyDown", "keyUp"]) {
    await a.command("Input.dispatchKeyEvent", {
      type,
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    });
  }
  await until(
    () =>
      pa.inputs.filter((i) => i.key === 97 && i.down).length === 2 &&
      pa.inputs.some((i) => i.key === 97 && !i.down),
    "repeated key has matching release",
  );
  const keyStart = pa.inputs.length;
  await a.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Shift",
    code: "ShiftLeft",
    windowsVirtualKeyCode: 16,
  });
  await shell(a, true);
  await until(
    () => pa.inputs.some((i) => i.key === 0xffe1 && !i.down),
    "panel focus releases held Shift",
  );
  assert.equal(
    pa.inputs.slice(keyStart).filter((i) => i.key && i.key !== 0xffe1).length,
    0,
  );
  await shell(b);
  const ta = (await ipc(a, "terminal_sessions"))[0],
    tb = (await ipc(b, "terminal_sessions"))[0];
  assert.notEqual(ta.id, tb.id);
  assert.equal((await ipc(main, "terminal_sessions")).length, 0);
  await assert.rejects(
    ipc(b, "resize_terminal", {
      id: ta.id,
      clientId: ta.clientId,
      cols: 80,
      rows: 24,
    }),
  );
  await hit(
    b,
    q('.terminal-workspace button[aria-label="折叠面板"]'),
    "collapse terminal",
  );
  await tool(b, "SSH 终端");
  assert.equal((await ipc(b, "terminal_sessions"))[0].id, tb.id);
  mark(
    "Two live PTYs, isolated input and resizing, tab restore, fit/100% pointer at 150% scaling",
  );
  await tool(b, "文件传输");
  assert.ok(
    (await ipc(b, "file_snapshot")).sessions.some(
      (s) => s.id === sid && s.phase === "connected",
    ),
  );
  await assert.rejects(ipc(a, "file_list", { session: sid, path: "/" }));
  const sample = path.join(profile, "payload.bin");
  fs.writeFileSync(sample, randomBytes(192 * 1024));
  const dataDir = path.join(profile, "download");
  fs.mkdirSync(dataDir);
  const source = await ipc(b, "file_sources", { paths: [sample] }),
    dest = await ipc(b, "file_list", { session: sid, path: "/" });
  async function submit(win, sources, target) {
    return ipc(win, "file_submit", {
      requestId: randomUUID(),
      sources,
      target,
    });
  }
  async function task(win, job) {
    return (await ipc(win, "file_snapshot")).tasks.find((t) => t.id === job);
  }
  async function localDirectory(directory) {
    const local = 'section[data-file-side="local"]';
    await b.evaluate(
      q(local + ' button[aria-label="输入完整路径"]') + ".click()",
    );
    const field = q(local + ' input[aria-label="目录路径"]');
    await until(() => b.evaluate("!!" + field), "local path editor");
    await b.evaluate(field + ".select()");
    await b.command("Input.insertText", { text: directory });
    await b.evaluate(
      q(local + ' button[aria-label="跳转到此路径"]') + ".click()",
    );
    await until(() => b.evaluate("!" + field), "local directory changed");
  }
  async function transferFile(side, action) {
    const pane = 'section[data-file-side="' + side + '"]';
    const entry =
      all(pane + " [data-file-entry]") +
      ".find(e=>e.querySelector('.files-entry-name')?.textContent.includes('payload.bin'))";
    await until(
      () => b.evaluate("!!(" + entry + ")"),
      "file listed in " + side,
    );
    await b.evaluate("(" + entry + ").click()");
    const button =
      all(pane + " button") +
      ".find(e=>e.textContent.trim()===" +
      JSON.stringify(action) +
      ")";
    await until(
      () => b.evaluate("!(" + button + ").disabled"),
      action + " enabled",
    );
    await b.evaluate("(" + button + ").click()");
  }
  await localDirectory(profile);
  await transferFile("local", "上传");
  const upload = await until(
    async () =>
      (await ipc(b, "file_snapshot")).tasks.find(
        (t) => t.direction === "upload",
      )?.id,
    "UI upload accepted",
  );
  await until(
    async () => (await task(b, upload))?.phase === "completed",
    "upload complete",
  );
  await localDirectory(dataDir);
  await hit(
    b,
    q('.files-workspace button[aria-label="折叠面板"]'),
    "collapse file pane",
  );
  await tool(b, "文件传输");
  await until(
    () =>
      b.evaluate(
        "document.querySelector('section[data-file-side=local] .files-breadcrumb')?.textContent.includes('download')",
      ),
    "restore local directory",
  );
  assert.ok(
    (await ipc(b, "file_snapshot")).sessions.some(
      (s) => s.id === sid && s.phase === "connected",
    ),
  );
  await transferFile("remote", "下载");
  const download = await until(
    async () =>
      (await ipc(b, "file_snapshot")).tasks.find(
        (t) => t.direction === "download",
      )?.id,
    "UI download accepted",
  );
  await until(
    async () => (await task(main, download))?.phase === "completed",
    "download complete",
  );
  assert.ok(
    fs
      .readFileSync(path.join(dataDir, "payload.bin"))
      .equals(fs.readFileSync(sample)),
  );
  const conflict = await submit(b, source, dest.id);
  await until(
    async () => (await task(b, conflict))?.phase === "conflict",
    "conflict",
  );
  assert.ok((await ipc(b, "file_snapshot")).conflictIds.includes(conflict));
  assert.ok(!(await ipc(main, "file_snapshot")).conflictIds.includes(conflict));
  assert.ok(!(await ipc(a, "file_snapshot")).conflictIds.includes(conflict));
  await ipc(b, "file_resolve_conflict", {
    id: conflict,
    policy: "skip",
    applyAll: true,
  });
  await until(
    async () =>
      ["partial", "completed"].includes((await task(b, conflict))?.phase),
    "conflict resolved",
  );
  mark(
    "SFTP host verification and password, upload/download byte equality, single conflict owner and shared task IDs",
  );
  const second = path.join(profile, "background.bin");
  fs.writeFileSync(second, randomBytes(6 * 1024 * 1024));
  const bg = await submit(
    b,
    await ipc(b, "file_sources", { paths: [second] }),
    dest.id,
  );
  assert.notEqual((await task(main, bg)).phase, "completed");
  await ipc(b, "vnc_window_action", { action: "close" }).catch(() => {});
  await until(() => pb.socket.destroyed, "RFB closed");
  await until(
    async () => (await task(main, bg))?.phase === "completed",
    "shared transfer finished after closing source",
  );
  assert.ok((await task(main, bg)).bytes >= 6 * 1024 * 1024);
  assert.equal((await ipc(a, "terminal_sessions"))[0].id, ta.id);
  await tool(main, "文件传输");
  await until(
    () =>
      main.evaluate(
        "document.querySelector('.files-workspace')?.textContent.includes('background.bin')",
      ),
    "main transfer queue displays completed background file",
  );
  await main.command("Page.reload", {});
  await until(async () => {
    try {
      return !!(await ipc(main, "snapshot")).hosts.length;
    } catch {
      return false;
    }
  }, "main page reloaded");
  await shellCommand(a);
  await hit(
    a,
    q('.terminal-workspace button[aria-label="折叠面板"]'),
    "collapse remaining terminal",
  );
  await hit(a, q("canvas"), "remaining desktop");
  assert.ok(!pa.socket.destroyed);
  await until(
    () => pa.inputs.at(-1)?.buttons === 0,
    "remaining desktop receives input",
  );
  mark(
    "Closing the source desktop releases its RFB and leaves another desktop, its terminal, and the background transfer operational",
  );
  fs.writeFileSync(
    path.join(profile, "result.json"),
    JSON.stringify(
      { platform: process.platform, deviceScale: 1.5, verified },
      null,
      2,
    ),
  );
  console.log(profile);
} finally {
  for (const w of windows) w.socket.close();
  direct.close();
  forwarded.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    const exited = once(child, "exit");
    child.stdin.end();
    await Promise.race([exited, delay(1200)]);
    if (child.exitCode === null) child.kill();
  }
}
