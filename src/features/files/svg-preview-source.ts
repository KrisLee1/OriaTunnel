import { sanitizeAnimatedSvg } from "@/lib/markdown/safe-svg";

export function svgPreviewSource(source: string) {
  let svg = source.trim().replace(/^<\?xml\s+[^?]*\?>\s*/i, "");
  // XML declarations and leading editor comments are common in standalone SVGs.
  while (svg.startsWith("<!--")) {
    const end = svg.indexOf("-->");
    if (end < 0) break;
    svg = svg.slice(end + 3).trimStart();
  }
  return sanitizeAnimatedSvg(svg);
}
