// Included only in the temporary Mac QA frontend by vnc-macos.mjs.
const state = async () =>
  (await fetch(reportURL, { cache: "no-store" })).json();
const report = (stage, extra = {}) =>
  fetch(reportURL, {
    method: "POST",
    body: JSON.stringify({ stage, ...extra }),
  });
const ipc = (name, args = {}) => window.__TAURI_INTERNALS__.invoke(name, args);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, name, timeout = 18000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await read();
    if (result) return result;
    await pause(60);
  }
  throw Error("Timeout: " + name);
}
const stage = (name) =>
  until(async () => (await state()).stages.includes(name), name, 75000);
async function main(cfg) {
  await stage("classic-clipboard-limit");
  for (const [id, port] of [
    ["shell", cfg.sshPort],
    ["files", cfg.sftpPort],
  ]) {
    await ipc("save_host", {
      host: {
        id,
        name: id,
        address: "127.0.0.1",
        port,
        user: "tester",
        authMethod: "password",
        identityFiles: [],
        source: "manual",
        diagnostics: [],
        tags: [],
        hidden: false,
        connection: {
          connectTimeoutSecs: 15,
          keepaliveIntervalSecs: 15,
          keepaliveMax: 3,
        },
        identitiesOnly: false,
        fieldSources: {},
        configuredForwards: [],
      },
    });
  }
  const id = "v5-forward";
  await ipc("save_rule", {
    rule: {
      id,
      name: "V5",
      hostId: "shell",
      serviceProtocol: "vnc",
      kind: "L",
      bindAddress: "127.0.0.1",
      bindPort: cfg.bindPort,
      targetHost: "127.0.0.1",
      targetPort: cfg.forward,
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
  await ipc("start_rule", { id, secret: cfg.shellSecret });
  const runtime = async () =>
    (await ipc("snapshot")).runtimes.find((r) => r.ruleId === id);
  const r = await until(async () => {
    const r = await runtime();
    return r?.fingerprint && r;
  }, "forward fingerprint");
  await ipc("trust_host", { id, runId: r.runId, fingerprint: r.fingerprint });
  await until(
    async () => (await runtime()).status === "listening",
    "forward listening",
  );
  await ipc("open_service", { id, internalVnc: true });
  await stage("background");
  const task = (await state()).background;
  await until(
    async () =>
      (await ipc("file_snapshot")).tasks.find((t) => t.id === task)?.phase ===
      "completed",
    "background transfer",
  );
  await report("background-complete");
  await ipc("show_main_window");
  const fileSession = await ipc("file_connect", {
    request: { hostId: "files", secrets: { files: cfg.fileSecret } },
  });
  const phase = async () => (await ipc("file_snapshot")).sessions.find(s => s.id === fileSession)?.phase;
  await until(async () => await phase() === "connected", "connected file browser before deletion");
  const tab = await until(() => [...document.querySelectorAll("[role=tab]")].find(
    el => ["SSH 主机", "SSH hosts"].includes(el.textContent.trim())), "hosts tab");
  tab.click();
  const openDelete = async () => {
    const button = await until(() => document.querySelector('.hosts-page button[aria-label$=" files"] .lucide-trash-2')?.closest("button"), "delete fixture host");
    button.click();
    return until(() => [...document.querySelectorAll("[role=dialog]")].find(
      el => el.textContent.includes("停止服务并删除") || el.textContent.includes("Stop services and delete")), "stop-and-delete confirmation");
  };
  let dialog = await openDelete();
  const clickAction = (d, labels) => [...d.querySelectorAll("button")].find(b => labels.includes(b.textContent.trim())).click();
  clickAction(dialog, ["取消", "Cancel"]);
  await until(() => !dialog.isConnected, "deletion cancelled");
  if (await phase() !== "connected" || !(await ipc("snapshot")).addedHostIds.includes("files"))
    throw Error("Cancelling host deletion changed the session");
  dialog = await openDelete();
  clickAction(dialog, ["停止服务并删除", "Stop services and delete"]);
  await until(async () => !(await ipc("snapshot")).addedHostIds.includes("files"), "host removed after confirmation");
  if (await phase() === "connected" || !(await ipc("snapshot")).addedHostIds.includes("shell"))
    throw Error("Unexpected session or host after deletion");
  await report("connected-host-delete");
  await stage("surviving-terminal");
  await ipc("delete_rule", { id });
  const clickUndo = async (page) => {
    const button = await until(() => [...document.querySelectorAll(page + " button")].find(
      el => /^(撤销删除|Undo deletion)\s*1$/.test(el.textContent.trim()) && !el.disabled), page + " undo");
    button.click();
  };
  await clickUndo(".hosts-page");
  await until(async () => {
    const s = await ipc("snapshot");
    return s.addedHostIds.includes("files") && !s.rules.some(r => r.id === id)
      && s.hostUndoCount === 0 && s.forwardUndoCount === 1;
  }, "host undo leaves the forward deleted");
  const forwards = await until(() => [...document.querySelectorAll("[role=tab]")].find(
    el => ["转发", "Forwards"].includes(el.textContent.trim())), "forwards tab");
  forwards.click();
  await clickUndo(".tunnels-page");
  await until(async () => {
    const s = await ipc("snapshot");
    return s.rules.some(r => r.id === id && !r.autoConnect) && !s.forwardUndoCount && !s.hostUndoCount;
  }, "forward undo restores the stopped forward");
  await report("page-scoped-undo");

}
async function performanceCheck(width) {
  const screen = await until(() => {
    const c = document.querySelector("[data-vnc-screen]");
    return (
      Number(c?.dataset.remoteWidth) === width &&
      c.getContext("2d").getImageData(1, 1, 1, 1).data[0] === 77 &&
      c
    );
  }, "performance framebuffer");
  const read = () => screen.getContext("2d").getImageData(1, 1, 1, 1).data[0];
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const mode = (value) => report("workload", { width, mode: value });
  const rates = {};
  for (const value of ["small", "scroll", "full"]) {
    await mode(value);
    await pause(200);
    let last = read(),
      count = 0;
    const start = performance.now();
    while (performance.now() - start < 1500) {
      await frame();
      const next = read();
      if (next !== last) {
        last = next;
        count++;
      }
    }
    if (count === 0)
      throw Error("No visible " + value + " updates at " + width);
    rates[value] =
      Math.round((count * 10000) / (performance.now() - start)) / 10;
    await mode("idle");
    await pause(150);
  }
  await mode("echo");
  screen.focus();
  const r = screen.getBoundingClientRect();
  const latency = [];
  for (let i = 0; i < 7; i++) {
    const before = read(),
      start = performance.now();
    screen.dispatchEvent(
      new PointerEvent(
        "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove",
        { bubbles: true, clientX: r.x + 60 + i * 5, clientY: r.y + 50 },
      ),
    );
    while (read() === before) {
      if (performance.now() - start > 3000)
        throw Error("missing RFB pointer echo");
      await frame();
    }
    latency.push(Math.round(performance.now() - start));
  }
  await report("perf-" + width, {
    rates,
    latency,
    canvas: [screen.width, screen.height],
    ratio: devicePixelRatio,
  });
  await ipc("vnc_window_action", { action: "close" });
}
async function openTerminal(cfg, choose) {
  document
    .querySelector(".app-titlebar .lucide-terminal")
    ?.closest("button")
    ?.click();
  if (choose) {
    const picker = await until(
      () => document.querySelector("[role=dialog] [role=combobox]"),
      "choose a host for the link",
    );
    picker.focus();
    picker.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
    const item = await until(
      () =>
        [...document.querySelectorAll("[role=option]")].find(
          (e) => e.querySelector("strong")?.textContent === "shell",
        ),
      "loopback SSH option",
    );
    item.click();
  }
  // The first viewer remembers the fixture's SSH password. The second
  // opens the same host without submitting another credential.
  if (!choose) {
    const pass = await until(
      () => document.querySelector("[role=dialog] input[type=password]"),
      "terminal password",
    );
    if (pass.closest("[role=dialog]").querySelector('[role=alert]') ||
        (await ipc("terminal_sessions")).every(s => s.phase !== "credentialsRequired"))
      throw Error("Initial terminal password prompt was treated as a failure");
    const remember = await until(
      () => pass.closest("form").querySelector("input[type=checkbox]"),
      "terminal remember password",
    );
    remember.click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
      pass,
      cfg.shellSecret,
    );
    pass.dispatchEvent(new Event("input", { bubbles: true }));
    pass.closest("form").requestSubmit();
  }
  const terminal = await until(
    async () =>
      (await ipc("terminal_sessions")).find((s) => s.phase === "running"),
    "PTY",
  );
  await ipc("terminal_input", {
    id: terminal.id,
    clientId: terminal.clientId,
    sequence: 1,
    bytes: Array.from(new TextEncoder().encode("echo ORIA_$((19+23))\r")),
  });
  await until(
    () =>
      document.querySelector(".xterm-rows")?.textContent.includes("ORIA_42"),
    "shell output",
  );
  return terminal;
}
async function viewer(cfg) {
  const endpoint = await ipc("vnc_endpoint");
  const port = Number(endpoint.split(":").at(-1));
  const display = cfg.displays.find((d) => d.port === port);
  if (display) return performanceCheck(display.width);
  const kind =
    port === cfg.bindPort ? "forward" : port === cfg.direct ? "direct" : "warm";
  if (kind === "warm" || kind === "direct") {
    async function password(value) {
      const field = await until(
        () => document.querySelector(".vnc-password input[type=password]"),
        "VNC password form",
      );
      field.value = value;
      const toggle = field.form.querySelector('button[aria-controls="vnc-password"]');
      toggle.click();
      await until(() => field.type === "text" && field.value === value, "show password");
      toggle.click();
      await until(() => field.type === "password" && field.value === value, "hide password");
      field.form.requestSubmit();
    }
    if (kind === "warm") {
      await password("wrong");
      const retry = await until(
        () => document.querySelector(".vnc-status button"),
        "VNC retry",
      );
      retry.click();
    }
    await password(cfg.password);
  }
  const start = performance.now();
  const screen = await until(() => {
    const c = document.querySelector("canvas[data-vnc-screen]");
    return (
      c?.dataset.remoteWidth === (kind === "direct" ? "6016" : "320") &&
      c.getContext("2d").getImageData(1, 1, 1, 1).data[0] === 77 &&
      c
    );
  }, kind + " canvas");
  const r = screen.getBoundingClientRect();
  screen.focus();
  const motion =
    "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove";
  screen.dispatchEvent(
    new PointerEvent(motion, {
      bubbles: true,
      clientX: r.x + r.width / 2,
      clientY: r.y + r.height / 2,
    }),
  );
  for (const type of ["keydown", "keyup"])
    screen.dispatchEvent(
      new KeyboardEvent(type, { key: "a", code: "KeyA", bubbles: true }),
    );
  await report(kind + "-frame", {
    label: window.__TAURI_INTERNALS__.metadata.currentWindow.label,
    ratio: devicePixelRatio,
    desktop: [screen.dataset.remoteWidth, screen.dataset.remoteHeight],
    css: [r.width, r.height],
    canvas: [screen.width, screen.height],
    firstPixelMs: Math.round(performance.now() - start),
  });
  if (kind === "warm") {
    const zoomOut = document
      .querySelector(".app-titlebar .lucide-zoom-out")
      .closest("button");
    for (let i = 0; i < 8 && screen.getBoundingClientRect().width > 321; i++) {
      zoomOut.click();
      await pause(50);
    }
    const actual = screen.getBoundingClientRect();
    if (Math.abs(actual.width - 320) > 1) throw Error("100% zoom mismatch");
    screen.focus();
    screen.dispatchEvent(
      new PointerEvent(motion, {
        bubbles: true,
        clientX: actual.x + 80,
        clientY: actual.y + 60,
      }),
    );
    document
      .querySelector(".app-titlebar .lucide-scan")
      .closest("button")
      .click();
    await until(
      () => screen.getBoundingClientRect().width > 320,
      "restore fit",
    );
    const more = document
      .querySelector(".app-titlebar .lucide-ellipsis")
      .closest("button");
    more.click();
    const special = await until(
      () =>
        [...document.querySelectorAll("[role=menuitem]")].find((item) =>
          /Ctrl.*Alt.*Del/i.test(item.textContent),
        ),
      "VNC menu",
    );
    special.click();
    const toggle = document.querySelector(
      "[data-window-active] button:last-child",
    );
    toggle.click();
    await until(
      () =>
        document.querySelector("[data-viewer-fullscreen]") &&
        innerWidth > r.width + 100,
      "native fullscreen",
    );
    await pause(700);
    toggle.click();
    await until(
      async () =>
        !(await ipc("vnc_window_action", { action: "isFullscreen" })) &&
        Math.abs(innerWidth - r.width) < 100,
      "restore window",
    );
    screen.focus();
    const data = new DataTransfer();
    data.setData("text/plain", "中文");
    screen.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData: data }),
    );
    await until(
      () =>
        document.querySelector(".vnc-error")?.textContent.includes("Latin-1"),
      "classic clipboard feedback",
    );
    await report("classic-clipboard-limit");
  }
  if (kind === "warm") return;
  if (kind === "direct") {
    await stage("terminal-output");
    const terminal = await openTerminal(cfg, true);
    await report("direct-terminal");
    await ipc("plugin:window|set_focus", {
      label: (await state()).labels["forward-frame"],
    });
    await stage("background-complete");
    await ipc("terminal_input", {
      id: terminal.id,
      clientId: terminal.clientId,
      sequence: 2,
      bytes: Array.from(new TextEncoder().encode("echo ALIVE_$((20+23))\r")),
    });
    await until(
      () =>
        document.querySelector(".xterm-rows")?.textContent.includes("ALIVE_43"),
      "surviving PTY",
    );
    await report("surviving-terminal");
    return;
  }
  const denied = async () => {
    throw new DOMException("Clipboard denied", "NotAllowedError");
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: denied, write: denied, writeText: denied },
  });
  const key = (code, modifiers) =>
    screen.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: code.slice(-1).toLowerCase(),
        code,
        ...modifiers,
        bubbles: true,
      }),
    );
  screen.focus();
  key("KeyC", { metaKey: true });
  const copied = await until(
    () => document.querySelector(".vnc-desktop > textarea[readonly]"),
    "manual copy",
  );
  if (copied.value !== "V5 手动\ncopy") throw Error("manual copy mismatch");
  copied.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await until(() => document.activeElement === screen, "canvas focus");
  // Ctrl+V is the alternate readText shortcut. Cmd+V receives a native paste event.
  key("KeyV", { ctrlKey: true });
  const field = await until(
    () => document.querySelector(".vnc-desktop > textarea:not([readonly])"),
    "manual paste",
  );
  const data = new DataTransfer();
  data.setData("text/plain", "V5 手动\npaste");
  field.dispatchEvent(
    new ClipboardEvent("paste", { bubbles: true, clipboardData: data }),
  );
  delete navigator.clipboard;
  await report("manual-clipboard");
  await openTerminal(cfg, false);
  await report("terminal-output");
  await ipc("plugin:window|set_focus", {
    label: (await state()).labels["direct-frame"],
  });
  await stage("direct-terminal");
  const filesButton = document
    .querySelector(".app-titlebar .lucide-folder-sync")
    .closest("button");
  filesButton.click();
  // Select the SFTP fixture as soon as the panel opens on its default host.
  await until(
    async () =>
      (await ipc("file_snapshot")).sessions.some((s) => s.hostId === "shell"),
    "file panel opened on the rule host",
  );
  const picker = document.querySelectorAll(".files-host-select")[1];
  picker.focus();
  picker.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const option = await until(
    () =>
      [...document.querySelectorAll("[role=option]")].find(
        (e) => e.textContent.trim() === "files",
      ),
    "SFTP host option",
  );
  option.click();
  const trust = await until(
    () =>
      document
        .querySelector("[role=dialog] code")
        ?.parentElement.querySelector("button"),
    "SFTP fingerprint",
  );
  trust.click();
  let field2 = await until(
    () => document.querySelector("[role=dialog] input[type=password]"),
    "SFTP password",
  );
  const dialog = field2.closest("[role=dialog]");
  if (
    (dialog.textContent.match(/\bfiles\b/g) || []).length !== 1 ||
    !field2.labels?.length
  ) throw Error("Duplicate or missing file authentication label");
  const failureToast = () => [...document.querySelectorAll('[data-slot=toast-content]')].some(
    el => /身份认证失败|authentication failed/i.test(el.textContent));
  if (dialog.querySelector('[role=alert]') || failureToast())
    throw Error("Initial SFTP password prompt was treated as a failure");
  const fillPassword = (field, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  fillPassword(field2, cfg.fileSecret + "-rejected");
  [...dialog.querySelectorAll("button")].find(b => ["连接", "Connect"].includes(b.textContent.trim())).click();
  field2 = await until(() => {
    const retry = document.querySelector("[role=dialog] [role=alert]");
    return retry?.closest("[role=dialog]").querySelector("input[type=password]");
  }, "wrong SFTP password shown inside retry dialog");
  if (failureToast()) throw Error("Duplicate SFTP authentication error toast");
  const remember = await until(
    () => field2.closest("[role=dialog]").querySelector("input[type=checkbox]"),
    "SFTP remember password",
  );
  remember.click();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
    field2,
    cfg.fileSecret,
  );
  field2.dispatchEvent(new Event("input", { bubbles: true }));
  const connect = await until(
    () =>
      [...field2.closest("[role=dialog]").querySelectorAll("button")].find(
        (b) => ["连接", "Connect"].includes(b.textContent.trim()),
      ),
    "SFTP connect",
  );
  connect.click();
  const sid = await until(
    async () =>
      (await ipc("file_snapshot")).sessions.find(
        (s) => s.hostId === "files" && s.phase === "connected",
      )?.id,
    "SFTP",
  );
  for (const id of ["shell", "files"]) {
    const [status] = await ipc("password_status", { ids: [id] });
    if (!status?.saved || status.error)
      throw Error("Missing saved fixture credential: " + id);
  }
  const reused = await ipc("file_connect", {
    request: { hostId: "files", secrets: {}, rememberHostIds: [] },
  });
  await until(
    async () => (await ipc("file_snapshot")).sessions.some(
      (s) => s.id === reused && s.phase === "connected",
    ),
    "SFTP saved password reconnect",
  );
  await ipc("file_disconnect", { id: reused });
  for (const id of ["shell", "files"]) {
    await ipc("clear_password", { id });
    if ((await ipc("password_status", { ids: [id] }))[0]?.saved !== false)
      throw Error("Fixture credential not cleared");
  }
  await report("ssh-password-reuse");
  document
    .querySelector(".files-workspace .workspace-panel-actions .lucide-x")
    .closest("button")
    .click();
  filesButton.click();
  await until(
    () =>
      document
        .querySelectorAll(".files-host-select")[1]
        ?.textContent.includes("files"),
    "restore file panel",
  );
  const remote = () => ipc("file_list", { session: sid, path: "/" });
  const submit = (sources, target) =>
    ipc("file_submit", { requestId: crypto.randomUUID(), sources, target });
  const sources = (name) =>
    ipc("file_sources", { paths: [cfg.run + "/" + name] });
  const task = async (id) =>
    (await ipc("file_snapshot")).tasks.find((t) => t.id === id);
  const done = (id) =>
    until(async () => {
      const t = await task(id);
      if (
        t &&
        [
          "failed",
          "conflict",
          "cancelled",
          "interrupted",
          "partial",
          "paused",
        ].includes(t.phase)
      ) {
        throw Error(
          "SFTP " + t.direction + " " + t.phase + " " + (t.error ?? ""),
        );
      }
      return t?.phase === "completed";
    }, "file complete");
  const dest = (await remote()).id;
  await done(await submit(await sources("sample.bin"), dest));
  const sample = (await remote()).entries.find((e) => e.name === "sample.bin");
  await done(
    await submit(
      [sample.id],
      (await ipc("file_list", { path: cfg.run + "/download" })).id,
    ),
  );
  await report("round-trip");
  const id = await submit(await sources("background.bin"), dest);
  if ((await task(id)).phase === "completed")
    throw Error("background file completed before close");
  await report("background", { id });
  await ipc("vnc_window_action", { action: "close" });
}
try {
  const cfg = await state();
  if (window.__TAURI_INTERNALS__.metadata.currentWindow.label === "main")
    await main(cfg);
  else await viewer(cfg);
} catch (error) {
  await report("failed", { error: String(error) });
}
