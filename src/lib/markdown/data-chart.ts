import {
  parseChartAppearance,
  LINE_DASHES,
  MARKER_STYLES,
  type ChartAppearance,
} from "./chart-appearance";
import {
  COLOR_PALETTE_PRESETS,
  grayscalePatternSvg,
  resolveGrayscalePatterns,
  type GrayscalePattern,
} from "./color-palette";
export type DataChartType =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "scatter"
  | "heatmap"
  | "boxplot";

export type DataChartBarOrientation = "vertical" | "horizontal";

export type DataChartStylePreset =
  | "default"
  | "academic"
  | "grayscale"
  | "high-contrast";

export interface DataChartAxis {
  label?: string;
  min?: number;
  max?: number;
}

export interface DataChartCategoryAxis {
  label?: string;
}

export interface DataChartValueSeries {
  name: string;
  values: (number | null)[];
}

export interface DataChartScatterPoint {
  x: number;
  y: number;
  label?: string;
}

export interface DataChartScatterSeries {
  name: string;
  points: DataChartScatterPoint[];
}

export interface DataChartBoxSummary {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers?: number[];
}

export interface DataChartBoxSeries {
  name: string;
  boxes: (DataChartBoxSummary | null)[];
}

interface DataChartCommonSpec {
  appearance?: ChartAppearance;
  title?: string;
  subtitle?: string;
  showLegend?: boolean;
  showValues?: boolean;
  stylePreset?: DataChartStylePreset;
  palette?: string[];
}

export interface DataChartBarSpec extends DataChartCommonSpec {
  type: "bar";
  labels: string[];
  series: DataChartValueSeries[];
  orientation?: DataChartBarOrientation;
  xAxis?: DataChartAxis;
  yAxis?: DataChartAxis;
  stacked?: boolean;
}

export interface DataChartCartesianSpec extends DataChartCommonSpec {
  type: "line" | "area";
  labels: string[];
  series: DataChartValueSeries[];
  xAxis?: DataChartCategoryAxis;
  yAxis?: DataChartAxis;
  stacked?: never;
}

interface DataChartPolarBaseSpec extends DataChartCommonSpec {
  labels: string[];
  series: DataChartValueSeries[];
  stacked?: never;
}

export interface DataChartPieSpec extends DataChartPolarBaseSpec {
  type: "pie";
}

export interface DataChartDonutSpec extends DataChartPolarBaseSpec {
  type: "donut";
}

export type DataChartPolarSpec = DataChartPieSpec | DataChartDonutSpec;

export interface DataChartScatterSpec extends DataChartCommonSpec {
  type: "scatter";
  series: DataChartScatterSeries[];
  xAxis?: DataChartAxis;
  yAxis?: DataChartAxis;
  labels?: never;
  stacked?: never;
}

export interface DataChartHeatmapSpec extends DataChartCommonSpec {
  type: "heatmap";
  labels: string[];
  series: DataChartValueSeries[];
  xAxis?: DataChartCategoryAxis;
  yAxis?: DataChartCategoryAxis;
  stacked?: never;
}

export interface DataChartBoxplotSpec extends DataChartCommonSpec {
  type: "boxplot";
  labels: string[];
  series: DataChartBoxSeries[];
  xAxis?: DataChartCategoryAxis;
  yAxis?: DataChartAxis;
  stacked?: never;
}

export type DataChartSpec =
  | DataChartBarSpec
  | DataChartCartesianSpec
  | DataChartPolarSpec
  | DataChartScatterSpec
  | DataChartHeatmapSpec
  | DataChartBoxplotSpec;

export type DataChartParseResult =
  | { ok: true; spec: DataChartSpec }
  | { ok: false; reason: string };

export interface DataChartTheme {
  appearance?: ChartAppearance;
  grayscalePatterns?: GrayscalePattern[];
  background: string;
  foreground: string;
  muted: string;
  grid: string;
  palette: string[];
}

export interface DataChartRenderOptions {
  idPrefix?: string;
  title?: string;
  description?: string;
  locale?: string;
}

interface ResolvedDataChartStyle {
  preset: DataChartStylePreset;
  theme: DataChartTheme;
}

/** Okabe-Ito based palette, ordered for useful contrast on light and dark surfaces. */
export const defaultDataChartTheme: DataChartTheme = {
  background: "transparent",
  foreground: "#263238",
  muted: "#607d8b",
  grid: "#c7d0d9",
  palette: [
    "#0072b2",
    "#e69f00",
    "#009e73",
    "#cc79a7",
    "#d55e00",
    "#56b4e9",
    "#6f5aa8",
    "#8a6d1d",
  ],
};

const chartWidth = 960;
const chartHeight = 600;
const maxSourceLength = 200_000;
const maxLabels = 80;
const maxSeries = 8;
const maxScatterPoints = 300;
const maxHeatmapRows = 24;
const maxHeatmapCells = 480;
const maxBoxplotOutliers = 300;
const maxOutliersPerBox = 20;
const maxAbsoluteValue = 1_000_000_000_000;
const maxTitleLength = 200;
const maxSubtitleLength = 300;
const maxLabelLength = 120;
const maxSeriesNameLength = 120;
const maxPaletteSize = 8;
const maxPolarLabels = 8;

const chartTypes = new Set<DataChartType>([
  "bar",
  "line",
  "area",
  "pie",
  "donut",
  "scatter",
  "heatmap",
  "boxplot",
]);

const stylePresets = new Set<DataChartStylePreset>([
  "default",
  "academic",
  "grayscale",
  "high-contrast",
]);

const rootKeys = new Set([
  "type",
  "appearance",
  "title",
  "subtitle",
  "xAxis",
  "yAxis",
  "stacked",
  "orientation",
  "showLegend",
  "showValues",
  "stylePreset",
  "palette",
  "labels",
  "series",
]);

export function parseDataChartSpec(source: string): DataChartParseResult {
  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, reason: "Chart JSON is empty" };
  }
  if (source.length > maxSourceLength) {
    return {
      ok: false,
      reason: `Chart JSON exceeds ${maxSourceLength} characters`,
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, reason: "Chart content is not valid JSON" };
  }

  try {
    return { ok: true, spec: validateSpec(value) };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : "Chart specification is invalid",
    };
  }
}

export function dataChartKey(
  scopeId: string,
  source: string,
  sourceOffset = 0,
): string {
  const value = `${scopeId}\0${sourceOffset}\0${source}`;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }

  const hex = (part: number) => (part >>> 0).toString(16).padStart(8, "0");
  return `chart-v1-${hex(first)}${hex(second)}`;
}

export function renderDataChartSvg(
  spec: DataChartSpec,
  theme: DataChartTheme = defaultDataChartTheme,
  options: DataChartRenderOptions = {},
): string {
  if (spec.appearance) {
    const a = parseChartAppearance(spec.appearance);
    spec = {
      ...spec,
      ...(a.title !== undefined ? { title: a.title } : {}),
      ...(a.legend && a.legend !== "auto"
        ? { showLegend: a.legend !== "hidden" }
        : {}),
    };
    if (spec.type === "pie" || spec.type === "donut")
      spec = {
        ...spec,
        labels: spec.labels.map((v, i) => a.series?.[i]?.label ?? v),
      };
    else
      spec = {
        ...spec,
        series: spec.series.map((v, i) => ({
          ...v,
          name: a.series?.[i]?.label ?? v.name,
        })),
      } as DataChartSpec;
    if (spec.type !== "pie" && spec.type !== "donut")
      spec = {
        ...spec,
        ...(a.xLabel !== undefined
          ? { xAxis: { ...spec.xAxis, label: a.xLabel } }
          : {}),
        ...(a.yLabel !== undefined
          ? { yAxis: { ...spec.yAxis, label: a.yLabel } }
          : {}),
      };
  }
  const prefix = safeId(options.idPrefix || "aide-data-chart");
  const resolvedStyle = resolveDataChartStyle(spec, theme);
  const resolvedTheme = resolvedStyle.theme;
  const titleId = `${prefix}-title`;
  const descriptionId = `${prefix}-description`;
  const clipId = `${prefix}-plot-clip`;
  const accessibleTitle = limitText(
    options.title || spec.title || `${spec.type} chart`,
    maxTitleLength,
  );
  const accessibleDescription = limitText(
    options.description || chartDescription(spec),
    500,
  );
  const showLegend = spec.showLegend ?? defaultLegendVisibility(spec);
  const legendEntries = chartLegendEntries(spec, resolvedTheme);
  const scalarLegendHeight = spec.type === "heatmap" && showLegend ? 58 : 0;
  const legendHeight =
    showLegend && legendEntries.length
      ? Math.ceil(Math.min(legendEntries.length, 12) / 4) *
          Math.max(24, (spec.appearance?.fontSize ?? 11) + 13) +
        16
      : scalarLegendHeight;
  const titleHeight = headingLayout(spec).height;
  const legendTop =
    spec.appearance?.legend === "top" && spec.type !== "heatmap";
  const plot = {
    left:
      spec.type === "heatmap" ||
      (spec.type === "bar" && spec.orientation === "horizontal")
        ? 138
        : 88,
    right: chartWidth - 34,
    top: titleHeight + 18 + (legendTop ? legendHeight : 0),
    bottom: chartHeight - 66 - (legendTop ? 0 : legendHeight),
  };
  const content =
    spec.type === "pie" || spec.type === "donut"
      ? renderPolarChart(spec, resolvedStyle, options.locale, plot, prefix)
      : spec.type === "scatter"
        ? renderScatterChart(spec, resolvedStyle, options.locale, plot, clipId)
        : spec.type === "heatmap"
          ? renderHeatmapChart(
              spec,
              resolvedStyle,
              options.locale,
              plot,
              prefix,
              showLegend,
            )
          : spec.type === "boxplot"
            ? renderBoxplotChart(
                spec,
                resolvedStyle,
                options.locale,
                plot,
                clipId,
                prefix,
              )
            : renderCartesianChart(
                spec,
                resolvedStyle,
                options.locale,
                plot,
                clipId,
                prefix,
              );
  const legend = showLegend
    ? renderLegend(
        legendEntries,
        resolvedStyle,
        legendTop ? titleHeight + 12 : chartHeight - legendHeight + 4,
        prefix,
        spec.type,
      )
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-labelledby="${escapeXmlAttribute(titleId)} ${escapeXmlAttribute(descriptionId)}" data-chart-type="${spec.type}" data-style-preset="${resolvedStyle.preset}">`,
    `<title id="${escapeXmlAttribute(titleId)}">${escapeXmlText(accessibleTitle)}</title>`,
    `<desc id="${escapeXmlAttribute(descriptionId)}">${escapeXmlText(accessibleDescription)}</desc>`,
    `<rect width="${chartWidth}" height="${chartHeight}" fill="${paint(resolvedTheme.background)}"/>`,
    `<g font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif">`,
    renderHeading(spec, resolvedTheme),
    `<defs><clipPath id="${escapeXmlAttribute(clipId)}"><rect x="${plot.left}" y="${plot.top}" width="${plot.right - plot.left}" height="${plot.bottom - plot.top}"/></clipPath>${renderStyleDefinitions(resolvedStyle, prefix)}</defs>`,
    content,
    legend,
    "</g>",
    "</svg>",
  ].join("");
}

