import { MIDNIGHT_CRYSTAL_GROUND_Y, type CutoutPreset } from "@/lib/gift-art-cutout";
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
//   trophy         Trophy Frame: a gold trophy (cup, two handles, stem, foot, on a dark plinth) rises in and spins
//                  continuously and smoothly about its axis for as long as the reveal is open.
//   kitten-box     Playful Kitten: the gift box arrives, its lid swings open and a 3D kitten jumps out of it on a natural
//                  arc, lands in front of the box and sits there (tail sway, blinks); the reveal's sound meows as it jumps.
//   twin-hearts    Kindred Spirit: two glossy red 3D hearts fly in from either side, turning, and meet overlapping on the
//                  hit, then sway together.
//   star-engraved  Supporter Star: the gold star with the Supporter Star icon engraved into its front face (relief in the
//                  metal, lit with it); a glint of light runs across the engraving on the hit.
//   gem-crystal    Midnight Crystal: the gem arrives, the Midnight Crystal (the whole cluster with its rock bed, kept by its
//                  traced outline) floats slowly down onto the gem's flat table, stands flush on it on the moment, and
//                  sparkles.
//   postcard-box   Sunset Postcard: a gift box wrapped all round in the postcard's sunset (one continuous picture around
//                  the four sides and the lid's rim, engraved into the paper), turning continuously so every side shows.
//
// Units: the scene is centred on the origin, camera on +z at 4.2 (GiftCanvas), about 2.65 units visible top to bottom.
// Timeline (ms from the reveal's start; Replay restarts it): the object's entrance (rise, grow, a part turn), its
// moment, then a slow sway until `activeMs`, a settle over `settleMs` (sway back to rest, particles out) and no more
// frames (`composedSceneNeedsFrames`), unless a pulse is showing. The two spinning variants (trophy, postcard-box) keep
// turning at a constant speed instead and draw frames while the reveal is open (and visible). Motion: eased tweens and
// slow sines, no spring, no overshoot: every travel only moves one way (tests check monotonic paths).

export type ComposedVariant =
  | "gold-heart"
  | "fireworks-box"
  | "star-badge"
  | "gem-sweep"
  | "gem-frame"
  | "trophy"
  | "kitten-box"
  | "twin-hearts"
  | "star-engraved"
  | "gem-crystal"
  | "postcard-box";

export const COMPOSED_VARIANTS: readonly ComposedVariant[] = [
  "gold-heart",
  "fireworks-box",
  "star-badge",
  "gem-sweep",
  "gem-frame",
  "trophy",
  "kitten-box",
  "twin-hearts",
  "star-engraved",
  "gem-crystal",
  "postcard-box",
];

/** Which variants place the gift's icon (cut out of its backdrop) on the object (the postcard box draws its sunset from code). */
export const COMPOSED_USES_ART: Readonly<Record<ComposedVariant, boolean>> = {
  "gold-heart": false,
  "fireworks-box": false,
  "star-badge": true,
  "gem-sweep": true,
  "gem-frame": true,
  trophy: false,
  "kitten-box": false,
  "twin-hearts": false,
  "star-engraved": true,
  "gem-crystal": true,
  "postcard-box": false,
};

/**
 * How each icon is prepared (gift-art-cutout.ts): a colour cut-out preset, a hand-traced outline (the Level Up badge,
 * "level-up-outline"; the Midnight Crystal's cluster and rock bed, "crystal-outline"), or the postcard's sunset redrawn
 * as a carving round the box ("postcard", gift-postcard-wrap.ts). Unused for the variants without art.
 */
export type ComposedArtPrep = CutoutPreset | "level-up-outline" | "crystal-outline" | "postcard";
export const COMPOSED_CUTOUT: Readonly<Record<ComposedVariant, ComposedArtPrep>> = {
  "gold-heart": "standard",
  "fireworks-box": "standard",
  "star-badge": "level-up-outline",
  "gem-sweep": "standard",
  "gem-frame": "frame",
  trophy: "standard",
  "kitten-box": "standard",
  "twin-hearts": "standard",
  "star-engraved": "standard",
  "gem-crystal": "crystal-outline",
  "postcard-box": "postcard",
};

