// The Sunset Postcard carved all round its 3D gift box (gift-scene-composed.tsx, variant "postcard-box"). The owner's
// postcard (a violet-to-orange sunset sky, the sun on the sea's horizon with its golden reflection, a tall palm leaning
// over a dark shore on the left, a smaller palm on rocks on the right, low purple hills, thin clouds, a cream border) is
// redrawn here as vector art, at a high resolution, as ONE continuous scene round the box's four sides and up the lid's
// rim: the scene spans two sides (the postcard's own proportions) and its texture repeats twice round the box
// (POSTCARD_WRAP_REPEAT), every element drawn at x and x +/- the scene's width, so it is periodic: no seam, no join, no
// ghost or mirrored palm, and the palms are kept clear of the box's corners.
//
// It is carved, not printed: the same drawing is made twice, once in colour and once as a height map of deliberate
// levels (sky lowest, with grooved sun rays and drilled stars; clouds; the sea a raised layer with wave grooves and the
// sun's reflection; the sun a bevelled disc ringed by a groove; hills; the shore; the palms highest, with grooved trunk
// rings and frond midribs; a raised cream border top and bottom). The height displaces the box's sides (real geometry,
// gift-composed-objects.ts `carvedSidesGeometry`) and becomes a strong normal map for the bevels, and the recesses are
// shaded into the colour, so highlights and shadows move across the carving as the box turns. The lid's top is carved
// the same way (a sunset seen from above: the sun's raised disc, grooved rays, a raised border).
//
// The drawing works on any Canvas 2D-like context (a real canvas in the browser, a recording fake in the tests); the
// rest is pure and deterministic (unit-tested, gift-postcard-wrap.test.ts).

/**
 * The scene's size in px: half the box's perimeter (two sides, 2.6 units) by the visible height (1.24 units), square
 * pixels; the texture repeats POSTCARD_WRAP_REPEAT times round the box.
 */
export const POSTCARD_WRAP_SIZE = { width: 1536, height: 732 } as const;
export const POSTCARD_WRAP_REPEAT = 2;
/** The lid top's texture size (px, square). */
export const POSTCARD_LID_SIZE = 768;
/** How far the highest level stands out of the paper (box units), and the normal map's strength. */
export const POSTCARD_CARVE = { depth: 0.045, normalStrength: 34 } as const;
/** Within this distance (box units) of a corner or the lid top's edge, the relief eases out to the plain surface. */
export const POSTCARD_CORNER_EASE = 0.03;

/** Panorama px per box unit (the perimeter 4 x 1.3 over the width). */
const PX = (POSTCARD_WRAP_SIZE.width * POSTCARD_WRAP_REPEAT) / 5.2;
/** One side of the box, in panorama px (768). */
export const POSTCARD_SIDE_PX = POSTCARD_WRAP_SIZE.width / 2;
/** Row of the lid's lower edge (box y 0.1, the lid's top at 0.36 is row 0). */
export const POSTCARD_LID_EDGE_ROW = Math.round((0.36 - 0.1) * PX);
/** The horizon's row and the sun (centre x within the scene, centre row, radius), px. */
export const POSTCARD_HORIZON_ROW = 452;
export const POSTCARD_SUN = { x: 1150, y: 436, r: 62 } as const;

/** A palm: trunk base and crown (px within the scene), trunk widths, frond count and length, coconut size. */
export type Palm = { base: [number, number]; crown: [number, number]; bend: number; baseWidth: number; topWidth: number; fronds: number; frond: number; nut: number };
/** The tall palm leaning over the left shore and the small palm on the right rocks (the scene repeats once more round the box). */
export const POSTCARD_PALMS: readonly Palm[] = [
  { base: [452, 716], crown: [340, 262], bend: -70, baseWidth: 30, topWidth: 13, fronds: 9, frond: 190, nut: 11 },
  { base: [1330, 690], crown: [1372, 398], bend: 34, baseWidth: 20, topWidth: 9, fronds: 8, frond: 118, nut: 7 },
];

