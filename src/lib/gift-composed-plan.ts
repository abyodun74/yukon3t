import type { CutoutPreset } from "@/lib/gift-art-cutout";
import { seededRandom, smoothstep } from "@/lib/gift-legendary-plan";

// The composed 3D reveals: a procedural object with the gift's own artwork or effect placed physically on it (what
// src/components/gift-scene-composed.tsx draws, objects in gift-composed-graph.ts). One pure, deterministic plan per
// variant plus the pose functions sampled every frame. Client-safe, no I/O, no three.js, unit-tested
// (gift-composed-plan.test.ts).
//
//   gold-heart     Keepsake Locket: a rounded, polished, fully metallic gold heart (a puffy 3D heart, no engraving),
//                  with a warm glow and twinkles.
//   fireworks-box  Fireworks: the gift box arrives, its lid swings open on its back hinge and rockets launch from the
//                  open box and burst overhead; the first burst lands on the reveal's hit.
//   star-badge     Level Up: the gold star arrives and the Level Up badge (its icon, cut out of the backdrop) comes in
//                  and settles onto the star's front face on the hit; from then on it is part of the star.
//   gem-sweep      Aurora Sweep: the gem arrives and the aurora sweep (its icon, cut out) appears across the gem's
//                  facets, drawn on from one end to the other, then a shimmer runs along it.
//   gem-frame      Aurora Frame: the gem arrives, the Aurora Frame (its icon, cut out) rises up in front of it, moves
//                  back onto the gem's flat top and stands there on the hit.
//
// Units: the scene is centred on the origin, camera on +z at 4.2 (GiftCanvas), about 2.65 units visible top to bottom.
// Timeline (ms from the reveal's start; Replay restarts it): the object's entrance (rise, grow, a part turn), its
// moment, then a slow sway until `activeMs`, a settle over `settleMs` (sway back to rest, particles out) and no more
// frames (`composedSceneNeedsFrames`), unless a pulse is showing. Motion: eased tweens and slow sines, no spring, no
// overshoot: every travel only moves one way (tests check monotonic paths).

export type ComposedVariant = "gold-heart" | "fireworks-box" | "star-badge" | "gem-sweep" | "gem-frame";

export const COMPOSED_VARIANTS: readonly ComposedVariant[] = ["gold-heart", "fireworks-box", "star-badge", "gem-sweep", "gem-frame"];

/** Which variants place the gift's icon (cut out of its backdrop) on the object. */
export const COMPOSED_USES_ART: Readonly<Record<ComposedVariant, boolean>> = {
  "gold-heart": false,
  "fireworks-box": false,
  "star-badge": true,
  "gem-sweep": true,
  "gem-frame": true,
};

/** How each icon is cut out of its backdrop (gift-art-cutout.ts CUTOUT_PRESETS). */
export const COMPOSED_CUTOUT: Readonly<Record<ComposedVariant, CutoutPreset>> = {
  "gold-heart": "standard",
  "fireworks-box": "standard",
  "star-badge": "badge",
  "gem-sweep": "standard",
  "gem-frame": "frame",
};

export const COMPOSED_ACTIVE_MS = 14000;
export const COMPOSED_SETTLE_MS = 2500;
export const COMPOSED_PULSE_MS = 1800;
/** The slow sway after the entrance: yaw amplitude (rad) and period (ms) per variant (small where art faces the camera). */
const SWAY: Record<ComposedVariant, { yaw: number; periodMs: number; pitch: number }> = {
  "gold-heart": { yaw: 0.55, periodMs: 7000, pitch: 0.06 },
  "fireworks-box": { yaw: 0.22, periodMs: 9000, pitch: 0 },
  "star-badge": { yaw: 0.32, periodMs: 8000, pitch: 0.05 },
  "gem-sweep": { yaw: 0.38, periodMs: 8000, pitch: 0.04 },
  "gem-frame": { yaw: 0.3, periodMs: 9000, pitch: 0.03 },
};
/** How far the object turns during its entrance (rad, ending at 0). */
const ENTRANCE_TURN: Record<ComposedVariant, number> = {
  "gold-heart": Math.PI,
  "fireworks-box": 0.9,
  "star-badge": Math.PI * 0.8,
  "gem-sweep": Math.PI * 0.6,
  "gem-frame": Math.PI * 0.6,
};
/** Where the object rests and how big (its group's y and scale). */
export const COMPOSED_REST: Record<ComposedVariant, { y: number; scale: number }> = {
  "gold-heart": { y: 0.02, scale: 0.8 },
  "fireworks-box": { y: -0.78, scale: 0.5 },
  "star-badge": { y: 0, scale: 0.95 },
  "gem-sweep": { y: 0.08, scale: 0.98 },
  "gem-frame": { y: -0.3, scale: 0.74 },
};

