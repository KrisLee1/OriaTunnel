import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

// The first pixel is inside the 32x32 frame/input marker. All PNG row
// predictors are zero at (0,0), so no scanline reconstruction is needed.
function marker(png) {
  assert.equal(png[24], 8);
  assert.ok(png[25] === 2 || png[25] === 6);
  const chunks = [];
  for (let pos = 8; pos < png.length; ) {
    const n = png.readUInt32BE(pos);
    if (png.toString("ascii", pos + 4, pos + 8) === "IDAT")
      chunks.push(png.subarray(pos + 8, pos + 8 + n));
    pos += 12 + n;
  }
  const row = inflateSync(Buffer.concat(chunks));
  return [row[1], row[2]];
}

// Observe actual WebView compositor output without synchronously reading the
// application's large canvas each animation frame.
export async function watchVncFrames(viewer) {
  let frames = 0,
    red = -1,
    green = -1,
    pending;
  const listener = ({ data }) => {
    const event = JSON.parse(data);
    if (event.method !== "Page.screencastFrame") return;
    void viewer.command("Page.screencastFrameAck", {
      sessionId: event.params.sessionId,
    });
    const [r, g] = marker(Buffer.from(event.params.data, "base64"));
    if (r !== red) frames++;
    red = r;
    green = g;
    if (pending && pending.value === green) pending.resolve();
  };
  viewer.socket.addEventListener("message", listener);
  await viewer.command("Page.startScreencast", {
    format: "png",
    maxWidth: 512,
    maxHeight: 288,
    everyNthFrame: 1,
  });
  return {
    count: () => frames,
    async waitEcho(value) {
      if (green === value) return;
      let timer;
      try {
        await new Promise((resolve, reject) => {
          pending = { value, resolve };
          timer = setTimeout(
            () =>
              reject(
                Error(
                  "Missing compositor echo " +
                    value +
                    "; last " +
                    red +
                    "," +
                    green,
                ),
              ),
            8000,
          );
        });
      } finally {
        clearTimeout(timer);
        pending = undefined;
      }
    },
    async stop() {
      try {
        await viewer.command("Page.stopScreencast", {});
      } finally {
        viewer.socket.removeEventListener("message", listener);
      }
    },
  };
}