function validateSpec(value: unknown): DataChartSpec {
  const root = requireRecord(value, "Chart specification");
  rejectUnknownKeys(root, rootKeys, "Chart specification");
  const type = root.type;
  if (typeof type !== "string" || !chartTypes.has(type as DataChartType)) {
    throw new Error(
      "Chart type must be bar, line, area, pie, donut, scatter, heatmap, or boxplot",
    );
  }
  const chartType = type as DataChartType;
  const common = {
    ...optionalProperty(
      "appearance",
      root.appearance === undefined
        ? undefined
        : parseChartAppearance(root.appearance),
    ),
    ...optionalProperty(
      "title",
      readOptionalText(root.title, "title", maxTitleLength),
    ),
    ...optionalProperty(
      "subtitle",
      readOptionalText(root.subtitle, "subtitle", maxSubtitleLength),
    ),
    ...optionalProperty(
      "showLegend",
      readOptionalBoolean(root.showLegend, "showLegend"),
    ),
    ...optionalProperty(
      "showValues",
      readOptionalBoolean(root.showValues, "showValues"),
    ),
    ...optionalProperty(
      "stylePreset",
      readOptionalStylePreset(root.stylePreset),
    ),
    ...optionalProperty("palette", readOptionalPalette(root.palette)),
  };

  if (
    chartType !== "bar" &&
    Object.prototype.hasOwnProperty.call(root, "stacked")
  ) {
    throw new Error("stacked is supported only for bar charts");
  }
  if (
    chartType !== "bar" &&
    Object.prototype.hasOwnProperty.call(root, "orientation")
  ) {
    throw new Error("orientation is supported only for bar charts");
  }

  const rawSeries = requireArray(root.series, "series");
  const seriesLimit = chartType === "heatmap" ? maxHeatmapRows : maxSeries;
  if (rawSeries.length < 1 || rawSeries.length > seriesLimit) {
    throw new Error(`series must contain between 1 and ${seriesLimit} items`);
  }

  if (chartType === "scatter") {
    if (Object.prototype.hasOwnProperty.call(root, "labels")) {
      throw new Error("scatter charts must not define labels");
    }
    const series = rawSeries.map((candidate, seriesIndex) =>
      validateScatterSeries(candidate, seriesIndex),
    );
    const pointCount = series.reduce(
      (total, item) => total + item.points.length,
      0,
    );
    if (pointCount === 0)
      throw new Error("scatter charts require at least one point");
    if (pointCount > maxScatterPoints) {
      throw new Error(
        `scatter charts support at most ${maxScatterPoints} points`,
      );
    }
    return {
      type: "scatter",
      ...common,
      ...optionalProperty("xAxis", readOptionalAxis(root.xAxis, "xAxis", true)),
      ...optionalProperty("yAxis", readOptionalAxis(root.yAxis, "yAxis", true)),
      series,
    };
  }

  const labels = requireArray(root.labels, "labels");
  if (labels.length < 1 || labels.length > maxLabels) {
    throw new Error(`labels must contain between 1 and ${maxLabels} items`);
  }
  const normalizedLabels = labels.map((label, index) =>
    readText(label, `labels[${index}]`, maxLabelLength),
  );

  if (chartType === "boxplot") {
    const series = rawSeries.map((candidate, seriesIndex) =>
      validateBoxSeries(candidate, seriesIndex, normalizedLabels.length),
    );
    const boxCount = series.reduce(
      (total, item) => total + item.boxes.filter((box) => box !== null).length,
      0,
    );
    if (boxCount === 0)
      throw new Error("boxplot charts require at least one box");
    const outlierCount = series.reduce(
      (total, item) =>
        total +
        item.boxes.reduce(
          (subtotal, box) => subtotal + (box?.outliers?.length ?? 0),
          0,
        ),
      0,
    );
    if (outlierCount > maxBoxplotOutliers) {
      throw new Error(
        `boxplot charts support at most ${maxBoxplotOutliers} outliers`,
      );
    }
    return {
      type: "boxplot",
      ...common,
      ...optionalProperty(
        "xAxis",
        readOptionalAxis(root.xAxis, "xAxis", false),
      ),
      ...optionalProperty("yAxis", readOptionalAxis(root.yAxis, "yAxis", true)),
      labels: normalizedLabels,
      series,
    };
  }

  const series = rawSeries.map((candidate, seriesIndex) =>
    validateValueSeries(candidate, seriesIndex, normalizedLabels.length),
  );
  if (!series.some((item) => item.values.some(isNumber))) {
    throw new Error(`${chartType} charts require at least one numeric value`);
  }

  if ((chartType === "pie" || chartType === "donut") && series.length !== 1) {
    throw new Error(`${chartType} charts require exactly one series`);
  }
  if (chartType === "pie" || chartType === "donut") {
    if (normalizedLabels.length > maxPolarLabels) {
      throw new Error(
        `${chartType} charts support at most ${maxPolarLabels} labels`,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(root, "xAxis") ||
      Object.prototype.hasOwnProperty.call(root, "yAxis")
    ) {
      throw new Error(`${chartType} charts do not support axes`);
    }
    const values = series[0].values;
    if (values.some((entry) => entry !== null && entry < 0)) {
      throw new Error(`${chartType} chart values must be non-negative`);
    }
    const total = values.reduce<number>((sum, entry) => sum + (entry ?? 0), 0);
    if (!(total > 0))
      throw new Error(`${chartType} chart values must have a positive total`);
    return { type: chartType, ...common, labels: normalizedLabels, series };
  }

  if (chartType === "heatmap") {
    if (normalizedLabels.length * series.length > maxHeatmapCells) {
      throw new Error(
        `heatmap charts support at most ${maxHeatmapCells} cells`,
      );
    }
    return {
      type: "heatmap",
      ...common,
      ...optionalProperty(
        "xAxis",
        readOptionalAxis(root.xAxis, "xAxis", false),
      ),
      ...optionalProperty(
        "yAxis",
        readOptionalAxis(root.yAxis, "yAxis", false),
      ),
      labels: normalizedLabels,
      series,
    };
  }

  if (chartType === "bar") {
    const stacked = readOptionalBoolean(root.stacked, "stacked");
    const orientation = readOptionalBarOrientation(root.orientation);
    const horizontal = orientation === "horizontal";
    return {
      type: "bar",
      ...common,
      ...optionalProperty("orientation", orientation),
      ...optionalProperty(
        "xAxis",
        readOptionalAxis(root.xAxis, "xAxis", horizontal),
      ),
      ...optionalProperty(
        "yAxis",
        readOptionalAxis(root.yAxis, "yAxis", !horizontal),
      ),
      ...optionalProperty("stacked", stacked),
      labels: normalizedLabels,
      series,
    };
  }
  return {
    type: chartType,
    ...common,
    ...optionalProperty("xAxis", readOptionalAxis(root.xAxis, "xAxis", false)),
    ...optionalProperty("yAxis", readOptionalAxis(root.yAxis, "yAxis", true)),
    labels: normalizedLabels,
    series,
  };
}

function validateValueSeries(
  value: unknown,
  seriesIndex: number,
  labelCount: number,
): DataChartValueSeries {
  const path = `series[${seriesIndex}]`;
  const series = requireRecord(value, path);
  rejectUnknownKeys(series, new Set(["name", "values"]), path);
  const values = requireArray(series.values, `${path}.values`);
  if (values.length !== labelCount) {
    throw new Error(`${path}.values must have the same length as labels`);
  }
  return {
    name: readText(series.name, `${path}.name`, maxSeriesNameLength),
    values: values.map((entry, valueIndex) =>
      entry === null
        ? null
        : readNumber(entry, `${path}.values[${valueIndex}]`),
    ),
  };
}

function validateScatterSeries(
  value: unknown,
  seriesIndex: number,
): DataChartScatterSeries {
  const path = `series[${seriesIndex}]`;
  const series = requireRecord(value, path);
  rejectUnknownKeys(series, new Set(["name", "points"]), path);
  const points = requireArray(series.points, `${path}.points`);
  return {
    name: readText(series.name, `${path}.name`, maxSeriesNameLength),
    points: points.map((candidate, pointIndex) => {
      const pointPath = `${path}.points[${pointIndex}]`;
      const point = requireRecord(candidate, pointPath);
      rejectUnknownKeys(point, new Set(["x", "y", "label"]), pointPath);
      return {
        x: readNumber(point.x, `${pointPath}.x`),
        y: readNumber(point.y, `${pointPath}.y`),
        ...optionalProperty(
          "label",
          readOptionalText(point.label, `${pointPath}.label`, maxLabelLength),
        ),
      };
    }),
  };
}

function validateBoxSeries(
  value: unknown,
  seriesIndex: number,
  labelCount: number,
): DataChartBoxSeries {
  const path = `series[${seriesIndex}]`;
  const series = requireRecord(value, path);
  rejectUnknownKeys(series, new Set(["name", "boxes"]), path);
  const boxes = requireArray(series.boxes, `${path}.boxes`);
  if (boxes.length !== labelCount) {
    throw new Error(`${path}.boxes must have the same length as labels`);
  }
  return {
    name: readText(series.name, `${path}.name`, maxSeriesNameLength),
    boxes: boxes.map((candidate, boxIndex) => {
      if (candidate === null) return null;
      const boxPath = `${path}.boxes[${boxIndex}]`;
      const box = requireRecord(candidate, boxPath);
      rejectUnknownKeys(
        box,
        new Set(["min", "q1", "median", "q3", "max", "outliers"]),
        boxPath,
      );
      const summary: DataChartBoxSummary = {
        min: readNumber(box.min, `${boxPath}.min`),
        q1: readNumber(box.q1, `${boxPath}.q1`),
        median: readNumber(box.median, `${boxPath}.median`),
        q3: readNumber(box.q3, `${boxPath}.q3`),
        max: readNumber(box.max, `${boxPath}.max`),
        ...optionalProperty(
          "outliers",
          readOptionalOutliers(box.outliers, boxPath),
        ),
      };
      if (
        !(
          summary.min <= summary.q1 &&
          summary.q1 <= summary.median &&
          summary.median <= summary.q3 &&
          summary.q3 <= summary.max
        )
      ) {
        throw new Error(
          `${boxPath} must satisfy min <= q1 <= median <= q3 <= max`,
        );
      }
      return summary;
    }),
  };
}

function readOptionalOutliers(
  value: unknown,
  boxPath: string,
): number[] | undefined {
  if (value === undefined) return undefined;
  const outliers = requireArray(value, `${boxPath}.outliers`);
  if (outliers.length > maxOutliersPerBox) {
    throw new Error(
      `${boxPath}.outliers supports at most ${maxOutliersPerBox} values`,
    );
  }
  return outliers.map((outlier, index) =>
    readNumber(outlier, `${boxPath}.outliers[${index}]`),
  );
}

function readOptionalBarOrientation(
  value: unknown,
): DataChartBarOrientation | undefined {
  if (value === undefined) return undefined;
  if (value !== "vertical" && value !== "horizontal") {
    throw new Error("orientation must be vertical or horizontal");
  }
  return value;
}

function readOptionalAxis(
  value: unknown,
  path: string,
  allowRange: true,
): DataChartAxis | undefined;
function readOptionalAxis(
  value: unknown,
  path: string,
  allowRange: false,
): DataChartCategoryAxis | undefined;
function readOptionalAxis(
  value: unknown,
  path: string,
  allowRange: boolean,
): DataChartAxis | DataChartCategoryAxis | undefined;
function readOptionalAxis(
  value: unknown,
  path: string,
  allowRange: boolean,
): DataChartAxis | DataChartCategoryAxis | undefined {
  if (value === undefined) return undefined;
  const axis = requireRecord(value, path);
  rejectUnknownKeys(
    axis,
    new Set(allowRange ? ["label", "min", "max"] : ["label"]),
    path,
  );
  if (!allowRange) {
    return {
      ...optionalProperty(
        "label",
        readOptionalText(axis.label, `${path}.label`, maxLabelLength),
      ),
    };
  }
  const min = readOptionalNumber(axis.min, `${path}.min`);
  const max = readOptionalNumber(axis.max, `${path}.max`);
  if (min !== undefined && max !== undefined && min >= max) {
    throw new Error(`${path}.min must be less than ${path}.max`);
  }
  return {
    ...optionalProperty(
      "label",
      readOptionalText(axis.label, `${path}.label`, maxLabelLength),
    ),
    ...optionalProperty("min", min),
    ...optionalProperty("max", max),
  };
}

function readOptionalStylePreset(
  value: unknown,
): DataChartStylePreset | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !stylePresets.has(value as DataChartStylePreset)
  ) {
    throw new Error(
      "stylePreset must be default, academic, grayscale, or high-contrast",
    );
  }
  return value as DataChartStylePreset;
}

