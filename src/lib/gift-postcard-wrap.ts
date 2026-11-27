import { boxBlur, heightToNormal } from "@/lib/gift-engrave";

// The Sunset Postcard's wrap for its 3D gift box (gift-scene-composed.tsx, variant "postcard-box"): the picture inside
// the postcard's border, taken out of the 384px icon and squared up, then made into ONE continuous picture that runs
// round the box's four sides with no seam: two copies of the sunset end to end, each copy's edge blended into the next
// (the sky and sea cross-fade, while the dark palm silhouettes of both sides are kept, so the join reads as more palms,
// never as a ghost or a mirror image). Its left edge meets its right edge the same way, so the box can turn all the way
// round. Plus the lid's top (a sunset sun with engraved rays) and the relief for both (normal maps, gift-engrave.ts).
// Pure and deterministic, no DOM (unit-tested, gift-postcard-wrap.test.ts).

type Point = readonly [number, number];

/**
 * The picture inside the postcard's border on the 384px icon (the card is drawn in perspective): top-left, top-right,
 * bottom-right, bottom-left, measured on the icon and pulled 3 px inside the border so none of the border comes along.
 */
export const POSTCARD_PICTURE_QUAD: readonly [Point, Point, Point, Point] = [
  [64.3, 150.4],
  [330.9, 127],
  [333.2, 247.2],
  [68, 259.5],
];

/** The squared-up picture's size: about the picture's own proportions at twice the icon's scale. */
export const POSTCARD_PICTURE_SIZE = { width: 544, height: 236 } as const;

/** Samples `src` (RGBA, sw x sh) at a fractional pixel position, bilinearly (edges clamp). */
function sample(src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number, out: number[]): void {
  const fx = Math.min(sw - 1, Math.max(0, x - 0.5));
  const fy = Math.min(sh - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(sw - 1, x0 + 1);
  const y1 = Math.min(sh - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 4; c++) {
    const a = src[(y0 * sw + x0) * 4 + c] * (1 - tx) + src[(y0 * sw + x1) * 4 + c] * tx;
    const b = src[(y1 * sw + x0) * 4 + c] * (1 - tx) + src[(y1 * sw + x1) * 4 + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
}

/** Squares up the quadrilateral `quad` (TL, TR, BR, BL in `src` pixels) into an outW x outH image (bilinear mapping). */
export function rectifyQuad(src: Uint8ClampedArray, sw: number, sh: number, quad: readonly [Point, Point, Point, Point], outW: number, outH: number): Uint8ClampedArray {
  const [tl, tr, br, bl] = quad;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const u = (x + 0.5) / outW;
      const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
      const bottom = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
      sample(src, sw, sh, top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v, px);
      const o = (y * outW + x) * 4;
      out[o] = px[0];
      out[o + 1] = px[1];
      out[o + 2] = px[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

const lum = (p: ArrayLike<number>, o: number) => (0.2126 * p[o] + 0.7152 * p[o + 1] + 0.0722 * p[o + 2]) / 255;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One join: `p` is the copy being left, `q` the copy arriving, `s` 0..1 across the join. The sky and sea cross-fade;
 * a pixel that is a dark silhouette against the other copy (a palm) keeps its weight until close to its own copy's
 * edge, where it thins out, so palms from both sides stand together and no frond is cut off at a hard line.
 */
function joinPixel(p: Uint8ClampedArray, po: number, q: Uint8ClampedArray, qo: number, s: number, out: Uint8ClampedArray, o: number): void {
  const k = smooth(0, 1, s);
  const darkP = smooth(0.03, 0.16, lum(q, qo) - lum(p, po)) * (1 - smooth(0.62, 1, s));
  const darkQ = smooth(0.03, 0.16, lum(p, po) - lum(q, qo)) * smooth(0, 0.38, s);
  const wp = 1 - k + k * darkP;
  const wq = k + (1 - k) * darkQ;
  const total = wp + wq;
  for (let c = 0; c < 3; c++) out[o + c] = (p[po + c] * wp + q[qo + c] * wq) / total;
  out[o + 3] = 255;
}

/**
 * The seamless wrap: two copies of `pic` (w x h) end to end, overlapping by `overlap` px at each of the two joins (the
 * second join is where the strip's end meets its start), then resampled to outW x outH. Column 0 continues column
 * outW - 1 exactly, so the texture can repeat round the box.
 */
export function wrapPanorama(pic: Uint8ClampedArray, w: number, h: number, overlap: number, outW: number, outH: number): Uint8ClampedArray {
  const z = Math.max(1, Math.round(overlap));
  const length = 2 * (w - z);
  const strip = new Uint8ClampedArray(length * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < length; x++) {
      const o = (y * length + x) * 4;
      const row = y * w;
      if (x < z) {
        // The wrap-around join: copy B's end (leaving) into copy A's start (arriving).
        joinPixel(pic, (row + x + w - z) * 4, pic, (row + x) * 4, x / z, strip, o);
      } else if (x < w - z) {
        strip.set(pic.subarray((row + x) * 4, (row + x) * 4 + 4), o);
      } else if (x < w) {
        // The middle join: copy A's end into copy B's start.
        joinPixel(pic, (row + x) * 4, pic, (row + x - (w - z)) * 4, (x - (w - z)) / z, strip, o);
      } else {
        const bx = x - (w - z);
        strip.set(pic.subarray((row + bx) * 4, (row + bx) * 4 + 4), o);
      }
    }
  }
  // Resample (wrapping horizontally, so the ends stay continuous).
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) / outH) * h - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < outW; x++) {
      const sx = ((x + 0.5) / outW) * length - 0.5;
      const x0 = ((Math.floor(sx) % length) + length) % length;
      const x1 = (x0 + 1) % length;
      const tx = sx - Math.floor(sx);
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = strip[(y0 * length + x0) * 4 + c] * (1 - tx) + strip[(y0 * length + x1) * 4 + c] * tx;
        const b = strip[(y1 * length + x0) * 4 + c] * (1 - tx) + strip[(y1 * length + x1) * 4 + c] * tx;
        out[o + c] = a * (1 - ty) + b * ty;
      }
    }
  }
  return out;
}