/** The carving's levels (0..1 of POSTCARD_CARVE.depth). */
export const CARVE_LEVEL = {
  groove: 0.04,
  sky: 0.16,
  cloud: 0.34,
  sea: 0.3,
  seaGroove: 0.18,
  glitter: 0.42,
  sunRing: 0.08,
  sun: 0.62,
  hills: 0.46,
  shore: 0.68,
  border: 0.74,
  frond: 0.95,
  rib: 0.78,
  trunk: 1,
  ring: 0.8,
} as const;

/** The subset of CanvasRenderingContext2D the drawing uses (so the tests can record it). */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "translate"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "quadraticCurveTo"
  | "bezierCurveTo"
  | "closePath"
  | "arc"
  | "ellipse"
  | "fill"
  | "stroke"
  | "fillRect"
  | "createLinearGradient"
  | "createRadialGradient"
> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
};

type Pass = "color" | "height";
const grey = (level: number) => {
  const v = Math.round(Math.min(1, Math.max(0, level)) * 255);
  return `rgb(${v},${v},${v})`;
};

/** A seeded pseudo-random sequence (mulberry32), so the drawing is the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One palm frond (px): its drooping midrib and its leaflets, long thin tapered blades hanging from both sides of the rib
 * and sweeping towards the tip (each a small polygon), longest in the middle of the frond, the way a coconut palm's
 * fronds read in silhouette.
 */
export function frondShape(crown: readonly [number, number], angle: number, length: number, droop: number): { spine: [number, number][]; leaflets: [number, number][][] } {
  const [cx, cy] = crown;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const spineAt = (t: number): [number, number] => [cx + dx * length * t, cy + dy * length * t + droop * length * t * t];
  const spine: [number, number][] = [];
  const steps = 22;
  for (let i = 0; i <= steps; i++) spine.push(spineAt(i / steps));
  const leaflets: [number, number][][] = [];
  const count = 17;
  const longest = length * 0.34;
  const base = Math.max(2.2, length * 0.022);
  for (let i = 1; i <= count; i++) {
    const t = 0.06 + (0.94 * i) / count;
    const [x, y] = spineAt(t);
    const [x2, y2] = spineAt(Math.min(1, t + 0.01));
    const len = Math.hypot(x2 - x, y2 - y) || 1;
    const tx = (x2 - x) / len;
    const ty = (y2 - y) / len;
    const reach = longest * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7) * (1 - 0.3 * t) + length * 0.03;
    for (const sideSign of [1, -1]) {
      // Out from the rib at ~50 deg towards the tip, then hanging a little.
      const nx = -ty * sideSign;
      const ny = tx * sideSign;
      const ex = x + (tx * 0.62 + nx * 0.78) * reach;
      const ey = y + (ty * 0.62 + ny * 0.78) * reach + reach * 0.32;
      const mx = x + (tx * 0.4 + nx * 0.85) * reach * 0.55;
      const my = y + (ty * 0.4 + ny * 0.85) * reach * 0.55 + reach * 0.06;
      const w = base * (1 - 0.4 * t);
      leaflets.push([
        [x - tx * w, y - ty * w],
        [mx - tx * w * 0.7, my - ty * w * 0.7],
        [ex, ey],
        [mx + tx * w * 0.7, my + ty * w * 0.7],
        [x + tx * w, y + ty * w],
      ]);
    }
  }
  return { spine, leaflets };
}

/** The palm's trunk centreline (a gentle curve from the base to the crown). */
export function trunkPoint(palm: Palm, t: number): [number, number] {
  const [bx, by] = palm.base;
  const [cx, cy] = palm.crown;
  const mx = (bx + cx) / 2 + palm.bend;
  const my = (by + cy) / 2;
  const u = 1 - t;
  return [u * u * bx + 2 * u * t * mx + t * t * cx, u * u * by + 2 * u * t * my + t * t * cy];
}

/**
 * The angles (rad), lengths and droops of a palm's fronds: a crown that spreads out sideways and arches down (the long
 * side fronds hang lowest), with a few short ones standing up in the middle, each turned a little off the even spread
 * (seeded) so the crown looks grown, not stamped.
 */
