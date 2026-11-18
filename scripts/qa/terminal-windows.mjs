// Run against the embedded debug build. Each run has its own app and WebView data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { control, port, until } from "./vnc-native-control.mjs";

assert.equal(process.platform, "win32");
const root = path.resolve("outputs/terminal-windows");
fs.mkdirSync(root, { recursive: true });
const profile = fs.mkdtempSync(path.join(root, "run-"));
const data = path.join(profile, "data");
fs.mkdirSync(data);
const prior = "Write-Output 'Oria prior command'";
fs.writeFileSync(path.join(data, "ConsoleHost_history.txt"), prior + "\r\n");
const sshConfig = path.join(profile, "ssh_config");
fs.writeFileSync(sshConfig, "");
const debug = await port();
const app = spawn(
  path.resolve(
    process.env.ORIA_QA_EXE || "src-tauri/target/debug/oria-tunnel.exe",
  ),
  [],
  {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ORIATUNNEL_TEST_DATA_DIR: data,
      ORIATUNNEL_TEST_SSH_CONFIG: sshConfig,
      WEBVIEW2_USER_DATA_FOLDER: path.join(profile, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + debug,
    },
  },
);
let page;
try {
  page = await control(debug, (p) => p.url.includes("tauri.localhost"));
  const { evaluate, command } = page;
  await command("Page.bringToFront", {});
  const invoke = (name, args = {}) =>
    evaluate(
      "window.__TAURI_INTERNALS__.invoke(" +
        JSON.stringify(name) +
        "," +
        JSON.stringify(args) +
        ")",
    );
  const sessions = () => invoke("terminal_sessions");
  const click = async (selector) => {
    const query = "document.querySelector(" + JSON.stringify(selector) + ")";
    await until(() => evaluate("!!" + query + "?.offsetWidth"), selector);
    await evaluate(query + ".click()");
  };
  const screen = () =>
    evaluate("document.querySelector('.xterm-rows')?.textContent || ''");
  await until(
    () => evaluate("!!document.querySelector('.app-titlebar')"),
    "main window",
  );
  const welcome = `[...document.querySelectorAll('[role=dialog] button')].find(
    b => /开始使用|Get started/i.test(b.textContent))`;
  await until(() => evaluate("!!" + welcome), "initial preferences");
  await evaluate(welcome + ".click()");
  await until(
    () => evaluate("!document.querySelector('[role=dialog]')"),
    "preferences closed",
  );
  await invoke("plugin:event|emit", {
    event: "tunnel://open-terminal",
    payload: {},
  });
  const local = '[data-terminal-start] [data-terminal-target=""]';
  const closeTab = ".terminal-tab-entry button:last-child";
  const confirm = "[role=dialog] button.text-destructive";
  await click(local);
  const edit = ".shell-edit textarea";
  const q = (s) => "document.querySelector(" + JSON.stringify(s) + ")";
  const exists = (s) => evaluate("!!" + q(s) + "?.offsetWidth");
  const key = async (name, code) => {
    for (const type of ["keyDown", "keyUp"])
      await command("Input.dispatchKeyEvent", {
        type,
        key: name,
        code: name,
        windowsVirtualKeyCode: code,
      });
  };
  const setDraft = async (line) => {
    await until(() => exists(edit), "integrated PowerShell prompt");
    await evaluate(q(edit) + ".focus()");
    await evaluate(`(() => {const el = ${q(edit)};
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(line)});
      el.dispatchEvent(new Event("input",{bubbles:true}));})()`);
  };
  const run = async (line) => {
    await setDraft(line);
    await evaluate(
      q(edit) +
        ".dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))",
    );
  };
  const output = () =>
    evaluate(
      "[...document.querySelectorAll('.shell-output-text')].at(-1)?.textContent || ''",
    );
  await until(() => exists(edit), "integrated PowerShell prompt");
  const accessibleTree = q(".xterm-accessibility-tree");
  assert.ok(await evaluate(accessibleTree + " === null"));
  assert.equal(await evaluate(q(".shell-edit > span") + ".textContent"), ">");
  await setDraft("Write-Output 'Oria prior");
  await until(
    () => evaluate(q(".shell-ghost") + '?.textContent === " command\'"'),
    "previous PowerShell history",
  );
  const [session] = await sessions();
  await setDraft("PiN");
  await until(
    () => evaluate("!!" + q(".shell-ghost") + "?.textContent"),
    "inline native executable hint",
  );
  assert.equal(await exists(".shell-candidates"), false);
  await key("Tab", 9);
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('[data-mode=complete] [role=option]')].some(el => /^ping\\.exe$/i.test(el.textContent.trim()))",
      ),
    "native executable suggestions",
  );
  await key("Escape", 27);
  assert.equal(await exists(".shell-candidates"), false);
  await setDraft("write-output 'oria prior");
  await key("ArrowUp", 38);
  await until(
    () => evaluate(q(edit) + ".value === " + JSON.stringify(prior)),
    "case-insensitive history preview",
  );
  await key("Escape", 27);
  assert.ok(
    session.local &&
      session.phase === "running" &&
      /(?:powershell|pwsh)\.exe$/i.test(session.endpoint),
  );
  await run("1900 + 73");
  await until(
    async () => (await output()).trim() === "1973",
    "archived calculated output",
  );
  assert.equal(
    await evaluate(q(".shell-block .shell-command") + ".textContent"),
    "> 1900 + 73",
  );
  assert.equal(await output(), "1973");
  await run("ping 127.0.0.1 -n 2");
  await until(
    async () => (await screen()).includes("127.0.0.1"),
    "live ping output",
  );
  const gap = await evaluate(`(() => {
    const row = [...document.querySelector('.xterm-rows').children].find(el => el.textContent.includes("127.0.0.1"));
    const header = document.querySelector('.shell-current-block .shell-command');
    return (row.getBoundingClientRect().top - header.getBoundingClientRect().bottom) / row.clientHeight;
  })()`);
  assert.ok(gap >= 0 && gap < 2, "live ping gap (rows): " + gap);
  const size = await evaluate("({width: innerWidth, height: innerHeight})");
  await command("Emulation.setDeviceMetricsOverride", {
    width: Math.max(400, size.width - 80),
    height: Math.max(320, size.height - 90),
    deviceScaleFactor: 0,
    mobile: false,
  });
  await until(
    async () => (await output()).includes("127.0.0.1"),
    "ping output",
  );
  const ping = await output();
  assert.match(ping, /^\n\S.*127\.0\.0\.1/u);
  assert.equal(ping.match(/127\.0\.0\.1/gu)?.length, 4);
  await command("Emulation.clearDeviceMetricsOverride", {});
  await run("'', '', '  indented', '', 'last'");
  await until(
    async () => (await output()).endsWith("last"),
    "intentional spacing",
  );
  assert.equal(await output(), "\n\n  indented\n\nlast");
  await run("$a = '中文'; $a + '完成'");
  await until(
    async () => (await output()).trim() === "中文完成",
    "Unicode output",
  );
  await run("$a.Length");
  await until(
    async () => (await output()).trim() === "2",
    "persistent shell variable",
  );
  await key("ArrowUp", 38);
  await until(
    () => exists("[data-mode=history] [role=option]"),
    "command history",
  );
  await key("Escape", 27);
  await setDraft("get-childite");
  await until(
    () =>
      evaluate("!!document.querySelector('.shell-ghost')?.textContent.trim()"),
    "inline completion",
  );
  await key("ArrowRight", 39);
  assert.equal(
    (await evaluate(q(edit) + ".value")).toLowerCase(),
    "get-childitem",
  );
  const dir = path.join(profile, "子目录 test");
  fs.mkdirSync(dir);
  const quoted = (p) => "'" + p.replaceAll("'", "''") + "'";
  await run("Set-Location -LiteralPath " + quoted(profile));
  await until(
    () =>
      evaluate(
        q("[aria-current=location]") + "?.title === " + JSON.stringify(profile),
      ),
    "PowerShell cwd",
  );
  await setDraft("cd 子");
  await key("Tab", 9);
  await until(
    () => exists("[data-mode=complete] [role=option]"),
    "directory completion",
  );
  await key("Enter", 13);
  assert.equal(await evaluate(q(edit) + ".value"), "cd '子目录 test\\'");
  await key("Enter", 13);
  await until(
    () =>
      evaluate(
        q("[aria-current=location]") + "?.title === " + JSON.stringify(dir),
      ),
    "quoted completion executed",
  );
  await setDraft("pending");
  await click("[aria-current=location]");
  await click(".shell-directory [role=option]");
  await until(
    () =>
      evaluate(
        q("[aria-current=location]") + "?.title === " + JSON.stringify(profile),
      ),
    "directory picker parent",
  );
  assert.equal(await evaluate(q(edit) + ".value"), "pending");
  const openDrives = async () => {
    await click("[aria-current=location]");
    await click(".shell-directory [role=option]:has(.lucide-monitor)");
    await until(
      () => exists(".shell-directory [role=option][title]"),
      "drive roots",
    );
  };
  await openDrives();
  const drives = await evaluate(
    "[...document.querySelectorAll('.shell-directory [role=option][title]')].map(el => el.title)",
  );
  const currentRoot = path.parse(profile).root;
  assert.ok(drives.includes(currentRoot));
  const otherRoot = drives.find(
    (root) => root !== currentRoot && fs.existsSync(root),
  );
  for (const root of [...(otherRoot ? [otherRoot] : []), currentRoot]) {
    if (!(await exists(".shell-directory [role=option][title]")))
      await openDrives();
    await evaluate(
      `[...document.querySelectorAll('.shell-directory [role=option]')].find(el => el.title === ${JSON.stringify(root)}).click()`,
    );
    await until(
      () =>
        evaluate(
          q("[aria-current=location]") + "?.title === " + JSON.stringify(root),
        ),
      "drive selected",
    );
    assert.equal(await evaluate(q(edit) + ".value"), "pending");
  }
  await run("(Get-Location).ProviderPath");
  await until(
    async () => (await output()) === currentRoot,
    "shell drive changed",
  );
  await setDraft("6 * 7");
  await key("ArrowDown", 40);
  const save = "[data-save-command-popover] form";
  await until(() => exists(save), "save command popover");
  await evaluate(q(save + " input") + ".focus()");
  await command("Input.insertText", { text: "乘法" });
  await until(
    () => evaluate("!" + q(save + " button[type=submit]") + ".disabled"),
    "keyword entered",
  );
  await evaluate(q(save) + ".requestSubmit()");
  await until(
    async () =>
      (await invoke("saved_terminal_commands")).entries.some(
        (e) => e.command === "6 * 7",
      ),
    "saved command",
  );
  await setDraft("乘法");
  await click("[data-mode=saved] [role=option]");
  assert.equal(await evaluate(q(edit) + ".value"), "6 * 7");
  await setDraft("6 *");
  assert.equal(await exists(".shell-candidates"), false);
  await key("Tab", 9);
  await click("[data-mode=complete] [role=option]");
  await key("Enter", 13);
  await until(
    async () => (await output()).trim() === "42",
    "execute recalled command",
  );
  await run("1..120");
  await until(
    async () => (await output()).trim().endsWith("\n120"),
    "long output",
  );
  assert.equal(
    await output(),
    Array.from({ length: 120 }, (_, i) => i + 1).join("\n"),
  );
  const foldLast = () =>
    evaluate("[...document.querySelectorAll('.shell-fold')].at(-1).click()");
  await foldLast();
  await until(() => exists(".shell-summary"), "fold command");
  assert.equal(
    await evaluate(q(".shell-summary") + ".textContent"),
    "> 1..120",
  );
  // Capture this WebView's clipboard write without modifying the system clipboard.
  await evaluate(
    "Object.defineProperty(navigator.clipboard, 'writeText', {value: async text => {window.qaCopy = text}})",
  );
  await evaluate(`const more = [...document.querySelectorAll('.shell-block .shell-block-more')].at(-1);
    for (const type of ["mousedown", "mouseup", "click"]) more.dispatchEvent(new MouseEvent(type, {bubbles:true, cancelable:true, button:0}));`);
  await click("[data-terminal-block-menu] [data-copy=all]");
  assert.equal(
    await evaluate("window.qaCopy"),
    "> 1..120\n" + Array.from({ length: 120 }, (_, i) => i + 1).join("\n"),
  );
  await foldLast();
  await run("$part = 'multi'\n$part + 'line'");
  await until(
    async () => (await output()).trim() === "multiline",
    "multiline command",
  );
  await run("Read-Host 'QA_INPUT'");
  await until(
    async () => (await screen()).includes("QA_INPUT"),
    "raw interactive input",
  );
  await until(
    () => evaluate(accessibleTree + "?.textContent.includes('QA_INPUT')"),
    "foreground output is exposed to screen readers",
  );
  assert.equal(
    await evaluate(q(".shell-current-block .shell-command") + ".textContent"),
    "> Read-Host 'QA_INPUT'",
  );
  await click(closeTab);
  await until(() => exists(confirm), "foreground close confirmation");
  await key("Escape", 27);
  await until(async () => !(await exists(confirm)), "cancel close");
  await evaluate(`const rawInput = document.querySelector('.xterm-helper-textarea'); rawInput.focus();
    const data = new DataTransfer(); data.setData("text/plain","interactive-ok");
    rawInput.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,clipboardData:data}));`);
  await until(
    async () => (await screen()).includes("interactive-ok"),
    "foreground echo",
  );
  await command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    text: "\r",
  });
  await command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await until(
    async () => (await output()).includes("interactive-ok"),
    "returned to prompt",
  );
  await run("Set-PSReadLineOption -HistorySaveStyle SaveNothing");
  await run("'QA-memory-only'");
  await until(
    async () => (await output()) === "QA-memory-only",
    "memory-only command",
  );
  await run("exit 7");
  await until(
    async () =>
      (await sessions()).some(
        (s) => s.id === session.id && s.phase === "exited" && s.exitCode === 7,
      ),
    "exit status",
  );
  await click(closeTab);
  await click(local);
  await until(() => exists(edit), "second prompt");
  assert.ok(
    !fs
      .readFileSync(path.join(data, "ConsoleHost_history.txt"), "utf8")
      .includes("QA-memory-only"),
  );
  await setDraft("$A.len");
  await until(
    () => evaluate(q(".shell-ghost") + "?.textContent === 'gth'"),
    "inline restored history",
  );
  assert.equal(await exists(".shell-candidates"), false);
  await key("ArrowUp", 38);
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('[data-mode=history] [role=option]')].some(el => el.textContent.trim() === '$a.Length')",
      ),
    "history across terminal sessions",
  );
  await click(closeTab);
  await until(async () => (await sessions()).length === 0, "idle close");
  console.log(
    "Verified PowerShell output spacing, live resize, drive navigation, commands, history, completion, saved commands, folding, foreground input, exit and close.",
  );
  fs.writeFileSync(
    path.join(profile, "result.json"),
    JSON.stringify(
      { passed: true, shell: session.endpoint, exitCode: 7 },
      null,
      2,
    ),
  );
  await invoke("quit_app");
  await until(() => app.exitCode !== null, "isolated app exited");
} finally {
  page?.socket.close();
  if (app.exitCode === null) app.kill();
}