/** The relief pressed into the paper: the picture's light and shade as height (palms and the horizon stand out). */
export function wrapReliefNormal(rgba: Uint8ClampedArray, width: number, height: number, strength = 3): Uint8ClampedArray {
  const count = width * height;
  const h = new Float32Array(count);
  for (let i = 0; i < count; i++) h[i] = lum(rgba, i * 4);
  return heightToNormal(boxBlur(h, width, height, 1), width, height, strength, true);
}

/** The lid top's sunset colours, sampled from the art's sky (centre sun -> orange -> pink -> violet at the edge). */
const LID_STOPS: readonly [number, [number, number, number]][] = [
  [0, [255, 236, 170]],
  [0.16, [255, 208, 112]],
  [0.3, [255, 150, 84]],
  [0.55, [232, 86, 136]],
  [0.8, [150, 66, 170]],
  [1.05, [84, 44, 140]],
];

/**
 * The lid's top (size x size): a sunset seen from above, the sun in the middle (under the bow) with rays running out to
 * the edges, the colours of the art's sky; the sun's disc stands up and the rays are cut in (the normal map).
 */
export function lidTopMaps(size: number): { color: Uint8ClampedArray; normal: Uint8ClampedArray } {
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const rays = 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const a = Math.atan2(dy, dx);
      let i = 0;
      while (i < LID_STOPS.length - 2 && r > LID_STOPS[i + 1][0]) i++;
      const [r0, c0] = LID_STOPS[i];
      const [r1, c1] = LID_STOPS[i + 1];
      const t = smooth(r0, r1, r);
      const ray = Math.pow(0.5 + 0.5 * Math.cos(a * rays), 3) * smooth(0.22, 0.4, r) * (1 - smooth(0.85, 1.2, r));
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) color[o + c] = (c0[c] + (c1[c] - c0[c]) * t) * (1 + 0.1 * ray);
      color[o + 3] = 255;
      const sun = 1 - smooth(0.14, 0.2, r);
      height[y * size + x] = 0.8 * sun - 0.35 * ray;
    }
  }
  return { color, normal: heightToNormal(boxBlur(height, size, size, 1), size, size, 6) };
}
