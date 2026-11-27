import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POSTCARD_BOX, POSTCARD_WRAP_ASPECT, postcardWrapV } from "@/lib/gift-composed-plan";
import {
  CARVE_LEVEL,
  POSTCARD_CARVE,
  POSTCARD_CORNER_EASE,
  POSTCARD_HORIZON_ROW,
  POSTCARD_LID_EDGE_ROW,
  POSTCARD_PALMS,
  POSTCARD_SIDE_PX,
  POSTCARD_SUN,
  POSTCARD_WRAP_REPEAT,
  POSTCARD_WRAP_SIZE,
  blurHeight,
  carveMaps,
  drawPostcardLid,
  drawPostcardWrap,
  frondAngles,
  frondShape,
  sampleHeight,
  trunkPoint,
  type Ctx2D,
  type Palm,
} from "@/lib/gift-postcard-wrap";

// The Sunset Postcard carved round its 3D gift box: the owner's postcard redrawn as one periodic panorama (no seam, no
// ghost or mirrored palm, palms clear of the corners), drawn in colour and as a height map of deliberate levels, then
// turned into a bevelled height, a normal map and relief-shaded colour.

type Call = { op: string; args: unknown[]; ox: number; inCopy: boolean; style: string };

/** A Canvas 2D stand-in that records every call with the horizontal translation and fill/stroke style in force. */
function recorder(): { ctx: Ctx2D; calls: Call[] } {
  const calls: Call[] = [];
  const stack: number[] = [];
  let ox = 0;
  const gradient = { addColorStop: () => undefined } as unknown as CanvasGradient;
  const ctx = {
    fillStyle: "" as Ctx2D["fillStyle"],
    strokeStyle: "" as Ctx2D["strokeStyle"],
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    globalAlpha: 1,
    save: () => stack.push(ox),
    restore: () => {
      ox = stack.pop() ?? 0;
    },
    translate: (x: number) => {
      ox += x;
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  } as unknown as Ctx2D & Record<string, unknown>;
  for (const op of ["beginPath", "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "closePath", "arc", "ellipse", "fill", "stroke", "fillRect"]) {
    (ctx as Record<string, unknown>)[op] = (...args: unknown[]) => {
      const style = op === "stroke" ? String(ctx.strokeStyle) : op === "fill" || op === "fillRect" ? String(ctx.fillStyle) : "";
      calls.push({ op, args, ox, inCopy: stack.length > 0, style });
    };
  }
  return { ctx, calls };
}

/** Every point a palm is drawn through (trunk and fronds, px within its copy). */
function palmPoints(palm: Palm): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= 20; i++) points.push(trunkPoint(palm, i / 20));
  for (const f of frondAngles(palm)) {
    const { spine, leaflets } = frondShape(palm.crown, f.angle, f.length, f.droop);
    points.push(...spine, ...leaflets.flat());
  }
  return points;
}