function readOptionalPalette(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const palette = requireArray(value, "palette");
  if (palette.length < 1 || palette.length > maxPaletteSize) {
    throw new Error(
      `palette must contain between 1 and ${maxPaletteSize} colors`,
    );
  }
  return palette.map((color, index) => {
    if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color)) {
      throw new Error(`palette[${index}] must be a six-digit #RRGGBB color`);
    }
    return color;
  });
}

function readOptionalBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function readOptionalNumber(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : readNumber(value, path);
}

function readNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  if (Math.abs(value) > maxAbsoluteValue) {
    throw new Error(
      `${path} must be between -${maxAbsoluteValue} and ${maxAbsoluteValue}`,
    );
  }
  return value;
}

function readOptionalText(
  value: unknown,
  path: string,
  maxLength: number,
): string | undefined {
  return value === undefined ? undefined : readText(value, path, maxLength);
}

function readText(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  if (Array.from(value).length > maxLength) {
    throw new Error(`${path} exceeds ${maxLength} characters`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${path}.${unknown} is not supported`);
}

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { [Property in Key]?: Value } {
  return value === undefined
    ? {}
    : ({ [key]: value } as { [Property in Key]?: Value });
}

interface PlotRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface NumericDomain {
  min: number;
  max: number;
}

interface LegendEntry {
  label: string;
  color: string;
  index: number;
}

function headingLayout(spec: DataChartSpec) {
  const scale = (spec.appearance?.fontSize ?? 11) / 11;
  const titleY = 22 * scale + 10;
  const subtitleY = spec.title ? titleY + 13 * scale + 11 : 13 * scale + 18;
  return {
    titleY,
    subtitleY,
    height: spec.subtitle
      ? subtitleY + (spec.title ? 16 : 17)
      : spec.title
        ? titleY + 18
        : 18,
  };
}

function renderHeading(spec: DataChartSpec, theme: DataChartTheme) {
  const parts: string[] = [];
  if (spec.title) {
    parts.push(
      `<text x="${chartWidth / 2}" y="${round(headingLayout(spec).titleY)}" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 22) / 11) : 22}" font-weight="650">${renderLimitedText(spec.title, 64)}</text>`,
    );
  }
  if (spec.subtitle) {
    parts.push(
      `<text x="${chartWidth / 2}" y="${round(headingLayout(spec).subtitleY)}" text-anchor="middle" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 13) / 11) : 13}">${renderLimitedText(spec.subtitle, 72)}</text>`,
    );
  }
  return parts.join("");
}

function renderCartesianChart(
  spec: DataChartBarSpec | DataChartCartesianSpec,
  style: ResolvedDataChartStyle,
  locale: string | undefined,
  plot: PlotRect,
  clipId: string,
  prefix: string,
) {
  const theme = style.theme;
  const values = spec.series.flatMap((series) =>
    series.values.filter(isNumber),
  );
  const domainValues =
    spec.type === "bar" && spec.stacked ? stackedDomainValues(spec) : values;
  if (spec.type === "bar" && spec.orientation === "horizontal") {
    const xDomain = numericDomain(domainValues, spec.xAxis, true);
    const format = numberFormatter(locale, tickValues(xDomain));
    const axes = renderHorizontalCategoryAxes(
      spec.labels,
      xDomain,
      spec.xAxis,
      spec.yAxis,
      theme,
      format,
      plot,
    );
    const marks = renderHorizontalBars(
      spec,
      xDomain,
      style,
      format,
      plot,
      prefix,
    );
    return `${axes}<g clip-path="url(#${escapeXmlAttribute(clipId)})">${marks}</g>`;
  }
  const yDomain = numericDomain(
    domainValues,
    spec.yAxis,
    spec.type === "bar" || spec.type === "area",
  );
  const format = numberFormatter(locale, tickValues(yDomain));
  const axes = renderCategoryAxes(
    spec.labels,
    yDomain,
    spec.xAxis,
    spec.yAxis,
    theme,
    format,
    plot,
  );
  const marks =
    spec.type === "bar"
      ? renderBars(spec, yDomain, style, format, plot, prefix)
      : spec.type === "line"
        ? renderLines(spec, yDomain, style, format, plot, false, prefix)
        : renderLines(spec, yDomain, style, format, plot, true, prefix);
  return `${axes}<g clip-path="url(#${escapeXmlAttribute(clipId)})">${marks}</g>`;
}

