import { GRAYSCALE_PATTERNS, type GrayscalePattern } from "./color-palette";

export const LINE_STYLES = [
  "solid",
  "dashed",
  "dotted",
  "dashdot",
  "longdash",
] as const;
export const MARKER_STYLES = [
  "none",
  "circle",
  "square",
  "triangle",
  "diamond",
  "plus",
  "cross",
  "hexagon",
  "star",
] as const;
export const LINE_DASHES = {
  solid: "",
  dashed: "8 4",
  dotted: "2 3",
  dashdot: "8 3 2 3",
  longdash: "14 5",
} as const;
export type LineStyle = (typeof LINE_STYLES)[number];
export type MarkerStyle = (typeof MARKER_STYLES)[number];
export interface SeriesAppearance {
  color?: string;
  peakColor?: string;
  label?: string;
  lineStyle?: LineStyle;
  marker?: MarkerStyle;
  pattern?: GrayscalePattern;
}
export interface ChartAppearance {
  palette?: string[];
  peakColor?: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  fontSize?: number;
  lineWidth?: number;
  markerSize?: number;
  grid?: "auto" | "none" | "x" | "y" | "both";
  gridStyle?: LineStyle;
  legend?: "auto" | "hidden" | "top" | "bottom";
  series?: SeriesAppearance[];
}
export interface ChartAppearanceTarget {
  kind: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  series: string[];
  fontSize?: number;
  lineWidth?: number;
  markerSize?: number;
}
export function chartStyleCapabilities(kind: string) {
  return {
    fill: [
      "bar",
      "boxplot",
      "histogram",
      "pie",
      "donut",
      "area",
      "violin",
      "raincloud",
      "diagram",
    ].includes(kind),
    line: [
      "line",
      "area",
      "density",
      "polar",
      "parallel",
      "function",
      "roc",
      "precision-recall",
      "calibration",
      "spectrum",
    ].includes(kind),
    marker: [
      "line",
      "area",
      "scatter",
      "polar",
      "swarm",
      "raincloud",
      "joint",
      "function",
    ].includes(kind),
    axes: ![
      "pie",
      "donut",
      "diagram",
      "schematic",
      "pairs",
      "ternary",
    ].includes(kind),
    legend: !["diagram", "schematic", "pairs", "ternary"].includes(kind),
  };
}
/** Shared closed appearance vocabulary; no data bindings, calculations, CSS or executable content. */
export function parseChartAppearance(value: unknown): ChartAppearance {
  const record = (v: unknown, keys: string[]) => {
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      Object.keys(v).some((k) => !keys.includes(k))
    )
      throw new Error("Invalid chart appearance");
    return v as Record<string, unknown>;
  };
  const text = (v: unknown) => {
    if (typeof v !== "string" || new TextEncoder().encode(v).length > 200)
      throw new Error("Appearance label exceeds 200 bytes");
    return v;
  };
  const choice = <T extends string>(v: unknown, choices: readonly T[]): T => {
    if (!choices.includes(v as T)) throw new Error("Invalid appearance style");
    return v as T;
  };
  const number = (v: unknown, min: number, max: number) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
      throw new Error("Appearance size outside limits");
    return v;
  };
  const v = record(value, [
    "title",
    "xLabel",
    "yLabel",
    "fontSize",
    "lineWidth",
    "markerSize",
    "grid",
    "gridStyle",
    "legend",
    "series",
    "palette",
    "peakColor",
  ]);
  const color = (v: unknown) => {
    if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v))
      throw new Error("Invalid appearance color");
    return v;
  };
  const result: ChartAppearance = {};
  if (v.peakColor !== undefined) result.peakColor = color(v.peakColor);
  if (v.palette !== undefined) {
    if (!Array.isArray(v.palette) || !v.palette.length || v.palette.length > 24)
      throw new Error("Invalid appearance palette");
    result.palette = v.palette.map(color);
  }
  for (const key of ["title", "xLabel", "yLabel"] as const)
    if (v[key] !== undefined) result[key] = text(v[key]);
  for (const [key, min, max] of [
    ["fontSize", 5, 24],
    ["lineWidth", 0.2, 5],
    ["markerSize", 1, 12],
  ] as const)
    if (v[key] !== undefined) result[key] = number(v[key], min, max);
  if (v.grid !== undefined)
    result.grid = choice(v.grid, ["auto", "none", "x", "y", "both"] as const);
  if (v.gridStyle !== undefined)
    result.gridStyle = choice(v.gridStyle, LINE_STYLES);
  if (v.legend !== undefined)
    result.legend = choice(v.legend, [
      "auto",
      "hidden",
      "top",
      "bottom",
    ] as const);
  if (v.series !== undefined) {
    if (!Array.isArray(v.series) || v.series.length > 24)
      throw new Error("Too many appearance series");
    result.series = v.series.map((item) => {
      const s = record(item, [
        "label",
        "lineStyle",
        "marker",
        "pattern",
        "color",
        "peakColor",
      ]);
      const out: SeriesAppearance = {};
      if (s.color !== undefined) out.color = color(s.color);
      if (s.peakColor !== undefined) out.peakColor = color(s.peakColor);
      if (s.label !== undefined) out.label = text(s.label);
      if (s.lineStyle !== undefined)
        out.lineStyle = choice(s.lineStyle, LINE_STYLES);
      if (s.marker !== undefined) out.marker = choice(s.marker, MARKER_STYLES);
      if (s.pattern !== undefined)
        out.pattern = choice(s.pattern, GRAYSCALE_PATTERNS);
      return out;
    });
  }
  return result;
}
