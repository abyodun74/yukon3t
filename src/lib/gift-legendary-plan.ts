import { giftRevealTimeline, type GiftEffectPlan } from "@/lib/gift-effect-plan";

// The cinematic 3D reveal of the Legendary atelier pieces drawn by the owner (the Luxury Red Rose, the Gold Orchid and
// the Diamond Jewelry Gift Box, whose petals are small diamonds floating up instead): what src/components/gift-scene-legendary.tsx shows, as one pure, deterministic plan plus the pose functions
// it samples every frame. Client-safe, no I/O, no three.js, unit-tested (gift-legendary-plan.test.ts).
//
// The artwork is a flat picture on a plane: the camera pushes in slowly and sways +-10 degrees around it (a flat image
// can't truly turn round, the sway and the layers at different depths are what give it depth). In front of and behind
// it: tumbling petals falling slowly (red for the rose, gold for the orchid), twinkling sparkles, an orbiting glow
// ribbon echoing the swirl painted in the art, a soft glow behind it, a light sweep across the picture (a shimmer over
// the orchid's flowers) and a light pulse ring at the base on the reveal's hit (the name step, = the sound's hit) and
// on every climax cue of the tier's score. Units: the picture is 1 x 1, centred on the origin, facing +z.
//
// Timeline (ms from the reveal's start; Replay restarts it): the picture fades in over ARRIVAL (aligned with the
// stage's poster, which it replaces without a jump: the camera holds still until then), then the push-in and sway, the
// petals and sparkles, until `activeMs`; over `settleMs` everything settles (petals and sparkles gone, ribbon and glow
// dimmed, camera at rest) and the scene stops drawing (`legendarySceneNeedsFrames`), waking only for a pulse.
// Motion: eased tweens and slow sines only, nothing overshoots.

export type LegendaryVariant = "rose" | "orchid" | "jewelry";

export type LegendaryLook = {
  /** What drifts around the picture: cupped petals (rose, orchid) or small faceted diamonds (the jewelry box). */
  particle: "petal" | "diamond";
  /** Petals fall; diamonds float up. */
  drift: "fall" | "rise";
  /** The picture's edges dissolve into the scene (its backdrop fades, its painted light carries on); else a plain fade. */
  edgeBlend: boolean;
  petalColor: string;
  petalEmissive: string;
  petalMetalness: number;
  petalRoughness: number;
  /** Petal length range (picture heights). */
  petalScale: [number, number];
  glowColor: string;
  sparkleColor: string;
  ribbonFrom: string;
  ribbonTo: string;
  ringColor: string;
  sweepColor: string;
  /** How strongly the light sweep brightens the picture's bright parts. */
  sweepStrength: number;
  sweepEveryMs: number;
  sweepMs: number;
  /** The ribbon's turn speed, rad/s. */
  ribbonSpin: number;
  /** Where the podium / pot meets its floor disc in the art (y, picture units): the pulse ring's height. */
  baseY: number;
  seed: number;
};

export const LEGENDARY_LOOKS: Record<LegendaryVariant, LegendaryLook> = {
  rose: {
    particle: "petal",
    drift: "fall",
    edgeBlend: false,
    petalColor: "#c8102e",
    petalEmissive: "#3a0008",
    petalMetalness: 0.05,
    petalRoughness: 0.42,
    petalScale: [0.055, 0.085],
    glowColor: "#ff2d55",
    sparkleColor: "#ffd9a0",
    ribbonFrom: "#ff4d6d",
    ribbonTo: "#ffd27a",
    ringColor: "#ffc26b",
    sweepColor: "#fff1dc",
    sweepStrength: 0.35,
    sweepEveryMs: 9000,
    sweepMs: 2600,
    ribbonSpin: 0.22,
    baseY: -0.41,
    seed: 0x5e1d,
  },
  orchid: {
    particle: "petal",
    drift: "fall",
    edgeBlend: false,
    petalColor: "#f2b93b",
    petalEmissive: "#4a3000",
    petalMetalness: 0.65,
    petalRoughness: 0.32,
    petalScale: [0.05, 0.08],
    glowColor: "#ffc54a",
    sparkleColor: "#fff2c4",
    ribbonFrom: "#ffd36b",
    ribbonTo: "#c58cff",
    ringColor: "#ffd780",
    sweepColor: "#fff6d8",
    sweepStrength: 0.75,
    sweepEveryMs: 5500,
    sweepMs: 1800,
    ribbonSpin: 0.3,
    baseY: -0.42,
    seed: 0x0c41d,
  },
  // The Diamond Jewelry Gift Box: diamonds floating up around the open box, gold orbit, white glints, a bright light
  // sweep over the jewels, the pulse ring where the box meets its gold base.
  jewelry: {
    particle: "diamond",
    drift: "rise",
    edgeBlend: true,
    petalColor: "#cfe0ff",
    petalEmissive: "#141c34",
    petalMetalness: 0.65,
    petalRoughness: 0.08,
    petalScale: [0.095, 0.14],
    glowColor: "#ffbf4a",
    sparkleColor: "#ffffff",
    ribbonFrom: "#ffd36b",
    ribbonTo: "#fff1c4",
    ringColor: "#ffd780",
    sweepColor: "#ffffff",
    sweepStrength: 0.8,
    sweepEveryMs: 5000,
    sweepMs: 1700,
    ribbonSpin: 0.34,
    baseY: -0.33,
    seed: 0xd1a40,
  },
};