function renderHeatmapChart(
  spec: DataChartHeatmapSpec,
  style: ResolvedDataChartStyle,
  locale: string | undefined,
  plot: PlotRect,
  prefix: string,
  showLegend: boolean,
) {
  const theme = style.theme;
  const numericValues = spec.series.flatMap((series) =>
    series.values.filter(isNumber),
  );
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const span = max - min;
  const format = numberFormatter(locale, numericValues);
  const rowHeight = (plot.bottom - plot.top) / spec.series.length;
  const columnWidth = (plot.right - plot.left) / spec.labels.length;
  const rowStep = Math.max(1, Math.ceil(spec.series.length / 16));
  const columnStep = Math.max(1, Math.ceil(spec.labels.length / 14));
  const baseColor =
    style.preset === "grayscale" ? theme.foreground : theme.palette[0];
  const parts: string[] = [];

  spec.series.forEach((series, rowIndex) => {
    if (rowIndex % rowStep === 0 || rowIndex === spec.series.length - 1) {
      parts.push(
        `<text x="${plot.left - 10}" y="${round(plot.top + rowHeight * (rowIndex + 0.5) + 4)}" text-anchor="end" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(limitText(series.name, 18))}</text>`,
      );
    }
    series.values.forEach((value, columnIndex) => {
      const x = plot.left + columnWidth * columnIndex;
      const y = plot.top + rowHeight * rowIndex;
      const normalized =
        value === null ? 0 : span === 0 ? 0.65 : (value - min) / span;
      const opacity = value === null ? 0.18 : 0.14 + normalized * 0.86;
      const fill = value === null ? theme.grid : baseColor;
      const label =
        value !== null && (spec.showValues ?? numericValues.length <= 100)
          ? `<text x="${round(x + columnWidth / 2)}" y="${round(y + rowHeight / 2 + 4)}" text-anchor="middle" fill="${paint(normalized > 0.58 ? "#ffffff" : theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 10) / 11) : 10}" font-weight="600">${escapeXmlText(format(value))}</text>`
          : "";
      parts.push(
        `<g data-mark="heatmap-cell" data-series-index="${rowIndex}" data-point-index="${columnIndex}"><rect x="${round(x + 0.5)}" y="${round(y + 0.5)}" width="${round(Math.max(0, columnWidth - 1))}" height="${round(Math.max(0, rowHeight - 1))}" rx="1" fill="${paint(fill)}" opacity="${round(opacity)}"/>${label}</g>`,
      );
    });
  });

  spec.labels.forEach((label, index) => {
    if (index % columnStep !== 0 && index !== spec.labels.length - 1) return;
    const x = plot.left + columnWidth * (index + 0.5);
    parts.push(
      `<text x="${round(x)}" y="${plot.bottom + 21}" text-anchor="middle" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(limitText(label, 14))}</text>`,
    );
  });
  parts.push(
    `<rect x="${plot.left}" y="${plot.top}" width="${round(plot.right - plot.left)}" height="${round(plot.bottom - plot.top)}" fill="none" stroke="${paint(theme.grid)}"/>`,
  );
  if (spec.xAxis?.label) {
    parts.push(
      `<text x="${round((plot.left + plot.right) / 2)}" y="${plot.bottom + 46}" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 12) / 11) : 12}">${renderLimitedText(spec.xAxis.label, 72)}</text>`,
    );
  }
  if (spec.yAxis?.label)
    parts.push(renderYAxisLabel(spec.yAxis.label, theme, plot));
  if (showLegend) {
    const legendY = plot.bottom + (spec.xAxis?.label ? 58 : 38);
    const legendWidth = 132;
    const startX = plot.right - legendWidth;
    const steps = 12;
    parts.push(
      `<g aria-label="heatmap scale">${Array.from({ length: steps }, (_, index) => `<rect x="${round(startX + (legendWidth * index) / steps)}" y="${round(legendY)}" width="${round(legendWidth / steps + 0.5)}" height="8" fill="${paint(baseColor)}" opacity="${round(0.14 + (index / (steps - 1)) * 0.86)}"/>`).join("")}<text x="${round(startX - 7)}" y="${round(legendY + 8)}" text-anchor="end" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 10) / 11) : 10}">${escapeXmlText(format(min))}</text><text x="${round(plot.right + 7)}" y="${round(legendY + 8)}" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 10) / 11) : 10}">${escapeXmlText(format(max))}</text></g>`,
    );
  }
  return `<g data-heatmap-prefix="${escapeXmlAttribute(prefix)}">${parts.join("")}</g>`;
}

function renderBoxplotChart(
  spec: DataChartBoxplotSpec,
  style: ResolvedDataChartStyle,
  locale: string | undefined,
  plot: PlotRect,
  clipId: string,
  prefix: string,
) {
  const theme = style.theme;
  const values = spec.series.flatMap((series) =>
    series.boxes.flatMap((box) =>
      box
        ? [
            box.min,
            box.q1,
            box.median,
            box.q3,
            box.max,
            ...(box.outliers ?? []),
          ]
        : [],
    ),
  );
  const yDomain = numericDomain(values, spec.yAxis, false);
  const format = numberFormatter(locale, tickValues(yDomain));
  const axes = renderCategoryAxes(
    spec.labels,
    yDomain,
    spec.xAxis,
    spec.yAxis,
    theme,
    format,
    plot,
  );
  const band = (plot.right - plot.left) / spec.labels.length;
  const groupWidth = Math.max(1, band * 0.72);
  const slotWidth = groupWidth / spec.series.length;
  const boxWidth = Math.max(3, slotWidth * 0.68);
  const marks = spec.series
    .map((series, seriesIndex) =>
      series.boxes
        .map((box, boxIndex) => {
          if (!box) return "";
          const center =
            plot.left +
            band * (boxIndex + 0.5) -
            groupWidth / 2 +
            slotWidth * (seriesIndex + 0.5);
          const left = center - boxWidth / 2;
          const q3Y = scale(box.q3, yDomain, plot.bottom, plot.top);
          const q1Y = scale(box.q1, yDomain, plot.bottom, plot.top);
          const medianY = scale(box.median, yDomain, plot.bottom, plot.top);
          const minY = scale(box.min, yDomain, plot.bottom, plot.top);
          const maxY = scale(box.max, yDomain, plot.bottom, plot.top);
          const stroke = paint(theme.foreground);
          const valueLabel = spec.showValues
            ? `<text x="${round(center)}" y="${round(medianY - 6)}" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 10) / 11) : 10}">${escapeXmlText(format(box.median))}</text>`
            : "";
          const outliers = (box.outliers ?? [])
            .map((outlier) =>
              renderPointMarker(
                center,
                scale(outlier, yDomain, plot.bottom, plot.top),
                3,
                theme.palette[seriesIndex % theme.palette.length],
                style,
                seriesIndex,
              ),
            )
            .join("");
          return `<g data-mark="boxplot" data-series-index="${seriesIndex}" data-point-index="${boxIndex}"><line x1="${round(center)}" y1="${round(maxY)}" x2="${round(center)}" y2="${round(minY)}" stroke="${stroke}" stroke-width="${theme.appearance?.lineWidth ?? 1.5}"/><line x1="${round(center - boxWidth * 0.28)}" y1="${round(maxY)}" x2="${round(center + boxWidth * 0.28)}" y2="${round(maxY)}" stroke="${stroke}" stroke-width="${theme.appearance?.lineWidth ?? 1.5}"/><line x1="${round(center - boxWidth * 0.28)}" y1="${round(minY)}" x2="${round(center + boxWidth * 0.28)}" y2="${round(minY)}" stroke="${stroke}" stroke-width="${theme.appearance?.lineWidth ?? 1.5}"/><rect x="${round(left)}" y="${round(q3Y)}" width="${round(boxWidth)}" height="${round(Math.max(1, q1Y - q3Y))}" fill="${seriesFill(style, seriesIndex, prefix)}" stroke="${stroke}" stroke-width="${theme.appearance?.lineWidth ?? 1.5}"/><line x1="${round(left)}" y1="${round(medianY)}" x2="${round(left + boxWidth)}" y2="${round(medianY)}" stroke="${stroke}" stroke-width="2"/>${outliers}${valueLabel}</g>`;
        })
        .join(""),
    )
    .join("");
  return `${axes}<g clip-path="url(#${escapeXmlAttribute(clipId)})">${marks}</g>`;
}

function renderScatterChart(
  spec: DataChartScatterSpec,
  style: ResolvedDataChartStyle,
  locale: string | undefined,
  plot: PlotRect,
  clipId: string,
) {
  const theme = style.theme;
  const points = spec.series.flatMap((series) => series.points);
  const xDomain = numericDomain(
    points.map((point) => point.x),
    spec.xAxis,
    false,
  );
  const yDomain = numericDomain(
    points.map((point) => point.y),
    spec.yAxis,
    false,
  );
  const xFormat = numberFormatter(locale, tickValues(xDomain));
  const yFormat = numberFormatter(locale, tickValues(yDomain));
  const axes = renderNumericAxes(
    xDomain,
    yDomain,
    spec.xAxis,
    spec.yAxis,
    theme,
    xFormat,
    yFormat,
    plot,
  );
  const marks = spec.series
    .map((series, seriesIndex) => {
      const color = theme.palette[seriesIndex % theme.palette.length];
      return series.points
        .map((point, pointIndex) => {
          const x = scale(point.x, xDomain, plot.left, plot.right);
          const y = scale(point.y, yDomain, plot.bottom, plot.top);
          const label = spec.showValues
            ? `<text x="${round(x + 7)}" y="${round(y - 7)}" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(limitText(point.label || `${xFormat(point.x)}, ${yFormat(point.y)}`, 28))}</text>`
            : "";
          const marker = renderPointMarker(x, y, 5, color, style, seriesIndex);
          return `<g data-mark="point" data-series-index="${seriesIndex}" data-point-index="${pointIndex}">${marker}${label}</g>`;
        })
        .join("");
    })
    .join("");
  return `${axes}<g clip-path="url(#${escapeXmlAttribute(clipId)})">${marks}</g>`;
}