export function frondAngles(palm: Palm): { angle: number; length: number; droop: number }[] {
  const random = seeded(Math.round(palm.base[0] * 7 + palm.crown[1]));
  const out: { angle: number; length: number; droop: number }[] = [];
  for (let i = 0; i < palm.fronds; i++) {
    const k = i / (palm.fronds - 1);
    // From out to the left (-172 deg) over the top to out to the right (-8 deg).
    const angle = (-172 + 164 * k + (random() - 0.5) * 10) * (Math.PI / 180);
    const side = Math.abs(k - 0.5) * 2;
    out.push({ angle, length: palm.frond * (0.62 + 0.42 * side) * (0.92 + random() * 0.16), droop: 0.12 + 0.95 * side * side });
  }
  return out;
}

function polygon(ctx: Ctx2D, points: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function drawPalm(ctx: Ctx2D, palm: Palm, pass: Pass): void {
  const trunk = pass === "color" ? "#2e1a2c" : grey(CARVE_LEVEL.trunk);
  const leaf = pass === "color" ? "#23142a" : grey(CARVE_LEVEL.frond);
  // Trunk: a tapered band along the curve.
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = trunkPoint(palm, t);
    const [x2, y2] = trunkPoint(palm, Math.min(1, t + 0.02));
    const [x0, y0] = trunkPoint(palm, Math.max(0, t - 0.02));
    const len = Math.hypot(x2 - x0, y2 - y0) || 1;
    const nx = -(y2 - y0) / len;
    const ny = (x2 - x0) / len;
    const w = (palm.baseWidth + (palm.topWidth - palm.baseWidth) * t) / 2;
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  }
  ctx.fillStyle = trunk;
  polygon(ctx, [...left, ...right.reverse()]);
  ctx.fill();
  // Trunk rings: grooves across the trunk, and the sunset's warm light down its sun-facing side (colour only).
  if (pass === "color") {
    ctx.strokeStyle = "rgba(255,150,90,0.28)";
    ctx.lineWidth = Math.max(2, palm.topWidth * 0.25);
    ctx.lineCap = "round";
    ctx.beginPath();
    left.slice(1, -2).forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }
  ctx.strokeStyle = pass === "color" ? "#140a16" : grey(CARVE_LEVEL.ring);
  ctx.lineWidth = Math.max(1.6, palm.topWidth * 0.22);
  ctx.lineCap = "butt";
  const rings = Math.round(Math.hypot(palm.crown[0] - palm.base[0], palm.crown[1] - palm.base[1]) / (palm.baseWidth * 0.8));
  for (let i = 1; i < rings; i++) {
    const t = i / rings;
    const k = Math.round(t * n);
    ctx.beginPath();
    ctx.moveTo(left[k][0], left[k][1]);
    const [mx, my] = trunkPoint(palm, t);
    const r = right[n - k];
    ctx.quadraticCurveTo(mx, my + palm.topWidth * 0.18, r[0], r[1]);
    ctx.stroke();
  }
  // Fronds, each with its midrib grooved in.
  for (const f of frondAngles(palm)) {
    const { spine, leaflets } = frondShape(palm.crown, f.angle, f.length, f.droop);
    ctx.fillStyle = leaf;
    for (const blade of leaflets) {
      polygon(ctx, blade);
      ctx.fill();
    }
    ctx.strokeStyle = pass === "color" ? "#23142a" : grey(CARVE_LEVEL.frond);
    ctx.lineWidth = Math.max(3, palm.frond * 0.03);
    ctx.lineCap = "round";
    ctx.beginPath();
    spine.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.strokeStyle = pass === "color" ? "#4a2c48" : grey(CARVE_LEVEL.rib);
    ctx.lineWidth = Math.max(1.2, palm.frond * 0.01);
    ctx.lineCap = "round";
    ctx.beginPath();
    spine.slice(0, -3).forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }
  // Coconuts under the crown.
  ctx.fillStyle = pass === "color" ? "#3a2030" : grey(CARVE_LEVEL.trunk);
  for (const [ox, oy] of [
    [-0.9, 0.6],
    [0.7, 0.8],
    [-0.1, 1.3],
  ] as const) {
    ctx.beginPath();
    ctx.arc(palm.crown[0] + ox * palm.nut, palm.crown[1] + oy * palm.nut, palm.nut * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The outline (px) of a land mass along the bottom or the horizon: a smooth, seeded profile between x0 and x1. */
export function ridge(x0: number, x1: number, baseY: number, peak: number, seed: number, bumps: number): [number, number][] {
  const random = seeded(seed);
  const phases = Array.from({ length: 3 }, () => random() * Math.PI * 2);
  const points: [number, number][] = [[x0, baseY]];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const envelope = Math.pow(Math.sin(Math.PI * t), 0.6);
    const wave = 0.65 + 0.2 * Math.sin(t * bumps * Math.PI + phases[0]) + 0.15 * Math.sin(t * bumps * 2.3 * Math.PI + phases[1]);
    points.push([x0 + (x1 - x0) * t, baseY - peak * envelope * wave]);
  }
  points.push([x1, baseY]);
  return points;
}

/** The scene (two sides wide), drawn at horizontal offset `ox`. */
function drawCopy(ctx: Ctx2D, pass: Pass, ox: number): void {
  const H = POSTCARD_WRAP_SIZE.height;
  const sun = POSTCARD_SUN;
  const horizon = POSTCARD_HORIZON_ROW;
  const copy = 2 * POSTCARD_SIDE_PX;
  ctx.save();
  ctx.translate(ox, 0);
  const c = pass === "color";
  // The sun's glow in the sky (colour only).
  if (c) {
    const glow = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.6, sun.x, sun.y, 620);
    glow.addColorStop(0, "rgba(255,236,160,0.95)");
    glow.addColorStop(0.18, "rgba(255,180,90,0.55)");
    glow.addColorStop(0.55, "rgba(255,110,120,0.18)");
    glow.addColorStop(1, "rgba(255,110,120,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sun.x - 640, 0, 1280, horizon);
  }
  // Sun rays: grooves fanning out of the sun over the sky.
  ctx.strokeStyle = c ? "rgba(255,226,170,0.35)" : grey(CARVE_LEVEL.groove);
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (let i = 0; i < 13; i++) {
    const a = Math.PI + (i + 0.5) * (Math.PI / 13);
    ctx.beginPath();
    ctx.moveTo(sun.x + Math.cos(a) * (sun.r + 22), sun.y + Math.sin(a) * (sun.r + 22));
    ctx.lineTo(sun.x + Math.cos(a) * 440, Math.max(POSTCARD_LID_EDGE_ROW + 40, sun.y + Math.sin(a) * 440));
    ctx.stroke();
  }
  // Clouds: thin raised bands either side of the sun.
  const clouds: [number, number, number, number][] = [
    [sun.x - 250, 352, 150, 12],
    [sun.x + 220, 330, 190, 11],
    [sun.x - 40, 300, 120, 9],
    [470, 395, 130, 10],
  ];
  for (const [x, y, rx, ry] of clouds) {
    ctx.fillStyle = c ? "#ff9fae" : grey(CARVE_LEVEL.cloud);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    if (c) {
      ctx.fillStyle = "rgba(255,226,180,0.8)";
      ctx.beginPath();
      ctx.ellipse(x, y - ry * 0.35, rx * 0.8, ry * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Stars: drilled dots high in the sky and on the lid's rim.
  const random = seeded(0x5ea5);
  for (let i = 0; i < 26; i++) {
    const x = random() * copy;
    const y = 26 + random() * 250;
    if (Math.hypot(x - sun.x, y - sun.y) < 380) continue;
    ctx.fillStyle = c ? "rgba(255,240,255,0.9)" : grey(0);
    ctx.beginPath();
    ctx.arc(x, y, 2.5 + random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // The sea: a raised layer from the horizon down, with wave grooves, and the sun's golden reflection.
  if (c) {
    const sea = ctx.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, "#f39a8a");
    sea.addColorStop(0.18, "#b8609e");
    sea.addColorStop(0.55, "#6a3c96");
    sea.addColorStop(1, "#3a2672");
    ctx.fillStyle = sea;
  } else ctx.fillStyle = grey(CARVE_LEVEL.sea);
  ctx.fillRect(-2, horizon, copy + 4, H - horizon);
  // The horizon line itself: a fine bright edge (colour) on the sea's bevelled top.
  if (c) {
    ctx.fillStyle = "rgba(255,214,150,0.9)";
    ctx.fillRect(-2, horizon - 1, copy + 4, 3);
  }
  const waves = seeded(0x3a7e);
  for (let row = 0; row < 15; row++) {
    const y = horizon + 14 + Math.pow(row / 14, 1.5) * (H - horizon - 60);
    const gap = 70 + row * 14;
    for (let x = -40 + waves() * gap; x < copy + 40; x += gap * (0.8 + waves() * 0.5)) {
      const len = gap * (0.35 + waves() * 0.3);
      ctx.strokeStyle = c ? "rgba(40,16,70,0.45)" : grey(CARVE_LEVEL.seaGroove);
      ctx.lineWidth = 2.5 + row * 0.25;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 9; i++) {
    const y = horizon + 10 + i * 20 + i * i * 1.8;
    const half = (sun.r * 0.9) * (1 - i / 11) + 6;
    const wobble = (i % 2 === 0 ? 1 : -1) * 8;
    ctx.fillStyle = c ? (i < 3 ? "#ffe6a0" : "#ffbf6a") : grey(CARVE_LEVEL.glitter);
    ctx.beginPath();
    ctx.ellipse(sun.x + wobble, y, half, 4 + i * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // The sun: a bevelled disc half-set on the horizon, a groove ringing it.
  ctx.strokeStyle = c ? "rgba(255,200,120,0.6)" : grey(CARVE_LEVEL.sunRing);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r + 12, Math.PI, Math.PI * 2);
  ctx.stroke();
  if (c) {
    const disc = ctx.createRadialGradient(sun.x, sun.y - sun.r * 0.3, 4, sun.x, sun.y, sun.r);
    disc.addColorStop(0, "#fffbe4");
    disc.addColorStop(0.6, "#ffe38a");
    disc.addColorStop(1, "#ffb04a");
    ctx.fillStyle = disc;
  } else ctx.fillStyle = grey(CARVE_LEVEL.sun);
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  // Hills along the horizon: low and purple, left of the sun and far right.
  for (const [x0, x1, peak, seed] of [
    [40, 760, 58, 0x41],
    [1400, 1570, 34, 0x42],
  ] as const) {
    ctx.fillStyle = c ? "#5a3478" : grey(CARVE_LEVEL.hills);
    polygon(ctx, ridge(x0, x1, horizon + 2, peak, seed, 3));
    ctx.fill();
    if (c) {
      ctx.strokeStyle = "rgba(255,150,140,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ridge(x0, x1, horizon + 2, peak, seed, 3)
        .slice(2, -2)
        .forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y + 1.5) : ctx.lineTo(x, y + 1.5)));
      ctx.stroke();
    }
  }
  // The shore: dark land at the bottom under each palm.
  for (const [x0, x1, peak, seed] of [
    [150, 880, 120, 0x51],
    [1150, 1500, 150, 0x52],
  ] as const) {
    if (c) {
      const land = ctx.createLinearGradient(0, H - peak, 0, H);
      land.addColorStop(0, "#5c2c3c");
      land.addColorStop(0.45, "#3a1c32");
      land.addColorStop(1, "#24122a");
      ctx.fillStyle = land;
    } else ctx.fillStyle = grey(CARVE_LEVEL.shore);
    polygon(ctx, ridge(x0, x1, H + 2, peak, seed, 2));
    ctx.fill();
    if (c) {
      // Warm grass light along the shore's top.
      ctx.strokeStyle = "rgba(255,160,80,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ridge(x0, x1, H + 2, peak, seed, 2)
        .slice(3, -3)
        .forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y + 2) : ctx.lineTo(x, y + 2)));
      ctx.stroke();
    }
  }
  for (const palm of POSTCARD_PALMS) drawPalm(ctx, palm, pass);
  ctx.restore();
}

/**
 * Draws the scene (POSTCARD_WRAP_SIZE) into `ctx`: in colour, or as the carving's height (grey levels). It is drawn at
 * x, x - width and x + width, so the texture's two ends continue each other exactly where it repeats.
 */
export function drawPostcardWrap(ctx: Ctx2D, pass: Pass): void {
  const { width: W, height: H } = POSTCARD_WRAP_SIZE;
  if (pass === "color") {
    const sky = ctx.createLinearGradient(0, 0, 0, POSTCARD_HORIZON_ROW);
    sky.addColorStop(0, "#3c2a86");
    sky.addColorStop(0.24, "#6a3aa8");
    sky.addColorStop(0.5, "#c04da6");
    sky.addColorStop(0.78, "#ff7a6a");
    sky.addColorStop(1, "#ffb560");
    ctx.fillStyle = sky;
  } else ctx.fillStyle = grey(CARVE_LEVEL.sky);
  ctx.fillRect(0, 0, W, H);
  for (const ox of [-W, 0, W]) drawCopy(ctx, pass, ox);
  // The postcard's cream border: raised bands along the lid's top edge and the box's bottom edge.
  ctx.fillStyle = pass === "color" ? "#f6e3c4" : grey(CARVE_LEVEL.border);
  ctx.fillRect(0, 0, W, 16);
  ctx.fillRect(0, H - 18, W, 18);
  if (pass === "color") {
    ctx.fillStyle = "rgba(120,70,40,0.35)";
    ctx.fillRect(0, 16, W, 2);
    ctx.fillRect(0, H - 20, W, 2);
  }
}

/** The lid top's sunset colours (centre sun -> orange -> pink -> violet at the edge). */
const LID_STOPS: readonly [number, string][] = [
  [0, "#fff3c4"],
  [0.14, "#ffd270"],
  [0.3, "#ff9654"],
  [0.55, "#e85688"],
  [0.8, "#9642aa"],
  [1, "#5a2c8c"],
];

/** Draws the lid's top (POSTCARD_LID_SIZE square): the sun's raised disc, grooved rays, a raised cream border. */
export function drawPostcardLid(ctx: Ctx2D, pass: Pass): void {
  const S = POSTCARD_LID_SIZE;
  const c = S / 2;
  if (pass === "color") {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 1.42);
    for (const [at, color] of LID_STOPS) g.addColorStop(at, color);
    ctx.fillStyle = g;
  } else ctx.fillStyle = grey(CARVE_LEVEL.sky);
  ctx.fillRect(0, 0, S, S);
  // Rays: 16 grooves from the sun's ring to the border.
  ctx.strokeStyle = pass === "color" ? "rgba(255,236,190,0.45)" : grey(CARVE_LEVEL.groove);
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * S * 0.2, c + Math.sin(a) * S * 0.2);
    ctx.lineTo(c + Math.cos(a) * S * 0.44, c + Math.sin(a) * S * 0.44);
    ctx.stroke();
  }
  // The sun's ring groove and its raised disc (under the bow).
  ctx.strokeStyle = pass === "color" ? "rgba(255,190,110,0.7)" : grey(CARVE_LEVEL.sunRing);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.165, 0, Math.PI * 2);
  ctx.stroke();
  if (pass === "color") {
    const d = ctx.createRadialGradient(c, c - S * 0.04, 4, c, c, S * 0.14);
    d.addColorStop(0, "#fffbe4");
    d.addColorStop(0.6, "#ffe38a");
    d.addColorStop(1, "#ffb04a");
    ctx.fillStyle = d;
  } else ctx.fillStyle = grey(CARVE_LEVEL.sun);
  ctx.beginPath();
  ctx.arc(c, c, S * 0.14, 0, Math.PI * 2);
  ctx.fill();
  // The border: a raised cream frame round the edge (it meets the rim's top border).
  ctx.fillStyle = pass === "color" ? "#f6e3c4" : grey(CARVE_LEVEL.border);
  const b = Math.round(S * 0.035);
  ctx.fillRect(0, 0, S, b);
  ctx.fillRect(0, S - b, S, b);
  ctx.fillRect(0, 0, b, S);
  ctx.fillRect(S - b, 0, b, S);
}

