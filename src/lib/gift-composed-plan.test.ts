import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPOSED_SPIN,
  COMPOSED_VARIANTS,
  CRYSTAL_PLANE,
  KITTEN_BOX,
  KITTEN_FLIGHT_MS,
  KITTEN_JUMP_AFTER_HIT_MS,
  KITTEN_LAND,
  SPIN_RAMP_MS,
  TWIN_HEARTS_REST,
  crystalPose,
  crystalRestY,
  engraveGlint,
  kittenPose,
  spinAngle,
  twinHeartPose,
  FRAME_PLANE,
  FRAME_START,
  GEM_GIRDLE,
  GEM_TABLE,
  badgePose,
  composedObjectPose,
  composedPulse,
  composedScenePlan,
  composedSceneNeedsFrames,
  frameBottom,
  framePose,
  gemCrownY,
  lidAngle,
  sweepReveal,
  type ComposedVariant,
} from "@/lib/gift-composed-plan";

// The composed 3D reveals (Keepsake Locket's gold heart, Fireworks from the opened box, Level Up on the gold star, the
// Aurora Sweep across the gem, the Aurora Frame on it): determinism, timing against the reveal's hit, the no-bounce
// rule for every travel (each one moves one way only), the frame never passing through the gem, and the scene
// stopping once it has settled.

const HITS = { EPIC: 1190, LEGENDARY: 2180 };
const plans = () =>
  COMPOSED_VARIANTS.flatMap((variant) =>
    [false, true].flatMap((lowEnd) => Object.values(HITS).map((hitMs) => [variant, composedScenePlan(variant, { lowEnd, hitMs })] as const)),
  );
const times = (endMs: number, step = 17) => Array.from({ length: Math.ceil(endMs / step) + 1 }, (_, i) => i * step);
const monotonic = (values: number[]) => {
  const up = values.every((v, i) => i === 0 || v >= values[i - 1] - 1e-9);
  const down = values.every((v, i) => i === 0 || v <= values[i - 1] + 1e-9);
  return up || down;
};

describe("the plan", () => {
  it("is deterministic and never reaches for Math.random, the clock or the DOM", () => {
    for (const variant of COMPOSED_VARIANTS) {
      expect(JSON.stringify(composedScenePlan(variant, { lowEnd: false, hitMs: 1190 }))).toBe(
        JSON.stringify(composedScenePlan(variant, { lowEnd: false, hitMs: 1190 })),
      );
    }
    const src = readFileSync(path.join(process.cwd(), "src/lib/gift-composed-plan.ts"), "utf8");
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|window\.|document\.|navigator\./);
  });

  it("the moment lands on the reveal's hit or after it, after the object has arrived, and everything ends", () => {
    for (const [variant, plan] of plans()) {
      expect(plan.momentMs, variant).toBeGreaterThanOrEqual(plan.hitMs);
      expect(plan.entranceMs[1], variant).toBeLessThanOrEqual(plan.momentMs);
      expect(plan.endMs, variant).toBe(plan.activeMs + plan.settleMs);
      // A spinning variant keeps drawing while the reveal is open; every other one stops once settled.
      expect(composedSceneNeedsFrames(plan, plan.endMs + 4000), variant).toBe(COMPOSED_SPIN[variant] !== undefined);
      expect(composedSceneNeedsFrames(plan, 0), variant).toBe(true);
    }
  });

  it("the object rises and grows in without overshooting, then sways and comes back to rest facing the camera", () => {
    for (const [variant, plan] of plans()) {
      const entrance = times(plan.entranceMs[1]).map((t) => composedObjectPose(plan, t));
      expect(monotonic(entrance.map((p) => p.y)), variant).toBe(true);
      expect(monotonic(entrance.map((p) => p.scale)), variant).toBe(true);
      const rest = composedObjectPose(plan, plan.endMs + 1000);
      expect(Math.abs(rest.pitch), variant).toBeLessThan(1e-9);
      if (COMPOSED_SPIN[variant]) continue;
      expect(Math.abs(rest.yaw), variant).toBeLessThan(1e-9);
      for (const t of times(plan.endMs, 97)) {
        const p = composedObjectPose(plan, t);
        expect(p.scale, variant).toBeLessThanOrEqual(composedObjectPose(plan, plan.endMs).scale + 1e-9);
        if (t >= plan.entranceMs[1]) expect(Math.abs(p.yaw), variant).toBeLessThanOrEqual(0.56);
      }
    }
  });
});