function renderPolarChart(
  spec: DataChartPolarSpec,
  style: ResolvedDataChartStyle,
  locale: string | undefined,
  plot: PlotRect,
  prefix: string,
) {
  const theme = style.theme;
  const values = spec.series[0].values.map((value) => value ?? 0);
  const format = numberFormatter(locale, values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const centerX = (plot.left + plot.right) / 2;
  const centerY = (plot.top + plot.bottom) / 2 + 4;
  const outerRadius = Math.max(
    50,
    Math.min(plot.right - plot.left, plot.bottom - plot.top) * 0.42,
  );
  const innerRadius = spec.type === "donut" ? outerRadius * 0.56 : 0;
  let angle = -Math.PI / 2;
  const slices = values
    .map((value, index) => {
      if (value <= 0) return "";
      const nextAngle = angle + (value / total) * Math.PI * 2;
      const path = polarSlicePath(
        centerX,
        centerY,
        outerRadius,
        innerRadius,
        angle,
        nextAngle,
      );
      const mid = (angle + nextAngle) / 2;
      const labelRadius =
        innerRadius > 0 ? (innerRadius + outerRadius) / 2 : outerRadius * 0.64;
      const valueLabel =
        spec.showValues && value / total >= 0.025
          ? `<text x="${round(centerX + Math.cos(mid) * labelRadius)}" y="${round(centerY + Math.sin(mid) * labelRadius + 4)}" text-anchor="middle" fill="#ffffff" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}" font-weight="650" paint-order="stroke" stroke="rgba(0,0,0,0.35)" stroke-width="2">${escapeXmlText(format(value))}</text>`
          : "";
      const result = `<g data-mark="slice" data-point-index="${index}"><path d="${path}" fill="${seriesFill(style, index, prefix)}" stroke="${paint(theme.background === "transparent" ? "#ffffff" : theme.background)}" stroke-width="2"/>${valueLabel}</g>`;
      angle = nextAngle;
      return result;
    })
    .join("");
  return slices;
}

function renderCategoryAxes(
  labels: string[],
  yDomain: NumericDomain,
  xAxis: DataChartCategoryAxis | undefined,
  yAxis: DataChartAxis | undefined,
  theme: DataChartTheme,
  format: (value: number) => string,
  plot: PlotRect,
) {
  const parts = renderYGridAndAxis(yDomain, theme, format, plot);
  parts.push(
    `<line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}" stroke="${paint(theme.muted)}" stroke-width="${theme.appearance?.lineWidth ?? 1}"/>`,
  );
  const band = (plot.right - plot.left) / labels.length;
  const labelStep = Math.max(1, Math.ceil(labels.length / 12));
  labels.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return;
    const x = plot.left + band * (index + 0.5);
    parts.push(chartGridLine("x", x, plot.top, x, plot.bottom, theme, false));
    parts.push(
      `<text x="${round(x)}" y="${plot.bottom + 21}" text-anchor="middle" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(limitText(label, 16))}</text>`,
    );
  });
  if (xAxis?.label) {
    parts.push(
      `<text x="${round((plot.left + plot.right) / 2)}" y="${plot.bottom + 46}" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 12) / 11) : 12}">${renderLimitedText(xAxis.label, 72)}</text>`,
    );
  }
  if (yAxis?.label) parts.push(renderYAxisLabel(yAxis.label, theme, plot));
  return parts.join("");
}

function renderNumericAxes(
  xDomain: NumericDomain,
  yDomain: NumericDomain,
  xAxis: DataChartAxis | undefined,
  yAxis: DataChartAxis | undefined,
  theme: DataChartTheme,
  xFormat: (value: number) => string,
  yFormat: (value: number) => string,
  plot: PlotRect,
) {
  const parts = renderYGridAndAxis(yDomain, theme, yFormat, plot);
  parts.push(
    `<line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}" stroke="${paint(theme.muted)}" stroke-width="${theme.appearance?.lineWidth ?? 1}"/>`,
  );
  tickValues(xDomain).forEach((tick) => {
    const x = scale(tick, xDomain, plot.left, plot.right);
    parts.push(chartGridLine("x", x, plot.top, x, plot.bottom, theme, false));
    parts.push(
      `<line x1="${round(x)}" y1="${plot.bottom}" x2="${round(x)}" y2="${plot.bottom + 5}" stroke="${paint(theme.muted)}"/>`,
    );
    parts.push(
      `<text x="${round(x)}" y="${plot.bottom + 21}" text-anchor="middle" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(xFormat(tick))}</text>`,
    );
  });
  if (xAxis?.label) {
    parts.push(
      `<text x="${round((plot.left + plot.right) / 2)}" y="${plot.bottom + 46}" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 12) / 11) : 12}">${renderLimitedText(xAxis.label, 72)}</text>`,
    );
  }
  if (yAxis?.label) parts.push(renderYAxisLabel(yAxis.label, theme, plot));
  return parts.join("");
}

function renderHorizontalCategoryAxes(
  labels: string[],
  xDomain: NumericDomain,
  xAxis: DataChartAxis | undefined,
  yAxis: DataChartCategoryAxis | undefined,
  theme: DataChartTheme,
  format: (value: number) => string,
  plot: PlotRect,
) {
  const parts: string[] = [];
  tickValues(xDomain).forEach((tick) => {
    const x = scale(tick, xDomain, plot.left, plot.right);
    parts.push(chartGridLine("x", x, plot.top, x, plot.bottom, theme, true));
    parts.push(
      `<text x="${round(x)}" y="${plot.bottom + 21}" text-anchor="middle" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(format(tick))}</text>`,
    );
  });
  parts.push(
    `<line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.bottom}" stroke="${paint(theme.muted)}" stroke-width="${theme.appearance?.lineWidth ?? 1}"/>`,
  );
  parts.push(
    `<line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}" stroke="${paint(theme.muted)}" stroke-width="${theme.appearance?.lineWidth ?? 1}"/>`,
  );
  const band = (plot.bottom - plot.top) / labels.length;
  const labelStep = Math.max(1, Math.ceil(labels.length / 16));
  labels.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return;
    const y = plot.top + band * (index + 0.5);
    parts.push(chartGridLine("y", plot.left, y, plot.right, y, theme, false));
    parts.push(
      `<text x="${plot.left - 10}" y="${round(y + 4)}" text-anchor="end" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(limitText(label, 18))}</text>`,
    );
  });
  if (xAxis?.label) {
    parts.push(
      `<text x="${round((plot.left + plot.right) / 2)}" y="${plot.bottom + 46}" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 12) / 11) : 12}">${renderLimitedText(xAxis.label, 72)}</text>`,
    );
  }
  if (yAxis?.label) parts.push(renderYAxisLabel(yAxis.label, theme, plot));
  return parts.join("");
}

function chartGridLine(
  axis: "x" | "y",
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  theme: DataChartTheme,
  auto: boolean,
) {
  const grid = theme.appearance?.grid ?? "auto";
  if (
    grid === "none" ||
    (grid === "auto" ? !auto : grid !== "both" && grid !== axis)
  )
    return "";
  const dash = LINE_DASHES[theme.appearance?.gridStyle ?? "solid"];
  return `<line data-grid="${axis}" x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${paint(theme.grid)}" stroke-width="${theme.appearance?.lineWidth ?? 1}" opacity="0.72"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

function renderYGridAndAxis(
  domain: NumericDomain,
  theme: DataChartTheme,
  format: (value: number) => string,
  plot: PlotRect,
) {
  const parts: string[] = [];
  tickValues(domain).forEach((tick) => {
    const y = scale(tick, domain, plot.bottom, plot.top);
    parts.push(chartGridLine("y", plot.left, y, plot.right, y, theme, true));
    parts.push(
      `<text x="${plot.left - 10}" y="${round(y + 4)}" text-anchor="end" fill="${paint(theme.muted)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(format(tick))}</text>`,
    );
  });
  parts.push(
    `<line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.bottom}" stroke="${paint(theme.muted)}" stroke-width="${theme.appearance?.lineWidth ?? 1}"/>`,
  );
  return parts;
}

function renderYAxisLabel(
  label: string,
  theme: DataChartTheme,
  plot: PlotRect,
) {
  const center = (plot.top + plot.bottom) / 2;
  return `<text x="22" y="${round(center)}" transform="rotate(-90 22 ${round(center)})" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 12) / 11) : 12}">${renderLimitedText(label, 36)}</text>`;
}

function renderBars(
  spec: DataChartBarSpec,
  domain: NumericDomain,
  style: ResolvedDataChartStyle,
  format: (value: number) => string,
  plot: PlotRect,
  prefix: string,
) {
  const theme = style.theme;
  const band = (plot.right - plot.left) / spec.labels.length;
  const categoryPadding = Math.min(14, band * 0.18);
  const available = Math.max(1, band - categoryPadding * 2);
  const zeroY = scale(
    clamp(0, domain.min, domain.max),
    domain,
    plot.bottom,
    plot.top,
  );
  if (!spec.stacked) {
    const barWidth = Math.max(1, available / spec.series.length - 2);
    return spec.series
      .map((series, seriesIndex) => {
        return series.values
          .map((value, valueIndex) => {
            if (value === null) return "";
            const valueY = scale(value, domain, plot.bottom, plot.top);
            const x =
              plot.left +
              valueIndex * band +
              categoryPadding +
              seriesIndex * (available / spec.series.length) +
              1;
            return renderBarMark(
              x,
              zeroY,
              valueY,
              barWidth,
              value,
              seriesFill(style, seriesIndex, prefix),
              theme,
              format,
              spec.showValues,
              seriesIndex,
              valueIndex,
            );
          })
          .join("");
      })
      .join("");
  }

  const positive = Array(spec.labels.length).fill(0) as number[];
  const negative = Array(spec.labels.length).fill(0) as number[];
  return spec.series
    .map((series, seriesIndex) => {
      return series.values
        .map((value, valueIndex) => {
          if (value === null) return "";
          const start =
            value >= 0 ? positive[valueIndex] : negative[valueIndex];
          const end = start + value;
          if (value >= 0) positive[valueIndex] = end;
          else negative[valueIndex] = end;
          const x = plot.left + valueIndex * band + categoryPadding;
          return renderBarMark(
            x,
            scale(start, domain, plot.bottom, plot.top),
            scale(end, domain, plot.bottom, plot.top),
            available,
            value,
            seriesFill(style, seriesIndex, prefix),
            theme,
            format,
            spec.showValues,
            seriesIndex,
            valueIndex,
          );
        })
        .join("");
    })
    .join("");
}