/** The gem (Aurora Sweep / Frame): its crown's flat top (the table) in the gem's own units, and its radius. */
export const GEM_TABLE = { y: 0.495, radius: 0.55 } as const;
/** The Aurora Frame plane: side length (gem units) and where the frame's painted bottom edge is (fraction from the bottom). */
/** (bottomInset measured on the 384px icon: the frame's lowest painted edge is at 76.5% of its height.) */
export const FRAME_PLANE = { size: 1.5, bottomInset: 0.235 } as const;
/** The gem's girdle (its widest ring, where crown meets pavilion): y and radius, gem units. */
export const GEM_GIRDLE = { y: 0.145, radius: 0.95 } as const;
/** Where the frame starts: below the gem and in front of its girdle, so it rises clear of the gem. */
export const FRAME_START = { y: -1.9, z: 1.12 } as const;

/** The height of the gem's crown surface at distance `r` from its axis (gem units), or -Infinity outside the gem. */
export function gemCrownY(r: number): number {
  if (r <= GEM_TABLE.radius) return GEM_TABLE.y;
  if (r > GEM_GIRDLE.radius) return -Infinity;
  return GEM_TABLE.y - ((r - GEM_TABLE.radius) / (GEM_GIRDLE.radius - GEM_TABLE.radius)) * (GEM_TABLE.y - GEM_GIRDLE.y);
}
/** The Level Up badge plane: side length (star units) and the star's front face (z). */
export const STAR_FACE_Z = 0.25;
export const BADGE_PLANE = { size: 1.42, y: 0.02 } as const;

/** The gift box (Fireworks): its opening (box units) where the rockets come out. */
export const BOX_OPENING = { y: 0.3, halfWidth: 0.6 } as const;

export type FireworkSpec = {
  /** Launch time (ms) and the burst time. */
  launchMs: number;
  burstMs: number;
  /** Launch point in the box's opening (box units) and the burst centre (scene units). */
  fromX: number;
  fromZ: number;
  x: number;
  y: number;
  z: number;
  /** Burst radius at the end of its spread (scene units). */
  radius: number;
  color: string;
  /** A second, inner colour for the burst's core sparks. */
  core: string;
  particles: number;
};

export type SparkleSpec = { x: number; y: number; z: number; size: number; phase: number; rate: number };

export type ComposedScenePlan = {
  variant: ComposedVariant;
  lowEnd: boolean;
  hitMs: number;
  /** The entrance window of the object. */
  entranceMs: [number, number];
  /** The variant's moment: badge / frame landing, sweep drawn, first burst (= the hit, or a little after it). */
  momentMs: number;
  activeMs: number;
  settleMs: number;
  endMs: number;
  pulseMs: number;
  fireworks: FireworkSpec[];
  sparkles: SparkleSpec[];
  /** Burst lifetime (ms) and gravity (scene units / s^2) for the fireworks. */
  burstLifeMs: number;
  gravity: number;
};

export const FIREWORK_COLORS: readonly [string, string][] = [
  ["#ff4fa0", "#ffd2ea"],
  ["#b26bff", "#e8d4ff"],
  ["#ffb43a", "#fff0c8"],
  ["#4fa3ff", "#d6ecff"],
  ["#4cd07d", "#dcffe8"],
  ["#ff7a3d", "#ffe0c8"],
];

