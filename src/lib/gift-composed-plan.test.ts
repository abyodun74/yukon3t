import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPOSED_VARIANTS,
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
      expect(composedSceneNeedsFrames(plan, plan.endMs + 4000), variant).toBe(false);
      expect(composedSceneNeedsFrames(plan, 0), variant).toBe(true);
    }
  });

  it("the object rises and grows in without overshooting, then sways and comes back to rest facing the camera", () => {
    for (const [variant, plan] of plans()) {
      const entrance = times(plan.entranceMs[1]).map((t) => composedObjectPose(plan, t));
      expect(monotonic(entrance.map((p) => p.y)), variant).toBe(true);
      expect(monotonic(entrance.map((p) => p.scale)), variant).toBe(true);
      const rest = composedObjectPose(plan, plan.endMs + 1000);
      expect(Math.abs(rest.yaw), variant).toBeLessThan(1e-9);
      expect(Math.abs(rest.pitch), variant).toBeLessThan(1e-9);
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