function renderHorizontalBars(
  spec: DataChartBarSpec,
  domain: NumericDomain,
  style: ResolvedDataChartStyle,
  format: (value: number) => string,
  plot: PlotRect,
  prefix: string,
) {
  const theme = style.theme;
  const band = (plot.bottom - plot.top) / spec.labels.length;
  const categoryPadding = Math.min(12, band * 0.18);
  const available = Math.max(1, band - categoryPadding * 2);
  const zeroX = scale(
    clamp(0, domain.min, domain.max),
    domain,
    plot.left,
    plot.right,
  );
  if (!spec.stacked) {
    const barHeight = Math.max(1, available / spec.series.length - 2);
    return spec.series
      .map((series, seriesIndex) =>
        series.values
          .map((value, valueIndex) => {
            if (value === null) return "";
            const valueX = scale(value, domain, plot.left, plot.right);
            const y =
              plot.top +
              valueIndex * band +
              categoryPadding +
              seriesIndex * (available / spec.series.length) +
              1;
            return renderHorizontalBarMark(
              zeroX,
              valueX,
              y,
              barHeight,
              value,
              seriesFill(style, seriesIndex, prefix),
              theme,
              format,
              spec.showValues,
              seriesIndex,
              valueIndex,
            );
          })
          .join(""),
      )
      .join("");
  }

  const positive = Array(spec.labels.length).fill(0) as number[];
  const negative = Array(spec.labels.length).fill(0) as number[];
  return spec.series
    .map((series, seriesIndex) =>
      series.values
        .map((value, valueIndex) => {
          if (value === null) return "";
          const start =
            value >= 0 ? positive[valueIndex] : negative[valueIndex];
          const end = start + value;
          if (value >= 0) positive[valueIndex] = end;
          else negative[valueIndex] = end;
          const y = plot.top + valueIndex * band + categoryPadding;
          return renderHorizontalBarMark(
            scale(start, domain, plot.left, plot.right),
            scale(end, domain, plot.left, plot.right),
            y,
            available,
            value,
            seriesFill(style, seriesIndex, prefix),
            theme,
            format,
            spec.showValues,
            seriesIndex,
            valueIndex,
          );
        })
        .join(""),
    )
    .join("");
}

function renderHorizontalBarMark(
  startX: number,
  endX: number,
  y: number,
  height: number,
  value: number,
  fill: string,
  theme: DataChartTheme,
  format: (value: number) => string,
  showValue: boolean | undefined,
  seriesIndex: number,
  valueIndex: number,
) {
  const x = Math.min(startX, endX);
  const width = Math.max(0, Math.abs(startX - endX));
  const labelX = value >= 0 ? x + width + 5 : x - 5;
  const label = showValue
    ? `<text x="${round(labelX)}" y="${round(y + height / 2 + 4)}" text-anchor="${value >= 0 ? "start" : "end"}" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 10) / 11) : 10}">${escapeXmlText(format(value))}</text>`
    : "";
  return `<g data-mark="bar" data-orientation="horizontal" data-series-index="${seriesIndex}" data-point-index="${valueIndex}"><rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="2" fill="${fill}"/>${label}</g>`;
}

function renderBarMark(
  x: number,
  startY: number,
  endY: number,
  width: number,
  value: number,
  fill: string,
  theme: DataChartTheme,
  format: (value: number) => string,
  showValue: boolean | undefined,
  seriesIndex: number,
  valueIndex: number,
) {
  const y = Math.min(startY, endY);
  const height = Math.max(0, Math.abs(startY - endY));
  const labelY = value >= 0 ? y - 5 : y + height + 13;
  const label = showValue
    ? `<text x="${round(x + width / 2)}" y="${round(labelY)}" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 10) / 11) : 10}">${escapeXmlText(format(value))}</text>`
    : "";
  return `<g data-mark="bar" data-series-index="${seriesIndex}" data-point-index="${valueIndex}"><rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="2" fill="${fill}"/>${label}</g>`;
}

function renderLines(
  spec: DataChartCartesianSpec,
  domain: NumericDomain,
  style: ResolvedDataChartStyle,
  format: (value: number) => string,
  plot: PlotRect,
  area: boolean,
  prefix: string,
) {
  const theme = style.theme;
  const band = (plot.right - plot.left) / spec.labels.length;
  const xForIndex = (index: number) => plot.left + band * (index + 0.5);
  const baseline = scale(
    clamp(0, domain.min, domain.max),
    domain,
    plot.bottom,
    plot.top,
  );
  return spec.series
    .map((series, seriesIndex) => {
      const color =
        style.preset === "grayscale"
          ? theme.foreground
          : theme.palette[seriesIndex % theme.palette.length];
      const segments = contiguousValues(series.values);
      const areas = area
        ? segments
            .map((segment) => {
              const first = segment[0];
              const last = segment[segment.length - 1];
              const topPath = segment
                .map(
                  ({ index, value }) =>
                    `L${round(xForIndex(index))} ${round(scale(value, domain, plot.bottom, plot.top))}`,
                )
                .join(" ");
              return `<path data-mark="area" data-series-index="${seriesIndex}" d="M${round(xForIndex(first.index))} ${round(baseline)} ${topPath} L${round(xForIndex(last.index))} ${round(baseline)} Z" fill="${seriesFill(style, seriesIndex, prefix)}" opacity="${style.preset === "grayscale" ? "0.72" : "0.2"}"/>`;
            })
            .join("")
        : "";
      const lines = segments
        .map((segment) => {
          const path = segment
            .map(
              ({ index, value }, pointIndex) =>
                `${pointIndex === 0 ? "M" : "L"}${round(xForIndex(index))} ${round(scale(value, domain, plot.bottom, plot.top))}`,
            )
            .join(" ");
          const dash = seriesDash(style, seriesIndex);
          return `<path data-mark="line" data-series-index="${seriesIndex}" d="${path}" fill="none" stroke="${paint(color)}" stroke-width="${theme.appearance?.lineWidth ?? 2.5}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linecap="round" stroke-linejoin="round"/>`;
        })
        .join("");
      const points = series.values
        .map((value, valueIndex) => {
          if (value === null) return "";
          const x = xForIndex(valueIndex);
          const y = scale(value, domain, plot.bottom, plot.top);
          const label = spec.showValues
            ? `<text x="${round(x)}" y="${round(y - 8)}" text-anchor="middle" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 10) / 11) : 10}">${escapeXmlText(format(value))}</text>`
            : "";
          return `<g data-mark="point" data-series-index="${seriesIndex}" data-point-index="${valueIndex}">${renderPointMarker(x, y, 3.5, color, style, seriesIndex)}${label}</g>`;
        })
        .join("");
      return `${areas}${lines}${points}`;
    })
    .join("");
}

function contiguousValues(values: (number | null)[]) {
  const segments: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ index, value });
  });
  if (current.length) segments.push(current);
  return segments;
}

function renderLegend(
  entries: LegendEntry[],
  style: ResolvedDataChartStyle,
  y: number,
  prefix: string,
  chartType: DataChartType,
) {
  if (!entries.length) return "";
  const theme = style.theme;
  const visible = entries.slice(0, 11);
  if (entries.length > 11) {
    visible.push({
      label: `+${entries.length - 11}`,
      color: theme.muted,
      index: 11,
    });
  }
  const columnWidth = 210;
  const startX = (chartWidth - Math.min(4, visible.length) * columnWidth) / 2;
  return `<g aria-label="legend">${visible
    .map((entry, index) => {
      const row = Math.floor(index / 4);
      const column = index % 4;
      const x = startX + column * columnWidth;
      const itemY =
        y + row * Math.max(24, (theme.appearance?.fontSize ?? 11) + 13);
      const symbol = renderLegendSymbol(entry, style, prefix, chartType);
      return `<g transform="translate(${round(x)} ${round(itemY)})">${symbol}<text x="19" y="1" fill="${paint(theme.foreground)}" font-size="${theme.appearance?.fontSize ? round((theme.appearance.fontSize * 11) / 11) : 11}">${escapeXmlText(limitText(entry.label, Math.min(24, Math.floor(175 / ((theme.appearance?.fontSize ?? 11) * 0.6)))))}</text></g>`;
    })
    .join("")}</g>`;
}

function chartLegendEntries(
  spec: DataChartSpec,
  theme: DataChartTheme,
): LegendEntry[] {
  if (spec.type === "pie" || spec.type === "donut") {
    return spec.labels.map((label, index) => ({
      label,
      color: theme.palette[index % theme.palette.length],
      index,
    }));
  }
  if (spec.type === "heatmap") return [];
  return spec.series.map((series, index) => ({
    label: series.name,
    color:
      spec.type === "line" && spec.stylePreset === "grayscale"
        ? theme.foreground
        : theme.palette[index % theme.palette.length],
    index,
  }));
}

