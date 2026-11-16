// Windows debug build with embedded assets. Use only the isolated loopback peer.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { framebuffer } from "./vnc-workspace-rfb.mjs";
import { control, port, until } from "./vnc-native-control.mjs";
import { watchVncFrames } from "./vnc-screencast.mjs";

const exe = fs.realpathSync(
  process.argv[2] ?? "src-tauri/target/debug/oria-tunnel.exe",
);
const compositor = process.argv.includes("--compositor");
if (compositor) {
  assert.ok(
    process.argv.includes("--4k-only") &&
      (process.argv.includes("--4k-viewport") ||
        process.argv.includes("--enlarged-viewport")),
    "compositor measurement requires a 4K-only, edge-to-edge viewport",
  );
}
assert.equal(
  path.basename(path.dirname(exe)),
  "debug",
  "isolated-data debug build required",
);
const output = path.resolve("outputs/vnc-v4");
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, "perf-"));
const ssh = path.join(profile, "empty-ssh");
fs.writeFileSync(ssh, "");
const server = await framebuffer(),
  debug = await port();
const app = spawn(exe, ["vnc://127.0.0.1:" + server.port], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    ORIATUNNEL_TEST_DATA_DIR: path.join(profile, "data"),
    ORIATUNNEL_TEST_SSH_CONFIG: ssh,
    WEBVIEW2_USER_DATA_FOLDER: path.join(profile, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + debug,
  },
});
// Sample the application's process tree (including renderer and GPU processes),
// summing working sets. Shared pages can be counted by more than one process.
const memory = [];
const sampler = spawn(
  "pwsh",
  [
    "-NoProfile",
    "-Command",
    `
$ErrorActionPreference='Stop'
while (Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue) {
  $all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize
  $ids = [Collections.Generic.HashSet[uint32]]::new()
  $null = $ids.Add(${app.pid})
  do {
    $old = $ids.Count
    foreach ($p in $all) {if ($ids.Contains($p.ParentProcessId)) {$null = $ids.Add($p.ProcessId)}}
  } while ($ids.Count -gt $old)
  $bytes = ($all | Where-Object {$ids.Contains($_.ProcessId)} | Measure-Object WorkingSetSize -Sum).Sum
  Write-Output ("{0} {1}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(),[long]$bytes)
  Start-Sleep -Milliseconds 200
}`,
  ],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let pending = "",
  samplerError = "";
sampler.stderr.on("data", (b) => (samplerError += b));
sampler.stdout.on("data", (b) => {
  pending += b;
  const lines = pending.split(/\r?\n/);
  pending = lines.pop();
  for (const line of lines) {
    const [time, bytes] = line.split(" ").map(Number);
    if (bytes > 0) memory.push({ time, bytes });
  }
});
function header(x, y, w, h, encoding = 0) {
  const b = Buffer.alloc(12);
  [x, y, w, h].forEach((n, i) => b.writeUInt16BE(n, i * 2));
  b.writeInt32BE(encoding, 8);
  return b;
}
function update(count) {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(count, 2);
  return b;
}
function samplePeak(since) {
  const bytes = memory.filter((m) => m.time >= since).map((m) => m.bytes);
  return bytes.length ? Math.max(...bytes) : null;
}
let viewer, main;
try {
  viewer = await control(debug);
  main = await control(
    debug,
    (p) => !p.url.includes("#vnc") && p.url.includes("tauri"),
  );
  await viewer.command("Page.bringToFront", {});
  // Exercise a full 4K backing canvas even on a smaller physical monitor.
  const enlarged = process.argv.includes("--enlarged-viewport");
  const fullViewport = enlarged || process.argv.includes("--4k-viewport");
  const viewport = enlarged ? [3952, 2223] : [3840, 2160];
  if (fullViewport) {
    await viewer.command("Emulation.setDeviceMetricsOverride", {
      width: viewport[0],
      height: viewport[1],
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  const peer = await until(
    () => server.peers.find((p) => p.ready && p.requests > 0),
    "first incremental request",
  );
  const socket = peer.socket;
  await viewer.evaluate(
    `window.readMarker=(channel=0)=>{const c=document.querySelector('[data-vnc-screen]');return c?.getContext('2d').getImageData(1,1,1,1).data[channel]}`,
  );
  if (!compositor)
    await until(() => viewer.evaluate("readMarker()===77"), "first pixels");
  const result = {
    arch: process.arch,
    binarySha256: createHash("sha256")
      .update(fs.readFileSync(exe))
      .digest("hex"),
    browser: (
      await (await fetch("http://127.0.0.1:" + debug + "/json/version")).json()
    ).Browser,
    windows: os.release(),
    cpu: os.cpus()[0].model,
    mode: "quality",
    rfb: "3.8 None, Raw/CopyRect, loopback",
    scenarios: [],
  };
  await viewer.evaluate(
    `window.vncSharedPackets=0;window.chrome?.webview?.addEventListener('sharedbufferreceived',e=>{if(e.additionalData?.vncSession)window.vncSharedPackets++})`,
  );
  const markHeader = header(0, 0, 32, 32),
    marker = Buffer.alloc(32 * 32 * 4);
  let next = 0;
  function send(parts, echo) {
    next = (next % 240) + 1;
    // Each queued socket.write must own its marker until flushed.
    marker.fill(next);
    if (echo !== undefined) {
      for (let i = 1; i < marker.length; i += 4) marker[i] = echo;
    }
    let bytes = 0;
    socket.cork();
    for (const b of [...parts, markHeader, Buffer.from(marker)]) {
      socket.write(b);
      bytes += b.length;
    }
    socket.uncork();
    return bytes;
  }
  const waitMarker = (n) =>
    until(() => viewer.evaluate("readMarker()===" + n), "visible marker " + n);
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
  ]) {
    if (width !== 3840 && process.argv.includes("--4k-only")) continue;
    let old = peer.requests;
    socket.write(Buffer.concat([update(1), header(0, 0, width, height, -223)]));
    await until(() => peer.requests > old, "request resized desktop");
    const pixels = Buffer.alloc(width * height * 4, 67);
    const full = [update(2), header(0, 0, width, height), pixels];
    // Shift the desktop upward by eight rows, then paint the newly exposed strip.
    const scroll = [
      update(3),
      header(0, 0, width, height - 8, 1),
      Buffer.from([0, 0, 0, 8]),
      header(0, height - 8, width, 8),
      Buffer.alloc(width * 8 * 4, 134),
    ];
    old = peer.requests;
    const cast = compositor ? await watchVncFrames(viewer) : null;
    send(full);
    if (cast) await cast.waitEcho(next);
    else await waitMarker(next);
    await until(() => peer.requests > old, "resize response consumed");
    await until(() => {
      if (sampler.exitCode !== null)
        throw Error(samplerError || "Working-set sampler exited");
      return memory.length > 0;
    }, "working-set sampler");
    const readDisplay = () =>
      viewer.evaluate(
        "(()=>{const c=document.querySelector('[data-vnc-screen]'),r=c.getBoundingClientRect();return {width:Math.round(r.width*devicePixelRatio),height:Math.round(r.height*devicePixelRatio),backingWidth:c.width,backingHeight:c.height,dpr:devicePixelRatio}})()",
      );
    const display = await readDisplay();
    const entry = { width, height, display, latencyMs: [], loads: [] };
    if (fullViewport && width === 3840) {
      assert.equal(display.width, viewport[0]);
      assert.equal(display.height, viewport[1]);
    }
    const start = Date.now(),
      idleRequests = peer.requests;
    await delay(1100);
    assert.equal(
      peer.requests,
      idleRequests,
      "idle desktop requested no redundant update",
    );
    entry.idle = {
      durationMs: Date.now() - start,
      updates: 0,
      peakWorkingSet: samplePeak(start),
    };
    const point = await viewer.evaluate(
      "(()=>{const c=document.querySelector('[data-vnc-screen]');c.focus();const r=c.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()",
    );
    async function inputLatency(i, expected, channel, cast) {
      const t = performance.now();
      await viewer.command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x + (i % 2 ? 2 : -2),
        y: point.y,
      });
      if (cast) await cast.waitEcho(expected);
      else
        await viewer.evaluate(
          "new Promise(r=>{function tick(){if(readMarker(" +
            channel +
            ")===" +
            expected +
            ")r(true);else requestAnimationFrame(tick)}tick()})",
        );
      return Math.round(performance.now() - t);
    }
    if (!cast) {
      peer.onPointer = () => send([update(1)]);
      for (let i = 0; i < 7; i++) {
        entry.latencyMs.push(await inputLatency(i, (next % 240) + 1, 0));
      }
      peer.onPointer = null;
      for (const [kind, parts] of [
        ["scroll", scroll],
        ["small", [update(1)]],
        ["full", full],
      ]) {
        await viewer.evaluate(
          `(()=>{let previous=readMarker();window.seen=0;function tick(){const value=readMarker();if(previous!==value){window.seen++;previous=value}window.sampleId=requestAnimationFrame(tick)}tick()})()`,
        );
        let sent = 0,
          bytes = 0,
          finished = false;
        const start = Date.now();
        function produce() {
          if (Date.now() - start >= 2000) {
            finished = true;
            peer.onRequest = null;
            return;
          }
          bytes += send(parts);
          sent++;
        }
        peer.onRequest = produce;
        produce();
        await until(() => finished, "request-paced " + kind);
        await waitMarker(next);
        const visible = await viewer.evaluate(
          "new Promise(r=>requestAnimationFrame(()=>{cancelAnimationFrame(window.sampleId);r(window.seen)}))",
        );
        const durationMs = Date.now() - start;
        entry.loads.push({
          kind,
          sent,
          visibleSamples: visible,
          bytes,
          durationMs,
          peakWorkingSet: samplePeak(start),
        });
      }
    }
    if (width === 3840) {
      // Alternate two full, non-uniform images. The green marker echoes input
      // only after the peer receives the pointer and constructs the next frame.
      const otherPixels = Buffer.allocUnsafe(pixels.length);
      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = ((i >>> 11) ^ i ^ (i >>> 6)) & 255;
        otherPixels[i] = pixels[i] ^ 255;
      }
      const frames = [full, [full[0], full[1], otherPixels]];
      let produced = 0,
        echo = 0,
        pendingEcho = 0;
      let inputStarted = 0;
      const inputToPeerMs = [];
      const produce = () => send(frames[produced++ % 2], echo);
      peer.onRequest = produce;
      peer.onPointer = () => {
        if (pendingEcho !== echo)
          inputToPeerMs.push(Math.round(performance.now() - inputStarted));
        echo = pendingEcho;
      };
      produce();
      await delay(1000);
      const startCount = cast?.count();
      if (!cast)
        await viewer.evaluate(
          `(()=>{let previous=readMarker();window.seen=0;function tick(){const current=readMarker();if(current!==previous)window.seen++;previous=current;window.sampleId=requestAnimationFrame(tick)}tick()})()`,
        );
      const start = performance.now();
      const latencyMs = [];
      for (const [i, pause] of [
        71, 149, 43, 211, 97, 53, 183, 109, 157,
      ].entries()) {
        await delay(pause);
        pendingEcho = i + 1;
        inputStarted = performance.now();
        latencyMs.push(await inputLatency(i + 1, pendingEcho, 1, cast));
      }
      await delay(Math.max(0, 6000 - (performance.now() - start)));
      const visible = cast
        ? cast.count() - startCount
        : await viewer.evaluate(
            "(()=>{cancelAnimationFrame(window.sampleId);return window.seen})()",
          );
      entry.continuousFull = {
        observation: cast ? "compositor" : "canvas",
        durationMs: Math.round(performance.now() - start),
        visible,
        latencyMs,
        inputToPeerMs,
      };
      peer.onRequest = null;
      peer.onPointer = null;
      await waitMarker(next);
      if (cast) {
        entry.display = await readDisplay();
        await cast.stop();
      }
    }
    result.scenarios.push(entry);
    console.log(JSON.stringify(entry));
  }
  // Suspend the real JS consumer. Rust can finish an outstanding IPC pull and
  // fill its bounded output channel before incremental requests must stop.
  await viewer.command("Debugger.enable", {});
  await viewer.command("Debugger.pause", {});
  const full4k = [
    update(2),
    header(0, 0, 3840, 2160),
    Buffer.alloc(3840 * 2160 * 4, 91),
  ];
  let sent = 0;
  peer.onRequest = () => {
    if (sent < 12) {
      send(full4k);
      sent++;
    }
  };
  send(full4k);
  sent++;
  await delay(800);
  const plateau = sent,
    since = Date.now();
  await delay(1200);
  assert.equal(sent, plateau);
  assert.ok(sent <= 6, "bounded in-flight full frames");
  const plateauMs = Date.now() - since;
  const pausedPeak = samplePeak(since);
  peer.onRequest = null;
  await viewer.command("Debugger.resume", {});
  await viewer.command("Debugger.disable", {});
  await waitMarker(next);
  result.slowConsumer = {
    sentBeforePlateau: sent,
    plateauMs,
    peakWorkingSet: pausedPeak,
  };
  result.beforeClose = memory.at(-1).bytes;
  result.sharedPackets = await viewer.evaluate("window.vncSharedPackets");
  await viewer.evaluate(
    "setTimeout(()=>window.__TAURI_INTERNALS__.invoke('vnc_window_action',{action:'close'}),0)",
  );
  await until(() => peer.socket.destroyed, "viewer released RFB");
  const closed = Date.now();
  await until(
    () => memory.at(-1)?.time > closed + 1500,
    "post-close memory samples",
  );
  result.afterClose = memory.at(-1).bytes;
  result.peakWorkingSet = Math.max(...memory.map((m) => m.bytes));
  fs.writeFileSync(
    path.join(profile, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(profile);
} finally {
  viewer?.socket.close();
  main?.socket.close();
  sampler.kill();
  if (app.exitCode === null) {
    const exited = once(app, "exit");
    app.kill();
    await exited;
  }
  server.close();
}