/**
 * A box blur of radius `r` px that wraps round horizontally when `wrapX` (the panorama), clamps otherwise. Written for
 * speed (it runs on the 1536 x 732 scene while the reveal opens): each row is padded once, then running sums along
 * the rows and down the columns (row by row, so memory is read in order).
 */
export function blurHeight(src: Float32Array, width: number, height: number, r: number, wrapX: boolean): Float32Array {
  if (r <= 0) return src.slice();
  const n = 2 * r + 1;
  const tmp = new Float32Array(src.length);
  const padded = new Float32Array(width + 2 * r);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let k = 0; k < width + 2 * r; k++) {
      let x = k - r;
      if (x < 0) x = wrapX ? x + width : 0;
      else if (x >= width) x = wrapX ? x - width : width - 1;
      padded[k] = src[row + x];
    }
    let sum = 0;
    for (let k = 0; k < n; k++) sum += padded[k];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / n;
      sum += padded[x + n] - padded[x];
    }
  }
  const out = new Float32Array(src.length);
  const acc = new Float32Array(width);
  const rowAt = (y: number) => (y < 0 ? 0 : y >= height ? height - 1 : y) * width;
  for (let k = -r; k <= r; k++) {
    const o = rowAt(k);
    for (let x = 0; x < width; x++) acc[x] += tmp[o + x];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const add = rowAt(y + r + 1);
    const drop = rowAt(y - r);
    for (let x = 0; x < width; x++) {
      out[row + x] = acc[x] / n;
      acc[x] += tmp[add + x] - tmp[drop + x];
    }
  }
  return out;
}