describe("Fireworks", () => {
  it("the lid only opens (it never swings back) and is open before the first rocket leaves the box", () => {
    const plan = composedScenePlan("fireworks-box", { lowEnd: false, hitMs: 1190 });
    const angles = times(plan.endMs).map((t) => lidAngle(plan, t));
    expect(monotonic(angles)).toBe(true);
    expect(Math.abs(lidAngle(plan, 0))).toBe(0);
    expect(lidAngle(plan, plan.fireworks[0].launchMs)).toBeLessThan(-1.8);
  });

  it("rockets launch from the box after it has arrived; the first burst is the moment; all burst inside the active time", () => {
    for (const lowEnd of [false, true]) {
      const plan = composedScenePlan("fireworks-box", { lowEnd, hitMs: 1190 });
      expect(plan.fireworks.length).toBe(lowEnd ? 4 : 9);
      expect(plan.fireworks[0].burstMs).toBe(plan.momentMs);
      for (const f of plan.fireworks) {
        expect(f.launchMs).toBeGreaterThan(plan.entranceMs[1]);
        expect(f.burstMs).toBeGreaterThan(f.launchMs);
        expect(f.burstMs + plan.burstLifeMs).toBeLessThanOrEqual(plan.activeMs);
        expect(f.y).toBeGreaterThan(0);
      }
    }
  });

  it("no other variant has fireworks", () => {
    for (const variant of COMPOSED_VARIANTS.filter((v) => v !== "fireworks-box")) {
      expect(composedScenePlan(variant, { lowEnd: false, hitMs: 1190 }).fireworks).toEqual([]);
    }
  });
});

describe("Level Up on the star", () => {
  it("the badge comes in from in front and settles flat on the star's face on the moment, one way only", () => {
    const plan = composedScenePlan("star-badge", { lowEnd: false, hitMs: 1190 });
    const poses = times(plan.endMs).map((t) => badgePose(plan, t));
    expect(monotonic(poses.map((p) => p.z))).toBe(true);
    expect(monotonic(poses.map((p) => p.scale))).toBe(true);
    expect(badgePose(plan, plan.momentMs)).toEqual({ z: 0, scale: 1, opacity: 1 });
    expect(composedPulse(plan, plan.momentMs + 100)).not.toBeNull();
  });
});

describe("Aurora Sweep on the gem", () => {
  it("is drawn on one way only and complete on the moment", () => {
    const plan = composedScenePlan("gem-sweep", { lowEnd: false, hitMs: 2180 });
    const values = times(plan.endMs).map((t) => sweepReveal(plan, t));
    expect(monotonic(values)).toBe(true);
    expect(sweepReveal(plan, 0)).toBe(0);
    expect(sweepReveal(plan, plan.momentMs)).toBe(1);
  });
});

describe("Aurora Frame on the gem", () => {
  const variants: ComposedVariant[] = ["gem-frame"];
  it.each(variants)("rises up (y only grows), moves back onto the gem (z only shrinks) and stands on its table", (variant) => {
    for (const hitMs of Object.values(HITS)) {
      const plan = composedScenePlan(variant, { lowEnd: false, hitMs });
      const poses = times(plan.endMs, 5).map((t) => framePose(plan, t));
      expect(monotonic(poses.map((p) => p.y))).toBe(true);
      expect(monotonic(poses.map((p) => p.z))).toBe(true);
      const rest = framePose(plan, plan.momentMs);
      expect(rest.z).toBe(0);
      expect(frameBottom(rest)).toBeGreaterThanOrEqual(GEM_TABLE.y);
      expect(frameBottom(rest)).toBeLessThan(GEM_TABLE.y + 0.01);
      expect(framePose(plan, plan.endMs + 5000)).toEqual(rest);
    }
  });

  it("never passes through the gem: wherever the frame is over the gem, its bottom is above the crown there", () => {
    expect(FRAME_START.z).toBeGreaterThan(GEM_GIRDLE.radius);
    for (const hitMs of Object.values(HITS)) {
      const plan = composedScenePlan("gem-frame", { lowEnd: false, hitMs });
      for (const t of times(plan.momentMs + 100, 2)) {
        const pose = framePose(plan, t);
        const crown = gemCrownY(Math.abs(pose.z));
        // The frame plane spans the gem's width, so at depth z it is over the crown wherever the crown reaches that far.
        expect(frameBottom(pose), `t=${t} z=${pose.z}`).toBeGreaterThanOrEqual(crown - 1e-3);
      }
    }
    expect(FRAME_PLANE.size).toBeGreaterThan(0);
  });
});

describe("Trophy Frame and Sunset Postcard: the continuous spin", () => {
  it("turns one way only, comes up to speed smoothly and then holds a constant speed for as long as it is open", () => {
    for (const variant of ["trophy", "postcard-box"] as const) {
      const plan = composedScenePlan(variant, { lowEnd: false, hitMs: 1190 });
      const speed = COMPOSED_SPIN[variant]!;
      const angles = times(60000, 50).map((t) => spinAngle(plan, t));
      expect(monotonic(angles)).toBe(true);
      expect(spinAngle(plan, 0)).toBe(0);
      // Smooth start (no jump in speed) and constant speed after the ramp.
      expect(spinAngle(plan, 20)).toBeLessThan(speed * 20 * 0.01);
      expect(spinAngle(plan, SPIN_RAMP_MS + 2000) - spinAngle(plan, SPIN_RAMP_MS + 1000)).toBeCloseTo(speed * 1000, 9);
      expect(spinAngle(plan, 50000) - spinAngle(plan, 49000)).toBeCloseTo(speed * 1000, 9);
      expect(composedSceneNeedsFrames(plan, 120000)).toBe(true);
    }
    expect(Object.keys(COMPOSED_SPIN).sort()).toEqual(["postcard-box", "trophy"]);
  });
});

