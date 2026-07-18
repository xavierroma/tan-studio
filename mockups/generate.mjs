import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PREVIEWS = join(ROOT, "previews");
mkdirSync(PREVIEWS, { recursive: true });

const C = {
  canvas: "#EEE8DC",
  paper: "#F8F5ED",
  surface: "#FFFCF7",
  ink: "#3E3027",
  graphite: "#E7D8C2",
  muted: "#796D62",
  soft: "#F0E8DB",
  line: "#DED2C1",
  lineDark: "#C5B59E",
  orange: "#B86F55",
  orangeSoft: "#F3E1D6",
  teal: "#4E8982",
  tealSoft: "#DDEAE5",
  red: "#A4483F",
  redSoft: "#F5E1DE",
  amber: "#967746",
  amberSoft: "#F2E7C9",
  blue: "#668994",
  blueSoft: "#DFE9EA",
  purple: "#8A7184",
  oak: "#D8C09E",
  oakSoft: "#EEE2D1",
  sage: "#7E9678",
  sageSoft: "#E2EADF",
  lagoon: "#5D9692",
  lagoonSoft: "#E0EEEA",
};

const board = { frames: [], shapes: [] };
let elementNumber = 0;

function stableId(prefix = "e") {
  elementNumber += 1;
  return `${prefix}${elementNumber.toString(36).padStart(5, "0")}`;
}

function hashNumber(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) || 1;
}

function common(type, x, y, width, height, opts = {}) {
  const id = opts.id ?? stableId(type[0]);
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: opts.stroke ?? C.line,
    backgroundColor: opts.fill ?? "transparent",
    fillStyle: "solid",
    strokeWidth: opts.strokeWidth ?? 1,
    strokeStyle: opts.dash ? "dashed" : "solid",
    roughness: 0,
    opacity: opts.opacity ?? 100,
    groupIds: opts.groupIds ?? [],
    frameId: opts.frameId ?? null,
    index: `a${elementNumber.toString(36)}`,
    roundness: opts.round === false ? null : { type: 3 },
    seed: hashNumber(`${id}:seed`) % 2147483647,
    version: 1,
    versionNonce: hashNumber(`${id}:version`) % 2147483647,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: opts.locked ?? false,
  };
}

function addFrame(key, name, x, y, width, height) {
  const id = stableId("f");
  const element = {
    ...common("frame", x, y, width, height, {
      id,
      stroke: C.lineDark,
      strokeWidth: 1,
      fill: "transparent",
      round: false,
    }),
    name,
  };
  const frame = { key, name, id, x, y, width, height };
  board.frames.push(frame);
  board.shapes.push({ kind: "frame", frame, element });
  rect(frame, 0, 0, width, height, {
    fill: C.paper,
    stroke: C.lineDark,
    radius: 0,
    locked: true,
  });
  return frame;
}

function resolve(frame, x, y) {
  return { x: frame.x + x, y: frame.y + y };
}

function rect(frame, x, y, width, height, opts = {}) {
  const p = resolve(frame, x, y);
  const element = common("rectangle", p.x, p.y, width, height, {
    frameId: frame.id,
    stroke: opts.stroke ?? C.line,
    strokeWidth: opts.strokeWidth ?? 1,
    fill: opts.fill ?? "transparent",
    opacity: opts.opacity,
    dash: opts.dash,
    round: opts.radius === 0 ? false : true,
    locked: opts.locked,
  });
  board.shapes.push({
    kind: "rect",
    frame,
    x,
    y,
    width,
    height,
    radius: opts.radius ?? 8,
    fill: opts.fill ?? "transparent",
    stroke: opts.stroke ?? C.line,
    strokeWidth: opts.strokeWidth ?? 1,
    dash: opts.dash ?? false,
    opacity: opts.opacity ?? 100,
    element,
  });
  return element.id;
}

function text(frame, x, y, value, opts = {}) {
  const lines = String(value).split("\n");
  const fontSize = opts.size ?? 14;
  const lineHeight = opts.lineHeight ?? 1.25;
  const width = opts.width ?? Math.max(8, ...lines.map((line) => line.length * fontSize * 0.57));
  const height = opts.height ?? Math.max(fontSize * lineHeight, lines.length * fontSize * lineHeight);
  const p = resolve(frame, opts.align === "center" ? x - width / 2 : x, y);
  const element = {
    ...common("text", p.x, p.y, width, height, {
      frameId: frame.id,
      stroke: opts.color ?? C.ink,
      fill: "transparent",
      strokeWidth: 1,
      round: false,
    }),
    fontSize,
    fontFamily: opts.mono ? 3 : 2,
    text: String(value),
    textAlign: opts.align ?? "left",
    verticalAlign: "top",
    containerId: null,
    originalText: String(value),
    autoResize: true,
    lineHeight,
  };
  board.shapes.push({
    kind: "text",
    frame,
    x,
    y,
    value: String(value),
    size: fontSize,
    width,
    height,
    lineHeight,
    color: opts.color ?? C.ink,
    weight: opts.weight ?? 400,
    align: opts.align ?? "left",
    mono: opts.mono ?? false,
    opacity: opts.opacity ?? 100,
    element,
  });
  return element.id;
}

