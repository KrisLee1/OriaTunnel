// Run after pnpm build. Both SSH fixtures, the app profile and the report endpoint are isolated.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";

assert.equal(process.platform, "darwin");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "oria-editor-"));
const children = [];
const stages = [];
const overflowOnly = process.argv.includes("--overflow-only");
const localOnly = process.argv.includes("--local-only");
const localShell = process.argv.includes("--bash") ? "bash" : "zsh";
const localHome = path.join(fs.realpathSync(temp), "local-home");
if (localOnly) fs.mkdirSync(localHome);
const libraryOnly = process.argv.includes("--library-only");
const outputOnly = process.argv.includes("--output-only");
const pointer = !process.argv.includes("--no-pointer");
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const token = "/" + randomUUID();
const report = http.createServer();
try {
  if (!process.argv.includes("--built-fixture"))
    execFileSync(
      "cargo",
      [
        "build",
        "--offline",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--example",
        "terminal_fixture",
      ],
      { stdio: "inherit" },
    );
  const ports = {};
  for (const shell of ["bash", "zsh"]) {
    const fixture = spawn(
      "src-tauri/target/debug/examples/terminal_fixture",
      [shell],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    children.push(fixture);
    const [line] = await once(fixture.stdout, "data");
    ports[shell] = Number(/ISOLATED_SSH_PORT=(\d+)/.exec(line)[1]);
  }
  const secret = fs
    .readFileSync("src-tauri/tests/common/terminal_server.rs", "utf8")
    .match(/password == "([^"]+)"/)[1];
  let app;
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  report.on("request", async (req, res) => {
    if (req.url !== token || req.headers.origin !== "tauri://localhost") {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "tauri://localhost");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { stage, error, click, right, hover } = JSON.parse(body);
      if (
        click &&
        app &&
        [2, 4].includes(click.length) &&
        click.every(Number.isFinite)
      ) {
        try {
          execFileSync("swift", [
            "scripts/qa/terminal-editor-click.swift",
            String(app.pid),
            ...click.map(String),
            ...(right ? ["right"] : hover ? ["hover"] : []),
          ]);
        } catch {
          finish(Error("Native click driver failed"));
        }
      }
      if (error) finish(Error(error));
      else {
        stages.push(stage);
        console.log(stage);
        if (stage === "complete") finish(null);
      }
    }
    res.end(
      JSON.stringify({
        ports,
        secret,
        pointer,
        outputOnly,
        overflowOnly,
        libraryOnly,
        localOnly,
        localHome,
        localShell,
      }),
    );
  });
  report.listen(0, "127.0.0.1");
  await once(report, "listening");
  const origin = "http://127.0.0.1:" + report.address().port;
  const ui = path.join(temp, "ui");
  fs.cpSync("dist", ui, { recursive: true });
  fs.appendFileSync(
    path.join(ui, "index.html"),
    '<script type="module" src="/terminal-editor-probe.js"></script>',
  );
  fs.writeFileSync(
    path.join(ui, "terminal-editor-probe.js"),
    "const reportURL=" +
      JSON.stringify(origin + token) +
      ";\n" +
      fs.readFileSync("scripts/qa/terminal-editor-probe.js", "utf8"),
  );
  const overrides = {
    identifier: "com.oria-tunnel.qa.terminal-editor",
    build: { frontendDist: ui, beforeBuildCommand: "" },
    app: { security: { csp: config.app.security.csp + " " + origin } },
  };
  execFileSync(
    "pnpm",
    [
      "tauri",
      "build",
      "--debug",
      "--no-bundle",
      "--config",
      JSON.stringify(overrides),
    ],
    { stdio: "inherit" },
  );
  const empty = path.join(temp, "ssh-config");
  fs.writeFileSync(empty, "");
  app = spawn("src-tauri/target/debug/oria-tunnel", [], {
    env: {
      ...process.env,
      ...(localOnly
        ? {
            HOME: localHome,
            ZDOTDIR: localHome,
            HISTFILE: path.join(localHome, ".history"),
            SHELL: "/bin/" + localShell,
          }
        : {}),
      ORIATUNNEL_TEST_DATA_DIR: path.join(temp, "data"),
      ORIATUNNEL_TEST_SSH_CONFIG: empty,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(app);
  const timer = setTimeout(
    () => finish(Error("Native editor QA timed out")),
    120000,
  );
  app.on("exit", () => finish(Error("Isolated app exited")));
  const failure = await result;
  clearTimeout(timer);
  if (failure) throw failure;
  fs.mkdirSync("outputs/terminal-editor", { recursive: true });
  fs.writeFileSync(
    localOnly
      ? "outputs/terminal-editor/local-" + localShell + ".json"
      : libraryOnly
        ? "outputs/terminal-editor/saved-commands.json"
        : overflowOnly
          ? "outputs/terminal-editor/overflow.json"
          : outputOnly
            ? "outputs/terminal-editor/output-" +
              (pointer ? "mouse" : "keyboard") +
              ".json"
            : pointer
              ? "outputs/terminal-editor/native.json"
              : "outputs/terminal-editor/native-keyboard.json",
    JSON.stringify({ stages }, null, 2),
  );
} finally {
  for (const child of children.reverse()) child.kill();
  report.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
