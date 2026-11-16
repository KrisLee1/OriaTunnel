// Windows WebView2, isolated profile and a real RFB peer on loopback.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { control, port, until } from "./vnc-native-control.mjs";
import { framebuffer } from "./vnc-workspace-rfb.mjs";

const executable = path.resolve(
  process.argv[2] ?? "src-tauri/target/debug/oria-tunnel.exe",
);
const baseline = process.argv.includes("--baseline");
const native4k = process.argv.includes("--4k-viewport");
const enlarged4k = process.argv.includes("--enlarged-viewport");
const root = path.resolve("outputs/vnc-render");
fs.mkdirSync(root, { recursive: true });
const profile = fs.mkdtempSync(
  path.join(root, baseline ? "before-" : "after-"),
);
const sshConfig = path.join(profile, "empty-ssh");
fs.writeFileSync(sshConfig, "");
const remote = await framebuffer();
const debug = await port();
const app = spawn(executable, ["vnc://127.0.0.1:" + remote.port], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    ORIATUNNEL_TEST_DATA_DIR: path.join(profile, "data"),
    ORIATUNNEL_TEST_SSH_CONFIG: sshConfig,
    WEBVIEW2_USER_DATA_FOLDER: path.join(profile, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-port=" +
      debug +
      " --remote-debugging-address=127.0.0.1 --force-device-scale-factor=1.5",
  },
});
function header(x, y, w, h, encoding = 0) {
  const bytes = Buffer.alloc(12);
  [x, y, w, h].forEach((v, i) => bytes.writeUInt16BE(v, i * 2));
  bytes.writeInt32BE(encoding, 8);
  return bytes;
}
function update(rectangles) {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(rectangles.length, 2);
  return Buffer.concat([head, ...rectangles]);
}
function solid(x, y, w, h, value) {
  return Buffer.concat([header(x, y, w, h), Buffer.alloc(4 * w * h, value)]);
}
let page;
try {
  page = await control(debug);
  await page.command("Page.bringToFront", {});
  const onCanvas = (expression) =>
    page.evaluate(
      "(()=>{const c=document.querySelector('[data-vnc-screen]');if(!c)return null;const ctx=c.getContext('2d');" +
        "const red=(x,y)=>ctx.getImageData(Math.floor(x*c.width),Math.floor(y*c.height),1,1).data[0];return " +
        expression +
        "})()",
    );
  await until(() => onCanvas("red(0.5,0.5)===77"), "loopback first frame");
  const margins = {};
  if (!baseline) {
    async function marginPixel() {
      const point =
        await onCanvas(`(()=>{const r=c.getBoundingClientRect(),v=c.parentElement.getBoundingClientRect();
        if(r.left-v.left>4)return {x:(v.left+r.left)/2,y:v.top+v.height/2};
        if(r.top-v.top>4)return {x:v.left+v.width/2,y:(v.bottom+r.bottom)/2};
        throw Error("fixture has no margin")})()`);
      const shot = await page.command("Page.captureScreenshot", {
        format: "png",
        clip: { ...point, width: 3, height: 3, scale: 1 },
      });
      return page.evaluate(`(async()=>{const im=new Image();im.src="data:image/png;base64,${shot.data}";
        await im.decode();const ctx=new OffscreenCanvas(im.width,im.height).getContext("2d");
        ctx.drawImage(im,0,0);return Array.from(ctx.getImageData(1,1,1,1).data)})()`);
    }
    // Use the actual native fullscreen control, then sample the compositor
    // outside the fitted 4:3 remote desktop in a light window.
    await page.command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await until(
      () =>
        page.evaluate("document.documentElement.dataset.oriaMode==='light'"),
      "light window theme",
    );
    await delay(400);
    const setViewportVisibility = (visibility) =>
      page.evaluate(`new Promise(r=>{document.querySelector(".vnc-viewport").style.visibility=${JSON.stringify(visibility)};
        requestAnimationFrame(()=>requestAnimationFrame(()=>r(true)))})`);
    await setViewportVisibility("hidden");
    const shell = await marginPixel();
    await setViewportVisibility("");
    await until(async () => {
      margins.window = await marginPixel();
      return margins.window.every((v, i) => v === shell[i]);
    }, "window margin matches shell after initial fit");
    assert.notDeepEqual(margins.window, [0, 0, 0, 255]);
    const fullscreen = () =>
      page.evaluate(
        "window.__TAURI_INTERNALS__.invoke('vnc_window_action',{action:'isFullscreen'})",
      );
    await page.evaluate(
      "document.querySelector('[data-window-active] button[aria-label=全屏]').click()",
    );
    await until(fullscreen, "native fullscreen");
    await until(
      () =>
        page.evaluate("!!document.querySelector('[data-viewer-fullscreen]')"),
      "fullscreen appearance",
    );
    await until(async () => {
      margins.fullscreen = await marginPixel();
      return margins.fullscreen.join(",") === "0,0,0,255";
    }, "rendered fullscreen margin");
    assert.deepEqual(margins.fullscreen, [0, 0, 0, 255]);
    assert.equal(await onCanvas("red(.5,.5)"), 77);
    await page.evaluate(
      "document.querySelector('[data-viewer-fullscreen] button[aria-label=还原]').click()",
    );
    await until(async () => !(await fullscreen()), "restore window");
    await until(
      () =>
        page.evaluate("!document.querySelector('[data-viewer-fullscreen]')"),
      "restored appearance",
    );
    await until(async () => {
      margins.restored = await marginPixel();
      return margins.restored.every((v, i) => v === shell[i]);
    }, "rendered window margin after restore");
    assert.deepEqual(margins.window, margins.restored);
  }
  const { socket } = remote.peers[0];
  // 256 independent dirty rectangles. Measure server write to observation
  // of the last rectangle on the visible canvas at a browser repaint.
  const samples = [];
  for (let frame = 0; frame < 6; frame++) {
    const value = 32 + frame;
    const tiles = Array.from({ length: 256 }, (_, i) =>
      solid((i % 16) * 20, Math.floor(i / 16) * 15, 20, 15, value),
    );
    const wire = update(tiles);
    const start = performance.now();
    socket.write(wire);
    await onCanvas(
      "new Promise(resolve=>{function sample(){if(red(.98,.98)===" +
        value +
        ")resolve(true);else requestAnimationFrame(sample)}sample()})",
    );
    if (frame) samples.push(Math.round(performance.now() - start));
  }
  let fitted;
  if (!baseline) {
    // 36 output pixels for 35 remote pixels reproduced a regularly repeated
    // row and column through text, icons and the desktop background.
    const fourK = native4k || enlarged4k;
    const output = enlarged4k
      ? [3952, 2223]
      : native4k
        ? [3840, 2160]
        : [1152, 720];
    const density = fourK ? 1 : 1.5;
    await page.command("Emulation.setDeviceMetricsOverride", {
      width: output[0] / density,
      height: output[1] / density,
      deviceScaleFactor: density,
      mobile: false,
    });
    const width = fourK ? 3840 : 1120,
      height = fourK ? 2160 : 700;
    const pattern = (x, y, w, h) => {
      const bytes = Buffer.alloc(w * h * 4);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const p = (j * w + i) * 4;
          bytes[p] = (x + i) * 7;
          bytes[p + 1] = (y + j) * 9;
          bytes[p + 2] = (x + i) * 13 + (y + j) * 11;
        }
      }
      return Buffer.concat([header(x, y, w, h), bytes]);
    };
    socket.write(update([header(0, 0, width, height, -223)]));
    socket.write(
      update([pattern(0, 0, width, height), solid(240, 90, 60, 40, 220)]),
    );
    await until(
      () => onCanvas(`red(260/${width},105/${height})===220`),
      "fractional fixture painted",
    );
    const geometry = await onCanvas(
      "[Math.round(c.getBoundingClientRect().width*devicePixelRatio),Math.round(c.getBoundingClientRect().height*devicePixelRatio)]",
    );
    assert.deepEqual(
      geometry.slice(0, 2),
      output,
      "fitted desktop: " + geometry,
    );
    // Inspect final compositor pixels, including CSS scaling at display DPI.
    async function onScreenshot(expression, full = false) {
      const shot = await page.command("Page.captureScreenshot", {
        format: "png",
        clip: {
          x: 0,
          y: 0,
          width: (full ? output[0] : 480) / density,
          height: (full ? output[1] : 300) / density,
          scale: 1,
        },
      });
      return page.evaluate(`(async()=>{const im=new Image();
        im.src="data:image/png;base64,${shot.data}";await im.decode();
        const ctx=new OffscreenCanvas(im.width,im.height).getContext("2d");
        ctx.drawImage(im,0,0);return (${expression})})()`);
    }
    await until(
      () =>
        page.evaluate(
          "getComputedStyle(document.querySelector('.vnc-floating-header')).opacity==='0'",
        ),
      "unobscured desktop",
    );
    assert.deepEqual(
      await onScreenshot("[ctx.canvas.width,ctx.canvas.height]"),
      [480, 300],
    );
    fitted =
      await onScreenshot(`(()=>{const w=210,h=130,a=ctx.getImageData(0,0,w,h).data;
      const same=(p,q)=>a[p]===a[q] && a[p+1]===a[q+1] && a[p+2]===a[q+2];
      const columns=[],rows=[];
      for(let x=1;x<w;x++)if([7,23,37,59].every(y=>same((y*w+x)*4,(y*w+x-1)*4)))columns.push(x);
      for(let y=1;y<h;y++)if([7,23,37,59].every(x=>same((y*w+x)*4,((y-1)*w+x)*4)))rows.push(y);
      return {columns,rows}})()`);
    assert.deepEqual(
      fitted,
      { columns: [], rows: [] },
      "fractional fit must not repeat scanlines",
    );
    socket.write(
      update([
        Buffer.concat([
          header(317, 113, 60, 40, 1),
          Buffer.from([0, 240, 0, 90]),
        ]),
        pattern(240, 90, 60, 40),
      ]),
    );
    await until(
      () => onCanvas(`red(340/${width},129/${height})===220`),
      "moved rectangle",
    );
    await onScreenshot(
      "(window.movedPixels=ctx.getImageData(225,80,190,100).data,true)",
    );
    if (fourK) {
      await onScreenshot(
        "(window.incrementalDesktop=ctx.getImageData(0,0,im.width,im.height).data,true)",
        true,
      );
    }
    // Force the same final scene through a full repaint, using an independent
    // marker outside the compared area to wait for that specific commit.
    socket.write(
      update([
        pattern(0, 0, width, height),
        solid(317, 113, 60, 40, 220),
        solid(450, 250, 20, 20, 255),
      ]),
    );
    await until(
      () => onCanvas(`red(460/${width},260/${height})===255`),
      "full reference repaint",
    );
    // Clipping a filtered draw may round an 8-bit channel up or down by one.
    fitted.movedMaxChannelDifference =
      await onScreenshot(`ctx.getImageData(225,80,190,100).data.reduce(
      (max,value,i)=>Math.max(max,Math.abs(value-window.movedPixels[i])),0)`);
    assert.ok(
      fitted.movedMaxChannelDifference <= 1,
      "moved rectangle matches full repaint",
    );
    fitted.display = geometry;
    if (fourK) {
      // The only intentional difference is the independent completion marker.
      // Include its linear-filter footprint when excluding it from the comparison.
      fitted.fullDesktopMaxDifference = await onScreenshot(
        `(()=>{
        const w=im.width,h=im.height,s=w/${width};
        const a=ctx.getImageData(0,0,w,h).data,b=window.incrementalDesktop;
        const left=Math.floor(450*s)-1,right=Math.ceil(470*s)+1;
        const top=Math.floor(250*s)-1,bottom=Math.ceil(270*s)+1;
        let max=0;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          if(y>=top && y<bottom && x>=left && x<right)continue;
          const p=(y*w+x)*4;
          for(let i=p;i<p+4;i++)max=Math.max(max,Math.abs(a[i]-b[i]));
        }
        delete window.incrementalDesktop;return max;
      })()`,
        true,
      );
      assert.ok(
        fitted.fullDesktopMaxDifference <= 1,
        "full 4K compositor comparison",
      );
    }
    await page.command("Emulation.clearDeviceMetricsOverride", {});
  }
  socket.write(update([header(0, 0, 1024, 768, -223)]));
  socket.write(update([solid(0, 0, 1024, 768, 41)]));
  await until(() => onCanvas("red(.5,.75)===41"), "resized desktop");
  // Flush the first rectangle across the 1 MiB IPC boundary. Stall the
  // second rectangle after its header so multiple repaints can occur.
  socket.write(
    Buffer.concat([
      Buffer.from([0, 0, 0, 2]),
      solid(0, 0, 1024, 384, 200),
      header(0, 384, 1024, 384),
    ]),
  );
  await delay(400);
  const midway = await onCanvas("[red(.5,.25),red(.5,.75)]");
  assert.deepEqual(midway, baseline ? [200, 41] : [41, 41]);
  socket.write(Buffer.alloc(1024 * 384 * 4, 200));
  await until(
    () => onCanvas("red(.5,.25)===200 && red(.5,.75)===200"),
    "atomic completion",
  );
  const results = {
    samplesMs: samples,
    midway,
    fractionalFit: fitted,
    margins,
  };
  if (!baseline) {
    // Alternating vertical lines expose interpolation on enlargement and
    // aliasing on reduction. CopyRect depends on the preceding Raw in-frame.
    const stripes = Buffer.alloc(1024 * 32 * 4);
    for (let i = 0; i < stripes.length; i += 4)
      stripes.fill(((i / 4) % 2) * 255, i, i + 4);
    socket.write(
      update([
        Buffer.concat([header(0, 0, 1024, 32), stripes]),
        Buffer.concat([header(0, 384, 1024, 32, 1), Buffer.alloc(4)]),
      ]),
    );
    const zoomRatio = () => onCanvas("c.getBoundingClientRect().width/1024");
    const zoom = async (target) => {
      for (let step = 0; step < 12; step++) {
        const before = await zoomRatio();
        if (Math.abs(before - target) < 0.001) return;
        const label = before < target ? "放大" : "缩小";
        await page.evaluate(
          "document.querySelector('.app-titlebar button[aria-label=" +
            label +
            "]').click()",
        );
        await until(
          async () => Math.abs((await zoomRatio()) - before) > 0.001,
          "zoom step",
        );
      }
      throw Error("Zoom level unreachable");
    };
    const rowColors = () =>
      onCanvas(
        "[...new Set(Array.from(ctx.getImageData(10,Math.floor(c.height*.52),80,1).data).filter((_,i)=>i%4===0))].sort((a,b)=>a-b)",
      );
    await zoom(2);
    await until(
      () => onCanvas("c.width===3072"),
      "integer device pixel enlargement",
    );
    results.enlargedColors = await rowColors();
    assert.deepEqual(results.enlargedColors, [0, 255]);
    await zoom(0.25);
    await until(() => onCanvas("c.width===384"), "device pixel reduction");
    results.reducedColors = await rowColors();
    assert.ok(results.reducedColors.every((n) => n > 0 && n < 255));
    // Compare an incremental filtered edge with a complete repaint at the
    // same scale. The source rectangle for the CopyRect overlaps its target.
    const copySource = Buffer.from([0, 39, 1, 132]);
    socket.write(
      update([
        solid(39, 388, 73, 19, 250),
        Buffer.concat([header(77, 388, 73, 19, 1), copySource]),
      ]),
    );
    await until(
      () => onCanvas("red(144/1024,398/768)===250"),
      "overlapping CopyRect",
    );
    const aroundPatch = () =>
      onCanvas("Array.from(ctx.getImageData(7,141,57,17).data).join(',')");
    const incremental = await aroundPatch();
    await zoom(0.5);
    await until(
      () => onCanvas("c.width===768"),
      "zoom out of comparison scale",
    );
    await zoom(0.25);
    await until(() => onCanvas("c.width===384"), "restore comparison scale");
    assert.equal(
      await aroundPatch(),
      incremental,
      "filtered dirty edges match full repaint",
    );
    const point = await onCanvas(
      "(()=>{const r=c.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()",
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await page.command("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
    await until(
      () =>
        remote.peers[0].inputs.some(
          (p) =>
            p.buttons === 1 &&
            Math.abs(p.x - 512) <= 2 &&
            Math.abs(p.y - 384) <= 2,
        ),
      "remote coordinates at 25%",
    );
    assert.ok(
      await onCanvas(
        "document.activeElement===c && getComputedStyle(c).cursor!=='none'",
      ),
    );
    async function openMore() {
      const trigger =
        "document.querySelector('.app-titlebar button[aria-label=更多]')";
      if (
        !(await page.evaluate(
          trigger + ".getAttribute('aria-expanded')==='true'",
        ))
      )
        await page.evaluate(trigger + ".click()");
      await until(
        () =>
          page.evaluate("!!document.querySelector('[role=menuitemcheckbox]')"),
        "display options",
      );
    }
    const cursorItem = "document.querySelector('[role=menuitemcheckbox]')";
    const radio = (name) =>
      "[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent.trim()===" +
      JSON.stringify(name) +
      ")";
    async function selectMode(name) {
      await openMore();
      await page.evaluate(radio(name) + ".click()");
    }
    await openMore();
    assert.equal(
      await page.evaluate(cursorItem + ".getAttribute('aria-checked')"),
      "false",
    );
    assert.equal(
      await page.evaluate(radio("画质模式") + ".getAttribute('aria-checked')"),
      "true",
    );
    await page.evaluate(cursorItem + ".click()");
    await selectMode("流畅模式");
    await until(
      () => onCanvas("c.width===256 && red(.14,.52)===250"),
      "smooth mode redraws an idle desktop",
    );
    await page.evaluate("document.querySelector('canvas').focus()");
    assert.ok(await onCanvas("getComputedStyle(c).cursor==='none'"));
    // Switch back during a split frame. A mode change or animation callback
    // must never present the staged first half.
    socket.write(
      Buffer.concat([
        Buffer.from([0, 0, 0, 2]),
        solid(0, 0, 1024, 384, 119),
        header(0, 384, 1024, 384),
      ]),
    );
    await delay(200);
    assert.deepEqual(await onCanvas("[red(.5,.25),red(.5,.75)]"), [200, 200]);
    await selectMode("画质模式");
    assert.deepEqual(await onCanvas("[red(.5,.25),red(.5,.75)]"), [200, 200]);
    socket.write(Buffer.alloc(1024 * 384 * 4, 119));
    await until(
      () => onCanvas("c.width===384 && red(.5,.25)===119 && red(.5,.75)===119"),
      "quality resumes at a frame boundary",
    );
    await selectMode("流畅模式");
    assert.equal(
      remote.peers.length,
      1,
      "display choices keep the same RFB connection",
    );
    await page.command("Page.reload", {});
    await until(
      () =>
        onCanvas("red(.5,.5)===77 && c.dataset.renderMode==='smooth'").catch(
          () => false,
        ),
      "reload with saved mode",
    );
    await openMore();
    assert.equal(
      await page.evaluate(cursorItem + ".getAttribute('aria-checked')"),
      "true",
    );
    assert.equal(
      await page.evaluate(radio("流畅模式") + ".getAttribute('aria-checked')"),
      "true",
    );
    assert.notEqual(
      await page.evaluate("getComputedStyle(" + cursorItem + ").cursor"),
      "none",
    );
    await page.evaluate(cursorItem + ".click()");
    await selectMode("画质模式");
    await page.evaluate("document.querySelector('canvas').focus()");
    assert.ok(await onCanvas("getComputedStyle(c).cursor!=='none'"));
    results.displayPreferencesVerified = true;
  }
  fs.writeFileSync(
    path.join(profile, "result.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(profile, results);
} finally {
  page?.socket.close();
  remote.close();
  app.kill();
}
