// Cuts a gift icon out of its navy backdrop, in the browser, for the 3D reveals that place an icon on an object
// (gift-scene-composed.tsx: the Aurora Sweep across the gem, the Aurora Frame and the Midnight Crystal on it), plus the
// hand-traced outlines of the two icons no colour key can separate (the Level Up badge, the Supporter Star's star). The icon files keep the sheet's backdrop on purpose (see CLAUDE.md "Art pipeline": a colour key alone can't
// separate dark parts such as the graduation cap's top), so this does not key by colour alone: it flood-fills from the
// picture's border through backdrop-coloured (or already faded) pixels only. Dark parts enclosed by the art (the Level
// Up shield's navy face, the night sky inside the Aurora Frame) are not reachable from the border and stay opaque.
// Inside the filled region alpha ramps with the colour distance from the backdrop and with brightness (a dark halo goes
// too; warm and cool dark glow can be ramped differently), so the art's own soft
// glows become translucent instead of a hard edge or a dark rim, and the backdrop's tint is taken back out of those
// pixels (un-blended), so no navy fringe is left. Optionally the art is first "sealed" (grown a few px) so the fill can
// reach further into the glow without slipping through thin gaps into the art, and small specks left floating around
// the art are removed. Each icon has a preset (CUTOUT_PRESETS), chosen by the scene. Pure, deterministic, no DOM: it
// works on an RGBA buffer (ImageData.data), unit-tested (gift-art-cutout.test.ts).

/** The icons' backdrop, re-based to one navy by scripts/slice-gift-art.py (measured on the 384px files). */
export const GIFT_ART_BACKDROP: readonly [number, number, number] = [14, 13, 46];
/** A pixel the icon's own edge fade has made this transparent counts as backdrop for the flood fill. */
const FADED_ALPHA = 250;
/** A kept piece of art smaller than `speck` px (alpha above this) not joined to the rest is a speck. */
const SPECK_ALPHA = 0.35;

export type CutoutOptions = {
  /** Colour distance from the backdrop under which a pixel lets the flood fill through. */
  reach: number;
  /** In the filled region: colour distance at or under `lo` fully cut, from `hi` fully kept. */
  lo: number;
  hi: number;
  /** In the filled region: luminance ramp (cut at or under [0], kept from [1]) for cool and for warm (red > blue) pixels. */
  cool: readonly [number, number];
  warm: readonly [number, number];
  /** Grow the art by this many px before the fill (0 = none), and the fill back by as much afterwards. */
  seal: number;
  /** Remove kept pieces smaller than this many px (0 = keep all). */
  speck: number;
  /** Anti-alias the cut edge (3x3 alpha average over the cut region). */
  soften: boolean;
  /**
   * Harden the cut region's leftover glow (0 = off): there, alpha below `harden` goes, and it ramps to full over the next
   * 0.3, so a faint pale halo of un-blended glow pixels around the art doesn't survive as a speckled outline.
   */
  harden: number;
};

export const CUTOUT_PRESETS = {
  /** The Aurora Sweep (painted onto the gem; its shader also drops dark pixels) and the Supporter Star's engraving mask. */
  standard: { reach: 90, lo: 24, hi: 90, cool: [0.08, 0.28], warm: [0.08, 0.28], seal: 0, speck: 0, soften: false, harden: 0 },
  /** The Aurora Frame: nothing dark is enclosed by its outer edge, so the fill reaches all of its dark-blue glow
   *  (sealed by 2 px), which is cut; what is left of that glow is hardened (no pale speckled rim) and specks go. */
  frame: { reach: 130, lo: 24, hi: 130, cool: [0.14, 0.45], warm: [0.14, 0.45], seal: 2, speck: 40, soften: true, harden: 0.42 },
  /** The Midnight Crystal: its blue glow and the navy between the crystals go (sealed so the fill can't get into the
   *  crystals' dark facets), the crystals' edges stay crisp. */
  crystal: { reach: 120, lo: 30, hi: 120, cool: [0.12, 0.4], warm: [0.12, 0.4], seal: 2, speck: 60, soften: true, harden: 0.4 },
} as const satisfies Record<string, CutoutOptions>;

/**
 * The Level Up badge's outline (wings, arrow and shield), traced by hand on the 384px icon (x, y in icon pixels,
 * clockwise from the left wing's tip). Its dark shield and the maroon glow around it share their colours, so no colour
 * key can separate them (the earlier colour-keyed cut left maroon patches above the arrow and between the wings, and a
 * ragged shield); the scene fills this path instead (anti-aliased) and keeps only what is inside it. The four small
 * sparkles outside the outline go with the glow.
 */