function line(frame, points, opts = {}) {
  const minX = Math.min(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxX = Math.max(...points.map(([x]) => x));
  const maxY = Math.max(...points.map(([, y]) => y));
  const p = resolve(frame, minX, minY);
  const rel = points.map(([x, y]) => [x - minX, y - minY]);
  const element = {
    ...common("line", p.x, p.y, Math.max(1, maxX - minX), Math.max(1, maxY - minY), {
      frameId: frame.id,
      stroke: opts.stroke ?? C.ink,
      strokeWidth: opts.strokeWidth ?? 1,
      fill: "transparent",
      dash: opts.dash,
      round: false,
      opacity: opts.opacity,
    }),
    points: rel,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: opts.arrow ? "arrow" : null,
    elbowed: false,
  };
  board.shapes.push({
    kind: "line",
    frame,
    points,
    stroke: opts.stroke ?? C.ink,
    strokeWidth: opts.strokeWidth ?? 1,
    dash: opts.dash ?? false,
    opacity: opts.opacity ?? 100,
    element,
  });
  return element.id;
}

function circle(frame, x, y, diameter, opts = {}) {
  const p = resolve(frame, x, y);
  const element = common("ellipse", p.x, p.y, diameter, diameter, {
    frameId: frame.id,
    stroke: opts.stroke ?? C.line,
    strokeWidth: opts.strokeWidth ?? 1,
    fill: opts.fill ?? "transparent",
    round: false,
  });
  board.shapes.push({
    kind: "circle",
    frame,
    x,
    y,
    diameter,
    fill: opts.fill ?? "transparent",
    stroke: opts.stroke ?? C.line,
    strokeWidth: opts.strokeWidth ?? 1,
    element,
  });
  return element.id;
}

function pill(frame, x, y, label, tone = "neutral", opts = {}) {
  const tones = {
    neutral: [C.soft, C.muted, C.line],
    orange: [C.orangeSoft, C.orange, C.orangeSoft],
    teal: [C.tealSoft, C.teal, C.tealSoft],
    sage: [C.sageSoft, C.sage, C.sageSoft],
    red: [C.redSoft, C.red, C.redSoft],
    amber: [C.amberSoft, C.amber, C.amberSoft],
    blue: [C.blueSoft, C.blue, C.blueSoft],
  };
  const [fill, color, stroke] = tones[tone];
  const width = opts.width ?? Math.max(54, label.length * 7 + 22);
  const height = opts.height ?? 26;
  rect(frame, x, y, width, height, { fill, stroke, radius: height / 2 });
  text(frame, x + width / 2, y + 5, label, {
    size: opts.size ?? 11,
    color,
    weight: 600,
    align: "center",
    width,
  });
  return width;
}

function button(frame, x, y, label, tone = "outline", opts = {}) {
  const width = opts.width ?? Math.max(82, label.length * 7.2 + 28);
  const height = opts.height ?? 36;
  const config = {
    outline: [C.surface, C.ink, C.lineDark],
    primary: [C.orange, C.surface, C.orange],
    teal: [C.teal, C.surface, C.teal],
    ghost: ["transparent", C.muted, "transparent"],
    danger: [C.redSoft, C.red, C.red],
    disabled: [C.soft, C.muted, C.line],
  }[tone];
  rect(frame, x, y, width, height, { fill: config[0], stroke: config[2], radius: 7 });
  text(frame, x + width / 2, y + (height - 14) / 2 - 1, label, {
    size: opts.size ?? 12,
    color: config[1],
    weight: 600,
    align: "center",
    width,
  });
  return width;
}

function field(frame, x, y, width, label, value, opts = {}) {
  text(frame, x, y, label.toUpperCase(), { size: 9, color: C.muted, weight: 600, width });
  rect(frame, x, y + 16, width, opts.height ?? 38, { fill: C.surface, stroke: C.line, radius: 6 });
  text(frame, x + 12, y + 27, value, { size: 12, color: opts.muted ? C.muted : C.ink, width: width - 24 });
  if (opts.chevron) text(frame, x + width - 20, y + 27, "⌄", { size: 13, color: C.muted });
}

function toggle(frame, x, y, label, enabled = true, opts = {}) {
  rect(frame, x, y, 30, 17, { fill: enabled ? C.teal : C.soft, stroke: enabled ? C.teal : C.lineDark, radius: 10 });
  circle(frame, enabled ? x + 15 : x + 2, y + 2, 13, { fill: C.surface, stroke: C.surface });
  text(frame, x + 40, y + 1, label, { size: opts.size ?? 11, color: opts.color ?? C.ink, width: opts.width ?? 150 });
}

function checkbox(frame, x, y, label, checked = true, opts = {}) {
  rect(frame, x, y, 16, 16, { fill: checked ? C.orange : C.surface, stroke: checked ? C.orange : C.lineDark, radius: 3 });
  if (checked) text(frame, x + 3, y + 0.5, "✓", { size: 12, color: C.surface, weight: 700 });
  text(frame, x + 25, y, label, { size: opts.size ?? 11, color: opts.color ?? C.ink, width: opts.width ?? 170 });
}

function divider(frame, x1, y1, x2, y2, color = C.line) {
  line(frame, [[x1, y1], [x2, y2]], { stroke: color, strokeWidth: 1 });
}

const NAV = ["Roast", "Roasts", "Profiles", "Coffees", "Labels", "Devices"];

function desktopShell(frame, active, title, subtitle, actions = []) {
  rect(frame, 0, 0, 88, frame.height, { fill: C.graphite, stroke: C.lineDark, radius: 0 });
  circle(frame, 24, 18, 40, { fill: C.orange, stroke: C.orange });
  text(frame, 44, 29, "RS", { size: 12, color: C.surface, weight: 700, align: "center", width: 40 });
  text(frame, 44, 67, "ROAST\nSTUDIO", { size: 8, color: C.ink, weight: 650, lineHeight: 1.2, width: 48, align: "center" });
  NAV.forEach((item, index) => {
    const y = 128 + index * 78;
    if (item === active) rect(frame, 9, y - 10, 70, 58, { fill: C.oak, stroke: C.oak, radius: 10 });
    const initials = { Roast: "◉", Roasts: "▤", Profiles: "⌁", Coffees: "◇", Labels: "▣", Devices: "⌘" }[item];
    text(frame, 44, y - 2, initials, { size: 19, color: item === active ? C.orange : C.muted, align: "center", width: 42 });
    text(frame, 44, y + 24, item, { size: 9, color: item === active ? C.ink : C.muted, weight: item === active ? 650 : 500, align: "center", width: 60 });
  });
  circle(frame, 28, frame.height - 58, 32, { fill: C.oakSoft, stroke: C.lineDark });
  text(frame, 44, frame.height - 49, "XR", { size: 10, color: C.ink, weight: 650, align: "center", width: 32 });

  rect(frame, 88, 0, frame.width - 88, 74, { fill: C.paper, stroke: C.line, radius: 0 });
  text(frame, 116, 16, title, { size: 23, color: C.ink, weight: 650 });
  text(frame, 116, 46, subtitle, { size: 11, color: C.muted, width: 720 });
  let cursor = frame.width - 22;
  [...actions].reverse().forEach((action) => {
    const width = action.width ?? Math.max(88, action.label.length * 7 + 28);
    cursor -= width;
    button(frame, cursor, 19, action.label, action.tone ?? "outline", { width });
    cursor -= 10;
  });
  return { x: 108, y: 92, width: frame.width - 128, height: frame.height - 112 };
}

function sectionLabel(frame, x, y, label, meta = "") {
  text(frame, x, y, label, { size: 12, color: C.ink, weight: 650 });
  if (meta) text(frame, x + 116, y + 1, meta, { size: 10, color: C.muted });
}

function metric(frame, x, y, label, value, unit = "", width = 150, tone = C.ink) {
  text(frame, x, y, label.toUpperCase(), { size: 9, color: C.muted, weight: 600, width });
  text(frame, x, y + 17, value, { size: 25, color: tone, weight: 600, mono: true, width });
  if (unit) text(frame, x + Math.min(width - 32, value.length * 14 + 5), y + 26, unit, { size: 10, color: C.muted });
}

function chartGrid(frame, x, y, width, height, opts = {}) {
  rect(frame, x, y, width, height, { fill: opts.fill ?? C.surface, stroke: C.line, radius: opts.radius ?? 8 });
  const hCount = opts.hCount ?? 5;
  const vCount = opts.vCount ?? 8;
  for (let i = 1; i < hCount; i += 1) {
    const gy = y + (height / hCount) * i;
    line(frame, [[x + 46, gy], [x + width - 18, gy]], { stroke: C.line, strokeWidth: 1, opacity: 75 });
  }
  for (let i = 1; i < vCount; i += 1) {
    const gx = x + 46 + ((width - 64) / vCount) * i;
    line(frame, [[gx, y + 16], [gx, y + height - 30]], { stroke: C.line, strokeWidth: 1, opacity: 65 });
  }
  const yLabels = opts.yLabels ?? ["240", "180", "120", "60", "0"];
  yLabels.forEach((label, i) => text(frame, x + 10, y + 14 + i * ((height - 50) / (yLabels.length - 1)), label, { size: 9, color: C.muted, mono: true }));
  const xLabels = opts.xLabels ?? ["0:00", "2:00", "4:00", "6:00", "8:00", "10:00"];
  xLabels.forEach((label, i) => text(frame, x + 46 + i * ((width - 90) / (xLabels.length - 1)), y + height - 22, label, { size: 9, color: C.muted, mono: true }));
}

function temperatureChart(frame, x, y, width, height, opts = {}) {
  chartGrid(frame, x, y, width, height, opts);
  const px = x + 48;
  const py = y + 18;
  const pw = width - 70;
  const ph = height - 53;
  const pts = (data) => data.map(([tx, ty]) => [px + tx * pw, py + ty * ph]);
  const target = [[0, .91], [.08, .82], [.18, .69], [.28, .57], [.39, .45], [.5, .35], [.62, .27], [.75, .18], [.88, .11], [1, .07]];
  const actual = [[0, .92], [.06, .86], [.14, .74], [.24, .61], [.34, .51], [.44, .39], [.54, .33], [.65, .24], [.76, .19], [.87, .13], [opts.progress ?? .91, .105]];
  const ror = [[0, .78], [.07, .62], [.16, .54], [.25, .58], [.33, .6], [.45, .64], [.58, .68], [.68, .71], [.78, .74], [.88, .77], [opts.progress ?? .91, .79]];
  line(frame, pts(target), { stroke: C.blue, strokeWidth: 2, dash: true, opacity: 90 });
  line(frame, pts(actual), { stroke: C.orange, strokeWidth: 3 });
  line(frame, pts(ror), { stroke: C.teal, strokeWidth: 2 });
  const events = opts.events ?? [[.24, "CC"], [.76, "FC"], [.91, "NOW"]];
  events.forEach(([pos, label], index) => {
    const ex = px + pos * pw;
    line(frame, [[ex, py], [ex, py + ph]], { stroke: index === events.length - 1 ? C.orange : C.lineDark, dash: true, strokeWidth: index === events.length - 1 ? 2 : 1 });
    pill(frame, ex - 18, y + 8, label, index === events.length - 1 ? "orange" : "neutral", { width: label === "NOW" ? 42 : 36, height: 20, size: 8 });
  });
  circle(frame, px + (opts.progress ?? .91) * pw - 5, py + .105 * ph - 5, 10, { fill: C.orange, stroke: C.surface, strokeWidth: 2 });
}

function legend(frame, x, y, items) {
  let cursor = x;
  items.forEach(([label, color, dash = false]) => {
    line(frame, [[cursor, y + 7], [cursor + 22, y + 7]], { stroke: color, strokeWidth: 2, dash });
    text(frame, cursor + 28, y, label, { size: 10, color: C.muted });
    cursor += label.length * 6 + 62;
  });
}

function sparkline(frame, x, y, width, height, color = C.orange, variant = 0) {
  const data = variant % 3 === 0
    ? [[0, .9], [.15, .72], [.3, .58], [.46, .52], [.62, .32], [.78, .25], [1, .12]]
    : variant % 3 === 1
      ? [[0, .86], [.12, .74], [.29, .67], [.47, .43], [.66, .35], [.82, .2], [1, .17]]
      : [[0, .92], [.15, .78], [.32, .64], [.48, .48], [.63, .41], [.8, .26], [1, .08]];
  line(frame, data.map(([a, b]) => [x + a * width, y + b * height]), { stroke: color, strokeWidth: 2 });
}

function buildLive() {
  const f = addFrame("live-roast", "01 — Live roast command center", 0, 0, 1440, 900);
  desktopShell(f, "Roast", "Live roast", "Ethiopia Guji · Natural Light · Level 1.1 · 90 g", [
    { label: "Connected · USB", tone: "teal", width: 132 },
  ]);

  rect(f, 108, 92, 986, 80, { fill: C.surface, stroke: C.line, radius: 8 });
  metric(f, 130, 108, "Elapsed", "06:42", "", 150, C.orange);
  divider(f, 286, 104, 286, 160);
  metric(f, 310, 108, "Bean temp", "184.6", "°C", 150);
  divider(f, 474, 104, 474, 160);
  metric(f, 498, 108, "Actual RoR", "8.4", "°C/min", 150, C.teal);
  divider(f, 664, 104, 664, 160);
  metric(f, 688, 108, "Power", "0.77", "kW", 130);
  divider(f, 836, 104, 836, 160);
  metric(f, 860, 108, "Fan", "13,820", "rpm", 190);

  rect(f, 1114, 92, 306, 770, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 1136, 112, "ROAST STATE", { size: 9, color: C.muted, weight: 600 });
  pill(f, 1136, 132, "MAILLARD", "orange", { width: 84 });
  text(f, 1234, 135, "Expected FC 07:36", { size: 11, color: C.muted });
  rect(f, 1136, 178, 262, 58, { fill: C.tealSoft, stroke: C.tealSoft, radius: 7 });
  text(f, 1152, 190, "✓ LOCAL OPERATOR NEARBY", { size: 10, color: C.teal, weight: 650 });
  text(f, 1152, 209, "Roaster remains authoritative", { size: 10, color: C.muted });

  sectionLabel(f, 1136, 260, "Mark event", "⌘ 1–5");
  button(f, 1136, 286, "Colour change", "outline", { width: 262, height: 43 });
  button(f, 1136, 340, "First crack", "primary", { width: 262, height: 48 });
  button(f, 1136, 399, "First crack end", "outline", { width: 262, height: 43 });
  button(f, 1136, 453, "Second crack", "outline", { width: 262, height: 43 });
  text(f, 1136, 510, "Last event", { size: 9, color: C.muted, weight: 600 });
  text(f, 1136, 529, "Colour change · 03:12 · 149.3°C", { size: 11, color: C.ink });
  button(f, 1323, 518, "Edit", "ghost", { width: 64, height: 28, size: 10 });
  divider(f, 1136, 562, 1398, 562);
  sectionLabel(f, 1136, 582, "Quick note", "at 06:42");
  rect(f, 1136, 608, 262, 72, { fill: C.paper, stroke: C.line, radius: 6 });
  text(f, 1148, 620, "Aroma shifting to caramel…", { size: 11, color: C.muted, width: 220 });
  button(f, 1286, 692, "Add note", "primary", { width: 112, height: 34 });
  divider(f, 1136, 746, 1398, 746);
  pill(f, 1136, 766, "NO REMOTE START", "neutral", { width: 128, height: 24, size: 9 });
  text(f, 1136, 800, "Roast was started on the Nano dial.\nStop/end controls stay local and gated.", { size: 10, color: C.muted, lineHeight: 1.4, width: 250 });

  sectionLabel(f, 108, 194, "Telemetry", "live · newest sample 120 ms ago");
  temperatureChart(f, 108, 220, 986, 500, { progress: .71, events: [[.28, "CC"], [.71, "NOW"]] });
  legend(f, 150, 688, [["Actual temp", C.orange], ["Profile target", C.blue, true], ["Actual RoR", C.teal]]);
  rect(f, 108, 740, 986, 122, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 130, 758, "SERIES", { size: 9, color: C.muted, weight: 600 });
  checkbox(f, 130, 783, "Actual temp", true);
  checkbox(f, 282, 783, "Profile", true);
  checkbox(f, 412, 783, "Actual RoR", true);
  checkbox(f, 560, 783, "Desired RoR", false);
  checkbox(f, 716, 783, "Power", false);
  checkbox(f, 830, 783, "Fan", false);
  text(f, 130, 824, "Predicted end", { size: 10, color: C.muted });
  text(f, 212, 822, "09:24", { size: 13, color: C.ink, mono: true, weight: 600 });
  text(f, 310, 824, "Development", { size: 10, color: C.muted });
  text(f, 396, 822, "01:48 · 19.1%", { size: 13, color: C.ink, mono: true, weight: 600 });
  text(f, 558, 824, "Recommended end", { size: 10, color: C.muted });
  text(f, 672, 822, "218.0°C", { size: 13, color: C.ink, mono: true, weight: 600 });
  button(f, 952, 811, "View options", "outline", { width: 120, height: 34 });
}

function buildLibrary() {
  const f = addFrame("roast-library", "02 — Roast library", 1500, 0, 1440, 900);
  desktopShell(f, "Roasts", "Roast notebook", "2,418 roasts · Every batch linked to its green coffee and tasting feedback", [
    { label: "Export CSV", tone: "outline", width: 104 },
    { label: "Compare 2", tone: "primary", width: 108 },
  ]);

  rect(f, 108, 92, 550, 50, { fill: C.surface, stroke: C.line, radius: 9 });
  text(f, 128, 109, "⌕", { size: 18, color: C.muted });
  text(f, 158, 110, "Search coffee, provider, farm, tasting note, profile…", { size: 12, color: C.muted });
  button(f, 574, 101, "⌘ K", "ghost", { width: 64, height: 32, size: 10 });
  field(f, 676, 92, 252, "Group", "Coffee lot → Provider", { chevron: true });
  field(f, 944, 92, 194, "Sort", "Date · newest", { chevron: true });
  button(f, 1154, 108, "Columns 11", "outline", { width: 112, height: 34, size: 10 });
  button(f, 1278, 108, "Save view", "outline", { width: 120, height: 34, size: 10 });

  field(f, 108, 160, 154, "Date", "Last 90 days", { chevron: true });
  field(f, 276, 160, 178, "Provider", "All providers", { chevron: true });
  field(f, 468, 160, 156, "Country / region", "Any origin", { chevron: true });
  field(f, 638, 160, 156, "Process", "Any process", { chevron: true });
  field(f, 808, 160, 142, "Tasting score", "80+", { chevron: true });
  field(f, 964, 160, 142, "Profile", "Any profile", { chevron: true });
  field(f, 1120, 160, 142, "Status", "Tasted + due", { chevron: true });
  button(f, 1276, 176, "+ Filter", "outline", { width: 122, height: 38 });

  pill(f, 108, 230, "SAVED VIEW · ROASTING NOTEBOOK", "sage", { width: 226, height: 26, size: 9 });
  text(f, 350, 236, "Grouped by coffee lot · 86 groups · score sorted within each group", { size: 10, color: C.muted });
  button(f, 1286, 226, "Reset", "ghost", { width: 92, height: 30, size: 9 });

  const tx = 108; const ty = 270; const tw = 1312; const rowH = 62;
  rect(f, tx, ty, tw, 38, { fill: C.soft, stroke: C.line, radius: 7 });
  const cols = [148, 250, 388, 506, 686, 798, 938, 1034, 1102, 1294];
  ["DATE ↓", "COFFEE", "PROVIDER", "COUNTRY · REGION · FARM", "PROCESS", "PROFILE / REV", "LEVEL · LOAD", "SCORE", "TASTING NOTES", "STATUS"].forEach((h, i) => text(f, cols[i], ty + 13, h, { size: i === 3 ? 8 : 8.5, color: C.muted, weight: 650 }));
  checkbox(f, 118, ty + 11, "", false, { width: 0 });

  const groups = [
    {
      label: "Guji Shakiso · ETH-GUJ-24-07",
      meta: "Osito Coffee · purchase PO-2025-041 · 7 roasts · 1.42 kg on hand",
      rows: [
        ["18 Jul 09:42", "Guji Shakiso", "Osito Coffee", "Ethiopia · Guji\nKayon Mountain", "Natural", "Natural Light · r12", "1.1 · 90 g", "88", "Jasmine · peach", "BEST"],
        ["14 Jul 08:27", "Guji Shakiso", "Osito Coffee", "Ethiopia · Guji\nKayon Mountain", "Natural", "Natural Light · r11", "1.1 · 90 g", "82", "Thin finish", "TASTED"],
        ["09 Jul 10:36", "Guji Shakiso", "Osito Coffee", "Ethiopia · Guji\nKayon Mountain", "Natural", "Natural Light · r11", "1.0 · 90 g", "85", "Floral · lemon", "TASTED"],
      ],
    },
    {
      label: "Finca El Paraíso · COL-HUI-25-03",
      meta: "Forest Coffee · purchase PO-2025-052 · 4 roasts · 0.78 kg on hand",
      rows: [
        ["17 Jul 16:08", "El Paraíso", "Forest Coffee", "Colombia · Huila\nFinca El Paraíso", "Thermal shock", "Washed Light · r7", "1.0 · 100 g", "86", "Rose · lychee", "TASTED"],
        ["11 Jul 13:22", "El Paraíso", "Forest Coffee", "Colombia · Huila\nFinca El Paraíso", "Thermal shock", "Washed Light · r6", "1.1 · 100 g", "—", "Tasting due day 5", "DUE"],
        ["04 Jul 09:10", "El Paraíso", "Forest Coffee", "Colombia · Huila\nFinca El Paraíso", "Thermal shock", "Filter Omni · r18", "1.0 · 90 g", "83", "Citrus · dry finish", "TASTED"],
      ],
    },
  ];
  let cursorY = ty + 38;
  groups.forEach((group, groupIndex) => {
    rect(f, tx, cursorY, tw, 34, { fill: groupIndex === 0 ? C.sageSoft : C.oakSoft, stroke: C.line, radius: 0 });
    text(f, 126, cursorY + 10, "⌄", { size: 11, color: C.muted });
    text(f, 148, cursorY + 9, group.label, { size: 10.5, color: C.ink, weight: 650 });
    text(f, 430, cursorY + 10, group.meta, { size: 9, color: C.muted });
    button(f, 1302, cursorY + 3, "Open lot", "ghost", { width: 92, height: 28, size: 9 });
    cursorY += 34;
    group.rows.forEach((row, rowIndex) => {
      const best = row[9] === "BEST";
      rect(f, tx, cursorY, tw, rowH, { fill: best ? C.lagoonSoft : C.surface, stroke: C.line, radius: 0 });
      checkbox(f, 118, cursorY + 23, "", groupIndex === 0 && rowIndex < 2, { width: 0 });
      row.forEach((value, colIndex) => {
        const isScore = colIndex === 7;
        const isStatus = colIndex === 9;
        const color = isScore ? (value === "—" ? C.muted : C.orange) : C.ink;
        if (isStatus) {
          pill(f, cols[colIndex], cursorY + 18, value, value === "BEST" ? "sage" : value === "DUE" ? "amber" : "neutral", { width: value === "TASTED" ? 68 : 58, height: 24, size: 8 });
        } else {
          text(f, cols[colIndex], cursorY + (String(value).includes("\n") ? 12 : 21), value, { size: colIndex === 1 ? 10.5 : 9.3, color, weight: colIndex === 1 || isScore ? 600 : 400, mono: colIndex === 0 || colIndex === 6 || isScore, lineHeight: 1.35, width: colIndex === 3 ? 166 : colIndex === 8 ? 176 : 126 });
        }
      });
      cursorY += rowH;
    });
  });

  rect(f, 108, 820, 1312, 42, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 126, 834, "2 selected · 6 shown of 2,418", { size: 10.5, color: C.ink, weight: 600 });
  text(f, 356, 835, "Raw .klog retained · database view can be exported as CSV or JSON", { size: 9.5, color: C.muted });
  button(f, 1084, 825, "Print labels", "outline", { width: 112, height: 32 });
  button(f, 1208, 825, "Compare selected", "primary", { width: 188, height: 32 });
}

function buildCatalog() {
  const f = addFrame("green-coffee-catalog", "11 — Green coffee catalog and purchases", 4500, 0, 1440, 900);
  desktopShell(f, "Coffees", "Green coffee catalog", "Providers → purchases → coffee lots → roasts → tastings", [
    { label: "Add provider", tone: "outline", width: 112 },
    { label: "New purchase", tone: "primary", width: 120 },
  ]);

  rect(f, 108, 92, 1312, 68, { fill: C.oakSoft, stroke: C.line, radius: 10 });
  const flow = [
    [132, "PROVIDER", "Osito Coffee"],
    [378, "PURCHASE", "PO-2025-041 · 5 kg"],
    [674, "COFFEE LOT", "Guji Shakiso · 2.5 kg"],
    [974, "ROASTS", "7 batches"],
    [1190, "TASTINGS", "5 scored"],
  ];
  flow.forEach(([x, label, value], index) => {
    text(f, x, 106, label, { size: 8.5, color: C.muted, weight: 650 });
    text(f, x, 127, value, { size: 11, color: C.ink, weight: 600 });
    if (index < flow.length - 1) text(f, x + (index < 2 ? 216 : 238), 119, "→", { size: 16, color: C.orange, weight: 650 });
  });

  rect(f, 108, 180, 890, 682, { fill: C.surface, stroke: C.line, radius: 10 });
  rect(f, 128, 200, 420, 44, { fill: C.paper, stroke: C.line, radius: 8 });
  text(f, 146, 213, "⌕", { size: 16, color: C.muted });
  text(f, 174, 214, "Search provider, purchase, lot, origin…", { size: 11, color: C.muted });
  field(f, 566, 194, 190, "Group", "Provider → Purchase", { chevron: true });
  button(f, 772, 210, "Inventory filters", "outline", { width: 198, height: 34, size: 10 });

  const tx = 128; const tableY = 266; const tableW = 850;
  rect(f, tx, tableY, tableW, 34, { fill: C.soft, stroke: C.line, radius: 6 });
  [[152, "COFFEE / LOT"], [404, "ORIGIN · PROCESS"], [610, "PURCHASED"], [708, "ON HAND"], [796, "ROASTS"], [872, "LATEST SCORE"]].forEach(([x, label]) => text(f, x, tableY + 11, label, { size: 8.5, color: C.muted, weight: 650 }));

  rect(f, tx, 300, tableW, 34, { fill: C.sageSoft, stroke: C.line, radius: 0 });
  text(f, 144, 309, "⌄  Osito Coffee", { size: 11, color: C.ink, weight: 650 });
  pill(f, 848, 305, "3 PURCHASES", "sage", { width: 110, height: 23, size: 8 });
  rect(f, 144, 334, 818, 34, { fill: C.oakSoft, stroke: C.line, radius: 0 });
  text(f, 160, 344, "⌄  PO-2025-041", { size: 10, color: C.ink, weight: 650 });
  text(f, 308, 345, "Received 06 May 2026 · 5.0 kg · $94.50 landed", { size: 9, color: C.muted });
  pill(f, 856, 339, "ACTIVE", "teal", { width: 78, height: 23, size: 8 });

  const lots = [
    ["Guji Shakiso", "ETH-GUJ-24-07", "Ethiopia · Guji\nNatural", "2.50 kg", "1.42 kg", "7", "88"],
    ["Bensa Bombe", "ETH-SID-25-02", "Ethiopia · Sidama\nWashed", "2.50 kg", "2.08 kg", "3", "86"],
  ];
  lots.forEach((row, i) => {
    const y = 368 + i * 66;
    rect(f, 144, y, 818, 66, { fill: i === 0 ? C.lagoonSoft : C.surface, stroke: C.line, radius: 0 });
    text(f, 164, y + 12, row[0], { size: 11, color: C.ink, weight: 650 });
    text(f, 164, y + 36, row[1], { size: 8.5, color: C.muted, mono: true });
    text(f, 404, y + 12, row[2], { size: 9.5, color: C.ink, lineHeight: 1.35, width: 180 });
    text(f, 610, y + 22, row[3], { size: 10, color: C.ink, mono: true });
    text(f, 708, y + 22, row[4], { size: 10, color: C.ink, mono: true, weight: 600 });
    text(f, 812, y + 22, row[5], { size: 10, color: C.ink, mono: true });
    text(f, 892, y + 20, row[6], { size: 13, color: C.orange, mono: true, weight: 650 });
  });

  rect(f, 144, 500, 818, 34, { fill: C.oakSoft, stroke: C.line, radius: 0 });
  text(f, 160, 510, "›  PO-2025-018", { size: 10, color: C.ink, weight: 650 });
  text(f, 308, 511, "Received 18 Feb 2026 · 10.0 kg · 3 coffee lots", { size: 9, color: C.muted });
  pill(f, 848, 505, "2.1 KG LEFT", "amber", { width: 102, height: 23, size: 8 });

  rect(f, tx, 554, tableW, 34, { fill: C.sageSoft, stroke: C.line, radius: 0 });
  text(f, 144, 563, "⌄  Forest Coffee", { size: 11, color: C.ink, weight: 650 });
  pill(f, 848, 559, "2 PURCHASES", "sage", { width: 110, height: 23, size: 8 });
  rect(f, 144, 588, 818, 34, { fill: C.oakSoft, stroke: C.line, radius: 0 });
  text(f, 160, 598, "⌄  PO-2025-052", { size: 10, color: C.ink, weight: 650 });
  text(f, 308, 599, "Received 29 Jun 2026 · 3.0 kg · $81.20 landed", { size: 9, color: C.muted });
  const forestLots = [
    ["Finca El Paraíso", "COL-HUI-25-03", "Colombia · Huila", "Thermal shock", "0.78 kg", "4", "86"],
    ["Las Flores", "COL-HUI-25-09", "Colombia · Huila", "Anaerobic washed", "1.64 kg", "2", "—"],
  ];
  forestLots.forEach((row, i) => {
    const y = 622 + i * 62;
    rect(f, 144, y, 818, 62, { fill: C.surface, stroke: C.line, radius: 0 });
    text(f, 164, y + 10, row[0], { size: 10.5, color: C.ink, weight: 650 });
    text(f, 164, y + 33, row[1], { size: 8.5, color: C.muted, mono: true });
    text(f, 404, y + 11, row[2], { size: 9.5, color: C.ink });
    text(f, 404, y + 33, row[3], { size: 8.5, color: C.muted });
    text(f, 708, y + 20, row[4], { size: 10, color: C.ink, mono: true, weight: 600 });
    text(f, 812, y + 20, row[5], { size: 10, color: C.ink, mono: true });
    text(f, 892, y + 18, row[6], { size: 13, color: row[6] === "—" ? C.muted : C.orange, mono: true, weight: 650 });
  });
  text(f, 128, 826, "23 coffee lots · 5 providers · 14.8 kg on hand", { size: 9.5, color: C.muted });
  button(f, 824, 815, "Import inventory", "outline", { width: 146, height: 32, size: 9 });

  rect(f, 1018, 180, 402, 682, { fill: C.surface, stroke: C.line, radius: 10 });
  text(f, 1042, 202, "SELECTED PURCHASE", { size: 9, color: C.muted, weight: 650 });
  text(f, 1042, 229, "PO-2025-041", { size: 21, color: C.ink, weight: 650, mono: true });
  text(f, 1042, 260, "Osito Coffee", { size: 12, color: C.orange, weight: 650 });
  divider(f, 1042, 290, 1396, 290);
  const purchaseDetails = [
    ["Ordered", "29 Apr 2026"],
    ["Received", "06 May 2026"],
    ["Supplier invoice", "OSI-8824"],
    ["Purchased", "5.00 kg"],
    ["Landed cost", "$94.50 · $18.90/kg"],
  ];
  purchaseDetails.forEach(([label, value], i) => {
    text(f, 1042, 314 + i * 34, label, { size: 9.5, color: C.muted });
    text(f, 1188, 314 + i * 34, value, { size: 9.5, color: C.ink, weight: 600, mono: i > 2, width: 190 });
  });
  text(f, 1042, 500, "ALLOCATION", { size: 9, color: C.muted, weight: 650 });
  rect(f, 1042, 524, 354, 12, { fill: C.soft, stroke: C.soft, radius: 8 });
  rect(f, 1042, 524, 145, 12, { fill: C.sage, stroke: C.sage, radius: 8 });
  text(f, 1042, 548, "1.50 kg roasted", { size: 9.5, color: C.ink, mono: true });
  text(f, 1292, 548, "3.50 kg on hand", { size: 9.5, color: C.ink, mono: true, align: "right", width: 104 });

  rect(f, 1042, 584, 354, 92, { fill: C.lagoonSoft, stroke: C.line, radius: 8 });
  text(f, 1058, 599, "Guji Shakiso", { size: 11, color: C.ink, weight: 650 });
  text(f, 1058, 622, "7 roasts · best 88 · next tasting due 23 Jul", { size: 9.5, color: C.muted });
  button(f, 1236, 636, "Open lot", "outline", { width: 140, height: 28, size: 9 });
  rect(f, 1042, 688, 354, 72, { fill: C.paper, stroke: C.line, radius: 8 });
  text(f, 1058, 702, "Bensa Bombe", { size: 10.5, color: C.ink, weight: 650 });
  text(f, 1058, 726, "3 roasts · best 86 · 2.08 kg on hand", { size: 9.5, color: C.muted });
  button(f, 1042, 788, "Edit purchase", "outline", { width: 164, height: 38 });
  button(f, 1218, 788, "Plan roast", "primary", { width: 178, height: 38 });
}

function buildReview() {
  const f = addFrame("log-review", "03 — Log review and annotations", 3000, 0, 1440, 900);
  desktopShell(f, "Roasts", "Guji Shakiso · 18 Jul 2026", "Natural Light · r12 · Level 1.1 · 90 g · complete log reconciled", [
    { label: "Export", tone: "outline", width: 86 },
    { label: "Compare", tone: "outline", width: 96 },
    { label: "Extract profile", tone: "primary", width: 126 },
  ]);

  pill(f, 108, 92, "COMPLETE", "teal", { width: 82 });
  pill(f, 200, 92, "3 ANNOTATIONS", "blue", { width: 110 });
  pill(f, 320, 92, "RAW .KLOG KEPT", "neutral", { width: 116 });
  text(f, 798, 99, "Absolute time", { size: 10, color: C.muted });
  button(f, 890, 88, "Absolute", "primary", { width: 88, height: 32, size: 10 });
  button(f, 984, 88, "Align FC", "outline", { width: 82, height: 32, size: 10 });

  sectionLabel(f, 108, 136, "Roast telemetry", "hover to inspect · click chart to annotate");
  temperatureChart(f, 108, 164, 958, 448, { progress: .95, events: [[.3, "CC"], [.77, "FC"], [.95, "END"]] });
  legend(f, 150, 580, [["Actual temp", C.orange], ["Profile", C.blue, true], ["Actual RoR", C.teal]]);
  const note1x = 108 + 48 + .54 * (958 - 70);
  line(f, [[note1x, 290], [note1x + 56, 246]], { stroke: C.blue, strokeWidth: 1 });
  circle(f, note1x - 5, 285, 10, { fill: C.blue, stroke: C.surface, strokeWidth: 2 });
  rect(f, note1x + 54, 214, 188, 58, { fill: C.blueSoft, stroke: C.blue, radius: 6 });
  text(f, note1x + 66, 226, "05:24 · Aromatics lifted", { size: 10, color: C.blue, weight: 600 });
  text(f, note1x + 66, 245, "Keep this momentum next time", { size: 9, color: C.muted });
  const note2x = 108 + 48 + .82 * (958 - 70);
  line(f, [[note2x, 258], [note2x - 30, 198]], { stroke: C.amber, strokeWidth: 1 });
  circle(f, note2x - 5, 253, 10, { fill: C.amber, stroke: C.surface, strokeWidth: 2 });
  pill(f, note2x - 112, 176, "CHECK RoR FLICK", "amber", { width: 122, height: 24, size: 8 });

  sectionLabel(f, 108, 636, "Event timeline", "native events remain editable");
  rect(f, 108, 662, 958, 88, { fill: C.surface, stroke: C.line, radius: 8 });
  line(f, [[150, 704], [1022, 704]], { stroke: C.lineDark, strokeWidth: 2 });
  const timeline = [[.04, "START", "00:00"], [.31, "COLOUR", "03:04"], [.76, "FC", "07:28"], [.96, "END", "09:18"]];
  timeline.forEach(([pos, label, when], i) => {
    const x = 150 + pos * 872;
    circle(f, x - 7, 697, 14, { fill: i === 3 ? C.orange : C.surface, stroke: i === 3 ? C.orange : C.lineDark, strokeWidth: 2 });
    text(f, x, 673, label, { size: 8, color: C.muted, align: "center", width: 70 });
    text(f, x, 718, when, { size: 10, color: C.ink, mono: true, align: "center", width: 70 });
  });
  button(f, 915, 677, "Edit events", "outline", { width: 126, height: 34 });

  rect(f, 108, 770, 958, 92, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 128, 786, "CONCLUSION", { size: 9, color: C.muted, weight: 650 });
  text(f, 128, 807, "Best expression so far. Preserve Maillard shape; soften fan transition after first crack.", { size: 12, color: C.ink, width: 720 });
  pill(f, 128, 835, "SWEET", "orange", { width: 62, height: 22, size: 8 });
  pill(f, 198, 835, "FLORAL", "teal", { width: 66, height: 22, size: 8 });
  pill(f, 272, 835, "PROFILE CANDIDATE", "blue", { width: 124, height: 22, size: 8 });
  button(f, 910, 799, "Save conclusion", "outline", { width: 132, height: 36 });

  rect(f, 1086, 92, 334, 770, { fill: C.surface, stroke: C.line, radius: 8 });
  rect(f, 1104, 110, 298, 38, { fill: C.soft, stroke: C.soft, radius: 6 });
  button(f, 1108, 114, "Annotations 3", "primary", { width: 98, height: 30, size: 9 });
  button(f, 1210, 114, "Tasting", "ghost", { width: 84, height: 30, size: 9 });
  button(f, 1298, 114, "Details", "ghost", { width: 84, height: 30, size: 9 });
  text(f, 1110, 174, "ANCHORED NOTES", { size: 9, color: C.muted, weight: 650 });
  const notes = [
    ["05:24 · 172.1°C", "Aromatics lifted", "Keep this momentum next time", "blue"],
    ["07:58 · 203.8°C", "Check RoR flick", "Fan change may be too abrupt", "amber"],
    ["09:18 · 218.2°C", "End decision", "Colour looked even; no smoke", "orange"],
  ];
  notes.forEach(([anchor, title, body, tone], i) => {
    const y = 198 + i * 122;
    rect(f, 1108, y, 290, 106, { fill: tone === "amber" ? C.amberSoft : tone === "orange" ? C.orangeSoft : C.blueSoft, stroke: C.line, radius: 7 });
    text(f, 1122, y + 12, anchor, { size: 9, color: C.muted, mono: true });
    text(f, 1122, y + 34, title, { size: 12, color: C.ink, weight: 650 });
    text(f, 1122, y + 57, body, { size: 10, color: C.muted });
    button(f, 1340, y + 67, "•••", "ghost", { width: 44, height: 26, size: 9 });
  });
  divider(f, 1108, 580, 1398, 580);
  sectionLabel(f, 1108, 602, "Structured tasting");
  text(f, 1108, 630, "Overall", { size: 10, color: C.muted });
  text(f, 1252, 622, "88 / 100", { size: 19, color: C.orange, weight: 650, mono: true });
  text(f, 1108, 666, "Descriptors", { size: 10, color: C.muted });
  pill(f, 1108, 688, "jasmine", "teal", { width: 70, height: 23, size: 8 });
  pill(f, 1186, 688, "peach", "orange", { width: 62, height: 23, size: 8 });
  pill(f, 1256, 688, "honey", "amber", { width: 60, height: 23, size: 8 });
  text(f, 1108, 732, "Next action", { size: 10, color: C.muted });
  text(f, 1108, 754, "Create r13 with gentler post-FC fan step.", { size: 11, color: C.ink, width: 270 });
  button(f, 1108, 806, "Edit tasting", "outline", { width: 132, height: 36 });
}

function profileCurve(frame, x, y, width, height) {
  chartGrid(frame, x, y, width, height, { yLabels: ["240", "180", "120", "60", "0"], xLabels: ["0:00", "2:00", "4:00", "6:00", "8:00", "10:00"] });
  const px = x + 48; const py = y + 18; const pw = width - 70; const ph = height - 53;
  const base = [[0, .91], [.14, .72], [.31, .52], [.48, .35], [.67, .22], [.83, .12], [1, .06]];
  const proposed = [[0, .91], [.14, .72], [.31, .52], [.48, .35], [.67, .235], [.84, .135], [1, .085]];
  const plot = (data) => data.map(([a, b]) => [px + a * pw, py + b * ph]);
  line(frame, plot(base), { stroke: C.lineDark, strokeWidth: 3, dash: true });
  line(frame, plot(proposed), { stroke: C.orange, strokeWidth: 3 });
  proposed.forEach(([a, b], i) => {
    const cx = px + a * pw; const cy = py + b * ph;
    if (i > 0 && i < proposed.length - 1) {
      line(frame, [[cx - 24, cy + 9], [cx, cy], [cx + 25, cy - 8]], { stroke: C.orange, strokeWidth: 1, opacity: 70 });
    }
    circle(frame, cx - 6, cy - 6, 12, { fill: C.surface, stroke: C.orange, strokeWidth: 2 });
  });
}

function buildProfile() {
  const f = addFrame("profile-editor", "04 — Profile editor + AI proposal", 0, 960, 1440, 900);
  desktopShell(f, "Profiles", "Natural Light · revision 12", "Based on r11 · 18 Jul 2026 · schema 1.8 · firmware 7.20.6", [
    { label: "Deploy to roaster", tone: "outline", width: 142 },
    { label: "Save new revision", tone: "primary", width: 148 },
  ]);
  pill(f, 108, 92, "VALID", "teal", { width: 62 });
  button(f, 184, 88, "Temperature", "primary", { width: 106, height: 32, size: 10 });
  button(f, 296, 88, "Fan", "outline", { width: 62, height: 32, size: 10 });
  button(f, 364, 88, "Settings", "outline", { width: 78, height: 32, size: 10 });
  button(f, 448, 88, "Compare", "outline", { width: 82, height: 32, size: 10 });
  text(f, 748, 97, "Undo  ↶    Redo  ↷", { size: 10, color: C.muted });
  button(f, 870, 88, "Transform", "outline", { width: 98, height: 32, size: 10 });

  sectionLabel(f, 108, 138, "Temperature profile", "drag points or enter exact values");
  profileCurve(f, 108, 166, 860, 444);
  legend(f, 150, 578, [["Proposed r13", C.orange], ["Current r12", C.lineDark, true]]);

  rect(f, 108, 630, 860, 232, { fill: C.surface, stroke: C.line, radius: 8 });
  rect(f, 126, 648, 824, 36, { fill: C.soft, stroke: C.soft, radius: 6 });
  button(f, 130, 651, "Basic", "primary", { width: 68, height: 30, size: 9 });
  button(f, 202, 651, "Advanced", "ghost", { width: 78, height: 30, size: 9 });
  button(f, 284, 651, "Expert", "ghost", { width: 66, height: 30, size: 9 });
  button(f, 354, 651, "Engineer", "ghost", { width: 74, height: 30, size: 9 });
  field(f, 130, 704, 170, "Reference load", "90 g", { chevron: true });
  field(f, 316, 704, 170, "Recommended end", "218.0 °C");
  field(f, 502, 704, 170, "Expected FC", "07:36");
  field(f, 688, 704, 170, "Schema", "1.8", { chevron: true });
  text(f, 130, 778, "REVISION HISTORY", { size: 9, color: C.muted, weight: 650 });
  line(f, [[130, 817], [854, 817]], { stroke: C.lineDark, strokeWidth: 2 });
  [[.04, "r9", "02 Jul"], [.28, "r10", "06 Jul"], [.52, "r11", "14 Jul"], [.76, "r12", "18 Jul"], [.98, "r13", "draft"]].forEach(([pos, rev, date], i) => {
    const x = 130 + pos * 724;
    circle(f, x - 7, 810, 14, { fill: i === 4 ? C.orangeSoft : i === 3 ? C.orange : C.surface, stroke: i >= 3 ? C.orange : C.lineDark, strokeWidth: 2 });
    text(f, x, 788, rev, { size: 9, color: i >= 3 ? C.orange : C.muted, align: "center", width: 44, weight: 600 });
    text(f, x, 834, date, { size: 8, color: C.muted, align: "center", width: 54 });
  });

  rect(f, 988, 92, 432, 770, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 1012, 112, "AI PROFILE PROPOSAL", { size: 9, color: C.muted, weight: 650 });
  pill(f, 1274, 106, "LOCAL VALIDATION PASSED", "teal", { width: 124, height: 23, size: 8 });
  text(f, 1012, 145, "Gentler finish for more florals", { size: 17, color: C.ink, weight: 650 });
  text(f, 1012, 173, "Grounded in r11, r12 and two selected Guji roasts.", { size: 10, color: C.muted, width: 376 });
  rect(f, 1012, 204, 384, 76, { fill: C.blueSoft, stroke: C.blueSoft, radius: 7 });
  text(f, 1028, 218, "TRANSMISSION PREVIEW", { size: 9, color: C.blue, weight: 650 });
  text(f, 1028, 238, "2 logs · 1 profile · coffee metadata\nNo device serial, local path, or credentials", { size: 10, color: C.muted, lineHeight: 1.35, width: 340 });
  text(f, 1012, 304, "PROPOSED CHANGES", { size: 9, color: C.muted, weight: 650 });
  const changes = [
    ["End temperature", "218.0 → 216.0°C", "Preserve acidity after FC", "HIGH"],
    ["Total duration", "09:18 → 09:30", "Smoother declining RoR", "MED"],
    ["Post-FC fan", "+400 rpm from 07:42", "Reduce flick seen in r12", "MED"],
  ];
  changes.forEach(([name, diff, reason, conf], i) => {
    const y = 330 + i * 118;
    rect(f, 1012, y, 384, 104, { fill: C.paper, stroke: C.line, radius: 7 });
    checkbox(f, 1028, y + 15, name, true, { width: 170, size: 11 });
    pill(f, 1334, y + 10, conf, conf === "HIGH" ? "teal" : "amber", { width: 48, height: 21, size: 8 });
    text(f, 1053, y + 40, diff, { size: 11, color: C.orange, mono: true, weight: 600 });
    text(f, 1053, y + 64, reason, { size: 10, color: C.muted, width: 310 });
  });
  rect(f, 1012, 700, 384, 54, { fill: C.amberSoft, stroke: C.amberSoft, radius: 7 });
  text(f, 1028, 714, "△ Review on a supervised roast; expected FC may shift.", { size: 10, color: C.amber, weight: 600, width: 340 });
  button(f, 1012, 774, "Reject", "outline", { width: 92, height: 38 });
  button(f, 1114, 774, "Edit proposal", "outline", { width: 116, height: 38 });
  button(f, 1240, 774, "Create r13", "primary", { width: 156, height: 38 });
  text(f, 1012, 824, "Creates a local revision only · never deploys automatically", { size: 9, color: C.muted, width: 380 });
}

function qrPattern(frame, x, y, size) {
  rect(frame, x, y, size, size, { fill: C.surface, stroke: C.ink, radius: 1 });
  const cell = size / 11;
  const modules = [
    [0, 0, 3, 3], [8, 0, 3, 3], [0, 8, 3, 3],
    [4, 1, 1, 1], [5, 2, 1, 1], [4, 4, 2, 1], [7, 4, 1, 2], [3, 6, 1, 1],
    [5, 6, 2, 1], [8, 6, 1, 1], [4, 8, 1, 2], [6, 8, 1, 1], [8, 8, 3, 3],
  ];
  modules.forEach(([cx, cy, cw, ch]) => rect(frame, x + cx * cell, y + cy * cell, cw * cell, ch * cell, { fill: C.ink, stroke: C.ink, radius: 0 }));
}

function buildLabel() {
  const f = addFrame("label-composer", "05 — Label composer", 1500, 960, 1440, 900);
  desktopShell(f, "Labels", "Print label", "Guji Shakiso · roast 18 Jul 2026 · source fields locked to roast history", [
    { label: "Export PDF", tone: "outline", width: 106 },
    { label: "Print 2 copies", tone: "primary", width: 128 },
  ]);
  field(f, 108, 92, 264, "Source roast", "Guji Shakiso · 18 Jul · 09:42", { chevron: true });
  field(f, 388, 92, 196, "Template", "Compact 90 × 50", { chevron: true });
  field(f, 600, 92, 134, "Package net", "75 g");
  field(f, 750, 92, 76, "Copies", "2");
  pill(f, 842, 109, "FITS · 68% INK", "teal", { width: 112, height: 24, size: 8 });

  rect(f, 108, 166, 820, 564, { fill: C.soft, stroke: C.line, radius: 8 });
  text(f, 130, 186, "EXACT-SIZE PREVIEW · 90 × 50 MM", { size: 9, color: C.muted, weight: 650 });
  line(f, [[180, 270], [840, 270]], { stroke: C.lineDark, strokeWidth: 1 });
  line(f, [[180, 260], [180, 280]], { stroke: C.lineDark });
  line(f, [[840, 260], [840, 280]], { stroke: C.lineDark });
  text(f, 510, 248, "90 mm", { size: 9, color: C.muted, align: "center", width: 60 });
  line(f, [[157, 300], [157, 666]], { stroke: C.lineDark, strokeWidth: 1 });
  line(f, [[147, 300], [167, 300]], { stroke: C.lineDark });
  line(f, [[147, 666], [167, 666]], { stroke: C.lineDark });
  text(f, 132, 462, "50 mm", { size: 9, color: C.muted, width: 60 });
  rect(f, 180, 300, 660, 366, { fill: "#FFFEFA", stroke: C.lineDark, strokeWidth: 2, radius: 4 });
  rect(f, 180, 300, 16, 366, { fill: C.orange, stroke: C.orange, radius: 0 });
  text(f, 230, 342, "GUJI SHAKISO", { size: 31, color: C.ink, weight: 650, width: 410 });
  text(f, 232, 390, "ETHIOPIA · NATURAL · HEIRLOOM", { size: 12, color: C.orange, weight: 650, width: 390 });
  divider(f, 232, 430, 788, 430, C.lineDark);
  text(f, 232, 458, "Roasted", { size: 10, color: C.muted });
  text(f, 232, 479, "18 JUL 2026", { size: 15, color: C.ink, weight: 600, mono: true });
  text(f, 402, 458, "Profile", { size: 10, color: C.muted });
  text(f, 402, 479, "NATURAL LIGHT · 1.1", { size: 15, color: C.ink, weight: 600 });
  text(f, 232, 532, "Net 75 g · Light · Best from day 5", { size: 12, color: C.ink, weight: 500 });
  text(f, 232, 565, "Jasmine · peach · honey", { size: 13, color: C.muted });
  text(f, 232, 620, "ROAST 7FD2", { size: 9, color: C.muted, mono: true });
  qrPattern(f, 704, 500, 86);
  text(f, 747, 592, "Roast details", { size: 8, color: C.muted, align: "center", width: 90 });
  text(f, 130, 696, "Preview uses printer-safe margins · QR contains an opaque roast ID only", { size: 10, color: C.muted });

  rect(f, 108, 750, 820, 112, { fill: C.surface, stroke: C.line, radius: 8 });
  sectionLabel(f, 128, 770, "Print destination");
  field(f, 128, 792, 272, "Printer", "System dialog · Brother QL", { chevron: true });
  field(f, 416, 792, 184, "Paper", "90 × 50 mm", { chevron: true });
  field(f, 616, 792, 136, "Scale", "100%");
  button(f, 768, 808, "Test PDF", "outline", { width: 136, height: 38 });

  rect(f, 948, 92, 472, 770, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 972, 112, "TEMPLATE CONTENT", { size: 9, color: C.muted, weight: 650 });
  text(f, 972, 140, "Compact 90 × 50", { size: 18, color: C.ink, weight: 650 });
  text(f, 972, 169, "Version 4 · modified 12 Jul 2026", { size: 10, color: C.muted });
  divider(f, 972, 200, 1396, 200);
  const fields = [
    ["Coffee name", true, "Guji Shakiso"],
    ["Origin · process · variety", true, "Ethiopia · Natural · Heirloom"],
    ["Roast date", true, "18 Jul 2026"],
    ["Profile · level", true, "Natural Light · 1.1"],
    ["Package net · roast degree", true, "75 g net · Light"],
    ["Best-use window", true, "Best from day 5"],
    ["Tasting note", true, "Jasmine · peach · honey"],
    ["Roast QR", true, "Opaque ID · no local path"],
    ["Green input load", false, "90 g · internal batch data"],
    ["Device identity", false, "Hidden by policy"],
  ];
  fields.forEach(([name, on, value], i) => {
    const y = 216 + i * 47;
    toggle(f, 972, y, name, on, { width: 210 });
    text(f, 1198, y + 1, value, { size: 9, color: on ? C.muted : C.lineDark, width: 190 });
  });
  divider(f, 972, 704, 1396, 704);
  sectionLabel(f, 972, 724, "Layout");
  field(f, 972, 748, 130, "Margins", "4 mm", { chevron: true });
  field(f, 1116, 748, 130, "Type scale", "100%", { chevron: true });
  field(f, 1260, 748, 136, "Accent", "Burnt orange", { chevron: true });
  text(f, 972, 822, "✓ No overflow · payload and template version will be recorded", { size: 10, color: C.teal, weight: 600, width: 410 });
}

function buildDevice() {
  const f = addFrame("device-sync", "06 — Device and sync center", 3000, 960, 1440, 900);
  desktopShell(f, "Devices", "Nano 7", "Direct USB connection · identity redacted · last seen just now", [
    { label: "Sync now", tone: "primary", width: 104 },
  ]);

  const stats = [
    ["TRANSPORT", "USB CDC", "Connected", "teal"],
    ["ROASTER", "Nano 7 · ••••8A2F", "Idle", "teal"],
    ["FIRMWARE", "7.20.6", "Current", "neutral"],
    ["STORAGE", "38.2 / 64 MB", "60% used", "neutral"],
  ];
  stats.forEach(([label, value, status, tone], i) => {
    const x = 108 + i * 246;
    rect(f, x, 92, 230, 92, { fill: C.surface, stroke: C.line, radius: 8 });
    text(f, x + 18, 108, label, { size: 9, color: C.muted, weight: 650 });
    text(f, x + 18, 133, value, { size: 14, color: C.ink, weight: 600, mono: label !== "ROASTER" });
    pill(f, x + 18, 156, status, tone, { height: 21, size: 8 });
  });
  rect(f, 1108, 92, 312, 92, { fill: C.tealSoft, stroke: C.tealSoft, radius: 8 });
  text(f, 1128, 108, "SYNC HEALTH", { size: 9, color: C.teal, weight: 650 });
  text(f, 1128, 133, "Up to date", { size: 15, color: C.teal, weight: 650 });
  text(f, 1128, 158, "Last reconciliation · 11:36", { size: 9, color: C.muted });

  rect(f, 108, 204, 980, 658, { fill: C.surface, stroke: C.line, radius: 8 });
  rect(f, 126, 222, 944, 38, { fill: C.soft, stroke: C.soft, radius: 6 });
  button(f, 130, 226, "Profiles", "primary", { width: 76, height: 30, size: 9 });
  button(f, 210, 226, "Logs", "ghost", { width: 62, height: 30, size: 9 });
  button(f, 276, 226, "Core profiles", "ghost", { width: 96, height: 30, size: 9 });
  button(f, 376, 226, "Preferences", "ghost", { width: 92, height: 30, size: 9 });
  button(f, 472, 226, "Firmware", "ghost", { width: 78, height: 30, size: 9 });
  text(f, 878, 234, "42 local · 38 on roaster", { size: 9, color: C.muted });
  field(f, 126, 278, 340, "Search profiles", "⌕  Name or short code…");
  field(f, 482, 278, 170, "Status", "All", { chevron: true });
  button(f, 900, 294, "Add to roaster", "outline", { width: 144, height: 36 });

  const tableX = 126; const tableY = 350; const tableW = 944;
  rect(f, tableX, tableY, tableW, 38, { fill: C.soft, stroke: C.line, radius: 5 });
  [[150, "PROFILE"], [510, "LOCAL"], [646, "ROASTER"], [782, "STATUS"], [928, "ACTION"]].forEach(([x, label]) => text(f, x, tableY + 13, label, { size: 9, color: C.muted, weight: 650 }));
  const profiles = [
    ["Natural Light", "NLIGHT", "r12 · 1.8", "r12 · 1.8", "Synced", "teal"],
    ["Washed Light", "WASHL", "r7 · 1.8", "r7 · 1.8", "Synced", "teal"],
    ["Filter Omni", "OMNI", "r19 · 1.8", "r18 · 1.8", "Update available", "orange"],
    ["Kenya Filter", "KENYA", "r4 · 1.7", "—", "Local only", "blue"],
    ["Natural Omni", "NATOM", "r8 · 1.8", "r9 · 1.8", "Conflict", "red"],
    ["Decaf Light", "DECFL", "r3 · 1.6", "r3 · 1.6", "Synced", "teal"],
  ];
  profiles.forEach(([name, code, local, remote, status, tone], i) => {
    const y = tableY + 38 + i * 62;
    rect(f, tableX, y, tableW, 62, { fill: i === 4 ? C.redSoft : C.surface, stroke: C.line, radius: 0 });
    checkbox(f, 136, y + 23, "", false, { width: 0 });
    text(f, 162, y + 12, name, { size: 11, color: C.ink, weight: 600 });
    text(f, 162, y + 34, code, { size: 9, color: C.muted, mono: true });
    text(f, 510, y + 22, local, { size: 10, color: C.ink, mono: true });
    text(f, 646, y + 22, remote, { size: 10, color: C.ink, mono: true });
    pill(f, 782, y + 18, status, tone, { height: 24, size: 8, width: status.length * 6.5 + 24 });
    button(f, 930, y + 15, status === "Conflict" ? "Resolve" : status === "Synced" ? "•••" : "Copy →", status === "Conflict" ? "danger" : "outline", { width: 96, height: 32, size: 9 });
  });
  text(f, 126, 782, "Conflict policy", { size: 10, color: C.muted });
  text(f, 218, 782, "Both versions retained · no silent overwrite", { size: 10, color: C.ink, weight: 500 });
  rect(f, 126, 812, 944, 34, { fill: C.tealSoft, stroke: C.tealSoft, radius: 6 });
  text(f, 144, 822, "✓ Live sync pauses automatically while the roaster is busy", { size: 10, color: C.teal, weight: 600 });

  rect(f, 1108, 204, 312, 260, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 1128, 224, "REMOTE MONITOR BRIDGE", { size: 9, color: C.muted, weight: 650 });
  pill(f, 1128, 250, "OFF", "neutral", { width: 46, height: 23, size: 8 });
  text(f, 1128, 286, "Create a short-lived, read-only\nviewing session for this roast.", { size: 11, color: C.ink, lineHeight: 1.4, width: 250 });
  text(f, 1128, 342, "Outbound TLS · telemetry only\nNo start, stop, write, or serial exposure", { size: 9.5, color: C.muted, lineHeight: 1.45, width: 250 });
  button(f, 1128, 402, "Enable read-only session", "teal", { width: 244, height: 38 });

  rect(f, 1108, 484, 312, 190, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 1128, 504, "DIAGNOSTICS", { size: 9, color: C.muted, weight: 650 });
  const diag = [["Connection log", "Ready"], ["USB ownership", "Tan Studio"], ["Last device scan", "11:36:12"], ["Raw file integrity", "Verified"]];
  diag.forEach(([k, v], i) => {
    text(f, 1128, 534 + i * 30, k, { size: 10, color: C.muted });
    text(f, 1290, 534 + i * 30, v, { size: 10, color: C.ink, mono: true, align: "right", width: 96 });
  });
  button(f, 1128, 634, "Export redacted bundle", "outline", { width: 244, height: 34, size: 10 });

  rect(f, 1108, 694, 312, 168, { fill: C.paper, stroke: C.line, radius: 8 });
  text(f, 1128, 714, "MAINTENANCE MODE", { size: 9, color: C.muted, weight: 650 });
  text(f, 1128, 740, "Firmware, calibration and recovery are\nseparately gated local operations.", { size: 10, color: C.muted, lineHeight: 1.4, width: 260 });
  button(f, 1128, 792, "Unlock maintenance…", "outline", { width: 244, height: 38 });
  text(f, 1128, 838, "Format storage remains destructive and locked", { size: 8.5, color: C.red, width: 250 });
}

function buildCoffee() {
  const f = addFrame("coffee-lot-tasting", "08 — Coffee lot + structured tasting", 0, 1920, 1440, 900);
  desktopShell(f, "Coffees", "Guji Shakiso", "Osito Coffee → purchase PO-2025-041 → lot ETH-GUJ-24-07 → 7 linked roasts", [
    { label: "Archive lot", tone: "outline", width: 100 },
    { label: "Plan roast", tone: "primary", width: 104 },
  ]);

  rect(f, 108, 92, 912, 164, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 128, 110, "OSITO COFFEE  →  PO-2025-041  →  COFFEE LOT", { size: 9, color: C.muted, weight: 650 });
  text(f, 128, 135, "Guji Shakiso", { size: 24, color: C.ink, weight: 650 });
  pill(f, 128, 176, "ETHIOPIA", "orange", { width: 74, height: 23, size: 8 });
  pill(f, 210, 176, "NATURAL", "teal", { width: 68, height: 23, size: 8 });
  pill(f, 286, 176, "HEIRLOOM", "blue", { width: 74, height: 23, size: 8 });
  text(f, 128, 216, "Shakiso · 1,950–2,100 masl · Kayon Mountain · Crop 2025/26", { size: 11, color: C.muted, width: 580 });
  divider(f, 650, 108, 650, 238);
  const lotStats = [["Purchased", "2.50 kg"], ["Landed cost", "$18.90/kg"], ["Moisture", "10.6%"], ["On hand", "1.42 kg"]];
  lotStats.forEach(([label, value], i) => {
    const x = 682 + (i % 2) * 166;
    const y = 116 + Math.floor(i / 2) * 58;
    text(f, x, y, label.toUpperCase(), { size: 8.5, color: C.muted, weight: 650 });
    text(f, x, y + 20, value, { size: 13, color: C.ink, weight: 600, mono: i > 0 });
  });

  rect(f, 1040, 92, 380, 164, { fill: C.sageSoft, stroke: C.sageSoft, radius: 8 });
  text(f, 1060, 110, "NEXT-ROAST CONCLUSION · FROM 5 TASTINGS", { size: 9, color: C.sage, weight: 650 });
  text(f, 1060, 138, "Keep r12’s Maillard shape", { size: 16, color: C.ink, weight: 650 });
  text(f, 1060, 166, "Test a gentler post-FC fan transition.", { size: 10.5, color: C.ink, width: 320 });
  pill(f, 1060, 196, "BEST · r12 · 88/100", "sage", { width: 138, height: 24, size: 8 });
  text(f, 1210, 201, "Jasmine · peach · honey", { size: 9, color: C.muted });
  button(f, 1240, 222, "Plan next roast", "outline", { width: 156, height: 28, size: 9 });

  rect(f, 108, 276, 912, 586, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 128, 296, "ROAST HISTORY", { size: 9, color: C.muted, weight: 650 });
  button(f, 752, 290, "Chart", "primary", { width: 64, height: 30, size: 9 });
  button(f, 820, 290, "Table", "ghost", { width: 64, height: 30, size: 9 });
  button(f, 888, 290, "Compare", "outline", { width: 106, height: 30, size: 9 });
  rect(f, 128, 338, 866, 230, { fill: C.paper, stroke: C.line, radius: 7 });
  for (let i = 1; i < 5; i += 1) divider(f, 174, 338 + i * 46, 970, 338 + i * 46);
  divider(f, 174, 350, 174, 544);
  ["90", "85", "80", "75", "70"].forEach((label, i) => text(f, 140, 348 + i * 46, label, { size: 9, color: C.muted, mono: true }));
  ["02 Jul", "06 Jul", "09 Jul", "14 Jul", "18 Jul"].forEach((label, i) => text(f, 174 + i * 185, 545, label, { size: 9, color: C.muted, mono: true }));
  line(f, [[196, 459], [370, 422], [544, 394], [728, 440], [936, 366]], { stroke: C.orange, strokeWidth: 2 });
  [[196, 459, "r9"], [370, 422, "r10"], [544, 394, "r11"], [728, 440, "r11"], [936, 366, "r12"]].forEach(([x, y, rev], i) => {
    circle(f, x - 6, y - 6, 12, { fill: i === 4 ? C.orange : C.surface, stroke: C.orange, strokeWidth: 2 });
    pill(f, x - 18, y - 31, rev, i === 4 ? "orange" : "neutral", { width: 36, height: 19, size: 8 });
  });
  text(f, 190, 350, "TASTING SCORE", { size: 8, color: C.muted, weight: 650 });

  const rows = [
    ["18 Jul", "Natural Light · r12", "1.1", "88", "Jasmine · peach", "Best"],
    ["14 Jul", "Natural Light · r11", "1.1", "82", "Thin finish", "Review"],
    ["09 Jul", "Natural Light · r11", "1.0", "85", "Floral · lemon", "—"],
    ["06 Jul", "Natural Light · r10", "1.2", "80", "Honey · tea", "—"],
  ];
  rect(f, 128, 590, 866, 34, { fill: C.soft, stroke: C.line, radius: 5 });
  [[144, "DATE"], [240, "PROFILE"], [462, "LEVEL"], [546, "SCORE"], [632, "DESCRIPTORS"], [900, "STATE"]].forEach(([x, label]) => text(f, x, 601, label, { size: 8.5, color: C.muted, weight: 650 }));
  rows.forEach((row, r) => {
    const y = 624 + r * 48;
    rect(f, 128, y, 866, 48, { fill: r === 0 ? C.orangeSoft : C.surface, stroke: C.line, radius: 0 });
    [144, 240, 462, 546, 632, 900].forEach((x, c) => text(f, x, y + 17, row[c], { size: 10, color: c === 3 ? C.orange : C.ink, weight: c === 1 || c === 3 ? 600 : 400, mono: c === 0 || c === 2 || c === 3 }));
  });
  button(f, 128, 826, "View all 7 roasts", "outline", { width: 142, height: 30, size: 9 });

  rect(f, 1040, 276, 380, 586, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 1060, 296, "STRUCTURED TASTING", { size: 9, color: C.muted, weight: 650 });
  text(f, 1060, 322, "Roast · 18 Jul · Natural Light r12", { size: 12, color: C.ink, weight: 600 });
  field(f, 1060, 354, 162, "Brew method", "V60 · 1:16", { chevron: true });
  field(f, 1234, 354, 162, "Rest", "5 days");
  text(f, 1060, 426, "SENSORY · 0–5", { size: 9, color: C.muted, weight: 650 });
  const sensory = [["Aroma", "4.6"], ["Acidity", "4.4"], ["Sweetness", "4.8"], ["Body", "3.8"], ["Finish", "4.3"]];
  sensory.forEach(([name, score], i) => {
    const y = 452 + i * 40;
    text(f, 1060, y, name, { size: 10, color: C.ink });
    line(f, [[1144, y + 7], [1328, y + 7]], { stroke: C.line, strokeWidth: 5 });
    line(f, [[1144, y + 7], [1144 + (Number(score) / 5) * 184, y + 7]], { stroke: C.orange, strokeWidth: 5 });
    circle(f, 1138 + (Number(score) / 5) * 184, y + 1, 12, { fill: C.surface, stroke: C.orange, strokeWidth: 2 });
    text(f, 1344, y - 2, score, { size: 11, color: C.orange, mono: true, weight: 600 });
  });
  text(f, 1060, 664, "DESCRIPTORS", { size: 9, color: C.muted, weight: 650 });
  pill(f, 1060, 688, "jasmine", "teal", { width: 70, height: 23, size: 8 });
  pill(f, 1138, 688, "peach", "orange", { width: 62, height: 23, size: 8 });
  pill(f, 1208, 688, "honey", "amber", { width: 60, height: 23, size: 8 });
  button(f, 1276, 688, "+ Add", "outline", { width: 78, height: 23, size: 8 });
  text(f, 1060, 732, "NOTES / NEXT ACTION", { size: 9, color: C.muted, weight: 650 });
  rect(f, 1060, 754, 336, 62, { fill: C.paper, stroke: C.line, radius: 6 });
  text(f, 1074, 767, "Keep Maillard shape. Test gentler post-FC\nfan transition in r13.", { size: 10, color: C.ink, lineHeight: 1.35, width: 306 });
  button(f, 1060, 826, "Save tasting", "primary", { width: 132, height: 30, size: 9 });
  text(f, 1208, 834, "Overall 88 / 100", { size: 10, color: C.orange, mono: true, weight: 650 });
}

function buildCompare() {
  const f = addFrame("compare-workspace", "09 — Multi-roast compare workspace", 1500, 1920, 1440, 900);
  desktopShell(f, "Roasts", "Compare roasts", "Guji Shakiso · 4 selected · workspace “Post-FC airflow”", [
    { label: "Save workspace", tone: "outline", width: 126 },
    { label: "Export report", tone: "primary", width: 118 },
  ]);

  rect(f, 108, 92, 1004, 72, { fill: C.surface, stroke: C.line, radius: 8 });
  const roastChips = [
    ["r12 · 18 Jul · 88", C.orange, C.orangeSoft],
    ["r11 · 14 Jul · 82", C.teal, C.tealSoft],
    ["r11 · 09 Jul · 85", C.blue, C.blueSoft],
    ["r10 · 06 Jul · 80", C.purple, "#EFE7F4"],
  ];
  roastChips.forEach(([label, color, fill], i) => {
    const x = 126 + i * 228;
    rect(f, x, 108, 212, 40, { fill, stroke: color, radius: 6 });
    circle(f, x + 12, 120, 14, { fill: color, stroke: color });
    text(f, x + 36, 120, label, { size: 10, color: C.ink, weight: 600 });
    text(f, x + 192, 119, "×", { size: 11, color: C.muted });
  });
  button(f, 1040, 108, "+ Add", "outline", { width: 54, height: 40, size: 9 });
  rect(f, 1132, 92, 288, 72, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 1150, 105, "ALIGNMENT", { size: 8.5, color: C.muted, weight: 650 });
  button(f, 1150, 124, "Absolute", "outline", { width: 78, height: 28, size: 8 });
  button(f, 1232, 124, "First crack", "primary", { width: 88, height: 28, size: 8 });
  button(f, 1324, 124, "Normalized", "ghost", { width: 78, height: 28, size: 8 });

  sectionLabel(f, 108, 188, "Overlay", "aligned to first crack · temperature and RoR");
  chartGrid(f, 108, 214, 1004, 432, { yLabels: ["220", "180", "140", "100", "60"], xLabels: ["-6:00", "-4:00", "-2:00", "FC", "+1:00", "+2:00"] });
  const px = 156; const py = 230; const pw = 932; const ph = 372;
  const series = [
    { color: C.orange, shift: 0, end: .10 },
    { color: C.teal, shift: .018, end: .075 },
    { color: C.blue, shift: -.012, end: .125 },
    { color: C.purple, shift: .008, end: .16 },
  ];
  series.forEach(({ color, shift, end }, i) => {
    const data = [[0, .91], [.13, .75 + shift], [.28, .57 - shift], [.45, .4 + shift], [.62, .27], [.78, .18 + shift], [1, end]];
    line(f, data.map(([a, b]) => [px + a * pw, py + b * ph]), { stroke: color, strokeWidth: i === 0 ? 3 : 2, opacity: i === 0 ? 100 : 82 });
  });
  const fcX = px + .72 * pw;
  line(f, [[fcX, py], [fcX, py + ph]], { stroke: C.orange, strokeWidth: 1, dash: true });
  pill(f, fcX - 24, 226, "FC ALIGN", "orange", { width: 58, height: 20, size: 8 });
  rect(f, 108, 664, 1004, 198, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 126, 682, "METRIC", { size: 8.5, color: C.muted, weight: 650 });
  roastChips.forEach(([label, color], i) => text(f, 332 + i * 184, 682, label.split(" · ")[0], { size: 9, color, weight: 650, mono: true }));
  const metrics = [
    ["First crack", "07:28", "07:41", "07:36", "07:45"],
    ["Development", "01:50 · 19.8%", "01:42 · 18.4%", "01:56 · 20.5%", "01:48 · 19.3%"],
    ["End temperature", "218.2°C", "218.0°C", "217.6°C", "219.1°C"],
    ["RoR at FC", "7.8°C/min", "8.9°C/min", "8.3°C/min", "9.1°C/min"],
    ["Energy estimate", "0.116 kWh", "0.121 kWh", "0.119 kWh", "0.123 kWh"],
  ];
  metrics.forEach((row, r) => {
    const y = 710 + r * 29;
    if (r % 2 === 0) rect(f, 122, y - 6, 974, 28, { fill: C.soft, stroke: C.soft, radius: 3 });
    text(f, 126, y, row[0], { size: 9.5, color: C.muted });
    row.slice(1).forEach((value, i) => text(f, 332 + i * 184, y, value, { size: 9.5, color: i === 0 ? C.ink : C.muted, mono: true, weight: i === 0 ? 600 : 400 }));
  });

  rect(f, 1132, 184, 288, 678, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 1152, 204, "COMPARE CONTROLS", { size: 9, color: C.muted, weight: 650 });
  text(f, 1152, 236, "Series", { size: 10, color: C.ink, weight: 600 });
  checkbox(f, 1152, 262, "Temperature", true);
  checkbox(f, 1152, 290, "Actual RoR", true);
  checkbox(f, 1152, 318, "Power", false);
  checkbox(f, 1152, 346, "Fan RPM", false);
  text(f, 1152, 388, "Display", { size: 10, color: C.ink, weight: 600 });
  toggle(f, 1152, 414, "Normalize units", true);
  toggle(f, 1152, 446, "Show annotations", true);
  toggle(f, 1152, 478, "Show event bands", true);
  divider(f, 1152, 520, 1400, 520);
  text(f, 1152, 544, "CONCLUSION", { size: 9, color: C.muted, weight: 650 });
  rect(f, 1152, 570, 248, 118, { fill: C.paper, stroke: C.line, radius: 6 });
  text(f, 1166, 584, "r12 is best: stable RoR through FC\nand highest sweetness. Test a gentler\nfan step without changing Maillard.", { size: 10, color: C.ink, lineHeight: 1.45, width: 220 });
  pill(f, 1152, 704, "WINNER · r12", "orange", { width: 96, height: 24, size: 8 });
  pill(f, 1256, 704, "FOLLOW-UP", "blue", { width: 82, height: 24, size: 8 });
  button(f, 1152, 752, "Save conclusion", "outline", { width: 248, height: 36 });
  button(f, 1152, 798, "Create profile revision", "primary", { width: 248, height: 40 });
}

function buildPreflight() {
  const f = addFrame("roast-preflight", "10 — Roast setup and preflight", 3000, 1920, 1440, 900);
  desktopShell(f, "Roast", "Prepare roast", "Review this coffee’s evidence, choose the next experiment, then start physically on the Nano", [
    { label: "Save setup", tone: "outline", width: 104 },
  ]);

  rect(f, 108, 92, 860, 770, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 132, 114, "ROAST SETUP", { size: 9, color: C.muted, weight: 650 });
  text(f, 132, 142, "1 · Coffee lot", { size: 15, color: C.ink, weight: 650 });
  field(f, 132, 168, 400, "Coffee", "Guji Shakiso · ETH-GUJ-24-07", { chevron: true });
  field(f, 548, 168, 188, "Green available", "1.42 kg");
  button(f, 752, 184, "View lot", "outline", { width: 190, height: 38 });
  text(f, 132, 226, "Osito Coffee  →  purchase PO-2025-041  →  7 previous roasts", { size: 9.5, color: C.muted });

  rect(f, 132, 252, 810, 142, { fill: C.sageSoft, stroke: C.line, radius: 9 });
  text(f, 150, 268, "PREVIOUS ROAST FEEDBACK", { size: 9, color: C.sage, weight: 650 });
  divider(f, 388, 288, 388, 376, C.lineDark);
  divider(f, 654, 288, 654, 376, C.lineDark);
  text(f, 150, 296, "BEST · 18 JUL", { size: 8.5, color: C.muted, weight: 650 });
  text(f, 150, 318, "r12 · 88 / 100", { size: 14, color: C.ink, weight: 650, mono: true });
  text(f, 150, 344, "Jasmine · peach · honey", { size: 9.5, color: C.ink });
  text(f, 150, 366, "Stable RoR through FC", { size: 9, color: C.muted });
  text(f, 410, 296, "RECENT · 14 JUL", { size: 8.5, color: C.muted, weight: 650 });
  text(f, 410, 318, "r11 · 82 / 100", { size: 14, color: C.ink, weight: 650, mono: true });
  text(f, 410, 344, "Floral, but thin finish", { size: 9.5, color: C.ink });
  text(f, 410, 366, "Abrupt post-FC fan step", { size: 9, color: C.muted });
  text(f, 676, 296, "NEXT ACTION · TASTING-DERIVED", { size: 8.5, color: C.sage, weight: 650 });
  text(f, 676, 320, "Keep r12 Maillard shape.", { size: 10.5, color: C.ink, weight: 650 });
  text(f, 676, 343, "Test gentler post-FC airflow.", { size: 9.5, color: C.ink });
  button(f, 804, 360, "Compare history", "outline", { width: 120, height: 26, size: 8 });

  text(f, 132, 420, "2 · Profile and experiment", { size: 15, color: C.ink, weight: 650 });
  field(f, 132, 448, 344, "Profile", "Natural Light · revision 12", { chevron: true });
  field(f, 492, 448, 164, "Schema", "1.8 · compatible");
  field(f, 672, 448, 270, "Experiment", "Gentler post-FC fan", { chevron: true });
  rect(f, 132, 518, 810, 74, { fill: C.paper, stroke: C.line, radius: 7 });
  sparkline(f, 152, 530, 176, 44, C.orange, 0);
  text(f, 358, 529, "Natural Light · r12", { size: 11, color: C.ink, weight: 650 });
  text(f, 358, 551, "End 218.0°C · expected FC 07:36", { size: 9.5, color: C.muted });
  pill(f, 694, 535, "VALID", "teal", { width: 54, height: 21, size: 8 });
  pill(f, 756, 535, "DEVICE HAS r12", "teal", { width: 104, height: 21, size: 8 });
  button(f, 866, 532, "Curve", "ghost", { width: 58, height: 27, size: 8 });

  text(f, 132, 616, "3 · Parameters and tasting plan", { size: 15, color: C.ink, weight: 650 });
  field(f, 132, 644, 176, "Level / Dev%", "1.1", { chevron: true });
  field(f, 322, 644, 142, "Load", "90 g");
  field(f, 478, 644, 220, "Label", "Compact 90 × 50", { chevron: true });
  field(f, 712, 644, 230, "Tasting reminder", "Day 5 · V60", { chevron: true });
  rect(f, 132, 716, 810, 58, { fill: C.oakSoft, stroke: C.line, radius: 7 });
  text(f, 148, 729, "ROAST PLAN", { size: 8.5, color: C.muted, weight: 650 });
  text(f, 238, 727, "Watch post-FC airflow; mark aroma lift; cup against r12 on day 5.", { size: 10, color: C.ink, weight: 600, width: 680 });
  rect(f, 132, 792, 810, 42, { fill: C.orangeSoft, stroke: C.orangeSoft, radius: 7 });
  text(f, 150, 806, "PREDICTED  09:24 end  ·  218.0°C  ·  01:48 development / 19.1%  ·  1.33 kg coffee remaining", { size: 9.5, color: C.ink, mono: true, weight: 600 });

  rect(f, 988, 92, 432, 770, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 1012, 114, "PREFLIGHT", { size: 9, color: C.muted, weight: 650 });
  text(f, 1012, 142, "Ready to roast", { size: 21, color: C.teal, weight: 650 });
  text(f, 1012, 174, "All required local checks passed.", { size: 10, color: C.muted });
  const checks = [
    ["Nano 7 connected by USB", "Connected · idle"],
    ["Profile revision available", "Natural Light r12"],
    ["Previous feedback reviewed", "Best, recent and next action"],
    ["Firmware compatible", "7.20.6 · schema 1.8"],
    ["Live capture ready", "Companion owns port"],
    ["Coffee and load set", "Guji · 90 g · tasting day 5"],
  ];
  checks.forEach(([label, detail], i) => {
    const y = 216 + i * 62;
    circle(f, 1012, y, 22, { fill: C.tealSoft, stroke: C.tealSoft });
    text(f, 1023, y + 3, "✓", { size: 11, color: C.teal, weight: 700, align: "center", width: 22 });
    text(f, 1048, y, label, { size: 11, color: C.ink, weight: 600 });
    text(f, 1048, y + 22, detail, { size: 9, color: C.muted });
  });
  rect(f, 1012, 594, 384, 72, { fill: C.amberSoft, stroke: C.amberSoft, radius: 7 });
  text(f, 1028, 608, "△ Supervision required", { size: 11, color: C.amber, weight: 650 });
  text(f, 1028, 632, "Remain nearby for the entire roast.", { size: 10, color: C.muted });
  rect(f, 1012, 688, 384, 104, { fill: C.tealSoft, stroke: C.teal, strokeWidth: 1, radius: 8 });
  text(f, 1204, 707, "START ON THE NANO", { size: 11, color: C.teal, weight: 700, align: "center", width: 260 });
  text(f, 1204, 735, "Use the physical dial to select and start.\nThis screen will switch to Live automatically.", { size: 10, color: C.ink, align: "center", width: 330, lineHeight: 1.4 });
  pill(f, 1122, 806, "NO SOFTWARE START CONTROL", "neutral", { width: 184, height: 24, size: 8 });
}

function mobileShell(frame) {
  rect(frame, 0, 0, frame.width, frame.height, { fill: C.paper, stroke: C.lineDark, radius: 30 });
  text(frame, 22, 14, "9:42", { size: 11, color: C.ink, mono: true, weight: 600 });
  text(frame, 324, 14, "●  Wi‑Fi  ▰", { size: 9, color: C.ink });
  divider(frame, 0, 38, frame.width, 38);
  text(frame, 20, 54, "LIVE ROAST", { size: 9, color: C.muted, weight: 650 });
  text(frame, 20, 76, "Guji Shakiso", { size: 20, color: C.ink, weight: 650 });
  pill(frame, 282, 59, "READ ONLY", "teal", { width: 86, height: 25, size: 8 });
}

function buildRemote() {
  const f = addFrame("remote-mobile", "07 — Remote mobile monitor", 4500, 960, 390, 844);
  mobileShell(f);
  rect(f, 20, 112, 350, 54, { fill: C.tealSoft, stroke: C.tealSoft, radius: 8 });
  text(f, 36, 124, "✓ Local presence attested · expires 09:47", { size: 10.5, color: C.teal, weight: 650 });
  text(f, 36, 145, "Connected · 180 ms · viewer session ends 10:20", { size: 8.5, color: C.muted, mono: true });

  metric(f, 20, 190, "Elapsed", "06:42", "", 110, C.orange);
  metric(f, 142, 190, "Temp", "184.6", "°C", 104);
  metric(f, 268, 190, "RoR", "8.4", "°/min", 96, C.teal);

  temperatureChart(f, 20, 254, 350, 244, { hCount: 4, vCount: 5, yLabels: ["220", "140", "60"], xLabels: ["0", "5", "10"], progress: .71, events: [[.29, "CC"], [.71, "NOW"]] });
  legend(f, 62, 470, [["Temp", C.orange], ["Target", C.blue, true], ["RoR", C.teal]]);

  rect(f, 20, 516, 350, 82, { fill: C.surface, stroke: C.line, radius: 8 });
  text(f, 36, 532, "CURRENT PHASE", { size: 8.5, color: C.muted, weight: 650 });
  text(f, 36, 554, "Maillard", { size: 17, color: C.ink, weight: 650 });
  text(f, 154, 558, "Expected FC 07:36", { size: 10, color: C.muted });
  pill(f, 292, 540, "LIVE", "orange", { width: 56, height: 22, size: 8 });

  text(f, 20, 620, "EVENTS", { size: 8.5, color: C.muted, weight: 650 });
  const events = [["03:12", "Colour change", "149.3°C"], ["—", "First crack", "Expected 07:36"], ["—", "Roast end", "Predicted 09:24"]];
  events.forEach(([timeValue, name, detail], i) => {
    const y = 642 + i * 42;
    circle(f, 20, y + 3, 10, { fill: i === 0 ? C.orange : C.surface, stroke: i === 0 ? C.orange : C.lineDark });
    text(f, 40, y, timeValue, { size: 9, color: i === 0 ? C.ink : C.muted, mono: true, width: 42 });
    text(f, 92, y, name, { size: 10, color: C.ink, weight: 600, width: 104 });
    text(f, 220, y, detail, { size: 9, color: C.muted, align: "right", width: 140 });
  });

  rect(f, 20, 760, 350, 42, { fill: C.soft, stroke: C.line, radius: 7 });
  text(f, 195, 772, "Viewing only — use Nano controls locally", { size: 10, color: C.ink, weight: 600, width: 322, align: "center" });
  rect(f, 0, 808, 390, 36, { fill: C.surface, stroke: C.line, radius: 0 });
  text(f, 66, 816, "●\nLive", { size: 8, color: C.orange, align: "center", width: 50, lineHeight: 1.1 });
  text(f, 195, 816, "◇\nEvents", { size: 8, color: C.muted, align: "center", width: 50, lineHeight: 1.1 });
  text(f, 324, 816, "≡\nStatus", { size: 8, color: C.muted, align: "center", width: 50, lineHeight: 1.1 });
}

buildLive();
buildLibrary();
buildCatalog();
buildReview();
buildProfile();
buildLabel();
buildDevice();
buildRemote();
buildCoffee();
buildCompare();
buildPreflight();

function excalidrawDocument() {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: board.shapes.map((shape) => shape.element),
    appState: {
      gridSize: null,
      gridStep: 5,
      gridModeEnabled: false,
      viewBackgroundColor: C.canvas,
      currentItemFontFamily: 2,
      currentItemStrokeColor: C.ink,
      currentItemBackgroundColor: "transparent",
      currentItemFillStyle: "solid",
      currentItemStrokeWidth: 1,
      currentItemRoughness: 0,
    },
    files: {},
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svgShape(shape, offsetX, offsetY) {
  if (shape.kind === "frame") return "";
  const opacity = (shape.opacity ?? 100) / 100;
  if (shape.kind === "rect") {
    return `<rect x="${shape.x - offsetX}" y="${shape.y - offsetY}" width="${shape.width}" height="${shape.height}" rx="${shape.radius}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}"${shape.dash ? ' stroke-dasharray="6 5"' : ""} opacity="${opacity}"/>`;
  }
  if (shape.kind === "circle") {
    return `<circle cx="${shape.x - offsetX + shape.diameter / 2}" cy="${shape.y - offsetY + shape.diameter / 2}" r="${shape.diameter / 2}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}" opacity="${opacity}"/>`;
  }
  if (shape.kind === "line") {
    const points = shape.points.map(([x, y]) => `${x - offsetX},${y - offsetY}`).join(" ");
    return `<polyline points="${points}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${shape.dash ? ' stroke-dasharray="7 6"' : ""} opacity="${opacity}"/>`;
  }
  if (shape.kind === "text") {
    const lines = shape.value.split("\n");
    const x = shape.x - offsetX;
    const y = shape.y - offsetY + shape.size;
    const anchor = shape.align === "center" ? "middle" : shape.align === "right" ? "end" : "start";
    const actualX = shape.align === "center" ? x : shape.align === "right" ? x + shape.width : x;
    const family = shape.mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    const spans = lines.map((lineValue, index) => `<tspan x="${actualX}" dy="${index === 0 ? 0 : shape.size * shape.lineHeight}">${escapeXml(lineValue)}</tspan>`).join("");
    return `<text x="${actualX}" y="${y}" fill="${shape.color}" font-family="${family}" font-size="${shape.size}" font-weight="${shape.weight}" text-anchor="${anchor}" opacity="${opacity}">${spans}</text>`;
  }
  return "";
}

function renderFrameSvg(frame) {
  const content = board.shapes
    .filter((shape) => shape.frame?.id === frame.id && shape.kind !== "frame")
    .map((shape) => {
      const copy = { ...shape };
      if (shape.kind === "rect" || shape.kind === "circle" || shape.kind === "text") {
        copy.x = shape.x;
        copy.y = shape.y;
      }
      return svgShape(copy, 0, 0);
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><rect width="100%" height="100%" fill="${C.paper}"/>${content}</svg>`;
}

function renderOverviewSvg() {
  const maxX = Math.max(...board.frames.map((frame) => frame.x + frame.width));
  const maxY = Math.max(...board.frames.map((frame) => frame.y + frame.height));
  const padding = 40;
  const content = board.frames.map((frame) => {
    const shapes = board.shapes
      .filter((shape) => shape.frame?.id === frame.id && shape.kind !== "frame")
      .map((shape) => svgShape(shape, 0, 0))
      .join("\n");
    return `<g transform="translate(${frame.x + padding},${frame.y + padding})"><rect x="-1" y="-1" width="${frame.width + 2}" height="${frame.height + 2}" rx="8" fill="${C.paper}" stroke="${C.lineDark}" stroke-width="2"/>${shapes}</g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX + padding * 2}" height="${maxY + padding * 2}" viewBox="0 0 ${maxX + padding * 2} ${maxY + padding * 2}"><rect width="100%" height="100%" fill="${C.canvas}"/>${content}</svg>`;
}

writeFileSync(join(ROOT, "kaffelogic-modern-studio.excalidraw"), `${JSON.stringify(excalidrawDocument(), null, 2)}\n`);

for (const frame of board.frames) {
  const shapes = board.shapes.filter((shape) => shape.frame?.id === frame.id && shape.kind !== "frame");
  const content = shapes.map((shape) => svgShape(shape, 0, 0)).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><rect width="100%" height="100%" fill="${C.paper}"/>${content}</svg>`;
  writeFileSync(join(PREVIEWS, `${frame.key}.svg`), svg);
}

writeFileSync(join(PREVIEWS, "overview.svg"), renderOverviewSvg());

console.log(`Generated ${board.frames.length} frames and ${board.shapes.length} editable elements.`);
