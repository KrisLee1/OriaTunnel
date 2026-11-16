// Build a disposable .app with the production UI and a fixed, local WKWebView probe.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { framebuffer } from "./vnc-workspace-rfb.mjs";
import { port, until } from "./vnc-native-control.mjs";

assert.equal(process.platform, "darwin");
const root = path.resolve("outputs/vnc-v5");
fs.mkdirSync(root, { recursive: true });
const run = fs.mkdtempSync(path.join(root, "native-"));
console.log(run);
const appName = "OriaTunnel V5 " + path.basename(run);
const bundleId = "com.oria-tunnel.v5." + path.basename(run).toLowerCase();
const build = path.resolve("src-tauri/target/debug");
const intel = process.argv.includes("--intel");
const built = path.join(
  intel ? path.resolve("src-tauri/target/x86_64-apple-darwin/debug") : build,
  "bundle/macos",
  appName + ".app",
);
const temporary = fs.mkdtempSync("/private/tmp/oria-vnc-v5-");
const app = path.join(temporary, appName + ".app");
const executablePattern =
  "^" +
  (app + "/Contents/MacOS/oria-tunnel").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
  "$";
const sshConfig = path.join(temporary, "empty-ssh");
fs.writeFileSync(sshConfig, "");
const systemHandler = () =>
  execFileSync(
    "swift",
    [
      "-e",
      'import AppKit; let url = URL(string:"vnc://127.0.0.1/")!; print(NSWorkspace.shared.urlForApplication(toOpen:url)?.path ?? "")',
    ],
    { encoding: "utf8" },
  ).trim();
const initialHandler = systemHandler();
const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const isCandidate = () =>
  execFileSync(
    "swift",
    [
      "-e",
      `
    import AppKit
    let app = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let choices = NSWorkspace.shared.urlsForApplications(toOpen: URL(string: "vnc://127.0.0.1/")!)
    print(choices.contains { $0.resolvingSymlinksInPath().path == app.path })
  `,
      built,
    ],
    { encoding: "utf8" },
  ).trim() === "true";
const children = [];
const reports = [];
async function fixture(exe, args, match) {
  const p = spawn(exe, args, { stdio: ["pipe", "pipe", "inherit"] });
  children.push(p);
  let output = "";
  p.stdout.on("data", (b) => {
    output += b;
  });
  return until(() => {
    assert.equal(p.exitCode, null, "loopback fixture exited");
    return Number(match.exec(output)?.[1]);
  }, "loopback fixture");
}
const password = randomBytes(4).toString("hex");
const direct = await framebuffer({ apple: true, password, width: 6016, height: 3384 }),
  warm = await framebuffer({ password, classic: true }),
  forward = await framebuffer();