function defaultLegendVisibility(spec: DataChartSpec) {
  return (
    spec.type === "pie" ||
    spec.type === "donut" ||
    spec.type === "heatmap" ||
    spec.series.length > 1
  );
}

const academicDataChartTheme: DataChartTheme = {
  background: "#ffffff",
  foreground: "#111827",
  muted: "#4b5563",
  grid: "#d1d5db",
  palette: [
    "#0072b2",
    "#e69f00",
    "#009e73",
    "#cc79a7",
    "#d55e00",
    "#56b4e9",
    "#6f5aa8",
    "#8a6d1d",
  ],
};

const grayscaleDataChartTheme: DataChartTheme = {
  background: "#ffffff",
  foreground: "#111111",
  muted: "#444444",
  grid: "#c7c7c7",
  palette: [...COLOR_PALETTE_PRESETS["grayscale"]],
};

const highContrastDataChartTheme: DataChartTheme = {
  background: "#ffffff",
  foreground: "#000000",
  muted: "#292929",
  grid: "#9b9b9b",
  palette: [...COLOR_PALETTE_PRESETS["high-contrast"]],
};

const grayscaleLineDashes = [
  "",
  "9 4",
  "2 3",
  "11 3 2 3",
  "6 3 2 3",
  "2 2 2 6",
  "14 4",
  "5 2 1 2 1 2",
];

function resolveDataChartStyle(
  spec: DataChartSpec,
  theme: DataChartTheme,
): ResolvedDataChartStyle {
  const preset =
    spec.stylePreset && stylePresets.has(spec.stylePreset)
      ? spec.stylePreset
      : "default";
  const base =
    preset === "academic"
      ? academicDataChartTheme
      : preset === "grayscale"
        ? grayscaleDataChartTheme
        : preset === "high-contrast"
          ? highContrastDataChartTheme
          : normalizeTheme(theme);
  const normalizedBase = normalizeTheme(base);
  const palette = normalizedBase.palette.map((color, index) => {
    const localPalette = spec.appearance?.palette;
    const override =
      spec.appearance?.series?.[index]?.color ??
      (localPalette
        ? localPalette[index % localPalette.length]
        : spec.palette?.[index]);
    return preset !== "grayscale" &&
      typeof override === "string" &&
      /^#[\da-f]{6}$/i.test(override)
      ? override
      : color;
  });
  return {
    preset,
    theme: {
      ...normalizedBase,
      appearance: spec.appearance,
      palette,
      ...(theme.grayscalePatterns
        ? {
            grayscalePatterns: resolveGrayscalePatterns(
              theme.grayscalePatterns,
            ),
          }
        : {}),
    },
  };
}

function renderStyleDefinitions(style: ResolvedDataChartStyle, prefix: string) {
  if (style.preset !== "grayscale") return "";
  return style.theme.palette
    .map((color, index) => {
      const id = grayscalePatternId(prefix, index);
      if (
        style.theme.grayscalePatterns ||
        style.theme.appearance?.series?.some((s) => s.pattern)
      ) {
        const patterns =
          style.theme.grayscalePatterns ?? resolveGrayscalePatterns(undefined);
        return `<pattern id="${escapeXmlAttribute(id)}" patternUnits="userSpaceOnUse" width="8" height="8">${grayscalePatternSvg(style.theme.appearance?.series?.[index]?.pattern ?? patterns[index % patterns.length])}</pattern>`;
      }
      const ink = contrastingInk(color);
      return `<pattern id="${escapeXmlAttribute(id)}" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="${paint(color)}"/>${grayscalePatternMark(index, ink)}</pattern>`;
    })
    .join("");
}

function grayscalePatternMark(index: number, ink: string) {
  const stroke = paint(ink);
  switch (index % maxPaletteSize) {
    case 0:
      return `<path d="M-2 2L2-2M0 8L8 0M6 10L10 6" stroke="${stroke}" stroke-width="1"/>`;
    case 1:
      return `<path d="M-2 6L2 10M0 0L8 8M6-2L10 2" stroke="${stroke}" stroke-width="1"/>`;
    case 2:
      return `<path d="M-2 2L2-2M0 8L8 0M6 10L10 6M-2 6L2 10M0 0L8 8M6-2L10 2" stroke="${stroke}" stroke-width="0.8"/>`;
    case 3:
      return `<path d="M0 2H8M0 6H8" stroke="${stroke}" stroke-width="1"/>`;
    case 4:
      return `<path d="M2 0V8M6 0V8" stroke="${stroke}" stroke-width="1"/>`;
    case 5:
      return `<circle cx="2" cy="2" r="1" fill="${stroke}"/><circle cx="6" cy="6" r="1" fill="${stroke}"/>`;
    case 6:
      return `<path d="M0 4H8M4 0V8" stroke="${stroke}" stroke-width="1"/>`;
    default:
      return `<path d="M0 2H8M0 6H8M2 0V8M6 0V8" stroke="${stroke}" stroke-width="0.8"/>`;
  }
}

function contrastingInk(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150
    ? "#111111"
    : "#ffffff";
}

function grayscalePatternId(prefix: string, index: number) {
  return `${prefix}-grayscale-pattern-${index % maxPaletteSize}`;
}

function seriesFill(
  style: ResolvedDataChartStyle,
  index: number,
  prefix: string,
) {
  if (style.preset === "grayscale") {
    return `url(#${escapeXmlAttribute(grayscalePatternId(prefix, index))})`;
  }
  return paint(style.theme.palette[index % style.theme.palette.length]);
}

function seriesDash(style: ResolvedDataChartStyle, index: number) {
  const override = style.theme.appearance?.series?.[index]?.lineStyle;
  if (override) return LINE_DASHES[override];
  return style.preset === "grayscale"
    ? grayscaleLineDashes[index % grayscaleLineDashes.length]
    : "";
}