describe("Playful Kitten: the jump out of the box", () => {
  const plan = composedScenePlan("kitten-box", { lowEnd: false, hitMs: 1190 });
  it("leaves the box after the hit with the lid fully open, on a parabola, and lands exactly on the floor without bouncing", () => {
    expect(plan.momentMs).toBe(1190 + KITTEN_JUMP_AFTER_HIT_MS);
    expect(lidAngle(plan, plan.momentMs)).toBeLessThan(-1.8);
    const jump = plan.momentMs;
    const land = jump + KITTEN_FLIGHT_MS;
    const path = times(plan.endMs, 5).map((t) => kittenPose(plan, t));
    // Horizontal travel one way only.
    expect(monotonic(path.map((p) => p.x))).toBe(true);
    expect(monotonic(path.map((p) => p.z))).toBe(true);
    // Height: up then down once in the air (a single arc), then never off the floor again.
    const air = times(land - jump, 5).map((dt) => kittenPose(plan, jump + dt).y);
    const top = air.indexOf(Math.max(...air));
    expect(monotonic(air.slice(0, top + 1))).toBe(true);
    expect(monotonic(air.slice(top))).toBe(true);
    for (let t = land; t < plan.endMs + 2000; t += 37) expect(kittenPose(plan, t).y).toBeCloseTo(KITTEN_LAND.y, 9);
    expect(kittenPose(plan, jump).y).toBeCloseTo(KITTEN_BOX.floorY, 9);
    // It clears the box's front wall: wherever it is over the wall or in front of it, still within the box's width,
    // its feet are above the rim.
    for (let t = jump; t <= land; t += 5) {
      const p = kittenPose(plan, t);
      if (p.z >= KITTEN_BOX.z + 0.65 && p.x <= KITTEN_BOX.x + 0.65) expect(p.y, `t=${t}`).toBeGreaterThan(KITTEN_BOX.rimY);
    }
  });

  it("is hidden until the lid starts to open, sits after landing, and its stretch stays in range", () => {
    expect(kittenPose(plan, 0).visible).toBe(false);
    expect(kittenPose(plan, plan.momentMs).visible).toBe(true);
    for (const t of times(plan.endMs, 7)) {
      const p = kittenPose(plan, t);
      expect(p.stretch).toBeGreaterThanOrEqual(-1);
      expect(p.stretch).toBeLessThanOrEqual(1);
    }
    expect(kittenPose(plan, plan.endMs + 1000).stretch).toBe(0);
  });
});

describe("Kindred Spirit: the two hearts", () => {
  it("fly in from opposite sides (one way each) and rest overlapping in view but apart in depth", () => {
    const plan = composedScenePlan("twin-hearts", { lowEnd: false, hitMs: 1190 });
    for (const i of [0, 1] as const) {
      const xs = times(plan.momentMs, 5).map((t) => twinHeartPose(plan, i, t).x);
      expect(monotonic(xs)).toBe(true);
      expect(twinHeartPose(plan, i, plan.momentMs).x).toBeCloseTo(TWIN_HEARTS_REST[i].x, 9);
    }
    expect(Math.sign(twinHeartPose(plan, 0, 0).x)).toBe(-1);
    expect(Math.sign(twinHeartPose(plan, 1, 0).x)).toBe(1);
    expect(Math.abs(TWIN_HEARTS_REST[0].z - TWIN_HEARTS_REST[1].z)).toBeGreaterThanOrEqual(0.4);
  });
});

describe("Supporter Star: the glint over the engraving", () => {
  it("runs across the face on the moment, then now and then, and stops with the settle", () => {
    const plan = composedScenePlan("star-engraved", { lowEnd: false, hitMs: 1190 });
    expect(engraveGlint(plan, plan.momentMs)).not.toBeNull();
    expect(engraveGlint(plan, 0)).toBeNull();
    expect(engraveGlint(plan, plan.activeMs + 10)).toBeNull();
  });
});

describe("Midnight Crystal on the gem", () => {
  it("floats slowly down (y only falls) and its base rests exactly on the gem's table, staying there", () => {
    for (const hitMs of Object.values(HITS)) {
      const plan = composedScenePlan("gem-crystal", { lowEnd: false, hitMs });
      expect(plan.momentMs - 250).toBeGreaterThanOrEqual(2500);
      const ys = times(plan.endMs, 5).map((t) => crystalPose(plan, t).y);
      expect(monotonic(ys)).toBe(true);
      const rest = crystalPose(plan, plan.momentMs);
      const base = rest.y - CRYSTAL_PLANE.size * (0.5 - CRYSTAL_PLANE.bottomInset);
      expect(base).toBeCloseTo(GEM_TABLE.y, 9);
      expect(rest.x).toBeCloseTo(0, 6);
      expect(crystalPose(plan, plan.endMs + 3000).y).toBeCloseTo(crystalRestY(), 9);
      // Never below its rest (it can't sink into the gem).
      for (const y of ys) expect(y).toBeGreaterThanOrEqual(crystalRestY() - 1e-9);
    }
  });
});