const SEEDS: Record<ComposedVariant, number> = {
  "gold-heart": 0x60d4ea,
  "fireworks-box": 0xf13e,
  "star-badge": 0x57a2,
  "gem-sweep": 0xa0a5,
  "gem-frame": 0xa0af,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

export function composedScenePlan(variant: ComposedVariant, opts: { lowEnd: boolean; hitMs: number }): ComposedScenePlan {
  const random = seededRandom(SEEDS[variant]);
  const between = (a: number, b: number) => lerp(a, b, random());
  const hit = Math.max(0, opts.hitMs);
  // The object is in place a little before the hit (it starts behind the stage's poster, which fades on readiness).
  const entranceEnd = variant === "fireworks-box" ? 650 : Math.max(900, hit * 0.8);
  const entranceMs: [number, number] = [0, Math.round(entranceEnd)];
  const MOMENT_FLOOR: Record<ComposedVariant, number> = {
    "gold-heart": 900,
    "fireworks-box": 1500,
    "star-badge": 1500,
    "gem-sweep": 1800,
    "gem-frame": 1700,
  };
  const momentMs = Math.round(Math.max(variant === "gem-frame" ? hit + 500 : hit, MOMENT_FLOOR[variant]));

  const fireworks: FireworkSpec[] = [];
  if (variant === "fireworks-box") {
    const count = opts.lowEnd ? 4 : 9;
    const flight = 650;
    for (let i = 0; i < count; i++) {
      // The first rocket bursts on the hit; the rest follow, sometimes two close together.
      const burstMs = i === 0 ? momentMs : momentMs + Math.round(i * 760 + between(-140, 140) + (i % 3 === 2 ? -260 : 0));
      const [color, core] = FIREWORK_COLORS[i % FIREWORK_COLORS.length];
      const side = i === 0 ? 0 : i % 2 === 0 ? 1 : -1;
      fireworks.push({
        launchMs: burstMs - flight,
        burstMs,
        fromX: between(-0.35, 0.35) * BOX_OPENING.halfWidth,
        fromZ: between(-0.25, 0.25) * BOX_OPENING.halfWidth,
        x: i === 0 ? 0 : side * between(0.25, 0.7),
        y: i === 0 ? 0.42 : between(0.3, 0.8),
        z: between(-0.35, 0.2),
        radius: i === 0 ? 0.8 : between(0.55, 0.72),
        color,
        core,
        particles: opts.lowEnd ? 50 : 120,
      });
    }
  }

  const sparkleCount = opts.lowEnd ? 18 : 46;
  const sparkles: SparkleSpec[] = Array.from({ length: sparkleCount }, () => {
    const angle = between(0, Math.PI * 2);
    const radius = between(0.75, 1.3);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.85 + 0.05,
      z: between(-0.6, 0.5),
      size: between(5, 11),
      phase: between(0, Math.PI * 2),
      rate: between(1.1, 2.4),
    };
  });

  const activeMs = COMPOSED_ACTIVE_MS;
  return {
    variant,
    lowEnd: opts.lowEnd,
    hitMs: hit,
    entranceMs,
    momentMs,
    activeMs,
    settleMs: COMPOSED_SETTLE_MS,
    endMs: activeMs + COMPOSED_SETTLE_MS,
    pulseMs: COMPOSED_PULSE_MS,
    fireworks,
    sparkles,
    burstLifeMs: 1700,
    gravity: 0.32,
  };
}

/** 0 -> 1 while settling. */
function settled(plan: ComposedScenePlan, t: number): number {
  return smoothstep(plan.activeMs, plan.endMs, t);
}

export type ObjectPose = { y: number; scale: number; yaw: number; pitch: number; opacity: number };

/** The object's pose: it rises, grows and turns in over the entrance, then sways slowly and comes to rest. */
export function composedObjectPose(plan: ComposedScenePlan, t: number): ObjectPose {
  const rest = COMPOSED_REST[plan.variant];
  const [from, to] = plan.entranceMs;
  const k = easeOutCubic((t - from) / (to - from));
  const sway = SWAY[plan.variant];
  const since = Math.max(0, t - to);
  const envelope = smoothstep(to, to + 1500, t) * (1 - settled(plan, t));
  return {
    y: rest.y - 0.55 * (1 - k),
    scale: rest.scale * (0.6 + 0.4 * k),
    yaw: -ENTRANCE_TURN[plan.variant] * (1 - k) + sway.yaw * envelope * Math.sin((since / sway.periodMs) * Math.PI * 2),
    pitch: sway.pitch * envelope * Math.sin((since / (sway.periodMs * 1.4)) * Math.PI * 2),
    opacity: smoothstep(from, from + 250, t),
  };
}

/** How present the scene's extras are at `t` (0..1). */
export function composedLevels(plan: ComposedScenePlan, t: number) {
  const s = settled(plan, t);
  const breathing = t < plan.activeMs ? 0.85 + 0.15 * Math.sin((t / 2600) * Math.PI) : 1;
  return {
    glow: smoothstep(200, 1400, t) * lerp(breathing, 1, s) * (1 - 0.35 * s),
    sparkles: smoothstep(plan.entranceMs[1] * 0.6, plan.entranceMs[1] + 1200, t) * (1 - s),
  };
}

