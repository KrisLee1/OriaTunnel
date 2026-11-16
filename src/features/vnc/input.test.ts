import { describe, expect, it } from "vitest";
import {
  keysym,
  pointerButtons,
  pointerPosition,
  wheelPulseFilter,
} from "./input";

describe("VNC canvas input", () => {
  it("distinguishes modifier sides, AltGr, keypad enter and Unicode", () => {
    for (const [name, left] of [
      ["Shift", 0xffe1],
      ["Control", 0xffe3],
      ["Alt", 0xffe9],
      ["Meta", 0xffeb],
    ] as const) {
      expect(keysym(name, 1)).toBe(left);
      expect(keysym(name, 2)).toBe(left + 1);
    }
    expect(keysym("AltGraph", 2)).toBe(0xfe03);
    expect(keysym("Enter", 3)).toBe(0xff8d);
    expect(keysym("中", 0)).toBe(0x01004e2d);
    expect(keysym("Dead", 0)).toBeNull();
  });
  it("accumulates tiny trackpad deltas while preserving discrete wheels and direction changes", () => {
    const pulse = wheelPulseFilter();
    const ticks = Array.from({ length: 51 }, (_, i) => pulse(0, 1, 0, i * 4));
    expect(ticks.filter(Boolean)).toEqual([16, 16]);
    expect(pulse(0, -1, 0, 205)).toBe(8);
    expect(pulse(3, 0, 1, 210)).toBe(64);
    expect(pulse(3, 0, 1, 215)).toBe(64);
    expect(pulse(1, 0, 0, 500)).toBe(64);
  });
  it("clamps captured drags and maps scaled and scrolled canvas coordinates", () => {
    const screen = {
      width: 1800,
      height: 1350,
      getBoundingClientRect: () => ({
        left: -60,
        top: 30,
        width: 1200,
        height: 900,
      }),
    } as HTMLCanvasElement;
    expect(pointerPosition(screen, [800, 600], 540, 480)).toEqual({
      x: 400,
      y: 300,
    });
    expect(pointerPosition(screen, [800, 600], -1000, 3000)).toEqual({
      x: 0,
      y: 599,
    });
    expect(pointerButtons(3)).toBe(5);
    expect(pointerButtons(4)).toBe(2);
  });
});