/** A tangent-space normal map (RGBA, OpenGL style: green = +v, row 0 at the top) from a height field, wrapping in x. */
function normalMap(field: Float32Array, width: number, height: number, strength: number, wrapX: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const down = (y < height - 1 ? y + 1 : height - 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? x - 1 : wrapX ? width - 1 : 0;
      const right = x < width - 1 ? x + 1 : wrapX ? 0 : width - 1;
      const nx = -(field[row + right] - field[row + left]) * 0.5 * strength;
      // Rows run down the buffer but v runs up the texture: a height rising towards the top tilts the normal to -v.
      const ny = (field[down + x] - field[up + x]) * 0.5 * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (row + x) * 4;
      out[o] = nx * inv * 127.5 + 127.5;
      out[o + 1] = ny * inv * 127.5 + 127.5;
      out[o + 2] = inv * 127.5 + 127.5;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The carving's maps from the drawn height (grey RGBA): the bevelled height, its normal map, and the shaded colour. */
export type CarveMaps = { height: Float32Array; normal: Uint8ClampedArray; color: Uint8ClampedArray };

/**
 * Turns the drawn colour and height (RGBA, same size) into the carving: the levels' edges bevelled (two blur passes, a
 * chamfer rather than a hard step), a tangent-space normal map (POSTCARD_CARVE.normalStrength), and the colour shaded
 * by the relief (recesses and the foot of every raised edge darker, the top of every raised edge a touch lighter), so
 * the carving reads even where the light is flat.
 */
export function carveMaps(color: Uint8ClampedArray, heightRgba: Uint8ClampedArray, width: number, height: number, wrapX: boolean): CarveMaps {
  const count = width * height;
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) raw[i] = heightRgba[i * 4] / 255;
  const bevel = blurHeight(blurHeight(raw, width, height, 2, wrapX), width, height, 1, wrapX);
  const normal = normalMap(bevel, width, height, POSTCARD_CARVE.normalStrength, wrapX);
  const broad = blurHeight(bevel, width, height, 7, wrapX);
  const shaded = new Uint8ClampedArray(color.length);
  for (let i = 0; i < count; i++) {
    const relief = bevel[i] - broad[i];
    const k = Math.min(1.18, Math.max(0.62, 1 + relief * 2.4));
    const o = i * 4;
    shaded[o] = color[o] * k;
    shaded[o + 1] = color[o + 1] * k;
    shaded[o + 2] = color[o + 2] * k;
    shaded[o + 3] = 255;
  }
  return { height: bevel, normal, color: shaded };
}

/** Samples a height field (row 0 at the top) at texture coordinates u (0..1, wrapping when `wrapX`) and v (0..1, up). */
export function sampleHeight(field: Float32Array, width: number, height: number, u: number, v: number, wrapX: boolean): number {
  const fx = u * width - 0.5;
  const fy = (1 - v) * height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.min(height - 1, Math.max(0, Math.floor(fy)));
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = Math.min(1, Math.max(0, fy - y0));
  const col = (x: number) => (wrapX ? ((x % width) + width) % width : Math.min(width - 1, Math.max(0, x)));
  const a = field[y0 * width + col(x0)] * (1 - tx) + field[y0 * width + col(x0 + 1)] * tx;
  const b = field[y1 * width + col(x0)] * (1 - tx) + field[y1 * width + col(x0 + 1)] * tx;
  return a * (1 - ty) + b * ty;
}