export const LEGENDARY_PETALS = { full: 40, lowEnd: 14 } as const;
export const LEGENDARY_SPARKLES = { full: 90, lowEnd: 30 } as const;
/** The picture fades in over this window: the stage's Legendary poster arrives in the same one (1000-1900 ms). */
export const LEGENDARY_ARRIVAL_MS: readonly [number, number] = [800, 2000];
export const LEGENDARY_ACTIVE_MS = { full: 32000, lowEnd: 16000 } as const;
export const LEGENDARY_SETTLE_MS = 3000;
export const LEGENDARY_PULSE_MS = 2400;
/** The sway: +-10 degrees of yaw around the picture, one slow swing every 16 s. */
export const LEGENDARY_YAW_DEG = 10;
export const LEGENDARY_YAW_PERIOD_MS = 16000;
const PITCH_DEG = 2.5;
const PITCH_PERIOD_MS = 23000;
/** The push-in: camera distance as a fraction of the poster-matching distance, from arrival over PUSH_MS. */
const PUSH_TO = 0.84;
const PUSH_MS = 14000;
const ENVELOPE_IN_MS = 3000;
/** Petals fall between these heights (picture units), then start again at the top. */
export const LEGENDARY_FALL = { top: 0.78, bottom: -0.62 } as const;

export type PetalSpec = {
  side: "back" | "front";
  x: number;
  z: number;
  /** Where in its fall the petal starts, 0..1. */
  phase: number;
  /** Picture heights per second. */
  fallSpeed: number;
  swayAmp: number;
  /** rad/s */
  swayRate: number;
  swayPhase: number;
  rot: [number, number, number];
  /** Tumble, rad/s per axis. */
  spin: [number, number, number];
  scale: number;
};

export type SparkleSpec = { side: "back" | "front"; x: number; y: number; z: number; size: number; phase: number; rate: number };

export type LegendaryRibbon = {
  radius: number;
  /** The orbit's depth radius (an ellipse around the picture). */
  depth: number;
  bottom: number;
  top: number;
  turns: number;
  tubularSegments: number;
  radialSegments: number;
  thickness: number;
};

export type LegendaryScenePlan = {
  variant: LegendaryVariant;
  lowEnd: boolean;
  look: LegendaryLook;
  petals: PetalSpec[];
  sparkles: SparkleSpec[];
  ribbon: LegendaryRibbon;
  /** The reveal's hit (its name step): the first pulse. */
  hitMs: number;
  activeMs: number;
  settleMs: number;
  endMs: number;
  pulseMs: number;
};

/** mulberry32: a small seeded generator, so the same plan comes out every time (and server/client never differ). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 before `from`, 1 after `to`, smooth in between (no overshoot). */
export function smoothstep(from: number, to: number, x: number): number {
  const t = clamp01((x - from) / (to - from));
  return t * t * (3 - 2 * t);
}
const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

/** When the reveal shows the gift's name (= the sound's hit), for a plan: giftRevealTimeline's "name" step. */
export function legendaryHitMs(effect: GiftEffectPlan): number {
  return giftRevealTimeline(effect, { hasMessage: false }).steps.find((s) => s.step === "name")?.delayMs ?? 0;
}