/** Variants that keep turning about their axis for as long as the reveal is open (rad per ms). */
export const COMPOSED_SPIN: Readonly<Partial<Record<ComposedVariant, number>>> = {
  // One full turn every 6 s: a stately, readable spin.
  trophy: (Math.PI * 2) / 6000,
  // One turn every 10 s, so each side of the wrap is seen for a good moment.
  "postcard-box": (Math.PI * 2) / 10000,
};
/** How long the spin takes to come up to speed (an eased ramp, so it never jerks into motion). */
export const SPIN_RAMP_MS = 1400;

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
  trophy: { yaw: 0, periodMs: 9000, pitch: 0 },
  "kitten-box": { yaw: 0.16, periodMs: 10000, pitch: 0 },
  "twin-hearts": { yaw: 0.42, periodMs: 8000, pitch: 0.05 },
  "star-engraved": { yaw: 0.34, periodMs: 8000, pitch: 0.06 },
  "gem-crystal": { yaw: 0.3, periodMs: 9000, pitch: 0.03 },
  "postcard-box": { yaw: 0, periodMs: 9000, pitch: 0 },
};
/** How far the object turns during its entrance (rad, ending at 0). */
const ENTRANCE_TURN: Record<ComposedVariant, number> = {
  "gold-heart": Math.PI,
  "fireworks-box": 0.9,
  "star-badge": Math.PI * 0.8,
  "gem-sweep": Math.PI * 0.6,
  "gem-frame": Math.PI * 0.6,
  trophy: 0,
  "kitten-box": 0.7,
  "twin-hearts": 0,
  "star-engraved": Math.PI * 0.8,
  "gem-crystal": Math.PI * 0.6,
  "postcard-box": 0,
};
/** Where the object rests and how big (its group's y and scale). */
export const COMPOSED_REST: Record<ComposedVariant, { y: number; scale: number }> = {
  "gold-heart": { y: 0.02, scale: 0.8 },
  "fireworks-box": { y: -0.78, scale: 0.5 },
  "star-badge": { y: 0, scale: 0.95 },
  "gem-sweep": { y: 0.08, scale: 0.98 },
  "gem-frame": { y: -0.3, scale: 0.74 },
  trophy: { y: -0.02, scale: 1 },
  "kitten-box": { y: -0.3, scale: 0.7 },
  "twin-hearts": { y: 0.02, scale: 1 },
  "star-engraved": { y: 0, scale: 0.95 },
  "gem-crystal": { y: -0.36, scale: 0.72 },
  "postcard-box": { y: 0.18, scale: 0.78 },
};
/** A fixed tilt of the whole object towards the camera (rad), so the trophy's cup and the box's lid show from above. */
export const COMPOSED_TILT: Readonly<Partial<Record<ComposedVariant, number>>> = {
  trophy: 0.12,
  "kitten-box": 0.16,
  "postcard-box": 0.3,
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
  trophy: 0x7a0f,
  "kitten-box": 0x4177,
  "twin-hearts": 0x4ea7,
  "star-engraved": 0x5e57,
  "gem-crystal": 0xc4f5,
  "postcard-box": 0x5a57,
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
    trophy: 900,
    "kitten-box": 1100,
    "twin-hearts": 1100,
    "star-engraved": 1100,
    "gem-crystal": 3000,
    "postcard-box": 900,
  };
  const delayed = variant === "gem-frame" ? hit + 500 : variant === "kitten-box" ? hit + KITTEN_JUMP_AFTER_HIT_MS : hit;
  const momentMs = Math.round(Math.max(delayed, MOMENT_FLOOR[variant]));

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

/**
 * How far a spinning variant has turned by `t` (rad): its speed comes up along a smoothstep over SPIN_RAMP_MS and then
 * stays constant, so the angle only ever grows and the motion has no jerk (the integral of the ramp, in closed form).
 */
export function spinAngle(plan: ComposedScenePlan, t: number): number {
  const speed = COMPOSED_SPIN[plan.variant];
  if (!speed || t <= 0) return 0;
  const u = Math.min(1, t / SPIN_RAMP_MS);
  const ramped = SPIN_RAMP_MS * (u * u * u - (u * u * u * u) / 2);
  return speed * (ramped + Math.max(0, t - SPIN_RAMP_MS));
}