export const LEVEL_UP_SILHOUETTE: readonly (readonly [number, number])[] = [
  // Left wing: tip, its top edge straight to the shield's corner.
  [38.6, 136.6],
  [40.4, 134.9],
  [116.3, 169.4],
  // The shield's top-left rim up to the arrow head.
  [131.7, 159.4],
  [150, 146.5],
  [158.3, 141.7],
  // The arrow head.
  [156.2, 139.9],
  [193.5, 98.4],
  [231.3, 139.9],
  [229.4, 141.8],
  // The shield's top-right rim down to the right wing.
  [251.7, 156.3],
  [270.4, 169.6],
  // Right wing: its top edge to the tip, then the three feathers' lower edges.
  [305, 152.4],
  [343.6, 135.6],
  [345.9, 136.9],
  [346.7, 140.5],
  [342.9, 153.9],
  [337.7, 165.2],
  [332.7, 171.3],
  [326.6, 176.3],
  [328, 178.6],
  [337.9, 180.2],
  [336.7, 186.2],
  [331.5, 197.7],
  [325.2, 205.4],
  [317.6, 210.5],
  [310.6, 214],
  [314.3, 217.6],
  [311.5, 225.2],
  [305.2, 232.8],
  [296.2, 237.8],
  [287.6, 239.1],
  [285.9, 242.1],
  [284.7, 245.8],
  [280, 248.6],
  [271, 247.7],
  // The shield's right side and lower rims.
  [269.9, 258],
  [266.9, 262.5],
  [243.2, 276.7],
  [228.2, 292.3],
  [163.2, 290.7],
  [141.6, 277.7],
  [118.8, 258.2],
  [116.2, 252],
  // Left wing: the three feathers' lower edges back up to the tip.
  [115.5, 248.2],
  [110, 249],
  [105, 248.5],
  [100, 246.4],
  [97.4, 242.7],
  [96, 239.4],
  [92.5, 236.5],
  [85, 231.5],
  [77.4, 225.4],
  [72.9, 219.7],
  [72.6, 216.8],
  [71, 213],
  [62.5, 205.5],
  [55.4, 196.1],
  [51.5, 188.1],
  [49.9, 182.5],
  [50.6, 180.3],
  [56.2, 176.6],
  [53.8, 172.4],
  [49.8, 168.6],
  [45, 162.6],
  [41.1, 155],
  [38.8, 146.5],
  [38.3, 139.6],
];

/**
 * The Supporter Star icon's star (its five points and the five corners between them, 384px icon, clockwise from the top
 * point), traced by hand: the outline of the engraving cut into the 3D star (its warm glow is not part of it).
 */
export const SUPPORTER_STAR_OUTLINE: readonly (readonly [number, number])[] = [
  [188, 47],
  [234, 129],
  [330, 150],
  [268, 218],
  [283, 322],
  [187, 278],
  [90, 320],
  [103, 217],
  [42, 148],
  [142, 129],
];

/** Whether the point (x, y) lies inside `polygon` (even-odd rule). */
export function pointInPolygon(polygon: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type CutoutPreset = keyof typeof CUTOUT_PRESETS;

/** The icon is cut out at this multiple of its file size (upscaled smoothly first), so the cut edge is finer. */
export const CUTOUT_UPSCALE = 2;

/** A preset's px-based settings for an icon drawn at `scale` times the 384px it was tuned on. */
export function scaledCutout(options: CutoutOptions, scale: number): CutoutOptions {
  return { ...options, seal: Math.round(options.seal * scale), speck: Math.round(options.speck * scale * scale) };
}

const smooth = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Grows a 0/1 mask by `radius` px (a disc). */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const out = new Uint8Array(mask.length);
  const offsets: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius + radius) offsets.push([dx, dy]);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) out[ny * width + nx] = 1;
      }
    }
  }
  return out;
}

/** Flood fill (4-connected) from every border pixel through `passable` pixels. */
function fillFromBorder(passable: Uint8Array, width: number, height: number): Uint8Array {
  const count = width * height;
  const reached = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (passable[i] && !reached[i]) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (i >= width) seed(i - width);
    if (i < count - width) seed(i + width);
  }
  return reached;
}