function renderPointMarker(
  x: number,
  y: number,
  radius: number,
  color: string,
  style: ResolvedDataChartStyle,
  seriesIndex: number,
) {
  const marker = style.theme.appearance?.series?.[seriesIndex]?.marker;
  if (marker === "none") return "";
  radius = style.theme.appearance?.markerSize ?? radius;
  if (style.preset !== "grayscale" && !marker) {
    const outline =
      style.theme.background === "transparent"
        ? "#ffffff"
        : style.theme.background;
    return `<circle cx="${round(x)}" cy="${round(y)}" r="${round(radius)}" fill="${paint(color)}" stroke="${paint(outline)}" stroke-width="1"/>`;
  }

  const fill = paint(
    style.preset === "grayscale"
      ? seriesIndex % 2 === 0
        ? "#ffffff"
        : "#b8b8b8"
      : color,
  );
  const stroke = paint(
    style.preset === "grayscale" ? style.theme.foreground : color,
  );
  const left = round(x - radius);
  const top = round(y - radius);
  const size = round(radius * 2);
  switch (
    marker ? MARKER_STYLES.indexOf(marker) - 1 : seriesIndex % maxPaletteSize
  ) {
    case 0:
      return `<circle cx="${round(x)}" cy="${round(y)}" r="${round(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    case 1:
      return `<rect x="${left}" y="${top}" width="${size}" height="${size}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    case 2:
      return `<path d="M${round(x)} ${top}L${round(x + radius)} ${round(y + radius)}L${left} ${round(y + radius)}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    case 3:
      return `<path d="M${round(x)} ${top}L${round(x + radius)} ${round(y)}L${round(x)} ${round(y + radius)}L${left} ${round(y)}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    case 4:
      return `<path d="M${left} ${round(y)}H${round(x + radius)}M${round(x)} ${top}V${round(y + radius)}" fill="none" stroke="${stroke}" stroke-width="2"/>`;
    case 5:
      return `<path d="M${left} ${top}L${round(x + radius)} ${round(y + radius)}M${round(x + radius)} ${top}L${left} ${round(y + radius)}" fill="none" stroke="${stroke}" stroke-width="2"/>`;
    case 6: {
      const half = radius * 0.86;
      return `<path d="M${round(x - half)} ${round(y - radius / 2)}L${round(x)} ${top}L${round(x + half)} ${round(y - radius / 2)}L${round(x + half)} ${round(y + radius / 2)}L${round(x)} ${round(y + radius)}L${round(x - half)} ${round(y + radius / 2)}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    }
    default:
      return `<path d="M${round(x)} ${top}L${round(x + radius * 0.3)} ${round(y - radius * 0.3)}L${round(x + radius)} ${round(y)}L${round(x + radius * 0.3)} ${round(y + radius * 0.3)}L${round(x)} ${round(y + radius)}L${round(x - radius * 0.3)} ${round(y + radius * 0.3)}L${left} ${round(y)}L${round(x - radius * 0.3)} ${round(y - radius * 0.3)}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }
}

function renderLegendSymbol(
  entry: LegendEntry,
  style: ResolvedDataChartStyle,
  prefix: string,
  chartType: DataChartType,
) {
  if (chartType === "line" || chartType === "area") {
    const dash = seriesDash(style, entry.index);
    return `<line x1="0" y1="-3" x2="14" y2="-3" stroke="${paint(entry.color)}" stroke-width="${style.theme.appearance?.lineWidth ?? 2}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>${renderPointMarker(7, -3, 2.5, entry.color, style, entry.index)}`;
  }
  if (chartType === "scatter") {
    return renderPointMarker(6, -3, 4.5, entry.color, style, entry.index);
  }
  return `<rect x="0" y="-9" width="12" height="12" rx="2" fill="${seriesFill(style, entry.index, prefix)}"/>`;
}

function stackedDomainValues(spec: DataChartBarSpec) {
  const positive = Array(spec.labels.length).fill(0) as number[];
  const negative = Array(spec.labels.length).fill(0) as number[];
  spec.series.forEach((series) =>
    series.values.forEach((value, index) => {
      if (value === null) return;
      if (value >= 0) positive[index] += value;
      else negative[index] += value;
    }),
  );
  return [...positive, ...negative];
}

function numericDomain(
  values: number[],
  axis: DataChartAxis | undefined,
  includeZero: boolean,
) {
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const padding = constantDomainPadding(min);
    min -= padding;
    max += padding;
  } else {
    const padding = (max - min) * 0.06;
    if (axis?.min === undefined && (!includeZero || min < 0)) min -= padding;
    if (axis?.max === undefined && (!includeZero || max > 0)) max += padding;
  }
  if (axis?.min !== undefined) min = axis.min;
  if (axis?.max !== undefined) max = axis.max;
  if (!(min < max)) {
    const padding = constantDomainPadding(min || max);
    if (axis?.min !== undefined && axis.max === undefined) max = min + padding;
    else min = max - padding;
  }
  return { min, max };
}

function constantDomainPadding(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 1;
  const scaled = magnitude * 0.1;
  return scaled > 0 && Number.isFinite(scaled) ? scaled : magnitude;
}

function tickValues(domain: NumericDomain, count = 5) {
  return Array.from(
    { length: count + 1 },
    (_, index) => domain.min + ((domain.max - domain.min) * index) / count,
  );
}

function scale(
  value: number,
  domain: NumericDomain,
  outputMin: number,
  outputMax: number,
) {
  return (
    outputMin +
    ((value - domain.min) / (domain.max - domain.min)) * (outputMax - outputMin)
  );
}

function polarSlicePath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  start: number,
  end: number,
) {
  const delta = Math.min(Math.PI * 2, Math.max(0, end - start));
  if (delta >= Math.PI * 2 - 1e-7) {
    const middle = start + Math.PI;
    const outerStart = polarPoint(cx, cy, outerRadius, start);
    const outerMiddle = polarPoint(cx, cy, outerRadius, middle);
    if (innerRadius <= 0) {
      return `M${outerStart.x} ${outerStart.y} A${round(outerRadius)} ${round(outerRadius)} 0 1 1 ${outerMiddle.x} ${outerMiddle.y} A${round(outerRadius)} ${round(outerRadius)} 0 1 1 ${outerStart.x} ${outerStart.y} Z`;
    }
    const innerStart = polarPoint(cx, cy, innerRadius, start);
    const innerMiddle = polarPoint(cx, cy, innerRadius, middle);
    return `M${outerStart.x} ${outerStart.y} A${round(outerRadius)} ${round(outerRadius)} 0 1 1 ${outerMiddle.x} ${outerMiddle.y} A${round(outerRadius)} ${round(outerRadius)} 0 1 1 ${outerStart.x} ${outerStart.y} L${innerStart.x} ${innerStart.y} A${round(innerRadius)} ${round(innerRadius)} 0 1 0 ${innerMiddle.x} ${innerMiddle.y} A${round(innerRadius)} ${round(innerRadius)} 0 1 0 ${innerStart.x} ${innerStart.y} Z`;
  }
  const outerStart = polarPoint(cx, cy, outerRadius, start);
  const outerEnd = polarPoint(cx, cy, outerRadius, end);
  const largeArc = delta > Math.PI ? 1 : 0;
  if (innerRadius <= 0) {
    return `M${round(cx)} ${round(cy)} L${outerStart.x} ${outerStart.y} A${round(outerRadius)} ${round(outerRadius)} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} Z`;
  }
  const innerStart = polarPoint(cx, cy, innerRadius, start);
  const innerEnd = polarPoint(cx, cy, innerRadius, end);
  return `M${outerStart.x} ${outerStart.y} A${round(outerRadius)} ${round(outerRadius)} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} L${innerEnd.x} ${innerEnd.y} A${round(innerRadius)} ${round(innerRadius)} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`;
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: round(cx + Math.cos(angle) * radius),
    y: round(cy + Math.sin(angle) * radius),
  };
}

function chartDescription(spec: DataChartSpec) {
  const pointCount =
    spec.type === "scatter"
      ? spec.series.reduce((total, series) => total + series.points.length, 0)
      : spec.type === "boxplot"
        ? spec.series.reduce(
            (total, series) =>
              total + series.boxes.filter((box) => box !== null).length,
            0,
          )
        : spec.series.reduce(
            (total, series) => total + series.values.filter(isNumber).length,
            0,
          );
  return `${spec.type} chart with ${spec.series.length} series and ${pointCount} data points`;
}

function normalizeTheme(theme: DataChartTheme): DataChartTheme {
  const suppliedPalette = Array.isArray(theme?.palette)
    ? theme.palette.slice(0, maxSeries)
    : [];
  const palette = defaultDataChartTheme.palette.map((fallback, index) =>
    safePaint(suppliedPalette[index], fallback),
  );
  return {
    background: safePaint(theme?.background, defaultDataChartTheme.background),
    foreground: safePaint(theme?.foreground, defaultDataChartTheme.foreground),
    muted: safePaint(theme?.muted, defaultDataChartTheme.muted),
    grid: safePaint(theme?.grid, defaultDataChartTheme.grid),
    palette,
  };
}

function safePaint(value: unknown, fallback: string) {
  if (
    typeof value !== "string" ||
    value.length > 96 ||
    /url\s*\(|[<>"'{};]/i.test(value)
  ) {
    return fallback;
  }
  const normalized = value.trim();
  if (normalized === "transparent" || /^#[\da-f]{3,8}$/i.test(normalized))
    return normalized;
  if (
    /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([\w\s.,%+\-/]+\)$/i.test(
      normalized,
    )
  ) {
    return normalized;
  }
  return fallback;
}

function paint(value: string) {
  return escapeXmlAttribute(value);
}

function numberFormatter(
  locale: string | undefined,
  referenceValues: number[],
) {
  const finiteValues = referenceValues.filter(Number.isFinite);
  const magnitude = finiteValues.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value)),
    0,
  );
  const nonZeroMagnitude = finiteValues.reduce((minimum, value) => {
    const absolute = Math.abs(value);
    return absolute > 0 ? Math.min(minimum, absolute) : minimum;
  }, Number.POSITIVE_INFINITY);
  const sorted = [...new Set(finiteValues)].sort((left, right) => left - right);
  const smallestGap = sorted.slice(1).reduce((minimum, value, index) => {
    const gap = value - sorted[index];
    return gap > 0 ? Math.min(minimum, gap) : minimum;
  }, Number.POSITIVE_INFINITY);
  const significantDigits =
    Number.isFinite(smallestGap) && magnitude > 0
      ? clamp(Math.ceil(Math.log10(magnitude / smallestGap)) + 2, 3, 17)
      : 8;
  const fractionDigits =
    Number.isFinite(smallestGap) && smallestGap > 0
      ? clamp(Math.ceil(-Math.log10(smallestGap)) + 2, 0, 15)
      : 6;
  const preferScientific =
    magnitude >= 10_000_000 ||
    (Number.isFinite(nonZeroMagnitude) && nonZeroMagnitude < 0.0001);
  const standard: Intl.NumberFormatOptions = {
    notation: "standard",
    maximumFractionDigits: fractionDigits,
  };
  const scientific: Intl.NumberFormatOptions = {
    notation: "scientific",
    maximumSignificantDigits: significantDigits,
  };
  const preciseScientific: Intl.NumberFormatOptions = {
    notation: "scientific",
    maximumSignificantDigits: 17,
  };
  const candidates = preferScientific
    ? [scientific, preciseScientific, standard]
    : [standard, scientific, preciseScientific];
  const normalized = (value: number) => (Object.is(value, -0) ? 0 : value);

  for (const options of candidates) {
    const formatter = createNumberFormatter(locale, options);
    const format = (value: number) => formatter.format(normalized(value));
    if (new Set(sorted.map(format)).size === sorted.length) return format;
  }

  return (value: number) => normalized(value).toExponential(16);
}

function createNumberFormatter(
  locale: string | undefined,
  options: Intl.NumberFormatOptions,
) {
  try {
    return new Intl.NumberFormat(locale || undefined, options);
  } catch {
    return new Intl.NumberFormat("en", options);
  }
}

function safeId(value: string) {
  const normalized = Array.from(value)
    .slice(0, 64)
    .join("")
    .replace(/[^A-Za-z0-9_.:-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[A-Za-z_]/.test(normalized)
    ? normalized
    : `chart-${normalized || "preview"}`;
}

function limitText(value: string, maxLength: number) {
  const characters = Array.from(value);
  return characters.length <= maxLength
    ? value
    : `${characters.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

function renderLimitedText(value: string, maxLength: number) {
  const visible = limitText(value, maxLength);
  return visible === value
    ? escapeXmlText(value)
    : `<title>${escapeXmlText(value)}</title>${escapeXmlText(visible)}`;
}

function escapeXmlText(value: string) {
  return xmlSafe(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeXmlAttribute(value: string) {
  return escapeXmlText(value);
}

function xmlSafe(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const point = value.codePointAt(index);
    if (point === undefined) continue;
    if (point > 0xffff) index += 1;
    const allowed =
      point === 0x9 ||
      point === 0xa ||
      point === 0xd ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
    result += allowed ? String.fromCodePoint(point) : "�";
  }
  return result;
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isNumber(value: number | null): value is number {
  return value !== null;
}
