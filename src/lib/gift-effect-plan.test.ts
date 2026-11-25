import { describe, expect, it } from "vitest";
import { GIFT_TIERS } from "@/lib/gifts-data";
import {
  GIFT_REVEAL_STEPS,
  giftEffectPlan,
  giftRevealArtSize,
  giftRevealSender,
  giftRevealTimeline,
  isLowEndDevice,
  sparkleSpots,
} from "@/lib/gift-effect-plan";

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

describe("giftRevealTimeline", () => {
  it("shows the lines in the spec's order, the note only when there is one", () => {
    const plan = giftEffectPlan("RARE", full);
    expect(giftRevealTimeline(plan, { hasMessage: true }).steps.map((s) => s.step)).toEqual([...GIFT_REVEAL_STEPS]);
    expect(giftRevealTimeline(plan, { hasMessage: false }).steps.map((s) => s.step)).toEqual([
      "header",
      "badge",
      "name",
      "sender",
      "actions",
    ]);
  });

  it("scales with the tier: Legendary starts last, unfolds slowest and is the only one with a name shine", () => {
    const lines = GIFT_TIERS.map((t) => giftRevealTimeline(giftEffectPlan(t, full), { hasMessage: true }));
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].steps[0].delayMs).toBeGreaterThan(lines[i - 1].steps[0].delayMs);
      expect(lines[i].doneMs).toBeGreaterThan(lines[i - 1].doneMs);
    }
    expect(lines.map((l) => l.nameShine)).toEqual([false, false, false, true]);
    // Legendary's words wait for the art, which arrives about 1s into its cinematic sequence.
    expect(lines[3].steps[0].delayMs).toBeGreaterThanOrEqual(1000);
    for (const line of lines) {
      const delays = line.steps.map((s) => s.delayMs);
      expect([...delays].sort((a, b) => a - b)).toEqual(delays);
    }
  });

  it("reduced motion: every line at once, one short fade, no shine", () => {
    for (const tier of GIFT_TIERS) {
      const line = giftRevealTimeline(giftEffectPlan(tier, { reduce: true, lowEnd: false }), { hasMessage: true });
      expect(line.steps.every((s) => s.delayMs === 0)).toBe(true);
      expect(line.textMs).toBeLessThanOrEqual(400);
      expect(line.nameShine).toBe(false);
    }
  });

  it("a low-end device: an earlier, tighter sequence, never longer than full motion, no shine", () => {
    for (const tier of GIFT_TIERS) {
      const heavy = giftRevealTimeline(giftEffectPlan(tier, full), { hasMessage: true });
      const light = giftRevealTimeline(giftEffectPlan(tier, { reduce: false, lowEnd: true }), { hasMessage: true });
      expect(light.steps[0].delayMs).toBeLessThanOrEqual(400);
      expect(light.doneMs).toBeLessThanOrEqual(heavy.doneMs);
      expect(light.nameShine).toBe(false);
    }
  });
});

describe("giftRevealSender", () => {
  it("prefers @username, then the display name, then someone; an award has no sender", () => {
    expect(giftRevealSender({ isAward: false, username: "ada", name: "Ada L." })).toEqual({ kind: "person", label: "@ada" });
    expect(giftRevealSender({ isAward: false, username: null, name: "Ada L." })).toEqual({ kind: "person", label: "Ada L." });
    expect(giftRevealSender({ isAward: false, username: "  ", name: " " })).toEqual({ kind: "someone" });
    expect(giftRevealSender({ isAward: false, username: null, name: null })).toEqual({ kind: "someone" });
    expect(giftRevealSender({ isAward: true, username: "ada", name: "Ada" })).toEqual({ kind: "award" });
  });
});

describe("giftRevealArtSize", () => {
  it("is large on a desktop, expanded on a tablet and smaller on a short phone", () => {
    expect(giftRevealArtSize({ width: 1440, height: 900 })).toBe(280);
    expect(giftRevealArtSize({ width: 820, height: 1180 })).toBe(240);
    expect(giftRevealArtSize({ width: 390, height: 844 })).toBe(190);
    expect(giftRevealArtSize({ width: 320, height: 568 })).toBe(150);
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
