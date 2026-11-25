import type { GiftTierName } from "@/lib/gifts-data";

// What a gift's reveal looks like, by rarity tier. One pure plan feeds the one animation component (GiftStage), which
// both the marketplace's Preview and the recipient's open screen render, so what a buyer previews is what the
// recipient sees. A tier changes the look only, never what a gift gives. Client-safe, no I/O, unit-tested.
//
//   COMMON     the art rises in.
//   RARE       + a soft halo and a few sparkles.
//   EPIC       + layered depth (rings at different distances, a floor shadow, a slow tilt) and more sparkles.
//   LEGENDARY  + a cinematic sequence: letterbox bars, one soft light bloom, rotating rays, then the art arrives.
//
// "still" (reduced motion): the final pose with every layer drawn but nothing moving, plus one gentle fade.
// "light" (a low-end device): fewer sparkles, a single depth ring, no cinematic bars/bloom, shorter durations.

export type GiftEffectMotion = "full" | "light" | "still";

export type GiftEffectPlan = {
  tier: GiftTierName;
  motion: GiftEffectMotion;
  halo: boolean;
  sparkles: number;
  /** Depth rings behind the art (0 = none). */
  depthLayers: number;
  cinematic: boolean;
  /** How long the entrance takes, in ms (the whole sequence for Legendary). */
  durationMs: number;
};

const FULL: Record<GiftTierName, Omit<GiftEffectPlan, "tier" | "motion">> = {
  COMMON: { halo: false, sparkles: 0, depthLayers: 0, cinematic: false, durationMs: 700 },
  RARE: { halo: true, sparkles: 8, depthLayers: 0, cinematic: false, durationMs: 1400 },
  EPIC: { halo: true, sparkles: 12, depthLayers: 3, cinematic: false, durationMs: 2000 },
  LEGENDARY: { halo: true, sparkles: 18, depthLayers: 3, cinematic: true, durationMs: 3200 },
};

const LIGHT_MAX_SPARKLES = 4;
const LIGHT_MAX_DEPTH = 1;
const LIGHT_MAX_MS = 1200;
const STILL_FADE_MS = 400;

export function giftEffectPlan(tier: GiftTierName, opts: { reduce: boolean; lowEnd: boolean }): GiftEffectPlan {
  const base = FULL[tier];
  if (opts.reduce) return { ...base, tier, motion: "still", cinematic: false, durationMs: STILL_FADE_MS };
  if (opts.lowEnd) {
    return {
      ...base,
      tier,
      motion: "light",
      sparkles: Math.min(base.sparkles, LIGHT_MAX_SPARKLES),
      depthLayers: Math.min(base.depthLayers, LIGHT_MAX_DEPTH),
      cinematic: false,
      durationMs: Math.min(base.durationMs, LIGHT_MAX_MS),
    };
  }
  return { ...base, tier, motion: "full" };
}

export type SparkleSpot = { x: number; y: number; delayMs: number; size: number };

/** Deterministic sparkle positions (percent of the stage): no randomness, so server and client markup match. */
export function sparkleSpots(count: number): SparkleSpot[] {
  const GOLDEN = 137.508;
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
    const angle = ((i * GOLDEN) % 360) * (Math.PI / 180);
    const radius = 22 + ((i * 17) % 26);
    return {
      x: Math.round((50 + Math.cos(angle) * radius) * 10) / 10,
      y: Math.round((46 + Math.sin(angle) * radius * 0.9) * 10) / 10,
      delayMs: (i * 230) % 2400,
      size: 3 + (i % 3),
    };
  });
}

/** A phone/tablet that is likely to struggle: little memory, few cores, or the browser's data-saver. */
export function isLowEndDevice(nav: {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: { saveData?: boolean };
}): boolean {
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) return true;
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 2) return true;
  return nav.connection?.saveData === true;
}