/** The gift box's lid (Fireworks): how far it has swung open on its back hinge (rad, 0 = shut, monotonic). */
export function lidAngle(plan: ComposedScenePlan, t: number): number {
  if (plan.variant !== "fireworks-box") return 0;
  const first = plan.fireworks[0]?.launchMs ?? plan.momentMs;
  const open = first - 380;
  return -1.95 * easeOutCubic((t - open) / 420);
}

/** The light inside the open box while rockets go up (0..1). */
export function boxGlow(plan: ComposedScenePlan, t: number): number {
  if (plan.variant !== "fireworks-box" || plan.fireworks.length === 0) return 0;
  const first = plan.fireworks[0].launchMs - 250;
  const last = plan.fireworks[plan.fireworks.length - 1].launchMs + 600;
  return smoothstep(first, first + 300, t) * (1 - smoothstep(last, last + 1400, t)) * 0.9 + 0.1 * smoothstep(first, first + 300, t);
}

/** The Level Up badge: settling onto the star's face from in front of it (z offset, scale, opacity), monotonic. */
export function badgePose(plan: ComposedScenePlan, t: number): { z: number; scale: number; opacity: number } {
  const start = plan.entranceMs[1] * 0.55;
  const k = easeOutCubic((t - start) / (plan.momentMs - start));
  return { z: 1.1 * (1 - k), scale: lerp(1.18, 1, k), opacity: smoothstep(start, start + 300, t) };
}

/** The Aurora Frame: from below and in front of the gem up to standing on its table (gem units), y and z monotonic. */
export function framePose(plan: ComposedScenePlan, t: number): { y: number; z: number; opacity: number } {
  const restY = GEM_TABLE.y + FRAME_PLANE.size * (0.5 - FRAME_PLANE.bottomInset) + 0.004;
  const start = Math.min(plan.entranceMs[1] * 0.4, plan.momentMs - 1200);
  const span = plan.momentMs - start;
  // It rises in front of the gem first, and moves back onto the gem only once it is at its height.
  const up = easeOutCubic((t - start) / (span * 0.6));
  const back = easeInOutSine((t - (start + span * 0.6)) / (span * 0.4));
  return {
    y: lerp(FRAME_START.y, restY, up),
    z: lerp(FRAME_START.z, 0, back),
    opacity: smoothstep(start, start + 120, t),
  };
}

/** The frame's painted bottom edge at a pose (gem units). */
export function frameBottom(pose: { y: number }): number {
  return pose.y - FRAME_PLANE.size * (0.5 - FRAME_PLANE.bottomInset);
}

/** The Aurora Sweep drawn onto the gem: 0 (nothing) -> 1 (all of it), monotonic, done on the moment. */
export function sweepReveal(plan: ComposedScenePlan, t: number): number {
  const start = plan.momentMs - 1300;
  return easeInOutSine((t - start) / 1300);
}

/** A shimmer travelling along the sweep after it is drawn (-0.3 .. 1.3 along it), or null between passes. */
export function sweepShimmer(plan: ComposedScenePlan, t: number): number | null {
  const first = plan.momentMs + 400;
  if (t < first || t >= plan.activeMs) return null;
  const into = (t - first) % 4800;
  if (into >= 1900) return null;
  return lerp(-0.3, 1.3, easeInOutSine(into / 1900));
}

/** The landing pulse (badge, frame) or the burst flash: ring radius (object units) and alpha, or null. */
export function composedPulse(plan: ComposedScenePlan, t: number): { radius: number; alpha: number } | null {
  if (plan.variant === "fireworks-box") return null;
  const start = plan.momentMs;
  if (t < start || t - start >= plan.pulseMs) return null;
  const k = (t - start) / plan.pulseMs;
  return { radius: lerp(0.1, 1, easeOutCubic(k)), alpha: smoothstep(0, 0.1, k) * Math.pow(1 - k, 1.6) * 0.85 };
}

/** Whether the scene still has to draw frames at `t`: until it has settled, and while a burst is still fading. */
export function composedSceneNeedsFrames(plan: ComposedScenePlan, t: number): boolean {
  if (t < plan.endMs) return true;
  return plan.fireworks.some((f) => t < f.burstMs + plan.burstLifeMs);
}
