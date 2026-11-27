import { describe, expect, it } from "vitest";
import { giftEffectPlan, giftRevealTimeline } from "@/lib/gift-effect-plan";
import {
  LEGENDARY_ACTIVE_MS,
  LEGENDARY_ARRIVAL_MS,
  LEGENDARY_FALL,
  LEGENDARY_PETALS,
  LEGENDARY_PULSE_MS,
  LEGENDARY_SETTLE_MS,
  LEGENDARY_SPARKLES,
  LEGENDARY_YAW_DEG,
  legendaryCameraPose,
  legendaryHitMs,
  legendaryLevels,
  legendaryPetalPose,
  legendaryPulse,
  legendarySceneNeedsFrames,
  legendaryScenePlan,
  legendarySweep,
  seededRandom,
  type LegendaryVariant,
} from "@/lib/gift-legendary-plan";

const VARIANTS: LegendaryVariant[] = ["rose", "orchid", "jewelry"];
const fullEffect = giftEffectPlan("LEGENDARY", { reduce: false, lowEnd: false });
const HIT = legendaryHitMs(fullEffect);
const samples = (endMs: number, step = 250) => Array.from({ length: Math.floor(endMs / step) + 1 }, (_, i) => i * step);

describe("legendaryScenePlan", () => {
  it("is deterministic: the same input gives the same plan, and the seeded generator repeats", () => {
    for (const variant of VARIANTS) {
      expect(legendaryScenePlan(variant, { lowEnd: false, hitMs: HIT })).toEqual(legendaryScenePlan(variant, { lowEnd: false, hitMs: HIT }));
    }
    const a = seededRandom(42);
    const b = seededRandom(42);
    const first = Array.from({ length: 20 }, () => a());
    expect(Array.from({ length: 20 }, () => b())).toEqual(first);
    for (const n of first) expect(n >= 0 && n < 1).toBe(true);
    // Rose and orchid fall differently.
    expect(legendaryScenePlan("rose", { lowEnd: false, hitMs: HIT }).petals[0]).not.toEqual(legendaryScenePlan("orchid", { lowEnd: false, hitMs: HIT }).petals[0]);
  });

  it("bounds what it draws: 40 petals / 90 sparkles in full, 14 / 30 on a low-end device, both in front and behind", () => {
    for (const variant of VARIANTS) {
      for (const lowEnd of [false, true]) {
        const plan = legendaryScenePlan(variant, { lowEnd, hitMs: HIT });
        expect(plan.petals).toHaveLength(lowEnd ? LEGENDARY_PETALS.lowEnd : LEGENDARY_PETALS.full);
        expect(plan.sparkles).toHaveLength(lowEnd ? LEGENDARY_SPARKLES.lowEnd : LEGENDARY_SPARKLES.full);
        expect(LEGENDARY_PETALS.full).toBe(40);
        expect(LEGENDARY_PETALS.lowEnd).toBe(14);
        for (const set of [plan.petals, plan.sparkles]) {
          expect(set.some((p) => p.side === "front")).toBe(true);
          expect(set.some((p) => p.side === "back")).toBe(true);
          for (const p of set) expect(Math.sign(p.z)).toBe(p.side === "front" ? 1 : -1);
        }
        expect(plan.ribbon.tubularSegments).toBe(lowEnd ? 120 : 240);
      }
    }
  });

  it("keeps every petal and sparkle within the scene, small and slow", () => {
    for (const variant of VARIANTS) {
      const plan = legendaryScenePlan(variant, { lowEnd: false, hitMs: HIT });
      for (const p of plan.petals) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(0.8);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(0.85);
        expect(p.scale).toBeGreaterThan(0.03);
        expect(p.scale).toBeLessThan(0.09);
        // A whole fall takes at least ~16 s.
        expect((LEGENDARY_FALL.top - LEGENDARY_FALL.bottom) / p.fallSpeed).toBeGreaterThan(16);
        for (const spin of p.spin) expect(Math.abs(spin)).toBeLessThanOrEqual(1.1);
      }
      for (const s of plan.sparkles) {
        expect(Math.abs(s.x)).toBeLessThanOrEqual(0.85);
        expect(s.size).toBeGreaterThanOrEqual(5);
        expect(s.size).toBeLessThanOrEqual(12);
      }
    }
  });

  it("times: the hit is the reveal's name step, the active window then the settle, low-end shorter", () => {
    expect(HIT).toBe(giftRevealTimeline(fullEffect, { hasMessage: true }).steps.find((s) => s.step === "name")!.delayMs);
    expect(HIT).toBeGreaterThan(LEGENDARY_ARRIVAL_MS[1]);
    const full = legendaryScenePlan("rose", { lowEnd: false, hitMs: HIT });
    const low = legendaryScenePlan("rose", { lowEnd: true, hitMs: HIT });
    expect(full.hitMs).toBe(HIT);
    expect(full.activeMs).toBe(LEGENDARY_ACTIVE_MS.full);
    expect(full.endMs).toBe(LEGENDARY_ACTIVE_MS.full + LEGENDARY_SETTLE_MS);
    expect(low.endMs).toBe(LEGENDARY_ACTIVE_MS.lowEnd + LEGENDARY_SETTLE_MS);
    expect(low.endMs).toBeLessThan(full.endMs);
    expect(full.pulseMs).toBe(LEGENDARY_PULSE_MS);
    expect(legendaryScenePlan("rose", { lowEnd: false, hitMs: -5 }).hitMs).toBe(0);
  });
});

