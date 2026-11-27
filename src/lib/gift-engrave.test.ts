import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENGRAVE, boxBlur, engraveMaps, heightToNormal } from "@/lib/gift-engrave";

// The relief maps that cut a gift's art into a 3D surface (the Supporter Star's engraving, the postcard box's paper).

const decode = (n: Uint8ClampedArray, i: number) => [(n[i * 4] - 127.5) / 127.5, (n[i * 4 + 1] - 127.5) / 127.5, (n[i * 4 + 2] - 127.5) / 127.5];

describe("heightToNormal", () => {
  it("is flat (straight up) on a flat height, and tilts away from a rise in the right directions", () => {
    const w = 5;
    const flat = heightToNormal(new Float32Array(w * w), w, w, 4);
    expect(decode(flat, 12).map((v) => Math.round(v * 100) / 100)).toEqual([0, 0, 1]);
    // Height rising to the right: the normal leans left (-x).
    const ramp = new Float32Array(w * w).map((_, i) => (i % w) * 0.1);
    expect(decode(heightToNormal(ramp, w, w, 4), 12)[0]).toBeLessThan(0);
    // Height rising up the texture (towards row 0, which is v = 1): the normal leans to -v.
    const up = new Float32Array(w * w).map((_, i) => (w - 1 - Math.floor(i / w)) * 0.1);
    expect(decode(heightToNormal(up, w, w, 4), 12)[1]).toBeLessThan(0);
  });

  it("wraps across the left and right edges when asked (a texture that goes round the box)", () => {
    const w = 6;
    const h = new Float32Array(w).map((_, x) => (x === 0 ? 1 : 0));
    expect(decode(heightToNormal(h, w, 1, 4, true), w - 1)[0]).toBeLessThan(0);
    expect(Math.abs(decode(heightToNormal(h, w, 1, 4, false), w - 1)[0])).toBeLessThan(0.01);
  });
});

describe("engraveMaps", () => {
  it("cuts the art's silhouette in (sloped walls), leaves plain metal outside, and makes the cut satin and a little darker", () => {
    const size = 64;
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const inside = Math.abs(x - 32) < 14 && Math.abs(y - 32) < 14;
        rgba.set(inside ? [230, 160, 60, 255] : [0, 0, 0, 0], (y * size + x) * 4);
      }
    const maps = engraveMaps(rgba, size, size);
    const at = (x: number, y: number) => y * size + x;
    // Outside: flat normal, white tone, polished.
    expect(decode(maps.normal, at(2, 2))[2]).toBeCloseTo(1, 2);
    expect([...maps.color.slice(at(2, 2) * 4, at(2, 2) * 4 + 3)]).toEqual([255, 255, 255]);
    expect(maps.roughness[at(2, 2) * 4 + 1]).toBe(Math.round(255 * ENGRAVE.polished));
    // On the left wall the surface drops into the cut (going right): the normal leans right (+x).
    expect(decode(maps.normal, at(18, 32))[0]).toBeGreaterThan(0.2);
    // Inside: satin, and toned.
    expect(maps.roughness[at(32, 32) * 4 + 1]).toBe(Math.round(255 * ENGRAVE.satin));
    expect(maps.color[at(32, 32) * 4]).toBeLessThan(255);
  });

  it("refuses a buffer that doesn't match its size, and is pure", () => {
    expect(() => engraveMaps(new Uint8ClampedArray(8), 2, 2)).toThrow();
    expect(boxBlur(new Float32Array([0, 0, 3, 0, 0]), 5, 1, 1)[2]).toBeCloseTo(1, 6);
    const src = readFileSync(path.join(process.cwd(), "src/lib/gift-engrave.ts"), "utf8");
    expect(src).not.toMatch(/document\.|window\.|fetch\(|Math\.random/);
  });
});
