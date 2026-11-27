// Cuts a gift icon out of its navy backdrop, in the browser, for the 3D reveals that place an icon on an object
// (gift-scene-composed.tsx: the Level Up badge on the gold star, the Aurora Sweep across the gem, the Aurora Frame on
// it). The icon files keep the sheet's backdrop on purpose (see CLAUDE.md "Art pipeline": a colour key alone can't
// separate dark parts such as the graduation cap's top), so this does not key by colour alone: it flood-fills from the
// picture's border through backdrop-coloured (or already faded) pixels only. Dark parts enclosed by the art (the Level
// Up shield's navy face, the night sky inside the Aurora Frame) are not reachable from the border and stay opaque.
// Inside the filled region alpha ramps with the colour distance from the backdrop, so the art's own soft glows become
// translucent instead of a hard edge, and the backdrop's tint is taken back out of those pixels (un-blended), so no navy
// fringe is left. Pure, deterministic, no DOM: it works on an RGBA buffer (ImageData.data), unit-tested
// (gift-art-cutout.test.ts).

/** The icons' backdrop, re-based to one navy by scripts/slice-gift-art.py (measured on the 384px files). */
export const GIFT_ART_BACKDROP: readonly [number, number, number] = [14, 13, 46];
/** Colour distance from the backdrop: at or under LO fully cut, from HI fully kept (smooth in between). */
export const CUTOUT_LO = 18;
export const CUTOUT_HI = 70;
/** A pixel the icon's own edge fade has made this transparent counts as backdrop for the flood fill. */
const FADED_ALPHA = 250;

const smooth = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Cuts `data` (RGBA, straight alpha, width x height) out of its backdrop, in place. */
export function cutOutGiftArt(data: Uint8ClampedArray, width: number, height: number): void {
  const count = width * height;
  if (data.length !== count * 4) throw new Error("cutOutGiftArt: buffer size does not match");
  const [br, bg, bb] = GIFT_ART_BACKDROP;
  const distance = new Float32Array(count);
  const backdropLike = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const d = Math.hypot(data[o] - br, data[o + 1] - bg, data[o + 2] - bb);
    distance[i] = d;
    backdropLike[i] = d < CUTOUT_HI || data[o + 3] < FADED_ALPHA ? 1 : 0;
  }

  // Flood fill from every border pixel through backdrop-like pixels (4-connected).
  const reached = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (backdropLike[i] && !reached[i]) {
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

  for (let i = 0; i < count; i++) {
    if (!reached[i]) continue;
    const o = i * 4;
    const keep = smooth(CUTOUT_LO, CUTOUT_HI, distance[i]);
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
}
