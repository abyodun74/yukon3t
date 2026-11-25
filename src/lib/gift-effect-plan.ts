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
//
// giftRevealTimeline then times the words around the art (header, tier badge, name, sender, note, buttons).

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

// The reveal's words arrive in this order once the art has landed (GiftReveal): a header, the tier badge, the gift's
// name, who sent it, their note (only when there is one) and the buttons. How late the first one comes and how far
// apart they are scales with the tier, so Legendary waits for its cinematic sequence and then unfolds slowly. Reduced
// motion: everything at once with one short fade; a low-end device: an earlier, tighter sequence and no name shine.
export const GIFT_REVEAL_STEPS = ["header", "badge", "name", "sender", "message", "actions"] as const;
export type GiftRevealStep = (typeof GIFT_REVEAL_STEPS)[number];

const TEXT_TIMING: Record<GiftTierName, { startMs: number; staggerMs: number; textMs: number }> = {
  COMMON: { startMs: 250, staggerMs: 90, textMs: 420 },
  RARE: { startMs: 500, staggerMs: 130, textMs: 500 },
  EPIC: { startMs: 850, staggerMs: 170, textMs: 560 },
  LEGENDARY: { startMs: 1700, staggerMs: 240, textMs: 700 },
};
const LIGHT_TEXT = { maxStartMs: 400, staggerMs: 80, textMs: 320 };

export type GiftRevealTimeline = {
  steps: { step: GiftRevealStep; delayMs: number }[];
  /** How long each line takes to arrive, in ms. */
  textMs: number;
  /** A slow light sweep across the gift's name (Legendary, full motion only). */
  nameShine: boolean;
  /** When the last line has arrived, in ms. */
  doneMs: number;
};

export function giftRevealTimeline(plan: GiftEffectPlan, opts: { hasMessage: boolean }): GiftRevealTimeline {
  const shown = GIFT_REVEAL_STEPS.filter((step) => step !== "message" || opts.hasMessage);
  const base = TEXT_TIMING[plan.tier];
  const timing =
    plan.motion === "still"
      ? { startMs: 0, staggerMs: 0, textMs: plan.durationMs }
      : plan.motion === "light"
        ? { startMs: Math.min(base.startMs, LIGHT_TEXT.maxStartMs), staggerMs: LIGHT_TEXT.staggerMs, textMs: LIGHT_TEXT.textMs }
        : base;
  const steps = shown.map((step, i) => ({ step, delayMs: timing.startMs + i * timing.staggerMs }));
  return {
    steps,
    textMs: timing.textMs,
    nameShine: plan.tier === "LEGENDARY" && plan.motion === "full",
    doneMs: steps[steps.length - 1].delayMs + timing.textMs,
  };
}

export type GiftRevealSender = { kind: "award" } | { kind: "person"; label: string } | { kind: "someone" };

/** Who the reveal says sent the gift: an award has no sender; a person by @username, else display name, else "someone". */
export function giftRevealSender(input: { isAward: boolean; username: string | null; name: string | null }): GiftRevealSender {
  if (input.isAward) return { kind: "award" };
  const username = input.username?.trim();
  if (username) return { kind: "person", label: `@${username}` };
  const name = input.name?.trim();
  return name ? { kind: "person", label: name } : { kind: "someone" };
}

/** The art's size in px for a viewport: large on a desktop panel, expanded on a tablet, smaller on a short phone. */
export function giftRevealArtSize(viewport: { width: number; height: number }): number {
  if (viewport.width >= 1024) return 280;
  if (viewport.width >= 640) return 240;
  return viewport.height < 700 ? 150 : 190;
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
