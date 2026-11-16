import type { RenderMode } from "./display-preferences";

// Rust sends ordered rectangle batches. Only the last batch of an RFB
// FramebufferUpdate may change the visible canvas.
export const UPDATE_PART = 9;
export const UPDATE_END = 10;

type Damage = { left: number; top: number; right: number; bottom: number };

export class VncFramebuffer {
  private source = document.createElement("canvas");
  private image?: ImageData;
  private pixels: CanvasRenderingContext2D;
  private display: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private partial = false;
  private ready = false;
  private damage: Damage | null = null;
  private targetWidth = 0;
  private targetHeight = 0;
  private scheduled: number | null = null;

  constructor(
    private screen: HTMLCanvasElement,
    canvasError: string,
    private mode: RenderMode,
  ) {
    const pixels = this.source.getContext("2d", { alpha: false });
    const display = screen.getContext("2d", { alpha: false });
    if (!pixels || !display) throw Error(canvasError);
    this.pixels = pixels;
    this.display = display;
    this.observer = new ResizeObserver(([entry]) => {
      const box = entry.devicePixelContentBoxSize?.[0];
      this.setTarget(
        box?.inlineSize ??
          Math.round(entry.contentRect.width * devicePixelRatio),
        box?.blockSize ??
          Math.round(entry.contentRect.height * devicePixelRatio),
      );
    });
    try {
      this.observer.observe(screen, { box: "device-pixel-content-box" });
    } catch {
      this.observer.observe(screen);
    }
    window.addEventListener("resize", this.measure);
  }

  setMode(mode: RenderMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.cancelPresent();
    this.damage = {
      left: 0,
      top: 0,
      right: this.image?.width ?? 0,
      bottom: this.image?.height ?? 0,
    };
    if (this.ready && !this.partial) this.present();
  }

  private cancelPresent() {
    if (this.scheduled !== null) cancelAnimationFrame(this.scheduled);
    this.scheduled = null;
  }

  private measure = () => {
    const rect = this.screen.getBoundingClientRect();
    this.setTarget(
      Math.round(rect.width * devicePixelRatio),
      Math.round(rect.height * devicePixelRatio),
    );
  };

  private setTarget(width: number, height: number) {
    this.targetWidth = width;
    this.targetHeight = height;
    if (this.ready && !this.partial) this.present();
  }

  resize(width: number, height: number) {
    this.cancelPresent();
    this.image = new ImageData(width, height);
    // RFB's initial framebuffer is opaque black, including untouched pixels.
    new Uint32Array(this.image.data.buffer).fill(0xff000000);
    this.source.width = this.source.height = 0;
    this.partial = false;
    this.ready = false;
    // Hold the last display until the server supplies the resized desktop.
    this.damage = { left: 0, top: 0, right: width, bottom: height };
  }

  apply(data: ArrayBuffer) {
    const image = this.image;
    if (!image) return;
    const view = new DataView(data);
    const partial = view.getUint8(0) === UPDATE_PART;
    if (partial && this.scheduled !== null) {
      // Show the preceding complete frame before staging a possibly slow
      // multipart update into the same source canvas.
      this.cancelPresent();
      this.present();
    }
    this.partial = partial;
    let offset = 1;
    while (offset < data.byteLength) {
      const kind = view.getUint8(offset);
      const x = view.getUint16(offset + 1);
      const y = view.getUint16(offset + 3);
      const w = view.getUint16(offset + 5);
      const h = view.getUint16(offset + 7);
      offset += 9;
      if (kind === 2 || kind === 11) {
        const words = new Uint32Array(image.data.buffer);
        // The packed rectangle header need not end on a four-byte boundary.
        // On our little-endian desktop targets RGBX -> RGBA is one word write.
        for (let row = 0; row < h; row++) {
          const start = (y + row) * image.width + x;
          if (kind === 11) {
            for (let i = 0; i < w; i++, offset += 4)
              words[start + i] = view.getUint32(offset, true) | 0xff000000;
          } else {
            image.data.set(new Uint8Array(data, offset, w * 4), start * 4);
            offset += w * 4;
          }
        }
      } else if (kind === 3) {
        const sx = view.getUint16(offset),
          sy = view.getUint16(offset + 2);
        const words = new Uint32Array(image.data.buffer);
        // Copy bottom-up for downward moves; copyWithin handles horizontal overlap.
        if (w === image.width) {
          words.copyWithin(y * w, sy * w, (sy + h) * w);
        } else {
          for (let i = 0; i < h; i++) {
            const row = y > sy ? h - i - 1 : i;
            const from = (sy + row) * image.width + sx;
            words.copyWithin((y + row) * image.width + x, from, from + w);
          }
        }
        offset += 4;
      } else {
        throw Error("Invalid VNC rectangle");
      }
      if (this.damage) {
        this.damage.left = Math.min(this.damage.left, x);
        this.damage.top = Math.min(this.damage.top, y);
        this.damage.right = Math.max(this.damage.right, x + w);
        this.damage.bottom = Math.max(this.damage.bottom, y + h);
      } else {
        this.damage = { left: x, top: y, right: x + w, bottom: y + h };
      }
    }
    if (!this.partial) {
      this.ready = true;
      if (this.mode === "quality") this.present();
      else if (this.scheduled === null) {
        this.scheduled = requestAnimationFrame(() => {
          this.scheduled = null;
          this.present();
        });
      }
    }
  }

