export const COLOR_PALETTE_SEQUENCE = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#CC79A7",
  "#D55E00",
  "#56B4E9",
  "#6F5AA8",
  "#8A6D1D",
] as const;

export const DEFAULT_COLOR_PALETTE = COLOR_PALETTE_SEQUENCE.slice(0, 4);

export type HsvColor = { h: number; s: number; v: number };
export const COLOR_HARMONIES = [
  "custom",
  "analogous",
  "monochromatic",
  "complementary",
  "split",
  "triadic",
  "tetradic",
  "shades",
] as const;
export type ColorHarmony = (typeof COLOR_HARMONIES)[number];
export type ColorPaletteMode = ColorHarmony | "grayscale" | "high-contrast";
export const GRAYSCALE_PATTERNS = [
  "diagonal",
  "reverse",
  "cross",
  "dots",
  "horizontal",
  "vertical",
  "solid",
  "none",
] as const;
export type GrayscalePattern = (typeof GRAYSCALE_PATTERNS)[number];
export function resolveGrayscalePatterns(value: unknown): GrayscalePattern[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 12 &&
    value.every((v) => GRAYSCALE_PATTERNS.includes(v))
    ? [...value]
    : [...GRAYSCALE_PATTERNS];
}
/** Shared vector marks for the picker, sample chart and aide-chart SVG export. */
export function grayscalePatternSvg(pattern: GrayscalePattern): string {
  const path =
    pattern === "diagonal"
      ? "M-2 2L2-2M0 8L8 0M6 10L10 6"
      : pattern === "reverse"
        ? "M-2 6L2 10M0 0L8 8M6-2L10 2"
        : pattern === "cross"
          ? "M0 0L8 8M0 8L8 0"
          : pattern === "horizontal"
            ? "M0 2H8M0 6H8"
            : pattern === "vertical"
              ? "M2 0V8M6 0V8"
              : "";
  return `<rect width="8" height="8" fill="${pattern === "solid" ? "#777777" : "#f7f7f7"}"/>${path ? `<path d="${path}" stroke="#333333" stroke-width=".8" fill="none"/>` : pattern === "dots" ? '<circle cx="2" cy="2" r=".8" fill="#333333"/><circle cx="6" cy="6" r=".8" fill="#333333"/>' : ""}`;
}
/** Shared with the aide-chart publication presets. */
export const COLOR_PALETTE_PRESETS = {
  grayscale: [
    "#f7f7f7",
    "#dedede",
    "#c6c6c6",
    "#ababab",
    "#8f8f8f",
    "#737373",
    "#575757",
    "#3b3b3b",
  ],
  "high-contrast": [
    "#000000",
    "#0057b8",
    "#c43c00",
    "#007a53",
    "#a3006d",
    "#6b4f00",
    "#006a8e",
    "#5a3e9b",
  ],
} as const;
export function presetPalette(
  mode: "grayscale" | "high-contrast",
  count: number,
): string[] {
  const colors = COLOR_PALETTE_PRESETS[mode];
  return Array.from({ length: count }, (_, i) =>
    colors[i % colors.length].toUpperCase(),
  );
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const hue = (h: number) => ((h % 360) + 360) % 360;

/** All consumers receive opaque, six-digit sRGB hex colors. */
export function normalizePaletteColor(input: string): string | null {
  const value = input.trim();
  if (/^#?[\da-f]{6}$/i.test(value))
    return `#${value.replace("#", "").toUpperCase()}`;
  if (/^#[\da-f]{3}$/i.test(value))
    return `#${[...value.slice(1)]
      .map((c) => c + c)
      .join("")
      .toUpperCase()}`;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(
    value,
  );
  if (rgb && rgb.slice(1).every((c) => Number(c) <= 255))
    return `#${rgb
      .slice(1)
      .map((c) => Number(c).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
  return null;
}

export function hexToHsv(hex: string): HsvColor {
  const color = normalizePaletteColor(hex) ?? "#000000";
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(color.slice(i, i + 2), 16) / 255,
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const h = !d
    ? 0
    : max === r
      ? (g - b) / d
      : max === g
        ? 2 + (b - r) / d
        : 4 + (r - g) / d;
  return { h: hue(h * 60), s: max ? d / max : 0, v: max };
}
export function hsvToHex({ h, s, v }: HsvColor): string {
  const sector = hue(h) / 60,
    c = clamp(v) * clamp(s),
    x = c * (1 - Math.abs((sector % 2) - 1)),
    m = clamp(v) - c;
  const rgb =
    sector < 1
      ? [c, x, 0]
      : sector < 2
        ? [x, c, 0]
        : sector < 3
          ? [0, c, x]
          : sector < 4
            ? [0, x, c]
            : sector < 5
              ? [x, 0, c]
              : [c, 0, x];
  return `#${rgb
    .map((n) =>
      Math.round((n + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}
export function wheelColor(x: number, y: number, v: number): HsvColor {
  return {
    h: hue((Math.atan2(y, x) * 180) / Math.PI),
    s: clamp(Math.hypot(x, y)),
    v,
  };
}
export function harmonyPalette(
  colors: readonly string[],
  active: number,
  base: HsvColor,
  mode: ColorHarmony,
): string[] {
  return colors.map((color, i) => {
    if (i === active) return hsvToHex(base);
    if (mode === "custom") return color;
    const offset = (i - active + colors.length) % colors.length;
    if (mode === "monochromatic")
      return hsvToHex({
        ...base,
        s: clamp(
          base.s * (1 - (0.65 * offset) / Math.max(1, colors.length - 1)),
        ),
        v: clamp(
          base.v * (1 - (0.5 * offset) / Math.max(1, colors.length - 1)),
        ),
      });
    if (mode === "shades")
      return hsvToHex({ ...base, v: 0.2 + (0.8 * offset) / colors.length });
    const steps =
      mode === "complementary"
        ? [0, 180]
        : mode === "split"
          ? [0, 150, 210]
          : mode === "triadic"
            ? [0, 120, 240]
            : mode === "tetradic"
              ? [0, 90, 180, 270]
              : null;
    return hsvToHex({
      ...base,
      h: base.h + (steps ? steps[offset % steps.length] : (i - active) * 25),
      v: steps
        ? clamp(base.v - Math.floor(offset / steps.length) * 0.12)
        : base.v,
    });
  });
}
