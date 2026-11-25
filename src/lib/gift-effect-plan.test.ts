import { describe, expect, it } from "vitest";
import { GIFT_TIERS } from "@/lib/gifts-data";
import { giftEffectPlan, isLowEndDevice, sparkleSpots } from "@/lib/gift-effect-plan";

const full = { reduce: false, lowEnd: false };

describe("giftEffectPlan", () => {
  it("scales intensity with the tier", () => {
    const [c, r, e, l] = GIFT_TIERS.map((t) => giftEffectPlan(t, full));
    expect([c.halo, r.halo, e.halo, l.halo]).toEqual([false, true, true, true]);
    expect([c.sparkles, r.sparkles, e.sparkles, l.sparkles]).toEqual([0, 8, 12, 18]);
    expect([c.depthLayers, r.depthLayers, e.depthLayers, l.depthLayers]).toEqual([0, 0, 3, 3]);
    expect([c.cinematic, r.cinematic, e.cinematic, l.cinematic]).toEqual([false, false, false, true]);
    expect(c.durationMs).toBeLessThan(r.durationMs);
    expect(r.durationMs).toBeLessThan(e.durationMs);
    expect(e.durationMs).toBeLessThan(l.durationMs);
    for (const p of [c, r, e, l]) expect(p.motion).toBe("full");
  });

  it("reduced motion: still, every layer kept, no cinematic sequence, one short fade", () => {
    for (const tier of GIFT_TIERS) {
      const p = giftEffectPlan(tier, { reduce: true, lowEnd: true });
      expect(p.motion).toBe("still");
      expect(p.cinematic).toBe(false);
      expect(p.durationMs).toBeLessThanOrEqual(400);
      expect(p.sparkles).toBe(giftEffectPlan(tier, full).sparkles);
    }
  });

  it("a low-end device gets a lighter plan, never a heavier one", () => {
    for (const tier of GIFT_TIERS) {
      const heavy = giftEffectPlan(tier, full);
      const light = giftEffectPlan(tier, { reduce: false, lowEnd: true });
      expect(light.motion).toBe("light");
      expect(light.sparkles).toBeLessThanOrEqual(Math.min(4, heavy.sparkles));
      expect(light.depthLayers).toBeLessThanOrEqual(1);
      expect(light.cinematic).toBe(false);
      expect(light.durationMs).toBeLessThanOrEqual(heavy.durationMs);
      expect(light.halo).toBe(heavy.halo);
    }
  });
});

describe("sparkleSpots", () => {
  it("is deterministic, inside the stage, and the requested length", () => {
    const a = sparkleSpots(18);
    expect(a).toEqual(sparkleSpots(18));
    expect(a).toHaveLength(18);
    for (const s of a) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(100);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(100);
    }
    expect(sparkleSpots(0)).toEqual([]);
    expect(sparkleSpots(-3)).toEqual([]);
  });
});

describe("isLowEndDevice", () => {
  it("flags little memory, few cores or data-saver", () => {
    expect(isLowEndDevice({ deviceMemory: 2 })).toBe(true);
    expect(isLowEndDevice({ hardwareConcurrency: 2 })).toBe(true);
    expect(isLowEndDevice({ connection: { saveData: true } })).toBe(true);
    expect(isLowEndDevice({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
    expect(isLowEndDevice({})).toBe(false);
  });
});