export function legendaryScenePlan(variant: LegendaryVariant, opts: { lowEnd: boolean; hitMs: number }): LegendaryScenePlan {
  const look = LEGENDARY_LOOKS[variant];
  const random = seededRandom(look.seed);
  const between = (a: number, b: number) => lerp(a, b, random());
  const signed = (a: number, b: number) => (random() < 0.5 ? -1 : 1) * between(a, b);

  const petals: PetalSpec[] = Array.from({ length: opts.lowEnd ? LEGENDARY_PETALS.lowEnd : LEGENDARY_PETALS.full }, (_, i) => {
    // About four in nine fall in front of the picture, the rest behind it (seen through its faded edges and around it).
    const side = i % 9 < 4 ? "front" : "back";
    return {
      side,
      // Diamonds in front of the picture keep to its sides, so they never hide the jewellery or the plaque.
      x: look.particle === "diamond" && side === "front" ? signed(0.5, 0.8) : between(-0.8, 0.8),
      z: side === "front" ? between(0.12, 0.75) : -between(0.12, 0.85),
      phase: random(),
      fallSpeed: between(0.045, 0.085),
      swayAmp: between(0.02, 0.06),
      swayRate: between(0.4, 0.9),
      swayPhase: between(0, Math.PI * 2),
      rot: [between(0, Math.PI * 2), between(0, Math.PI * 2), between(0, Math.PI * 2)],
      spin: [signed(0.3, 1.1), signed(0.2, 0.6), signed(0.3, 1.1)],
      scale: between(look.petalScale[0], look.petalScale[1]) * (side === "back" ? 0.9 : 1),
    };
  });

  const sparkles: SparkleSpec[] = Array.from({ length: opts.lowEnd ? LEGENDARY_SPARKLES.lowEnd : LEGENDARY_SPARKLES.full }, (_, i) => {
    const side = i % 2 === 0 ? "front" : "back";
    return {
      side,
      x: between(-0.85, 0.85),
      y: between(-0.5, 0.75),
      z: side === "front" ? between(0.06, 0.7) : -between(0.06, 0.7),
      size: between(5, 12),
      phase: between(0, Math.PI * 2),
      rate: between(1.2, 2.6),
    };
  });

  const activeMs = opts.lowEnd ? LEGENDARY_ACTIVE_MS.lowEnd : LEGENDARY_ACTIVE_MS.full;
  return {
    variant,
    lowEnd: opts.lowEnd,
    look,
    petals,
    sparkles,
    ribbon: {
      radius: 0.58,
      depth: 0.42,
      bottom: -0.34,
      top: 0.22,
      turns: 2.25,
      tubularSegments: opts.lowEnd ? 120 : 240,
      radialSegments: opts.lowEnd ? 4 : 6,
      thickness: 0.0085,
    },
    hitMs: Math.max(0, opts.hitMs),
    activeMs,
    settleMs: LEGENDARY_SETTLE_MS,
    endMs: activeMs + LEGENDARY_SETTLE_MS,
    pulseMs: LEGENDARY_PULSE_MS,
  };
}

/** 0 -> 1 while settling (after `activeMs`). */
function settled(plan: LegendaryScenePlan, t: number): number {
  return smoothstep(plan.activeMs, plan.endMs, t);
}

/** How present each layer is at `t` (0..1): the entrance and the settle. */
export function legendaryLevels(plan: LegendaryScenePlan, t: number) {
  const s = settled(plan, t);
  const [arriveFrom, arriveTo] = LEGENDARY_ARRIVAL_MS;
  const breathing = t < plan.activeMs ? 0.88 + 0.12 * Math.sin((t / 2400) * Math.PI) : 1;
  return {
    art: smoothstep(arriveFrom, arriveTo, t),
    petals: smoothstep(900, 2400, t) * (1 - s),
    sparkles: smoothstep(1200, 3000, t) * (1 - s),
    ribbon: smoothstep(1400, 3200, t) * (1 - 0.65 * s),
    glow: smoothstep(600, 2200, t) * (1 - 0.4 * s) * lerp(breathing, 1, s),
  };
}

/**
 * The camera at `t`: its distance as a fraction of the distance at which the picture is exactly the poster's size,
 * and the sway (radians). Held at the poster's pose until the picture has arrived, then eased in and out.
 */