const displays = [];
for (const [width, height] of [
  [1920, 1080],
  [3840, 2160],
]) {
  displays.push({ width, height, rfb: await framebuffer({ width, height }) });
}
function rectangle(x, y, w, h, encoding = 0) {
  const buffer = Buffer.alloc(12);
  [x, y, w, h].forEach((n, i) => buffer.writeUInt16BE(n, i * 2));
  buffer.writeInt32BE(encoding, 8);
  return buffer;
}
function workload(display, mode) {
  const { width, height, rfb } = display;
  const peer = rfb.peers.find((p) => p.ready && !p.socket.destroyed);
  peer.onRequest = undefined;
  peer.onPointer = undefined;
  if (mode === "idle") return;
  const full = mode === "full";
  const scroll = mode === "scroll";
  const size = full ? width : 32,
    rows = full ? height : 32;
  const rect = rectangle(0, 0, size, rows);
  const pixels = [
    Buffer.alloc(size * rows * 4, 65),
    Buffer.alloc(size * rows * 4, 185),
  ];
  const scrollRect = rectangle(0, 0, width, height - 8, 1);
  const strip = rectangle(0, height - 8, width, 8);
  const bottom = Buffer.alloc(width * 8 * 4, 120);
  let sequence = 0;
  function send() {
    const data = pixels[sequence % 2];
    sequence = (sequence % 239) + 1;
    // Each painted update contains a fresh serial in the 32x32 sampling area.
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) data[(y * size + x) * 4] = sequence;
    peer.socket.cork();
    peer.socket.write(Buffer.from([0, 0, 0, scroll ? 3 : 1]));
    if (scroll) {
      for (const b of [scrollRect, Buffer.from([0, 0, 0, 8]), strip, bottom])
        peer.socket.write(b);
    }
    peer.socket.write(rect);
    peer.socket.write(data);
    peer.socket.uncork();
  }
  if (mode === "echo") peer.onPointer = send;
  else {
    peer.onRequest = send;
    send();
  }
}
const token = randomUUID();
const server = http.createServer();
let failure;
try {
  const sshPort = await fixture(
    path.join(build, "examples/terminal_fixture"),
    [],
    /ISOLATED_SSH_PORT=(\d+)/,
  );
  const test = fs
    .readdirSync(path.join(build, "deps"))
    .filter((n) => /^oria_tunnel_lib-[a-f0-9]+$/.test(n))
    .sort(
      (a, b) =>
        fs.statSync(path.join(build, "deps", b)).mtimeMs -
        fs.statSync(path.join(build, "deps", a)).mtimeMs,
    )[0];
  const sftpPort = await fixture(
    path.join(build, "deps", test),
    [
      "files::tests::serve_workspace_fixture",
      "--exact",
      "--ignored",
      "--nocapture",
    ],
    /ISOLATED_SFTP_PORT=(\d+)/,
  );
  const bindPort = await port();
  const options = {
    displays: displays.map((d) => ({ width: d.width, port: d.rfb.port })),
    direct: direct.port,
    warm: warm.port,
    forward: forward.port,
    sshPort,
    sftpPort,
    bindPort,
    run: temporary,
  };
  const sample = randomBytes(192 * 1024);
  fs.writeFileSync(path.join(temporary, "sample.bin"), sample);
  fs.writeFileSync(
    path.join(temporary, "background.bin"),
    randomBytes(6 * 1024 * 1024),
  );
  fs.mkdirSync(path.join(temporary, "download"));
  // Fixture credentials only travel in memory to the nonce-bound probe.
  const shellSecret = fs
    .readFileSync("src-tauri/tests/common/terminal_server.rs", "utf8")
    .match(/password == "([^"]+)"/)[1];
  const fileSecret = fs
    .readFileSync("src-tauri/src/files/tests.rs", "utf8")
    .match(/if p == "([^"]+)"/)[1];
  server.on("request", async (req, res) => {
    if (req.url !== "/" + token || req.headers.origin !== "tauri://localhost") {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "tauri://localhost");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST") {
      let body = "";
      for await (const data of req) body += data;
      const report = JSON.parse(body);
      if (report.stage === "forward-frame")
        forward.peers.find((p) => p.ready).copySelection = "V5 手动\ncopy";
      if (report.stage === "workload")
        workload(
          displays.find((d) => d.width === report.width),
          report.mode,
        );
      reports.push(report);
      console.log(report);
      if (report.error) failure = Error(report.error);
    }
    res.end(
      JSON.stringify({
        ...options,
        shellSecret,
        fileSecret,
        password,
        labels: Object.fromEntries(
          reports.filter((r) => r.label).map((r) => [r.stage, r.label]),
        ),
        stages: reports.map((r) => r.stage),
        background: reports.find((r) => r.stage === "background")?.id,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const ui = path.join(run, "frontend");
  fs.cpSync("dist", ui, { recursive: true });
  fs.appendFileSync(
    path.join(ui, "index.html"),
    '<script type="module" src="/v5-probe.js"></script>',
  );
  const probe = fs.readFileSync("scripts/qa/vnc-macos-probe.js", "utf8");
  fs.writeFileSync(
    path.join(ui, "v5-probe.js"),
    "const reportURL=" + JSON.stringify(origin + "/" + token) + ";\n" + probe,
  );
  const base = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json"));
  const config = {
    identifier: bundleId,
    productName: appName,
    build: { frontendDist: ui, beforeBuildCommand: "" },
    app: {
      security: {
        csp: base.app.security.csp + " " + origin,
        capabilities: [
          "main",
          {
            identifier: "v5-focus",
            windows: ["vnc-*"],
            permissions: ["core:window:allow-set-focus"],
          },
        ],
      },
    },
  };
  execFileSync(
    "pnpm",
    [
      "tauri",
      "build",
      "--debug",
      ...(intel ? ["--target", "x86_64-apple-darwin"] : []),
      "--bundles",
      "app",
      "--config",
      JSON.stringify(config),
    ],
    { stdio: "inherit" },
  );
  execFileSync("ditto", [built, app]);
  execFileSync("codesign", ["--force", "--sign", "-", app]);
  fs.writeFileSync(path.join(temporary, "app.log"), "");
  const open = (target, first) =>
    execFileSync(
      "/usr/bin/open",
      [
        "-a",
        app,
        ...(first
          ? [
              "--env",
              "ORIATUNNEL_TEST_DATA_DIR=" + path.join(temporary, "data"),
              "--env",
              "ORIATUNNEL_TEST_SSH_CONFIG=" + sshConfig,
              "--stderr",
              path.join(temporary, "app.log"),
            ]
          : []),
        "vnc://127.0.0.1:" + target + "/",
      ],
      { env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME } },
    );
  const stage = (name) =>
    until(
      () => {
        if (failure) throw failure;
        return reports.find((r) => r.stage === name);
      },
      name,
      75000,
    );
  open(direct.port, true);
  await stage("direct-frame");
  if (process.argv.includes("--clipboard")) {
    const peer = direct.peers.find((p) => p.ready);
    const marker = "V5 " + randomUUID() + "\n中英文 clipboard";
    const external = "External " + randomUUID() + "\n外部多行文本";
    const pastes = () =>
      peer.inputs.filter((i) => i.key === 118 && i.down).length;
    peer.copySelection = marker;
    const driver = spawn(
      "swift",
      ["scripts/qa/vnc-macos-clipboard.swift", bundleId, marker, external],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const exited = once(driver, "exit");
    try {
      await until(() => {
        assert.equal(driver.exitCode, null, "native clipboard driver exited");
        return peer.received === marker && peer.pasted;
      }, "native clipboard");
      assert.equal(pastes(), 1);
      driver.stdin.write("received\n");
      await until(() => {
        assert.equal(driver.exitCode, null, "native clipboard driver exited");
        return peer.received === external && pastes() >= 2;
      }, "one Cmd+V from an external pasteboard");
      driver.stdin.end("received external\n");
      assert.equal((await exited)[0], 0);
      assert.equal(pastes(), 2);
      reports.push({ stage: "system-clipboard-round-trip" });
      reports.push({ stage: "external-single-shortcut-paste" });
    } finally {
      driver.stdin.end();
      await exited;
    }
  }
  open(warm.port, false);
  await stage("warm-frame");
  assert.ok(warm.peers.some((p) => p.rejected));
  await stage("classic-clipboard-limit");
  const authenticated = warm.peers.find((p) => p.ready);
  assert.ok(authenticated.inputs.some((i) => i.x === 80 && i.y === 60));
  assert.ok(authenticated.inputs.some((i) => i.key === 0xffff && i.down === 0));
  await stage("forward-frame");
  await stage("round-trip");
  assert.equal(forward.peers.find((p) => p.ready).received, "V5 手动\npaste");
  assert.deepEqual(
    fs.readFileSync(path.join(temporary, "download/sample.bin")),
    sample,
  );
  await stage("background-complete");
  await until(
    () => forward.peers.some((p) => p.ready && p.socket.destroyed),
    "closed forwarding viewer",
  );
  assert.ok(direct.peers.some((p) => p.ready && !p.socket.destroyed));
  assert.ok(warm.peers.some((p) => p.ready && !p.socket.destroyed));
  for (const server of [direct, warm, forward]) {
    const peer = server.peers.find((p) => p.ready);
    assert.ok(peer.inputs.some((i) => i.x === server.width / 2 && i.y === server.height / 2));
    assert.ok(peer.inputs.some((i) => i.key === 97 && i.down === 1));
    assert.ok(peer.inputs.some((i) => i.key === 97 && i.down === 0));
  }
  await stage("surviving-terminal");
  await stage("connected-host-delete");
  await stage("page-scoped-undo");
  const pid = execFileSync("pgrep", ["-fx", executablePattern], {
    encoding: "utf8",
  }).trim();
  const memory = () =>
    Number(
      execFileSync("ps", ["-o", "rss=", "-p", pid], {
        encoding: "utf8",
      }).trim(),
    ) / 1024;
  for (const display of displays) {
    const samples = [memory()];
    const timer = setInterval(() => samples.push(memory()), 200);
    try {
      open(display.rfb.port, false);
      await stage("perf-" + display.width);
      await until(
        () => display.rfb.peers.some((p) => p.ready && p.socket.destroyed),
        "performance viewer closed",
      );
    } finally {
      clearInterval(timer);
    }
    await new Promise((r) => setTimeout(r, 500));
    reports.push({
      stage: "memory-" + display.width,
      peakAppRssMiB: Math.round(Math.max(...samples)),
      afterCloseMiB: Math.round(memory()),
    });
  }
  // Replace only the disposable QA bundle, under its own identifier and path.
  process.kill(Number(pid));
  await until(() => {
    try {
      process.kill(Number(pid), 0);
      return false;
    } catch (error) {
      if (error.code === "ESRCH") return true;
      throw error;
    }
  }, "QA process exited");
  // Launch Services excludes apps under /private/tmp from its candidate list.
  // Use this run's workspace build as the disposable installation location.
  execFileSync("codesign", ["--force", "--sign", "-", built]);
  execFileSync(lsregister, ["-f", built]);
  assert.ok(isCandidate(), "QA bundle registered for VNC");
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Set :CFBundleVersion 9999",
    built + "/Contents/Info.plist",
  ]);
  execFileSync("codesign", ["--force", "--sign", "-", built]);
  execFileSync(lsregister, ["-f", built]);
  assert.ok(isCandidate(), "updated QA bundle still registered");
  execFileSync(lsregister, ["-u", built]);
  const arch = execFileSync(
    "lipo",
    ["-archs", app + "/Contents/MacOS/oria-tunnel"],
    { encoding: "utf8" },
  ).trim();
  fs.rmSync(built, { recursive: true });
  assert.equal(isCandidate(), false, "removed QA bundle still registered");
  reports.push({ stage: "candidate-update-and-removal" });
  assert.equal(systemHandler(), initialHandler);
  reports.push({ stage: "default-handler-preserved" });
  fs.writeFileSync(
    path.join(run, "result.json"),
    JSON.stringify(
      {
        platform: execFileSync("sw_vers", ["-productVersion"], {
          encoding: "utf8",
        }).trim(),
        arch,
        cpu: os.cpus()[0].model,
        reports,
      },
      null,
      2,
    ),
  );
} finally {
  // Match only this run's unique executable path. Do not quit other instances.
  try {
    execFileSync("pkill", ["-f", executablePattern]);
  } catch {}
  if (fs.existsSync(path.join(temporary, "app.log")))
    fs.copyFileSync(path.join(temporary, "app.log"), path.join(run, "app.log"));
  // On an early failure a bundle may never have been registered.
  if (fs.existsSync(app))
    spawnSync(lsregister, ["-u", app], { stdio: "ignore" });
  if (fs.existsSync(built)) {
    spawnSync(lsregister, ["-u", built], { stdio: "ignore" });
    fs.rmSync(built, { recursive: true });
  }
  // If a probe failed before clearing its saved SSH passwords, remove only
  // the two accounts derived from this disposable profile and fixture IDs.
  const hash = (v) => createHash("sha256").update(v).digest("hex");
  const scope = hash(path.join(temporary, "data", "connections.json"));
  for (const host of ["shell", "files"]) {
    spawnSync("/usr/bin/security", [
      "delete-generic-password", "-s", "com.oria-tunnel.ssh-password",
      "-a", `OriaTunnel/password/v1/${scope}/${hash(host)}`,
    ], {stdio: "ignore"});
  }
  fs.rmSync(temporary, { recursive: true, force: true });
  server.closeAllConnections();
  server.close();
  for (const peer of [direct, warm, forward, ...displays.map((d) => d.rfb)])
    peer.close();
  for (const child of children) {
    child.stdin.end();
    child.kill();
  }
}