/** The object's pose: it rises, grows and turns in over the entrance, then sways slowly (or spins) and comes to rest. */
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
    yaw:
      -ENTRANCE_TURN[plan.variant] * (1 - k) +
      sway.yaw * envelope * Math.sin((since / sway.periodMs) * Math.PI * 2) +
      spinAngle(plan, t),
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
  if (plan.variant === "kitten-box") {
    // Open (fully) a little before the kitten leaves the box.
    return -1.95 * easeOutCubic((t - (plan.momentMs - KITTEN_LID_LEAD_MS)) / 420);
  }
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
  if (plan.variant === "fireworks-box" || plan.variant === "kitten-box") return null;
  const start = plan.momentMs;
  if (t < start || t - start >= plan.pulseMs) return null;
  const k = (t - start) / plan.pulseMs;
  return { radius: lerp(0.1, 1, easeOutCubic(k)), alpha: smoothstep(0, 0.1, k) * Math.pow(1 - k, 1.6) * 0.85 };
}

/**
 * Whether the scene still has to draw frames at `t`: until it has settled, and while a burst is still fading. A spinning
 * variant (COMPOSED_SPIN) always does: it keeps turning for as long as the reveal is open (the scene stops drawing while
 * the page is hidden, and closing the reveal disposes it).
 */
export function composedSceneNeedsFrames(plan: ComposedScenePlan, t: number): boolean {
  if (COMPOSED_SPIN[plan.variant]) return true;
  if (t < plan.endMs) return true;
  return plan.fireworks.some((f) => t < f.burstMs + plan.burstLifeMs);
}

// --- Playful Kitten ------------------------------------------------------------------------------------------------

/** The kitten leaves the box this long after the reveal's hit (the sound's meow is timed from the same hit). */
export const KITTEN_JUMP_AFTER_HIT_MS = 120;
/** The lid starts opening this long before the jump (it takes 420 ms, so it is fully open as the kitten rises). */
const KITTEN_LID_LEAD_MS = 560;
/** A short crouch before the jump, the flight, and the settle into sitting once it has landed. */
export const KITTEN_CROUCH_MS = 220;
export const KITTEN_FLIGHT_MS = 640;
export const KITTEN_SETTLE_MS = 320;
/** The box (box units, inside the object group) and the kitten's path (object units, the box's group scale). */
export const KITTEN_BOX = { x: -0.42, z: -0.55, floorY: -0.62, rimY: 0.3 } as const;
/** Where the kitten sits in the end: in front of the box and to its right, on the same floor. */
export const KITTEN_LAND = { x: 0.62, y: -0.7, z: 0.55 } as const;
/** The kitten's size in the box's group (its own units: about 1.2 high sitting, so about 0.86 of the box's height). */
export const KITTEN_SCALE = 0.95;
/** How high the arc rises above the straight line between the start and the landing (object units). */
export const KITTEN_ARC = 1.6;

export type KittenPose = {
  x: number;
  y: number;
  z: number;
  /** Body pitch (rad, + = nose up) and turn (rad). */
  pitch: number;
  yaw: number;
  /** 0 = sitting, 1 = fully stretched for the jump; -1..0 = curled up / crouched (smaller, so it fits in the box). */
  stretch: number;
  /** Hidden until the lid starts to open (curled up inside the closed box, it is never seen through the lid). */
  visible: boolean;
  /** Tail swing (rad), head tilt (rad), eyes closed (0..1). */
  tail: number;
  headTilt: number;
  blink: number;
};

/**
 * The kitten at `t`: crouched in the box, a short crouch, then the jump (horizontal travel at constant speed and height
 * on a parabola, i.e. under constant gravity, so the arc is natural), landing on the floor in front of the box where its
 * legs fold into a sit. Nothing overshoots: the travel only goes one way, it comes to rest exactly on the floor and the
 * stretch eases back to sitting. Afterwards it idles: a slow tail swing, a small head tilt and a blink now and then.
 */