describe("the carved postcard panorama", () => {
  it("has the box's proportions: the perimeter by the visible height, square pixels, one side = a quarter", () => {
    const { width, height } = POSTCARD_WRAP_SIZE;
    expect((width * POSTCARD_WRAP_REPEAT) / height).toBeCloseTo(POSTCARD_WRAP_ASPECT, 2);
    expect(POSTCARD_SIDE_PX * 4).toBe(width * POSTCARD_WRAP_REPEAT);
    expect(postcardWrapV(POSTCARD_BOX.bodyBottom)).toBe(0);
    expect(postcardWrapV(POSTCARD_BOX.lidTop)).toBe(1);
    // The horizon and the sun sit on the body, below the lid's lower edge.
    expect(POSTCARD_HORIZON_ROW).toBeGreaterThan(POSTCARD_LID_EDGE_ROW + 100);
    expect(POSTCARD_SUN.y - POSTCARD_SUN.r).toBeGreaterThan(POSTCARD_LID_EDGE_ROW);
  });

  it("is periodic: the scene is drawn exactly alike one width either side (no seam where the texture repeats)", () => {
    for (const pass of ["color", "height"] as const) {
      const { ctx, calls } = recorder();
      drawPostcardWrap(ctx, pass);
      const W = POSTCARD_WRAP_SIZE.width;
      const of = (ox: number) => calls.filter((c) => c.inCopy && c.ox === ox).map((c) => JSON.stringify([c.op, c.args, c.style]));
      expect(of(0).length).toBeGreaterThan(100);
      expect(of(-W)).toEqual(of(0));
      expect(of(W)).toEqual(of(0));
      expect(new Set(calls.filter((c) => c.inCopy).map((c) => c.ox))).toEqual(new Set([-W, 0, W]));
    }
  });

  it("keeps every palm clear of the box's corners and of each other (no palm cut by a corner, no overlapping palm)", () => {
    const margin = POSTCARD_CORNER_EASE * ((POSTCARD_WRAP_SIZE.width * POSTCARD_WRAP_REPEAT) / 5.2) + 20;
    const boxes = POSTCARD_PALMS.map((palm) => {
      const pts = palmPoints(palm);
      for (const [x] of pts) {
        // Within a copy (two sides), away from x = 0, the side boundary at 768 and the copy's end at 1536.
        for (const corner of [0, POSTCARD_SIDE_PX, 2 * POSTCARD_SIDE_PX]) expect(Math.abs(x - corner), `x ${x}`).toBeGreaterThan(margin);
      }
      const xs = pts.map(([x]) => x);
      const ys = pts.map(([, y]) => y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    expect(boxes[0].x1).toBeLessThan(boxes[1].x0);
    // The palms' crowns stay below the lid's lower edge (no palm is split by the lid's lip) and above the bottom border.
    for (const b of boxes) {
      expect(b.y0).toBeGreaterThan(POSTCARD_LID_EDGE_ROW);
      expect(b.y1).toBeLessThanOrEqual(POSTCARD_WRAP_SIZE.height);
    }
    // The big palm leans one way and the small one the other, as on the postcard (not a mirror of each other).
    expect(Math.sign(POSTCARD_PALMS[0].crown[0] - POSTCARD_PALMS[0].base[0])).toBe(-1);
    expect(Math.sign(POSTCARD_PALMS[1].crown[0] - POSTCARD_PALMS[1].base[0])).toBe(1);
  });

  it("carves deliberate levels: the height pass draws only greys, the palms highest, grooves below the sky", () => {
    const { ctx, calls } = recorder();
    drawPostcardWrap(ctx, "height");
    const greys = new Set(calls.filter((c) => c.op === "fill" || c.op === "stroke" || c.op === "fillRect").map((c) => c.style));
    for (const g of greys) expect(g).toMatch(/^rgb\((\d+),\1,\1\)$/);
    const level = (v: number) => `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`;
    for (const key of ["sky", "sea", "sun", "trunk", "frond", "shore", "border", "groove", "seaGroove"] as const) expect(greys.has(level(CARVE_LEVEL[key])), key).toBe(true);
    expect(CARVE_LEVEL.trunk).toBe(1);
    expect(CARVE_LEVEL.groove).toBeLessThan(CARVE_LEVEL.sky);
    expect(CARVE_LEVEL.seaGroove).toBeLessThan(CARVE_LEVEL.sea);
    expect(CARVE_LEVEL.sunRing).toBeLessThan(CARVE_LEVEL.sky);
    expect(CARVE_LEVEL.rib).toBeLessThan(CARVE_LEVEL.frond);
    const lid = recorder();
    drawPostcardLid(lid.ctx, "height");
    expect(lid.calls.some((c) => c.style === level(CARVE_LEVEL.sun))).toBe(true);
    expect(POSTCARD_CARVE.depth).toBeGreaterThan(0.03);
  });

  it("bevels the levels into a normal map and shades the recesses into the colour, wrapping round the strip", () => {
    const w = 40;
    const h = 20;
    const color = new Uint8ClampedArray(w * h * 4).fill(200);
    const height = new Uint8ClampedArray(w * h * 4);
    // A raised block that crosses the strip's end (x 34..39 and 0..5): the wrap must treat it as one block.
    for (let y = 5; y < 15; y++)
      for (let x = 0; x < w; x++) {
        const v = x >= 34 || x < 6 ? 255 : 40;
        height.set([v, v, v, 255], (y * w + x) * 4);
      }
    const maps = carveMaps(color, height, w, h, true);
    const at = (x: number, y: number) => maps.height[y * w + x];
    // Continuous across the strip's end: the two edge columns agree closely, and the block's top stays high.
    expect(Math.abs(at(0, 10) - at(w - 1, 10))).toBeLessThan(0.05);
    expect(at(1, 10)).toBeGreaterThan(0.8);
    // The bevel: the block's side walls tilt the normal (red channel away from 128) where the height falls.
    const n = (x: number, y: number) => maps.normal[(y * w + x) * 4];
    expect(Math.abs(n(6, 10) - 128)).toBeGreaterThan(40);
    expect(Math.abs(n(20, 10) - 128)).toBeLessThan(4);
    // The recess at the foot of the wall is shaded darker than the open field; the block's top edge a touch lighter.
    expect(maps.color[(10 * w + 8) * 4]).toBeLessThan(200);
    expect(maps.color[(10 * w + 20) * 4]).toBeGreaterThanOrEqual(190);
    // Wrapped sampling and blur.
    expect(sampleHeight(maps.height, w, h, 0, 0.5, true)).toBeCloseTo(sampleHeight(maps.height, w, h, 1, 0.5, true), 6);
    const ring = new Float32Array(w * h);
    ring[10 * w] = 1;
    const blurred = blurHeight(ring, w, h, 1, true);
    expect(blurred[10 * w + w - 1]).toBeGreaterThan(0);
  });

  it("is pure: no DOM, network or unseeded randomness", () => {
    const file = readFileSync(path.join(process.cwd(), "src/lib/gift-postcard-wrap.ts"), "utf8");
    expect(file).not.toMatch(/document\.|window\.|fetch\(|Math\.random/);
  });
});