describe("the camera", () => {
  const plan = legendaryScenePlan("rose", { lowEnd: false, hitMs: HIT });

  it("holds the poster's pose until the picture has arrived (no jump when it takes over)", () => {
    for (const t of [0, 500, LEGENDARY_ARRIVAL_MS[0], LEGENDARY_ARRIVAL_MS[1]]) {
      expect(legendaryCameraPose(plan, t)).toEqual({ distance: 1, yaw: 0, pitch: 0 });
    }
  });

  it("pushes in slowly and only ever closer, sways within +-10 degrees and comes to rest", () => {
    let last = 1;
    let maxYaw = 0;
    for (const t of samples(plan.endMs + 2000, 50)) {
      const pose = legendaryCameraPose(plan, t);
      expect(pose.distance).toBeLessThanOrEqual(last + 1e-12);
      expect(pose.distance).toBeGreaterThanOrEqual(0.84 - 1e-9);
      last = pose.distance;
      maxYaw = Math.max(maxYaw, Math.abs(pose.yaw));
      expect(Math.abs(pose.yaw)).toBeLessThanOrEqual((LEGENDARY_YAW_DEG * Math.PI) / 180 + 1e-9);
      expect(Math.abs(pose.pitch)).toBeLessThanOrEqual((2.5 * Math.PI) / 180 + 1e-9);
    }
    // It really sways (close to the full 10 degrees at some point).
    expect(maxYaw).toBeGreaterThan((8 * Math.PI) / 180);
    const rest = legendaryCameraPose(plan, plan.endMs);
    expect(Math.abs(rest.yaw)).toBeLessThan(1e-9);
    expect(Math.abs(rest.pitch)).toBeLessThan(1e-9);
  });

  it("moves smoothly: no sudden step between frames 50 ms apart", () => {
    let prev = legendaryCameraPose(plan, 0);
    for (const t of samples(plan.endMs, 50).slice(1)) {
      const pose = legendaryCameraPose(plan, t);
      expect(Math.abs(pose.yaw - prev.yaw)).toBeLessThan(0.005);
      expect(Math.abs(pose.distance - prev.distance)).toBeLessThan(0.002);
      prev = pose;
    }
  });
});

describe("petals", () => {
  const plan = legendaryScenePlan("rose", { lowEnd: false, hitMs: HIT });

  it("fall downwards and loop, sized 0 at both ends of the fall, tumbling as they go", () => {
    const petal = plan.petals[0];
    const a = legendaryPetalPose(plan, petal, 5000, 1);
    const b = legendaryPetalPose(plan, petal, 5100, 1);
    const wrapped = b.y > a.y;
    if (!wrapped) expect(b.y).toBeLessThan(a.y);
    expect(b.rx).not.toBe(a.rx);
    for (const t of samples(60000, 100)) {
      const pose = legendaryPetalPose(plan, petal, t, 1);
      expect(pose.y).toBeLessThanOrEqual(LEGENDARY_FALL.top + 1e-9);
      expect(pose.y).toBeGreaterThanOrEqual(LEGENDARY_FALL.bottom - 1e-9);
      expect(pose.scale).toBeLessThanOrEqual(petal.scale);
      expect(pose.scale).toBeGreaterThanOrEqual(0);
      if (Math.abs(pose.y - LEGENDARY_FALL.top) < 1e-6 || Math.abs(pose.y - LEGENDARY_FALL.bottom) < 1e-6) expect(pose.scale).toBe(0);
    }
  });

  it("are gone before the entrance and after the settle", () => {
    for (const t of [0, 800, plan.endMs, plan.endMs + 10000]) {
      expect(legendaryLevels(plan, t).petals).toBe(0);
      expect(legendaryLevels(plan, t).sparkles).toBe(0);
      for (const petal of plan.petals) expect(legendaryPetalPose(plan, petal, t, legendaryLevels(plan, t).petals).scale).toBe(0);
    }
  });
});