export function kittenPose(plan: ComposedScenePlan, t: number): KittenPose {
  const jump = plan.momentMs;
  const land = jump + KITTEN_FLIGHT_MS;
  const start = { x: KITTEN_BOX.x, y: KITTEN_BOX.floorY, z: KITTEN_BOX.z };
  const s = clamp01((t - jump) / KITTEN_FLIGHT_MS);
  const x = lerp(start.x, KITTEN_LAND.x, s);
  const z = lerp(start.z, KITTEN_LAND.z, s);
  const y = lerp(start.y, KITTEN_LAND.y, s) + KITTEN_ARC * 4 * s * (1 - s);
  // The crouch before the jump, the stretch in the air (most at take-off and just before landing) and the sit after.
  // Curled up in the box until the crouch before the jump; it uncurls into the leap over its first 90 ms.
  const crouch = 1 - 0.35 * smoothstep(jump - KITTEN_CROUCH_MS, jump - 40, t);
  const airborne = t > jump && t < land ? 1 : 0;
  const settle = smoothstep(land, land + KITTEN_SETTLE_MS, t);
  const flight = 0.55 + 0.45 * Math.abs(1 - 2 * s);
  const stretch = t <= jump ? -crouch : t < land ? lerp(-crouch, flight, smoothstep(jump, jump + 90, t)) : 1 - settle;
  // Nose up on the way up, level at the top, nose down on the way down; level once sitting.
  const pitch = airborne ? 0.55 * (1 - 2 * s) : 0;
  const since = Math.max(0, t - land - KITTEN_SETTLE_MS);
  const idle = smoothstep(land, land + 900, t) * (1 - settled(plan, t));
  const blinkPhase = (since % 3400) / 3400;
  const blink = since > 0 && blinkPhase > 0.94 ? Math.sin(((blinkPhase - 0.94) / 0.06) * Math.PI) : 0;
  return {
    x,
    y,
    z,
    pitch,
    // Facing the way it jumps, turning to face the camera as it settles.
    yaw: lerp(0.95, 0.22, smoothstep(land - 120, land + 600, t)),
    stretch,
    tail: 0.35 * Math.sin((since / 1700) * Math.PI * 2) * idle + (airborne ? 0.6 : 0) * (1 - s),
    headTilt: 0.16 * Math.sin((since / 4100) * Math.PI * 2) * idle,
    blink,
    visible: t >= jump - KITTEN_LID_LEAD_MS,
  };
}

// --- Kindred Spirit ------------------------------------------------------------------------------------------------

/** Where each of the two hearts rests (object units): overlapping in view, apart in depth so they never intersect. */
export const TWIN_HEARTS_REST = [
  { x: -0.34, y: 0.1, z: -0.2, roll: 0.2 },
  { x: 0.34, y: -0.06, z: 0.2, roll: -0.2 },
] as const;
/** The hearts' size (each is a 2-high heart scaled to this). */
export const TWIN_HEART_SCALE = 0.5;

/** One heart's pose: flying in from its side, turning, and arriving on the moment; then a gentle bob (one way per leg). */
export function twinHeartPose(plan: ComposedScenePlan, index: 0 | 1, t: number): { x: number; y: number; z: number; yaw: number; roll: number } {
  const rest = TWIN_HEARTS_REST[index];
  const side = index === 0 ? -1 : 1;
  const k = easeOutCubic(t / plan.momentMs);
  const since = Math.max(0, t - plan.momentMs);
  const idle = smoothstep(plan.momentMs, plan.momentMs + 1200, t) * (1 - settled(plan, t));
  return {
    x: lerp(side * 1.75, rest.x, k),
    y: rest.y + 0.045 * idle * Math.sin((since / 2600) * Math.PI * 2 + index * Math.PI),
    z: rest.z,
    yaw: side * Math.PI * 0.9 * (1 - k) + 0.12 * idle * Math.sin((since / 3300) * Math.PI * 2 + index * 1.7),
    roll: lerp(0, rest.roll, k),
  };
}

// --- Supporter Star ------------------------------------------------------------------------------------------------

/** The engraving texture's size (px, square, covering the star's face). */
export const ENGRAVE_TEXTURE_SIZE = 1024;
/** The 3D star's centre on its front face (star units: the geometry is centred on its bounding box, not its centre). */
export const STAR_FACE_CENTRE = { x: 0, y: -0.096 } as const;
/** The Supporter Star icon's own star (384px icon): its centre, where the facets meet, and its points' radius. */
export const SUPPORTER_STAR_ICON = { x: 188, y: 187, radius: 150 } as const;
/** The engraved star's size on the 3D star's face (its points' radius, star units; the 3D star's points reach 1). */
export const ENGRAVE_MOTIF_RADIUS = 0.64;