  private present() {
    const image = this.image;
    if (!image) return;
    let width = this.targetWidth;
    let height = this.targetHeight;
    if (!width || !height) return;
    if (this.mode === "smooth") {
      // Rasterize at most one sample per CSS pixel or source pixel. Let the
      // compositor handle further enlargement while preserving input geometry.
      const density = Math.max(1, devicePixelRatio);
      width = Math.min(image.width, Math.max(1, Math.round(width / density)));
      height = Math.min(
        image.height,
        Math.max(1, Math.round(height / density)),
      );
    } else if (
      width >= image.width &&
      height >= image.height &&
      (width % image.width !== 0 || height % image.height !== 0)
    ) {
      // Present native pixels once. The compositor linearly samples this
      // canvas at its CSS size, including fractional fit and display DPI.
      width = image.width;
      height = image.height;
    }
    // Keep very large zoom levels within the native decoder's canvas budget.
    if (width * height > 4096 ** 2 || Math.max(width, height) > 16384) {
      width = image.width;
      height = image.height;
    }
    let dirty = this.damage;
    const ctx = this.display;
    if (this.screen.width !== width || this.screen.height !== height) {
      if (this.screen.width !== width) this.screen.width = width;
      if (this.screen.height !== height) this.screen.height = height;
      dirty = { left: 0, top: 0, right: image.width, bottom: image.height };
    }
    if (!dirty) return;
    this.damage = null;
    const upload = (target: CanvasRenderingContext2D) =>
      target.putImageData(
        image,
        0,
        0,
        dirty.left,
        dirty.top,
        dirty.right - dirty.left,
        dirty.bottom - dirty.top,
      );
    if (width === image.width && height === image.height) {
      upload(ctx);
      return;
    }
    const source = this.source;
    if (source.width !== image.width || source.height !== image.height) {
      source.width = image.width;
      source.height = image.height;
      this.pixels.putImageData(image, 0, 0);
    } else {
      upload(this.pixels);
    }
    const sx = width / source.width,
      sy = height / source.height;
    // Nearest-neighbor is exact at 1:1 and integer enlargement. At a
    // fractional fit it periodically duplicates whole rows and columns.
    ctx.imageSmoothingEnabled =
      width % source.width !== 0 || height % source.height !== 0;
    if (ctx.imageSmoothingEnabled) {
      // Linear interpolation avoids halos on enlarged text and icon edges.
      ctx.imageSmoothingQuality =
        this.mode === "quality" && (sx < 1 || sy < 1) ? "high" : "low";
    }
    // Clip the destination but sample from the entire source. Adjacent dirty
    // rectangles then share the same filter footprint and subpixel origin.
    // At high DPI one source pixel can span several display pixels. Include
    // its filtered neighbours when replacing a moved window or glyph.
    const pad = ctx.imageSmoothingEnabled ? Math.ceil(Math.max(3, sx, sy)) : 0;
    const left = Math.floor(dirty.left * sx) - pad;
    const top = Math.floor(dirty.top * sy) - pad;
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      left,
      top,
      Math.ceil(dirty.right * sx) + pad - left,
      Math.ceil(dirty.bottom * sy) + pad - top,
    );
    ctx.clip();
    ctx.drawImage(source, 0, 0, width, height);
    ctx.restore();
  }

  dispose() {
    this.cancelPresent();
    this.observer.disconnect();
    window.removeEventListener("resize", this.measure);
    this.source.width = this.source.height = 0;
    this.image = undefined;
    this.screen.width = this.screen.height = 1;
  }
}
