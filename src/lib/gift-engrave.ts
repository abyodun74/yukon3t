// Relief maps for the composed 3D reveals that cut a gift's artwork into a surface instead of laying it on top: the
// Supporter Star engraved into the gold star's face, the Sunset Postcard pressed into the gift box's paper
// (gift-scene-composed.tsx builds the textures from these, gift-composed-graph.ts puts them on the objects' own
// materials, so the relief is lit with the object and turns with it). Pure and deterministic: RGBA / float buffers in,
// buffers out, no DOM (unit-tested, gift-engrave.test.ts).
//
// Conventions: buffers are row-major from the top row (as a canvas's ImageData is); textures made from them keep three's
// default flipY, so a buffer's top row is the texture's v = 1. Normal maps are tangent-space, OpenGL style (green = +v).

const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A separable box blur of radius `r` px (edges clamp). */
export function boxBlur(src: Float32Array, width: number, height: number, r: number): Float32Array {
  if (r <= 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[y * width + Math.min(width - 1, Math.max(0, k))];
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / n;
      sum += src[y * width + Math.min(width - 1, x + r + 1)] - src[y * width + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / n;
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
    }
  }
  return out;
}

/**
 * A tangent-space normal map (RGBA, alpha 255) from a height field: the slope by central differences, times `strength`.
 * With `wrapX` the left and right edges are neighbours (a texture that wraps round, like the postcard box's sides).
 */
export function heightToNormal(height: Float32Array, width: number, height_: number, strength: number, wrapX = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height_ * 4);
  const at = (x: number, y: number) => {
    const xx = wrapX ? (x + width) % width : Math.min(width - 1, Math.max(0, x));
    const yy = Math.min(height_ - 1, Math.max(0, y));
    return height[yy * width + xx];
  };
  for (let y = 0; y < height_; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
      // Rows run down the buffer but v runs up the texture: a height rising towards the top tilts the normal to -v.
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;
      const nx = -dx;
      const ny = dy;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * width + x) * 4;
      out[o] = Math.round((nx / len) * 127.5 + 127.5);
      out[o + 1] = Math.round((ny / len) * 127.5 + 127.5);
      out[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[o + 3] = 255;
    }
  }
  return out;
}

export type EngraveMaps = {
  /** Multiplies the metal's colour: white where the surface is plain, darker and warmer in the cut. */
  color: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  /** three reads roughness from green: polished outside, satin inside the engraving. */
  roughness: Uint8ClampedArray;
};

/** How deep the engraving is cut, and how strongly the art's own shading raises its facets inside the cut. */
export const ENGRAVE = { depth: 1, relief: 0.55, strength: 7, polished: 0.22, satin: 0.32 } as const;

/**
 * The engraving maps from a cut-out icon laid on the star's face (RGBA, straight alpha; transparent = plain metal). The
 * icon's silhouette is cut into the metal (a recess with softly sloped walls), its own light and shade become relief
 * inside the cut (lighter facets stand higher), the walls of the cut are shaded darker, and the cut is satin-finished
 * against the polished face, so the motif reads in the gold from every angle and lighting, the way a real engraving does.
 */
export function engraveMaps(rgba: Uint8ClampedArray, width: number, height: number): EngraveMaps {
  const count = width * height;
  if (rgba.length !== count * 4) throw new Error("engraveMaps: buffer size does not match");
  const mask = new Float32Array(count);
  const shade = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    // The art itself, not its soft glow (the cut-out keeps the glow translucent): only what is nearly opaque is cut in.
    mask[i] = smooth(0.5, 0.85, rgba[o + 3] / 255);
    shade[i] = luminance(rgba[o], rgba[o + 1], rgba[o + 2]);
  }
  const scale = width / 512;
  const soft = boxBlur(mask, width, height, Math.max(1, Math.round(2 * scale)));
  const wall = boxBlur(mask, width, height, Math.max(1, Math.round(4 * scale)));
  const detail = boxBlur(shade, width, height, Math.max(1, Math.round(1 * scale)));
  const h = new Float32Array(count);
  for (let i = 0; i < count; i++) h[i] = -ENGRAVE.depth * soft[i] + ENGRAVE.relief * soft[i] * (detail[i] - 0.5);
  const normal = heightToNormal(h, width, height, ENGRAVE.strength * scale);
  const color = new Uint8ClampedArray(count * 4);
  const roughness = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    // The walls of the cut catch less light; inside, the art's shading shows faintly in the metal.
    const walls = 1 - 0.45 * Math.min(1, 4 * wall[i] * (1 - wall[i]));
    const inside = soft[i];
    const tone = (1 - inside) + inside * (0.6 + 0.28 * detail[i]);
    const k = Math.max(0, Math.min(1.2, tone * walls));
    color[o] = Math.round(255 * Math.min(1, k));
    color[o + 1] = Math.round(255 * Math.min(1, k * (1 - 0.06 * inside)));
    color[o + 2] = Math.round(255 * Math.min(1, k * (1 - 0.16 * inside)));
    color[o + 3] = 255;
    const r = ENGRAVE.polished + (ENGRAVE.satin - ENGRAVE.polished) * smooth(0.2, 0.8, inside);
    roughness[o] = roughness[o + 1] = roughness[o + 2] = Math.round(255 * r);
    roughness[o + 3] = 255;
  }
  return { color, normal, roughness };
}
