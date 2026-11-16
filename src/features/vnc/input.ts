// X11 keysyms used by the RFB KeyEvent message.
const named: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Insert: 0xff63,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  CapsLock: 0xffe5,
  NumLock: 0xff7f,
  ScrollLock: 0xff14,
  PrintScreen: 0xff61,
  Pause: 0xff13,
  ContextMenu: 0xff67,
  AltGraph: 0xfe03,
  Shift: 0xffe1,
  Control: 0xffe3,
  Meta: 0xffeb,
  Alt: 0xffe9,
};
export function keysym(key: string, location: number) {
  if (location === 2 && ["Shift", "Control", "Meta", "Alt"].includes(key))
    return named[key] + 1;
  if (location === 3 && key === "Enter") return 0xff8d;
  if (named[key]) return named[key];
  if (/^F([1-9]|[12]\d|3[0-5])$/.test(key))
    return 0xffbd + Number(key.slice(1));
  if (Array.from(key).length !== 1) return null;
  const cp = key.codePointAt(0)!;
  return cp > 255 ? 0x01000000 + cp : cp;
}
export function pointerPosition(
  canvas: HTMLCanvasElement,
  [width, height]: readonly [number, number],
  clientX: number,
  clientY: number,
) {
  const r = canvas.getBoundingClientRect();
  const axis = (v: number, origin: number, extent: number, pixels: number) =>
    Math.min(
      pixels - 1,
      Math.max(0, Math.floor(((v - origin) * pixels) / extent)),
    );
  return {
    x: axis(clientX, r.left, r.width, width),
    y: axis(clientY, r.top, r.height, height),
  };
}
export const pointerButtons = (dom: number) =>
  (dom & 1) | ((dom & 2) << 1) | ((dom & 4) >> 1);