/** The glint across the engraving: the light's x across the star's face (-1.6 .. 1.6) and its strength, or null. */
export function engraveGlint(plan: ComposedScenePlan, t: number): { x: number; strength: number } | null {
  const start = plan.momentMs - 300;
  const length = 1500;
  // Once on the moment, then every 6 s while active.
  if (t < start || t >= plan.activeMs) return null;
  const into = (t - start) % 6000;
  if (into >= length) return null;
  const k = into / length;
  return { x: lerp(-1.6, 1.6, easeInOutSine(k)), strength: Math.sin(Math.PI * k) };
}

// --- Midnight Crystal ----------------------------------------------------------------------------------------------

/**
 * The crystal plane (gem units): its side, and where the rock bed's flat underside is (fraction of the icon from the
 * bottom: the icon's ground line, MIDNIGHT_CRYSTAL_GROUND_Y, at 304.5 of 384). The cut-out continues the bed's bottom
 * row a few px below that line (CRYSTAL_UNDERFILL_PX), so at rest the texture's filtered edge is inside the gem (hidden
 * by its table) and the visible base meets the table exactly: no gap, no soft seam.
 */
export const CRYSTAL_PLANE = { size: 1.5, bottomInset: (384 - MIDNIGHT_CRYSTAL_GROUND_Y) / 384 } as const;
/** How far (icon px) the rock bed's bottom row is continued below the ground line (hidden in the gem at rest). */
export const CRYSTAL_UNDERFILL_PX = 3;
/** How high above its resting place the crystal starts (gem units). */
export const CRYSTAL_DROP = 2.6;

/** The crystal's resting y (its painted bottom exactly on the gem's table, gem units). */
export function crystalRestY(): number {
  return GEM_TABLE.y + CRYSTAL_PLANE.size * (0.5 - CRYSTAL_PLANE.bottomInset);
}

/** The Midnight Crystal floating slowly down onto the gem: y only falls, ending exactly at rest on the moment. */
export function crystalPose(plan: ComposedScenePlan, t: number): { x: number; y: number; opacity: number } {
  const start = 250;
  const k = easeInOutSine((t - start) / (plan.momentMs - start));
  return {
    // A slight drift while it floats, gone by the time it lands.
    x: 0.05 * Math.sin(((t - start) / 1700) * Math.PI) * (1 - smoothstep(0.55, 0.95, k)),
    y: crystalRestY() + CRYSTAL_DROP * (1 - k),
    opacity: smoothstep(start, start + 500, t),
  };
}

/** The crystal's sparkle once it has landed (0..1). */
export function crystalSparkle(plan: ComposedScenePlan, t: number): number {
  return smoothstep(plan.momentMs - 150, plan.momentMs + 500, t) * (1 - settled(plan, t));
}

// --- Sunset Postcard -----------------------------------------------------------------------------------------------

/**
 * The postcard box (box units): body width/depth and height, and the lid (a cap a little wider, whose walls come down
 * over the body's top). The picture wraps the visible height: from the body's bottom to the lid's top, so it runs on
 * from the body onto the lid's rim without a break.
 */
export const POSTCARD_BOX = { width: 1.3, bodyBottom: -0.88, bodyTop: 0.3, lidWidth: 1.36, lidBottom: 0.1, lidTop: 0.36 } as const;
/** The wrapped picture's width over height: the box's perimeter over the visible height it covers (so nothing stretches). */
export const POSTCARD_WRAP_ASPECT = (4 * POSTCARD_BOX.width) / (POSTCARD_BOX.lidTop - POSTCARD_BOX.bodyBottom);
/** The picture's v (0 bottom .. 1 top) at height y on the box. */
export function postcardWrapV(y: number): number {
  return (y - POSTCARD_BOX.bodyBottom) / (POSTCARD_BOX.lidTop - POSTCARD_BOX.bodyBottom);
}

// --- Trophy --------------------------------------------------------------------------------------------------------

/** The trophy's plinth bottom (object units): the pulse ring lies there. */
export const TROPHY_BASE_Y = -0.69;