/** Zeroes the alpha of every kept piece (8-connected, alpha > SPECK_ALPHA) smaller than `speck` px. */
function removeSpecks(data: Uint8ClampedArray, width: number, height: number, speck: number): void {
  const count = width * height;
  const label = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);
  const solid = (i: number) => data[i * 4 + 3] > SPECK_ALPHA * 255;
  for (let start = 0; start < count; start++) {
    if (label[start] !== -1 || !solid(start)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = start;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const n = ny * width + nx;
          if (label[n] === -1 && solid(n)) {
            label[n] = start;
            queue[tail++] = n;
          }
        }
      }
    }
    if (tail < speck) for (let k = 0; k < tail; k++) data[queue[k] * 4 + 3] = 0;
  }
}

/** Cuts `data` (RGBA, straight alpha, width x height) out of its backdrop, in place. */
export function cutOutGiftArt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: CutoutOptions = CUTOUT_PRESETS.standard,
): void {
  const count = width * height;
  if (data.length !== count * 4) throw new Error("cutOutGiftArt: buffer size does not match");
  const [br, bg, bb] = GIFT_ART_BACKDROP;
  const distance = new Float32Array(count);
  const backdropLike = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const d = Math.hypot(data[o] - br, data[o + 1] - bg, data[o + 2] - bb);
    distance[i] = d;
    backdropLike[i] = d < options.reach || data[o + 3] < FADED_ALPHA ? 1 : 0;
  }

  let reached: Uint8Array;
  if (options.seal > 0) {
    // Seal: grow the art (what isn't backdrop-like) so the fill can't slip through thin gaps; fill; grow the fill back
    // over backdrop-like pixels only, so the glow right at the art's edge is still reached.
    const art = new Uint8Array(count);
    for (let i = 0; i < count; i++) art[i] = backdropLike[i] ? 0 : 1;
    const sealed = dilate(art, width, height, options.seal);
    const passable = new Uint8Array(count);
    for (let i = 0; i < count; i++) passable[i] = backdropLike[i] && !sealed[i] ? 1 : 0;
    const grown = dilate(fillFromBorder(passable, width, height), width, height, options.seal);
    reached = new Uint8Array(count);
    for (let i = 0; i < count; i++) reached[i] = grown[i] && backdropLike[i] ? 1 : 0;
  } else {
    reached = fillFromBorder(backdropLike, width, height);
  }

  for (let i = 0; i < count; i++) {
    if (!reached[i]) continue;
    const o = i * 4;
    const luminance = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
    const dark = data[o] > data[o + 2] + 4 ? options.warm : options.cool;
    const keep = smooth(options.lo, options.hi, distance[i]) * smooth(dark[0], dark[1], luminance);
    if (keep <= 0) {
      data[o + 3] = 0;
      continue;
    }
    // Un-blend: the pixel was keep * colour + (1 - keep) * backdrop.
    data[o] = (data[o] - br * (1 - keep)) / keep;
    data[o + 1] = (data[o + 1] - bg * (1 - keep)) / keep;
    data[o + 2] = (data[o + 2] - bb * (1 - keep)) / keep;
    data[o + 3] = Math.round(data[o + 3] * keep);
  }

  if (options.harden > 0) {
    for (let i = 0; i < count; i++) {
      if (!reached[i]) continue;
      const o = i * 4 + 3;
      data[o] = Math.round(255 * smooth(options.harden, options.harden + 0.3, data[o] / 255));
    }
  }
  if (options.speck > 0) removeSpecks(data, width, height, options.speck);
  if (options.soften) softenEdge(data, width, height, dilate(reached, width, height, 1));
}

/** A 3x3 average of alpha over the cut region (and 1 px around it), so a cut edge is anti-aliased, not stair-stepped. */
function softenEdge(data: Uint8ClampedArray, width: number, height: number, region: Uint8Array): void {
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!region[i]) continue;
      let sum = 0;
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const j = ny * width + nx;
          const a = alpha[j];
          sum += a;
          n++;
          r += data[j * 4] * a;
          g += data[j * 4 + 1] * a;
          b += data[j * 4 + 2] * a;
        }
      }
      // A pixel that was fully cut still holds the backdrop's navy: give it its kept neighbours' colour before it
      // becomes partly visible, so the soft edge has no navy rim.
      if (alpha[i] === 0 && sum > 0) {
        data[i * 4] = r / sum;
        data[i * 4 + 1] = g / sum;
        data[i * 4 + 2] = b / sum;
      }
      data[i * 4 + 3] = Math.round(sum / n);
    }
  }
}
