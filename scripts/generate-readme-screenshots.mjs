import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const argument = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
};
const dataPath = argument(
  "--data",
  path.join(projectRoot, "outputs/screenshot-preview-20261024/data/connections.json"),
);
const outputDirectory = argument(
  "--out",
  path.join(projectRoot, "docs/assets/screenshots"),
);
const data = JSON.parse(await readFile(dataPath, "utf8"));
const hosts = new Map(data.hosts.map((host) => [host.id, host]));
const rulesFor = (hostId) => data.rules.filter((rule) => rule.hostId === hostId);

const W = 1440;
const H = 960;
const C = {
  bg: "#eff2f3",
  surface: "#fffffff0",
  overlay: "#ffffffcf",
  fg: "#25292b",
  muted: "#656d73",
  faint: "#90999f",
  border: "#ffffffb8",
  borderStrong: "#cbd2d7",
  primary: "#22acd9",
  primarySoft: "#dff4fa",
  danger: "#cf505b",
  success: "#32936f",
  scrim: "#3c3c46",
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  sans: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif",
};
const visualScale = 1440 / 1180;
const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const attr = (value) => esc(value);
const text = (x, y, value, options = {}) => {
  const {
    size = 12,
    fill = C.fg,
    weight = 400,
    anchor = "start",
    family = C.sans,
    cls = "",
    opacity,
    letterSpacing,
  } = options;
  return `<text x="${x}" y="${y}" font-family="${attr(family)}" font-size="${size * visualScale}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${cls ? ` class="${cls}"` : ""}${opacity === undefined ? "" : ` opacity="${opacity}"`}${letterSpacing === undefined ? "" : ` letter-spacing="${letterSpacing}"`}>${esc(value)}</text>`;
};
const paint = (name, value) => {
  if (/^#[\da-f]{8}$/i.test(value))
    return `${name}="${value.slice(0, 7)}" ${name}-opacity="${Number.parseInt(value.slice(7), 16) / 255}"`;
  return `${name}="${value}"`;
};
const rect = (x, y, width, height, options = {}) => {
  const { rx = 0, fill = "none", stroke = "none", strokeWidth = 1, opacity, cls = "" } = options;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ${paint("fill", fill)} ${paint("stroke", stroke)} stroke-width="${strokeWidth}"${opacity === undefined ? "" : ` opacity="${opacity}"`}${cls ? ` class="${cls}"` : ""}/>`;
};
const line = (x1, y1, x2, y2, stroke = C.border, options = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${options.width || 1}"${options.dash ? ` stroke-dasharray="${options.dash}"` : ""}${options.opacity === undefined ? "" : ` opacity="${options.opacity}"`}/>`;
const circle = (cx, cy, r, fill, options = {}) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${options.stroke ? ` stroke="${options.stroke}" stroke-width="${options.strokeWidth || 1}"` : ""}${options.opacity === undefined ? "" : ` opacity="${options.opacity}"`}/>`;

const paths = {
  server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M12 7h5M12 17h5"/>',
  serverPlus: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M12 7h5M12 17h2M19 14v6M16 17h6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  squareTerminal: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  squarePlus: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="18" r="2" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrowRight: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  copyPlus: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10M14 11v6M11 14h6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  fileInput: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 18v-6m-3 3 3 3 3-3"/>',
  fileOutput: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6m-3-3 3-3 3 3"/>',
  branch: '<path d="M6 3v12a3 3 0 0 0 3 3h9M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4M15 3h6v6M21 3l-7 7"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  zoomIn: '<circle cx="10" cy="10" r="7"/><path d="m21 21-6-6M10 7v6M7 10h6"/>',
  zoomOut: '<circle cx="10" cy="10" r="7"/><path d="m21 21-6-6M7 10h6"/>',
  maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  graph: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/><circle cx="12" cy="12" r="3"/>',
  shieldCheck: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
  network: '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
  braces: '<path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2M10 8v8M14 8v8"/>',
  container: '<path d="M3 9h18v10H3zM6 9V6h12v3M8 3h8v3M7 13v3M11 13v3M15 13v3"/>',
  listChecks: '<path d="m3 6 2 2 4-4M3 12l2 2 4-4M3 18l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
  panelBottom: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18"/>',
  expand: '<path d="m8 3-5 5M3 3v5h5M16 21l5-5M21 21v-5h-5"/>',
  logo: '<circle cx="12" cy="12" r="8"/><path d="M8 14c2-5 6-5 8 0M9 9h.01M15 9h.01"/>',
};
const icon = (name, x, y, size = 16, color = C.muted, strokeWidth = 1.7) =>
  `<g transform="translate(${x} ${y}) scale(${size * visualScale / 24})" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" color="${color}" aria-hidden="true">${paths[name] || paths.info}</g>`;
const iconButton = (name, x, y, color = C.muted, size = 28) => {
  const scaled = size * visualScale;
  return `${rect(x, y, scaled, scaled, { rx: 8, fill: "none" })}${icon(name, x + (scaled - 16 * visualScale) / 2, y + (scaled - 16 * visualScale) / 2, 16, color)}`;
};
const capsule = (x, y, width, height = 34) =>
  rect(x, y, width, height, { rx: 14, fill: C.overlay, stroke: C.border, opacity: 0.96 });
const card = (x, y, width, height, rx = 16) =>
  rect(x, y, width, height, { rx, fill: C.surface, stroke: C.border, cls: "card" });
const badge = (x, y, value, options = {}) => {
  const width = (options.width || Math.max(34, String(value).length * 6.4 + 13)) * visualScale;
  return `${rect(x, y - 18, width, 24, { rx: 7, fill: options.fill || "none", stroke: options.stroke || C.border })}${text(x + width / 2, y - 1, value, { size: options.size || 9, fill: options.color || C.muted, anchor: "middle", family: options.mono ? C.mono : C.sans })}`;
};
const status = (x, y, value = "已停止", color = C.muted) =>
  `${circle(x + 3, y - 4, 3, color)}${text(x + 12, y, value, { size: 10, fill: color })}`;
const checkbox = (x, y) => rect(x, y, 15, 15, { rx: 3, fill: C.surface, stroke: C.borderStrong });
const select = (x, y, width, value) =>
  `${rect(x, y, width, 34, { rx: 9, fill: C.surface, stroke: C.border })}${text(x + 12, y + 22, value, { size: 11 })}${icon("chevronDown", x + width - 28, y + 8, 14)}`;
const button = (x, y, width, value, options = {}) => {
  const fill = options.danger ? "#f9e9eb" : options.primary === false ? "none" : C.primarySoft;
  const color = options.danger ? C.danger : options.primary === false ? C.muted : C.primary;
  return `${rect(x, y, width, 34, { rx: 9, fill, stroke: options.outline ? C.border : "none" })}${options.icon ? icon(options.icon, x + 10, y + 8, 15, color) : ""}${text(x + width / 2 + (options.icon ? 6 : 0), y + 22, value, { size: 11, fill: color, anchor: "middle", weight: 500 })}`;
};
const input = (x, y, width, placeholder) =>
  `${rect(x, y, width, 34, { rx: 9, fill: C.surface, stroke: C.border })}${icon("search", x + 11, y + 8, 16)}${text(x + 39, y + 22, placeholder, { size: 11, fill: C.faint })}`;

const pageNames = ["连接图", "转发", "服务", "SSH 主机", "日志"];
const pageKeys = ["canvas", "forwards", "services", "hosts", "logs"];
const logo = `<g transform="translate(512 512)">${[0, 60, 120, 180, 240, 300].map((angle) => `<path transform="rotate(${angle})" fill="url(#logo-${angle})" d="M-22-109.818C-14-111.421-12-122-12-140C-12-167-14-191.966-27-197.59A68 68 0 1 1 27-197.59C14-191.966 12-167 12-140C12-122 14-111.421 22-109.818L22-80H-22Z"/>`).join("")}<circle r="112" fill="#1673ff"/></g>`;
const logoIcon = (x, y, size) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 1024 1024" aria-hidden="true">${logo}</svg>`;
const logoDefinitions = [
  ["#1268ff", "#2da9fa"],
  ["#1268ff", "#ffc43c"],
  ["#1268ff", "#ff7774"],
  ["#1268ff", "#7060ff"],
  ["#1268ff", "#73d79b"],
  ["#1268ff", "#1cbdb5"],
].map(([from, to], index) => `<linearGradient id="logo-${index * 60}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`).join("");
function windowShell(active, content, options = {}) {
  const navWidths = [78, 60, 60, 88, 62];
  const total = navWidths.reduce((a, b) => a + b, 0) + 12;
  const navX = (W - total) / 2;
  let nav = capsule(navX, 4, total);
  let cursor = navX + 4;
  pageNames.forEach((name, index) => {
    if (pageKeys[index] === active)
      nav += rect(cursor, 7, navWidths[index], 28, { rx: 9, fill: C.primarySoft });
    nav += text(cursor + navWidths[index] / 2, 26, name, {
      size: 12,
      fill: pageKeys[index] === active ? C.primary : C.muted,
      anchor: "middle",
      weight: pageKeys[index] === active ? 550 : 400,
    });
    cursor += navWidths[index] + 2;
  });
  let left = rect(4, 4, 100, 40, { rx: 20, fill: C.overlay, stroke: C.border, opacity: 0.96 });
  [24, 51, 78].forEach((x, index) => {
    left += circle(x, 25, 8.5, ["#ff766c", "#f3bf4e", "#4cc35f"][index]);
  });
  const leftActions = options.leftActions || [];
  if (leftActions.length) {
    left += capsule(108, 4, leftActions.length * 36 + 4);
    leftActions.forEach((name, index) => {
      left += iconButton(name, 110 + index * 36, 6);
    });
  }
  let right = capsule(1244, 4, 72) + iconButton("play", 1246, 6, C.primary) + iconButton("stop", 1282, 6, C.danger);
  right += capsule(1328, 4, 100) + iconButton("terminal", 1330, 6, C.fg) + iconButton("settings", 1366, 6, C.fg);
  right += logoIcon(1399, 13, 19);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="title desc">
<title id="title">OriaTunnel · ${esc(options.title || pageNames[pageKeys.indexOf(active)])}</title>
<desc id="desc">${esc(options.description || "当前浅色界面的静态 SVG 复刻。使用独立 example.com 演示数据，全部转发停止，未连接真实 SSH。")}</desc>
<defs>
  ${logoDefinitions}
  <linearGradient id="window-wash" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eaf2f4"/><stop offset="0.48" stop-color="#f0f1f1"/><stop offset="1" stop-color="#f1f0eb"/></linearGradient>
  <linearGradient id="bottom-fade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${C.bg}" stop-opacity="0"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#202028" flood-opacity="0.045"/></filter>
  <filter id="backdrop-blur" x="-4%" y="-4%" width="108%" height="108%"><feGaussianBlur stdDeviation="2.8"/></filter>
  <pattern id="dots" width="30" height="30" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.1" fill="#929b9e" opacity="0.44"/></pattern>
  <clipPath id="window"><rect width="1440" height="960" rx="26"/></clipPath>
  <style>.card{filter:url(#shadow)} text{paint-order:stroke;stroke:none}</style>
</defs>
<g clip-path="url(#window)">
${rect(0, 0, W, H, { fill: "url(#window-wash)" })}
${content}
${left}${nav}${right}
${icon("terminal", 640, 929, 15, C.muted)}
${text(664, 942, "0 运行中", { size: 10, fill: C.muted })}
${line(730, 930, 730, 943, C.borderStrong)}
${text(743, 942, "OriaTunnel", { size: 10, fill: C.muted })}
</g>
</svg>
`;
}
function pageHeading(title, count) {
  const width = [...title].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 24 : char === " " ? 7 : 14), 0) * visualScale;
  return text(86, 110, title, { size: 24, weight: 600, letterSpacing: "-0.72" }) + text(86 + width + 14, 109, count, { size: 12, fill: C.muted });
}
function route(rule) {
  const host = hosts.get(rule.hostId);
  const local = `此电脑 ${rule.bindAddress}:${rule.bindPort}`;
  if (rule.kind === "D") return `D · 此电脑 SOCKS5 ${rule.bindAddress}:${rule.bindPort} → ${host.name} [DNS / TCP]`;
  const remote = `${host.name} ${rule.targetHost}:${rule.targetPort}`;
  return rule.kind === "L" ? `L · ${local} → ${remote}` : `R · ${remote} → ${local}`;
}
function serviceIconFor(rule, x, y) {
  const value = rule.icon?.value;
  return icon(value === "code" ? "code" : value === "database" ? "database" : value === "network" ? "network" : value === "braces" ? "braces" : "globe", x, y, 18, rule.color || C.primary);
}

function connectionMap() {
  let out = rect(0, 42, W, 886, { fill: "url(#dots)" });
  const positions = {
    "demo-dev": { x: 1020, y: 68 },
    "demo-cloud": { x: 564, y: 535 },
    "demo-lab": { x: 132, y: 68 },
  };
  const local = { x: 634, y: 168, w: 190, h: 154 };
  const localPorts = {
    "demo-lab": [local.x, local.y + 76],
    "demo-dev": [local.x + local.w, local.y + 76],
    "demo-cloud": [local.x + 63, local.y + local.h],
  };
  const arrow = (x, y, direction) => {
    const points = direction === "down" ? `${x - 4},${y - 5} ${x + 4},${y - 5} ${x},${y}` : direction === "right" ? `${x - 5},${y - 4} ${x - 5},${y + 4} ${x},${y}` : `${x + 5},${y - 4} ${x + 5},${y + 4} ${x},${y}`;
    return `<polygon points="${points}" fill="#85858c"/>`;
  };
  data.hosts.forEach((host) => {
    const p = positions[host.id];
    const rules = rulesFor(host.id);
    rules.forEach((rule, index) => {
      const horizontal = host.id !== "demo-cloud";
      const startX = horizontal ? (host.id === "demo-lab" ? p.x + 344 : p.x) : p.x + 63 + index * 64;
      const startY = horizontal ? p.y + 64 + index * 130 + 81 : p.y;
      const [endX, baseY] = localPorts[host.id];
      const endY = horizontal ? baseY + index * 35 : local.y + local.h;
      const path = horizontal
        ? `M${startX},${startY} C${(startX + endX) / 2},${startY} ${(startX + endX) / 2},${endY} ${endX},${endY}`
        : `M${endX},${endY} C${endX},${(endY + startY) / 2} ${startX},${(endY + startY) / 2} ${startX},${startY}`;
      out += `<path d="${path}" fill="none" stroke="#85858c" stroke-width="1.5" stroke-dasharray="6 6"/>`;
      out += circle(startX, startY, 5.5, rule.color, { stroke: C.bg, strokeWidth: 1.5 });
      out += circle(endX, endY, 5.5, rule.color, { stroke: C.bg, strokeWidth: 1.5 });
      out += horizontal ? arrow(host.id === "demo-lab" ? endX : startX, startY, host.id === "demo-lab" ? "right" : "left") : arrow(startX, startY, "down");
    });
  });
  out += rect(local.x, local.y, local.w, local.h, { rx: 18, fill: C.surface });
  out += icon("monitor", local.x + 65, local.y + 35, 60, "#797981", 0.75);
  out += text(local.x + 95, local.y + 64, data.rules.length, { size: 21, weight: 600, anchor: "middle" });
  out += text(local.x + 95, local.y + 124, "此电脑", { size: 12, fill: C.muted, anchor: "middle" });
  data.rules.forEach((rule) => {
    const index = rulesFor(rule.hostId).findIndex((item) => item.id === rule.id);
    const bottom = rule.hostId === "demo-cloud";
    const left = rule.hostId === "demo-lab";
    const x = bottom ? local.x + 26 + index * 64 : left ? local.x + 12 : local.x + 130;
    const y = bottom ? local.y + 141 : local.y + 79 + index * 35;
    const localPort = rule.kind === "R" ? rule.targetPort : rule.bindPort;
    out += badge(x, y, localPort, { mono: true, fill: `${rule.color}24`, stroke: `${rule.color}30`, color: rule.color, width: 48, size: 10 });
  });
  for (const host of data.hosts) {
    const p = positions[host.id];
    const rules = rulesFor(host.id);
    const width = 344;
    const height = 64 + rules.length * 130 + 12;
    out += card(p.x, p.y, width, height, 16);
    out += icon("server", p.x + 12, p.y + 20, 22, C.fg);
    out += text(p.x + 46, p.y + 21, "SSH HOST", { size: 9, fill: C.muted, letterSpacing: "1.2" });
    out += text(p.x + width - 12, p.y + 21, `${host.user}@${host.address}:${host.port}`, { size: 9, fill: C.muted, anchor: "end", family: C.mono });
    out += text(p.x + 46, p.y + 44, host.name, { size: 13, weight: 600 });
    out += badge(p.x + 228, p.y + 45, `${rules.length} 转发`, { width: 44, size: 9 });
    out += iconButton("squareTerminal", p.x + 296, p.y + 28, C.fg, 28);
    rules.forEach((rule, index) => {
      const y = p.y + 64 + index * 130;
      out += line(p.x, y, p.x + width, y, C.border);
      out += serviceIconFor(rule, p.x + 12, y + 14);
      out += text(p.x + 40, y + 29, rule.name, { size: 11, weight: 600 });
      out += status(p.x + 270, y + 29, "已停止", C.muted);
      out += text(p.x + 12, y + 51, rule.kind === "L" ? "L · 访问远端服务" : rule.kind === "R" ? "R · 让远端访问本地服务" : "D · 动态 SOCKS5 代理", { size: 9, fill: C.muted });
      out += text(p.x + width - 12, y + 51, "↑ 0 B　↓ 0 B", { size: 9, fill: C.muted, anchor: "end", family: C.mono });
      out += text(p.x + 12, y + 82, `${rule.bindAddress}:`, { size: 10, family: C.mono });
      if (rule.kind === "R") out += badge(p.x + 88, y + 84, rule.bindPort, { mono: true, fill: `${rule.color}24`, stroke: "none", color: rule.color, width: 46, size: 10 });
      else out += text(p.x + 88, y + 82, rule.bindPort, { size: 10, family: C.mono });
      out += icon("arrowRight", p.x + 145, y + 72, 14, C.muted);
      out += text(p.x + 169, y + 82, rule.kind === "D" ? "SOCKS5 · SSH" : `${rule.targetHost}:`, { size: 10, family: C.mono });
      if (rule.kind !== "R") out += badge(p.x + (rule.kind === "D" ? 268 : 246), y + 84, rule.kind === "D" ? "22" : rule.targetPort, { mono: true, fill: `${rule.color}24`, stroke: "none", color: rule.color, width: 38, size: 10 });
      else out += text(p.x + 251, y + 82, rule.targetPort, { size: 10, family: C.mono });
      out += iconButton("external", p.x + 303, y + 67, C.muted, 28);
      const ax = p.x + 124;
      out += iconButton("info", ax, y + 93, C.fg, 28) + iconButton("settings", ax + 34, y + 93, C.fg, 28) + iconButton("copyPlus", ax + 68, y + 93, C.fg, 28) + iconButton("trash", ax + 102, y + 93, C.danger, 28);
      out += button(p.x + 252, y + 93, 80, "启动", { icon: "play" });
    });
  }
  out += capsule(666, 884, 108, 38);
  out += iconButton("zoomOut", 669, 887) + iconButton("maximize", 705, 887) + iconButton("zoomIn", 741, 887);
  return out;
}

function forwardsPage() {
  let out = pageHeading("转发", "当前工作区（默认）");
  out += checkbox(86, 143) + text(108, 156, "全选", { size: 11 });
  out += text(158, 156, "已选 0 / 6", { size: 11, fill: C.muted });
  out += `<g opacity="0.35">${icon("play", 236, 141, 16, C.primary)}${text(262, 156, "启动", { size: 11, fill: C.primary })}${icon("stop", 324, 141, 16, C.danger)}${text(350, 156, "停止", { size: 11, fill: C.danger })}</g>`;
  out += button(1114, 136, 112, "导入配置", { icon: "fileInput", primary: false });
  out += button(1236, 136, 118, "导出配置  6", { icon: "fileOutput", primary: false });
  out += line(86, 185, 1354, 185, C.border);
  let y = 204;
  for (const host of data.hosts) {
    const rules = rulesFor(host.id);
    out += icon("server", 88, y, 19, C.fg);
    out += text(122, y + 17, host.name, { size: 13, weight: 600 });
    out += text(122, y + 38, `${host.user}@${host.address}:${host.port}`, { size: 10, fill: C.muted, family: C.mono });
    out += text(1354, y + 26, `${rules.length} 转发`, { size: 9, fill: C.muted, anchor: "end" });
    y += 54;
    for (const rule of rules) {
      out += card(86, y, 1268, 90);
      out += checkbox(101, y + 38);
      out += serviceIconFor(rule, 128, y + 16);
      out += text(158, y + 32, rule.name, { size: 13, weight: 600 });
      out += status(158 + [...rule.name].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 16 : 8), 0) + 14, y + 32);
      out += text(128, y + 70, route(rule), { size: 10, fill: C.muted, family: C.mono });
      const ax = 1098;
      out += iconButton("info", ax, y + 28, C.fg) + iconButton("settings", ax + 36, y + 28, C.fg) + iconButton("copyPlus", ax + 72, y + 28, C.fg) + iconButton("trash", ax + 108, y + 28, C.danger);
      out += button(ax + 148, y + 28, 100, "启动", { icon: "play" });
      y += 104;
    }
    y += 24;
  }
  out += rect(0, 908, W, 52, { fill: "url(#bottom-fade)" });
  return out;
}

function servicesPage() {
  let out = pageHeading("服务", "0 项服务");
  out += input(86, 136, 390, "搜索服务…");
  out += select(826, 136, 78, "全部");
  out += checkbox(920, 146) + text(944, 159, "全选当前结果", { size: 11 });
  out += text(1050, 159, "已选 0 项", { size: 11, fill: C.muted });
  out += button(1126, 136, 100, "导入配置", { icon: "fileInput", primary: false });
  out += `<g opacity="0.35">${button(1238, 136, 116, "导出全部", { icon: "fileOutput", primary: false })}</g>`;
  out += line(86, 185, 1354, 185, C.border);
  out += icon("listChecks", 696, 286, 40, C.muted, 1.4);
  out += text(720, 363, "服务", { size: 16, weight: 600, anchor: "middle" });
  out += text(720, 407, "添加服务，自行配置远程命令按钮。", { size: 12, fill: C.muted, anchor: "middle" });
  out += button(657, 434, 126, "添加服务", { icon: "plus" });
  return out;
}

function hostsPage() {
  let out = pageHeading("SSH 主机", "3 台主机");
  out += input(86, 136, 390, "搜索主机、地址或用户…");
  out += select(1016, 136, 170, "全部") + line(1204, 143, 1204, 163, C.borderStrong) + select(1222, 136, 132, "按标签");
  out += line(86, 185, 1354, 185, C.border);
  let y = 208;
  ["demo-dev", "demo-lab", "demo-cloud"].forEach((id) => {
    const host = hosts.get(id);
    const tag = id === "demo-dev" ? "开发" : id === "demo-lab" ? "实验室" : "云服务";
    out += icon("chevronDown", 88, y, 14, C.fg) + text(112, y + 13, `${tag} · 1`, { size: 12, weight: 600 });
    y += 30;
    out += card(86, y, 1268, 90);
    out += icon("server", 101, y + 35, 19, C.fg);
    out += text(134, y + 34, host.name, { size: 13, weight: 600 });
    const nameWidth = [...host.name].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 16 : 8), 0);
    out += status(134 + nameWidth + 14, y + 34, "未测试", C.muted);
    out += text(134, y + 65, `${host.user}@${host.address}:${host.port}`, { size: 10, fill: C.muted, family: C.mono });
    out += badge(134 + `${host.user}@${host.address}:${host.port}`.length * 7.35 + 16, y + 65, host.authMethod === "agent" ? "系统代理" : "私钥", { width: host.authMethod === "agent" ? 54 : 40, size: 10 });
    const ax = 1010;
    out += iconButton("info", ax, y + 28, C.fg) + iconButton("settings", ax + 36, y + 28, C.fg) + iconButton("copyPlus", ax + 72, y + 28, C.fg) + iconButton("squareTerminal", ax + 108, y + 28, C.fg) + iconButton("trash", ax + 144, y + 28, C.danger);
    out += button(ax + 184, y + 28, 126, "测试连接", { icon: "play" });
    y += 105;
  });
  return out;
}

const logGroups = [
  { id: "demo-lab", count: 3, runId: "b5a7463d" },
  { id: "demo-dev", count: 6, runId: "cf5010e5" },
  { id: "demo-cloud", count: 3, runId: "a746c3d2" },
];
const logStates = [
  { label: "已停止", color: C.muted, time: "2026/10/24 16:27:14" },
  { label: "网络错误", color: C.danger, time: "2026/10/24 16:17:52" },
  { label: "连接中", color: "#b57729", time: "2026/10/24 16:17:48" },
];
function logsPage() {
  let out = pageHeading("日志", "12 条记录");
  out += input(86, 136, 390, "搜索规则、事件或运行代次");
  out += select(710, 136, 150, "全部 SSH 主机") + select(872, 136, 120, "全部转发") + select(1004, 136, 120, "全部状态");
  out += button(1136, 136, 80, "仅警告", { primary: false });
  out += line(1230, 143, 1230, 163, C.borderStrong) + select(1242, 136, 112, "按 SSH 主机");
  out += line(86, 185, 1354, 185, C.border);
  let y = 211;
  logGroups.forEach((group) => {
    const host = hosts.get(group.id);
    out += icon("chevronDown", 88, y, 14, C.fg) + text(112, y + 13, host.name, { size: 12, weight: 600 }) + text(112 + host.name.length * 15 + 12, y + 13, group.count, { size: 11, fill: C.muted });
    y += 44;
    for (let index = 0; index < group.count; index += 1) {
      const state = logStates[index % logStates.length];
      out += card(86, y, 1268, 90);
      out += status(102, y + 32, state.label, state.color);
      out += text(1338, y + 32, state.time, { size: 11, fill: C.muted, anchor: "end", family: C.mono });
      out += text(102, y + 66, `${host.name} · 测试连接`, { size: 11, fill: C.muted });
      out += text(1338, y + 66, `重连次数 0 · ${group.runId}`, { size: 11, fill: C.muted, anchor: "end", family: C.mono });
      y += 104;
    }
  });
  out += rect(0, 908, W, 52, { fill: "url(#bottom-fade)" });
  return out;
}

function terminalPage() {
  let out = `<g filter="url(#backdrop-blur)" opacity="0.68">${logsPage()}</g>`;
  out += card(1016, 56, 420, 896, 14);
  out += text(1028, 82, "SSH 终端", { size: 12, weight: 600 });
  out += iconButton("expand", 1304, 65) + iconButton("panelBottom", 1332, 65) + iconButton("squarePlus", 1360, 65) + iconButton("close", 1388, 65);
  out += rect(1028, 94, 164, 28, { rx: 7, fill: "#ededf1" });
  out += icon("terminal", 1036, 101, 13, C.muted) + text(1055, 113, "开发环境", { size: 11 }) + icon("close", 1168, 101, 13, C.muted);
  out += text(1028, 143, "developer@dev.example…  SSH 连接失败，请重试。", { size: 10, fill: C.muted });
  out += rect(0, 0, W, H, { fill: "#f4f4f6", opacity: 0.32 });
  out += card(408, 347, 624, 318, 16);
  out += text(432, 387, "打开 SSH 终端", { size: 18, weight: 600 });
  out += iconButton("close", 988, 366, C.fg, 32);
  out += text(432, 443, "仅在主动操作时连接。每个终端使用独立的 SSH 连接。", { size: 12, fill: C.muted });
  out += text(432, 482, "SSH 主机", { size: 12, fill: C.muted });
  const host = hosts.get("demo-dev");
  out += rect(432, 495, 576, 42, { rx: 8, fill: C.surface });
  out += text(444, 522, `${host.name} · ${host.user}@${host.address}:${host.port}`, { size: 12 });
  out += icon("chevronDown", 974, 507, 16, C.muted);
  out += button(920, 606, 88, "连接", { primary: true });
  return out;
}

const screenshots = {
  "connection-map.svg": windowShell("canvas", connectionMap(), {
    title: "连接图",
    leftActions: ["serverPlus", "branch"],
    description: "OriaTunnel 当前连接图的静态 SVG 复刻。3 台 example.com 演示主机与 6 条 L/R/D 转发均为停止状态，未连接真实 SSH。",
  }),
  "forwards.svg": windowShell("forwards", forwardsPage(), {
    title: "转发",
    leftActions: ["branch"],
    description: "OriaTunnel 当前转发列表的静态 SVG 复刻，包含 6 条停止的 L/R/D 示例转发，未连接真实 SSH。",
  }),
  "services.svg": windowShell("services", servicesPage(), {
    title: "服务",
    leftActions: ["plus"],
    description: "OriaTunnel 当前服务页的静态 SVG 复刻，展示 0 项服务的空状态与添加服务入口。",
  }),
  "hosts.svg": windowShell("hosts", hostsPage(), {
    title: "SSH 主机",
    leftActions: ["serverPlus"],
    description: "OriaTunnel 当前 SSH 主机页的静态 SVG 复刻，展示开发、实验室、云服务三个分组中的 example.com 演示主机，无真实凭据。",
  }),
  "logs.svg": windowShell("logs", logsPage(), {
    title: "日志",
    description: "OriaTunnel 当前日志页的静态 SVG 复刻，展示隔离示例主机的测试连接记录，不代表真实连接。",
  }),
  "terminal.svg": windowShell("logs", terminalPage(), {
    title: "SSH 终端",
    description: "OriaTunnel 当前 SSH 终端入口的静态 SVG 复刻，展示右侧工作面板与主机选择弹窗，未发起新的 SSH 连接。",
  }),
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  Object.entries(screenshots).map(([name, svg]) =>
    writeFile(path.join(outputDirectory, name), svg, "utf8"),
  ),
);
console.log(`Generated ${Object.keys(screenshots).length} SVG screenshots in ${outputDirectory}`);
