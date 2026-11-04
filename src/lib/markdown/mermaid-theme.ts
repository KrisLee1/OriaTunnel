const supportedMermaidColor = /^(?:#[\da-f]{3,8}|rgba?\(|hsla?\()/i;
const oklchPattern =
  /^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+(-?[\d.]+)(?:deg)?(?:\s*\/\s*[\d.]+%?)?\s*\)$/i;

/** Convert theme OKLCH tokens to the legacy RGB syntax accepted by Mermaid. */
export function mermaidThemeColor(value: string, fallback: string) {
  const normalized = value.trim();
  if (supportedMermaidColor.test(normalized)) return normalized;

  const match = normalized.match(oklchPattern);
  if (!match) return fallback;
  const lightness = Number(match[1]) / (match[2] ? 100 : 1);
  const chroma = Number(match[3]);
  const hue = (Number(match[4]) * Math.PI) / 180;
  if (![lightness, chroma, hue].every(Number.isFinite)) return fallback;

  let mappedChroma = chroma;
  let channels = oklchToLinearRgb(lightness, mappedChroma, hue);
  for (
    let attempt = 0;
    attempt < 32 && channels.some(outsideSrgb);
    attempt += 1
  ) {
    mappedChroma *= 0.92;
    channels = oklchToLinearRgb(lightness, mappedChroma, hue);
  }

  const rgb = channels.map((channel) =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(channel))) * 255),
  );
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function oklchToLinearRgb(lightness: number, chroma: number, hue: number) {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function outsideSrgb(channel: number) {
  return channel < 0 || channel > 1;
}

function linearToSrgb(channel: number) {
  return channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * channel ** (1 / 2.4) - 0.055;
}
