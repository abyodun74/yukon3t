import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CUTOUT_PRESETS, CUTOUT_UPSCALE, GIFT_ART_BACKDROP, cutOutGiftArt, scaledCutout } from "@/lib/gift-art-cutout";

// The icon cut-out the composed 3D reveals use: the backdrop connected to the border goes, enclosed dark parts stay,
// soft edges become translucent without a navy fringe.

const [br, bg, bb] = GIFT_ART_BACKDROP;

function image(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  return data;
}
const at = (data: Uint8ClampedArray, width: number, x: number, y: number) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe("cutOutGiftArt", () => {
  it("removes the backdrop reached from the border, keeps the art and the backdrop-coloured part the art encloses", () => {
    // A gold ring (5..14) around a navy centre that is exactly the backdrop colour, on the backdrop.
    const size = 20;
    const data = image(size, size, (x, y) => {
      const d = Math.max(Math.abs(x - 9.5), Math.abs(y - 9.5));
      if (d < 2.5) return [br, bg, bb, 255];
      if (d < 5) return [240, 180, 60, 255];
      return [br, bg, bb, 255];
    });
    cutOutGiftArt(data, size, size);
    expect(at(data, size, 0, 0)[3]).toBe(0);
    expect(at(data, size, 19, 10)[3]).toBe(0);
    expect(at(data, size, 9, 9)).toEqual([br, bg, bb, 255]);
    expect(at(data, size, 6, 9)).toEqual([240, 180, 60, 255]);
  });

  it("makes a soft glow on the backdrop translucent and takes the navy back out of it", () => {
    const width = 3;
    // A faint violet glow over the backdrop (between the cut and keep distances).
    const glow: [number, number, number] = [br + 24, bg + 14, bb + 30];
    const data = image(width, 1, (x) => (x === 1 ? [...glow, 255] : [br, bg, bb, 255]));
    cutOutGiftArt(data, width, 1);
    const [r, g, b, a] = at(data, width, 1, 0);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
    // Un-blended: brighter than the stored pixel, towards the glow's own colour.
    expect(r).toBeGreaterThan(glow[0]);
    expect(b).toBeGreaterThanOrEqual(glow[2]);
    expect(g).toBeGreaterThanOrEqual(0);
  });

  it("keeps the icon's own edge fade, and anything far from the backdrop fully", () => {
    const width = 4;
    const data = image(width, 1, (x) => (x === 0 ? [br, bg, bb, 120] : x === 3 ? [255, 255, 255, 200] : [255, 255, 255, 255]));
    cutOutGiftArt(data, width, 1);
    expect(at(data, width, 0, 0)[3]).toBe(0);
    expect(at(data, width, 1, 0)).toEqual([255, 255, 255, 255]);
    expect(at(data, width, 3, 0)[3]).toBe(200);
    expect(CUTOUT_PRESETS.standard.hi).toBeGreaterThan(0);
  });

  it("cuts warm dark glow (the Level Up wings' maroon) harder than cool dark art with the badge preset", () => {
    const width = 3;
    // A maroon glow pixel and a dark purple art pixel, both reachable from the border.
    const maroon: [number, number, number, number] = [60, 30, 40, 255];
    const purple: [number, number, number, number] = [40, 30, 80, 255];
    const run = (px: [number, number, number, number]) => {
      const data = image(width, 1, (x) => (x === 1 ? px : [br, bg, bb, 255]));
      cutOutGiftArt(data, width, 1, { ...CUTOUT_PRESETS.badge, speck: 0, soften: false });
      return at(data, width, 1, 0)[3];
    };
    expect(run(maroon)).toBe(0);
    expect(run(purple)).toBeGreaterThan(0);
  });

  it("removes small specks floating around the art and keeps the art itself", () => {
    const size = 40;
    const data = image(size, size, (x, y) => {
      if (x >= 10 && x < 30 && y >= 10 && y < 30) return [240, 200, 80, 255];
      if (x === 3 && y === 3) return [200, 220, 255, 255];
      return [br, bg, bb, 255];
    });
    cutOutGiftArt(data, size, size, { ...CUTOUT_PRESETS.frame, soften: false });
    expect(at(data, size, 3, 3)[3]).toBe(0);
    expect(at(data, size, 20, 20)).toEqual([240, 200, 80, 255]);
  });

  it("with a seal, the fill can't slip through a 1px gap in an outline into the dark inside it", () => {
    const size = 30;
    // A bright ring (5..24) with a 1px gap at the top, enclosing a backdrop-dark centre.
    const data = image(size, size, (x, y) => {
      const ring = Math.max(Math.abs(x - 14.5), Math.abs(y - 14.5));
      if (ring >= 7 && ring < 10 && !(x === 14 && y < 15)) return [240, 200, 80, 255];
      if (ring < 7) return [30, 20, 60, 255];
      return [br, bg, bb, 255];
    });
    const sealed = data.slice();
    cutOutGiftArt(sealed, size, size, { ...CUTOUT_PRESETS.frame, speck: 0, soften: false });
    expect(at(sealed, size, 14, 16)[3]).toBe(255);
    // Without the seal the fill does get in.
    const open = data.slice();
    cutOutGiftArt(open, size, size, { ...CUTOUT_PRESETS.frame, seal: 0, speck: 0, soften: false });
    expect(at(open, size, 14, 16)[3]).toBeLessThan(255);
  });

  it("softens the cut edge without bringing the backdrop's navy back into it", () => {
    const size = 20;
    const data = image(size, size, (x) => (x >= 10 ? [240, 200, 80, 255] : [br, bg, bb, 255]));
    cutOutGiftArt(data, size, size, { ...CUTOUT_PRESETS.frame, speck: 0 });
    const [r, g, b, a] = at(data, size, 9, 10);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
    // The newly visible edge pixel carries the art's colour, not navy.
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(120);
    expect(g).toBeGreaterThan(150);
  });

  it("scales the px-based settings for an icon cut at a larger size", () => {
    expect(scaledCutout(CUTOUT_PRESETS.frame, 2)).toMatchObject({ seal: 4, speck: 160, reach: CUTOUT_PRESETS.frame.reach });
    expect(CUTOUT_UPSCALE).toBe(2);
  });

  it("refuses a buffer that doesn't match its size, and is pure (no DOM, no network)", () => {
    expect(() => cutOutGiftArt(new Uint8ClampedArray(12), 2, 2)).toThrow();
    const src = readFileSync(path.join(process.cwd(), "src/lib/gift-art-cutout.ts"), "utf8");
    expect(src).not.toMatch(/document\.|window\.|fetch\(|Math\.random/);
  });
});
