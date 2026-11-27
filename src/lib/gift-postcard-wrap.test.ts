import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POSTCARD_WRAP_ASPECT, POSTCARD_BOX, postcardWrapV } from "@/lib/gift-composed-plan";
import { POSTCARD_PICTURE_QUAD, POSTCARD_PICTURE_SIZE, lidTopMaps, rectifyQuad, wrapPanorama, wrapReliefNormal } from "@/lib/gift-postcard-wrap";

// The Sunset Postcard wrapped round its 3D gift box: the picture taken from inside the postcard's border, made into one
// strip whose end meets its start with no seam, no stretching and no mirror image.

function picture(w: number, h: number) {
  // A sky gradient (top to bottom) with a dark "palm" near each edge and a bright "sun" in the middle.
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let c = [200 - y, 100 + y, 160, 255];
      if (Math.abs(x - 4) < 2 || Math.abs(x - (w - 5)) < 2) c = [30, 20, 40, 255];
      if (Math.abs(x - w / 2) < 3 && Math.abs(y - h / 2) < 3) c = [255, 240, 170, 255];
      data.set(c, o);
    }
  return data;
}

describe("wrapPanorama", () => {
  const w = 60;
  const h = 20;
  const pic = picture(w, h);
  const overlap = 8;
  const outW = 2 * (w - overlap);
  const strip = wrapPanorama(pic, w, h, overlap, outW, h);
  const px = (x: number, y: number) => [...strip.slice((y * outW + x) * 4, (y * outW + x) * 4 + 3)];
  const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

  it("is seamless: the last column continues into the first (no jump bigger than any step inside the picture)", () => {
    let worstInside = 0;
    for (let y = 0; y < h; y++) for (let x = 1; x < outW; x++) worstInside = Math.max(worstInside, diff(px(x, y), px(x - 1, y)));
    for (let y = 0; y < h; y++) expect(diff(px(0, y), px(outW - 1, y)), `row ${y}`).toBeLessThanOrEqual(worstInside);
  });

  it("keeps the picture itself unchanged away from the joins, twice, the same way round (no mirror image)", () => {
    for (let y = 0; y < h; y += 3) {
      for (const x of [overlap + 2, w / 2, w - overlap - 2]) {
        const src = [...pic.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
        expect(px(x, y)).toEqual(src);
        expect(px(x + w - overlap, y)).toEqual(src);
      }
    }
  });

  it("keeps a dark silhouette (a palm) from either side through a join rather than fading it to a ghost", () => {
    // The right palm of copy A sits inside the middle join; it stays dark there.
    const palmX = w - 5;
    expect(px(palmX, 10)[0]).toBeLessThan(80);
  });
});

describe("the postcard picture and the box", () => {
  it("is taken from inside the postcard's border on the 384px icon, at about the picture's own proportions", () => {
    for (const [x, y] of POSTCARD_PICTURE_QUAD) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(384);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(384);
    }
    const [tl, tr, br, bl] = POSTCARD_PICTURE_QUAD;
    const width = (tr[0] - tl[0] + br[0] - bl[0]) / 2;
    const height = (bl[1] - tl[1] + br[1] - tr[1]) / 2;
    expect(POSTCARD_PICTURE_SIZE.width / POSTCARD_PICTURE_SIZE.height).toBeCloseTo(width / height, 0);
    // Two copies end to end, each join overlapping by a little, make exactly the box's proportions: nothing stretches.
    const overlap = POSTCARD_PICTURE_SIZE.width - (POSTCARD_WRAP_ASPECT * POSTCARD_PICTURE_SIZE.height) / 2;
    expect(overlap).toBeGreaterThan(0.04 * POSTCARD_PICTURE_SIZE.width);
    expect(overlap).toBeLessThan(0.15 * POSTCARD_PICTURE_SIZE.width);
    // The wrap runs from the body's bottom to the lid's top; the lid's rim continues the body's sides.
    expect(postcardWrapV(POSTCARD_BOX.bodyBottom)).toBe(0);
    expect(postcardWrapV(POSTCARD_BOX.lidTop)).toBe(1);
  });

  it("rectifies a quad, and the lid top and relief maps are well-formed", () => {
    const src = new Uint8ClampedArray(8 * 8 * 4).fill(200);
    const out = rectifyQuad(src, 8, 8, [[1, 1], [7, 1], [7, 7], [1, 7]], 4, 4);
    expect(out.length).toBe(64);
    expect(out[0]).toBe(200);
    const lid = lidTopMaps(32);
    expect(lid.color.length).toBe(32 * 32 * 4);
    expect(lid.normal.length).toBe(32 * 32 * 4);
    expect(wrapReliefNormal(new Uint8ClampedArray(16 * 4).fill(100), 4, 4).length).toBe(64);
    const file = readFileSync(path.join(process.cwd(), "src/lib/gift-postcard-wrap.ts"), "utf8");
    expect(file).not.toMatch(/document\.|window\.|fetch\(|Math\.random/);
  });
});