describe("levels, sweep and pulse", () => {
  it("the picture fades in over the arrival and stays; ribbon and glow settle dimmer, never off", () => {
    for (const variant of VARIANTS) {
      const plan = legendaryScenePlan(variant, { lowEnd: false, hitMs: HIT });
      expect(legendaryLevels(plan, 0).art).toBe(0);
      expect(legendaryLevels(plan, LEGENDARY_ARRIVAL_MS[1]).art).toBe(1);
      expect(legendaryLevels(plan, plan.endMs + 5000).art).toBe(1);
      const rest = legendaryLevels(plan, plan.endMs);
      expect(rest.ribbon).toBeCloseTo(0.35, 5);
      expect(rest.glow).toBeCloseTo(0.6, 5);
      for (const t of samples(plan.endMs + 2000)) {
        for (const level of Object.values(legendaryLevels(plan, t))) {
          expect(level).toBeGreaterThanOrEqual(0);
          expect(level).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("the orchid's shimmer sweeps more often and brighter than the rose's, and only while active", () => {
    const rose = legendaryScenePlan("rose", { lowEnd: false, hitMs: HIT });
    const orchid = legendaryScenePlan("orchid", { lowEnd: false, hitMs: HIT });
    const count = (plan: typeof rose) => samples(plan.activeMs, 100).filter((t) => legendarySweep(plan, t) !== null).length;
    expect(count(orchid)).toBeGreaterThan(count(rose));
    expect(orchid.look.sweepStrength).toBeGreaterThan(rose.look.sweepStrength);
    expect(legendarySweep(orchid, 0)).toBeNull();
    expect(legendarySweep(orchid, orchid.activeMs)).toBeNull();
    for (const t of samples(orchid.activeMs, 100)) {
      const s = legendarySweep(orchid, t);
      if (s !== null) {
        expect(s).toBeGreaterThanOrEqual(-0.4);
        expect(s).toBeLessThanOrEqual(2);
      }
    }
  });

  it("a pulse lasts its window, grows outward and fades; the latest one wins", () => {
    const plan = legendaryScenePlan("orchid", { lowEnd: false, hitMs: HIT });
    expect(legendaryPulse(plan, [HIT], HIT - 1)).toBeNull();
    expect(legendaryPulse(plan, [HIT], HIT + plan.pulseMs)).toBeNull();
    let lastRadius = 0;
    for (let t = HIT; t < HIT + plan.pulseMs; t += 100) {
      const p = legendaryPulse(plan, [HIT], t)!;
      expect(p.radius).toBeGreaterThanOrEqual(lastRadius);
      expect(p.alpha).toBeGreaterThanOrEqual(0);
      expect(p.alpha).toBeLessThanOrEqual(0.9);
      lastRadius = p.radius;
    }
    expect(legendaryPulse(plan, [HIT, 60000], 60000 + 10)!.radius).toBeLessThan(0.2);
  });

  it("draws frames until settled, then only for a pulse (the climax wakes it)", () => {
    const plan = legendaryScenePlan("rose", { lowEnd: false, hitMs: HIT });
    expect(legendarySceneNeedsFrames(plan, 0, [HIT])).toBe(true);
    expect(legendarySceneNeedsFrames(plan, plan.endMs - 1, [HIT])).toBe(true);
    expect(legendarySceneNeedsFrames(plan, plan.endMs, [HIT])).toBe(false);
    const climax = 70000;
    expect(legendarySceneNeedsFrames(plan, climax + 100, [HIT, climax])).toBe(true);
    expect(legendarySceneNeedsFrames(plan, climax + plan.pulseMs, [HIT, climax])).toBe(false);
  });
});

describe("the Diamond Jewelry Gift Box", () => {
  const plan = legendaryScenePlan("jewelry", { lowEnd: false, hitMs: HIT });

  it("floats small diamonds up (never down), with a gold orbit and the pulse ring at the box's base", () => {
    expect(plan.look.particle).toBe("diamond");
    expect(plan.look.drift).toBe("rise");
    expect(legendaryScenePlan("rose", { lowEnd: false, hitMs: HIT }).look.drift).toBe("fall");
    for (const p of plan.petals.slice(0, 8)) {
      let last = -Infinity;
      let wrapped = 0;
      for (const t of samples(20000, 100)) {
        const y = legendaryPetalPose(plan, p, t, 1).y;
        if (y < last) wrapped++;
        last = y;
      }
      // Only the loop's restart at the bottom ever moves one down.
      expect(wrapped).toBeLessThanOrEqual(2);
    }
    expect(plan.look.baseY).toBeLessThan(0);
  });
});