export function legendaryCameraPose(plan: LegendaryScenePlan, t: number): { distance: number; yaw: number; pitch: number } {
  const arrived = LEGENDARY_ARRIVAL_MS[1];
  const push = easeInOutSine((t - arrived) / PUSH_MS);
  const envelope = smoothstep(arrived, arrived + ENVELOPE_IN_MS, t) * (1 - settled(plan, t));
  const since = Math.max(0, t - arrived);
  const rad = Math.PI / 180;
  return {
    distance: lerp(1, PUSH_TO, push),
    yaw: LEGENDARY_YAW_DEG * rad * envelope * Math.sin((since / LEGENDARY_YAW_PERIOD_MS) * Math.PI * 2),
    pitch: PITCH_DEG * rad * envelope * Math.sin((since / PITCH_PERIOD_MS) * Math.PI * 2),
  };
}

export type PetalPose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; scale: number };

/** Where one petal is at `t` (it loops through its fall; its size is 0 at both ends of the fall and before/after). */
export function legendaryPetalPose(plan: LegendaryScenePlan, petal: PetalSpec, t: number, level: number): PetalPose {
  const seconds = t / 1000;
  const range = LEGENDARY_FALL.top - LEGENDARY_FALL.bottom;
  const progressRaw = petal.phase + (seconds * petal.fallSpeed) / range;
  const progress = progressRaw - Math.floor(progressRaw);
  const edge = smoothstep(0, 0.08, progress) * (1 - smoothstep(0.86, 1, progress));
  return {
    x: petal.x + petal.swayAmp * Math.sin(seconds * petal.swayRate + petal.swayPhase),
    y: plan.look.drift === "rise" ? LEGENDARY_FALL.bottom + progress * range : LEGENDARY_FALL.top - progress * range,
    z: petal.z,
    // A diamond is seen nearly side-on, its table tipped only a little towards the camera (0.14 to 0.34 rad): the classic
    // diamond silhouette (a flat-topped crown over the pointed pavilion) with a sliver of the table, never a flat disc
    // from above or a bare cone from below; it turns about its own axis with a gentle rock. A petal tumbles.
    ...(plan.look.particle === "diamond"
      ? {
          rx: 0.24 + 0.1 * Math.sin(petal.rot[0] + 0.35 * petal.spin[0] * seconds),
          ry: petal.rot[1] + 1.6 * petal.spin[1] * seconds,
          rz: 0.18 * Math.sin(petal.rot[2] + 0.3 * petal.spin[2] * seconds),
        }
      : {
          rx: petal.rot[0] + petal.spin[0] * seconds,
          ry: petal.rot[1] + petal.spin[1] * seconds,
          rz: petal.rot[2] + petal.spin[2] * seconds,
        }),
    scale: petal.scale * edge * clamp01(level),
  };
}

/** The light sweep's position across the picture at `t` (-0.4 .. 2: along x + 0.6 y in texture space), or null. */
export function legendarySweep(plan: LegendaryScenePlan, t: number): number | null {
  const first = LEGENDARY_ARRIVAL_MS[1] + 600;
  if (t < first || t >= plan.activeMs) return null;
  const into = (t - first) % plan.look.sweepEveryMs;
  if (into >= plan.look.sweepMs) return null;
  return lerp(-0.4, 2, easeInOutSine(into / plan.look.sweepMs));
}

/** The pulse ring for the latest pulse that has started by `t` (radius in picture units, alpha 0..1), or null. */
export function legendaryPulse(plan: LegendaryScenePlan, pulses: readonly number[], t: number): { radius: number; alpha: number } | null {
  let start: number | null = null;
  for (const p of pulses) if (p <= t && (start === null || p > start)) start = p;
  if (start === null || t - start >= plan.pulseMs) return null;
  const k = (t - start) / plan.pulseMs;
  return { radius: lerp(0.12, 0.75, 1 - Math.pow(1 - k, 3)), alpha: smoothstep(0, 0.12, k) * Math.pow(1 - k, 1.5) * 0.9 };
}

/** Whether the scene still has to draw frames at `t`: until it has settled, and while a pulse is (or will be) showing. */
export function legendarySceneNeedsFrames(plan: LegendaryScenePlan, t: number, pulses: readonly number[]): boolean {
  return t < plan.endMs || pulses.some((p) => t < p + plan.pulseMs);
}
