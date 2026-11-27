import { giftRevealTimeline, type GiftEffectMotion, type GiftEffectPlan } from "@/lib/gift-effect-plan";
import type { GiftItemSlug } from "@/lib/gifts-data";

// Signature motions: a few gifts replace the stage's generic "art rises in" entrance with an animation of their own
// (GiftSignatureMotion, rendered by GiftStage, so the marketplace Preview and the recipient's open screen play the same
// thing). Pure and deterministic (no randomness at render time: particles come from a seeded generator, so server and
// client markup match), client-safe, no I/O, unit-tested (gift-signature-motion.test.ts).
//
//   wave               the hand swings side to side around its wrist (decaying +-18deg to +-6deg) with motion lines.
//   high-five          the art is split into a left and a right half (the same image twice, clipped), the halves swing
//                      in from the sides and meet with a flash, a shockwave ring and clap lines, then the whole image.
//   balloon-release    a gift box appears, its lid pops and the balloon bunch rises out of it, sways and hovers.
//   confetti-rise      a burst of confetti launches from the bottom and flutters up, the confetti icon rises in.
//   heartbeat          the Heartbeat Note rises in and, from the name's step, pulsates like a heartbeat: a smooth
//                      two-part beat ("lub-dub": a swell, back to rest, a smaller swell, back to rest, a pause) several
//                      times, each beat with a soft glow behind the note, a ring spreading from it and a light running
//                      along its pulse line. The swell returns to exactly the resting size, eased in and out (a tween,
//                      not a spring): the only signature scale that rises and comes back, on purpose (allow-listed in
//                      the test, like the like heart's `post-heart-pulse`).
//
// Every track animates transform and opacity only, has a finite length and fills "backwards" only: before its delay it
// holds its first keyframe, after its end the element's own CSS (globals.css "Gift signature motions") is the final
// pose, which is the gift's plain art at rest (transient layers rest at opacity 0). Timing hangs off the reveal's
// timeline: the key beat (the hand starting to wave, the hands' impact, the balloons out of the box, the confetti icon
// in place) lands on the gift name's step, which is also where GiftReveal places the tier sound's hit.
// Reduced motion ("still"): the final pose with one short fade, no particles. A low-end device ("light"): fewer
// particles, no 3D flutter, no hover, shorter swings.

export type GiftSignatureKind = "wave" | "high-five" | "balloon-release" | "confetti-rise" | "heartbeat";

/** The gifts (by item slug) that have a signature motion. */
export const GIFT_SIGNATURES: Readonly<Partial<Record<GiftItemSlug, GiftSignatureKind>>> = {
  wave: "wave",
  "high-five": "high-five",
  "birthday-balloons": "balloon-release",
  confetti: "confetti-rise",
  "heartbeat-note": "heartbeat",
};

/** The Heartbeat Note's music note (fraction of the art's box): the beat swells around it, the glow and rings start here. */
export const HEARTBEAT_CENTER = { x: 0.6, y: 0.52 } as const;

/** The Heartbeat Note's pulse line (fraction of the art's box): its height and where it starts and ends. */
export const HEARTBEAT_LINE = { y: 0.578, from: 0.1, to: 0.9 } as const;

/** One heartbeat (ms): the swell ("lub"), back, the smaller swell ("dub"), back, then the pause before the next. */
export const HEARTBEAT = { periodMs: 900, lubScale: 1.1, dubScale: 1.05, beats: { full: 6, light: 3 } } as const;

/** No signature runs longer than this (ms), whatever the tier. */
export const SIGNATURE_MAX_MS = 8000;

/** Confetti colours: the gift tiers' hues plus the brand's warm accents. */
export const SIGNATURE_PALETTE = ["#ffcc4d", "#ff5fa2", "#4fa3ff", "#4cd07d", "#b26bff", "#ff8a3d", "#3fd6c6"] as const;

/** Where the High five art is split (fraction of its width): the column where the two hands touch in the icon. */
export const HIGH_FIVE_SPLIT = 0.5;

/** Where the hands touch in the High five art (fraction of the art's box): the flash, ring and clap lines start here. */
export const HIGH_FIVE_CONTACT = { x: 0.5, y: 0.42 } as const;

/** The Wave's pivot (fraction of the art's box): the forearm in the cuff, so the hand swings from below the wrist. */
export const WAVE_PIVOT = { x: 0.7, y: 0.84 } as const;

/** The balloon bunch's anchor (fraction of the art's box): where its strings meet; it grows from and sways around it. */
export const BALLOON_ANCHOR = { x: 0.51, y: 0.87 } as const;

/** The gift box the balloons come out of (fractions of the art's box). */
export const BALLOON_BOX = { x: 0.51, top: 0.74, width: 0.36, height: 0.24 } as const;

export type SignatureKeyframe = { offset: number; transform?: string; opacity?: number; easing?: string };

export type SignatureTrack = {
  delayMs: number;
  durationMs: number;
  /** Always finite. */
  iterations: number;
  keyframes: SignatureKeyframe[];
};

export type SignatureParticle = {
  /** The data-sig id of its track. */
  id: string;
  shape: "rect" | "circle" | "line";
  color: string;
  /** Start position, as a fraction of the art's box (its centre). */
  x: number;
  y: number;
  /** Size in px. */
  width: number;
  height: number;
};

export type GiftSignaturePlan = {
  kind: GiftSignatureKind;
  motion: GiftEffectMotion;
  /** Track per data-sig id; a layer without a track sits in its final (CSS) pose. */
  tracks: Record<string, SignatureTrack>;
  particles: SignatureParticle[];
  /** The key beat, aligned with the name's step (the sound's hit). */
  keyBeatMs: number;
  /** When the art is in place and fully visible. */
  arrivedMs: number;
  /** When the last track has finished. */
  endMs: number;
};

/** The signature of a reveal's items: only a single-item gift has one (a box keeps the plain stage). */
export function giftSignatureFor(items: readonly { slug: string }[]): GiftSignatureKind | null {
  if (items.length !== 1) return null;
  return (GIFT_SIGNATURES as Readonly<Record<string, GiftSignatureKind>>)[items[0].slug] ?? null;
}

/** The reveal's cue for the key beat: the gift name's step (GiftReveal places the sound's hit there too). */
export function signatureCueMs(effect: GiftEffectPlan): number {
  const timeline = giftRevealTimeline(effect, { hasMessage: false });
  return timeline.steps.find((s) => s.step === "name")?.delayMs ?? 0;
}

/** A small seeded generator (mulberry32): the same seed always gives the same particles. */
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

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const px = (n: number) => `${r1(n)}px`;
const deg = (n: number) => `${r1(n)}deg`;

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_IN_OUT = "cubic-bezier(0.45, 0, 0.55, 1)";
const EASE_IN = "cubic-bezier(0.55, 0, 0.85, 0.4)";

type Key = { at: number; transform?: string; opacity?: number; easing?: string };

/** A track from keys at absolute times (ms from the reveal's start); each key's easing leads to the next key. */
function track(keys: Key[], iterations = 1): SignatureTrack {
  const start = keys[0].at;
  const end = keys[keys.length - 1].at;
  const span = Math.max(1, end - start);
  return {
    delayMs: Math.round(start),
    durationMs: Math.round(span),
    iterations,
    keyframes: keys.map((k) => ({
      offset: r3((k.at - start) / span),
      ...(k.transform !== undefined ? { transform: k.transform } : {}),
      ...(k.opacity !== undefined ? { opacity: k.opacity } : {}),
      ...(k.easing ? { easing: k.easing } : {}),
    })),
  };
}

function trackEnd(t: SignatureTrack): number {
  return t.delayMs + t.durationMs * t.iterations;
}

function finish(
  kind: GiftSignatureKind,
  motion: GiftEffectMotion,
  tracks: Record<string, SignatureTrack>,
  particles: SignatureParticle[],
  keyBeatMs: number,
  arrivedMs: number,
): GiftSignaturePlan {
  const endMs = Math.max(0, ...Object.values(tracks).map(trackEnd));
  return { kind, motion, tracks, particles, keyBeatMs: Math.round(keyBeatMs), arrivedMs: Math.round(arrivedMs), endMs };
}

/** Reduced motion: the final pose, the art fading in once. */
function stillPlan(kind: GiftSignatureKind, fadeMs: number): GiftSignaturePlan {
  const fade = track([
    { at: 0, opacity: 0, easing: "ease-out" },
    { at: fadeMs, opacity: 1 },
  ]);
  return finish(kind, "still", { art: fade }, [], 0, fadeMs);
}

function wavePlan(motion: GiftEffectMotion, hit: number, size: number): GiftSignaturePlan {
  const light = motion === "light";
  const art = track([
    { at: 0, transform: `translateY(${px(size * 0.08)})`, opacity: 0, easing: EASE_OUT },
    { at: hit, transform: "translateY(0px)", opacity: 1 },
  ]);
  // Decaying swings around the wrist, each extreme eased in and out like a real wave.
  const swingMs = light ? 1100 : 1800;
  const angles = light ? [0, 14, -9, 0] : [0, 18, -14, 10, -6, 0];
  const at = light ? [0, 0.26, 0.62, 1] : [0, 0.14, 0.36, 0.58, 0.8, 1];
  const swing = track(angles.map((a, i) => ({ at: hit + at[i] * swingMs, transform: `rotate(${deg(a)})`, easing: EASE_IN_OUT })));
  const tracks: Record<string, SignatureTrack> = { art, swing };
  if (!light) {
    // Motion lines flick on beside the fingers at each extreme of the swing (end side for +, start side for -).
    const pulse = (extremes: number[], away: 1 | -1) =>
      track(
        extremes.flatMap((f, i) => {
          const t = hit + f * swingMs;
          const strength = i === 0 ? 0.9 : 0.6;
          return [
            { at: t - 160, opacity: 0, transform: "translateX(0px)", easing: EASE_OUT },
            { at: t, opacity: strength, transform: "translateX(0px)", easing: "ease-in" },
            { at: t + 220, opacity: 0, transform: `translateX(${px(away * size * 0.02)})` },
          ];
        }),
      );
    tracks.linesEnd = pulse([0.14, 0.58], 1);
    tracks.linesStart = pulse([0.36, 0.8], -1);
  }
  return finish("wave", motion, tracks, [], hit, hit);
}

/** The clip of each High five half (CSS inset(): top right bottom left, in %). Together they cover the art exactly. */
export function highFiveClips(split: number = HIGH_FIVE_SPLIT): { start: string; end: string; startWidth: number; endWidth: number } {
  const s = r3(split * 100);
  const e = r3(100 - s);
  return { start: `inset(0% ${e}% 0% 0%)`, end: `inset(0% 0% 0% ${s}%)`, startWidth: s, endWidth: e };
}

/** The halves' resting transform: identity, so at the impact they line up pixel for pixel with the whole art. */
export const HIGH_FIVE_REST = "translateX(0px) rotate(0deg)";

function highFivePlan(motion: GiftEffectMotion, hit: number, size: number): GiftSignaturePlan {
  const light = motion === "light";
  const impact = hit;
  // The halves stay on screen a moment after they meet, then the whole art takes over on the same frame.
  const handover = impact + 80;
  const half = (side: -1 | 1) =>
    track([
      { at: 0, transform: `translateX(${px(side * size * 0.62)}) rotate(${deg(light ? 0 : side * 12)})`, opacity: 0, easing: EASE_IN },
      { at: impact * 0.35, transform: `translateX(${px(side * size * 0.4)}) rotate(${deg(light ? 0 : side * 8)})`, opacity: 1, easing: EASE_IN },
      { at: impact, transform: HIGH_FIVE_REST, opacity: 1 },
      { at: handover, transform: HIGH_FIVE_REST, opacity: 1 },
    ]);
  const tracks: Record<string, SignatureTrack> = {
    art: track([
      { at: 0, opacity: 0 },
      { at: handover, opacity: 0 },
    ]),
    halfStart: half(-1),
    halfEnd: half(1),
    flash: track([
      { at: impact, transform: "scale(0.5)", opacity: 0, easing: "ease-out" },
      { at: impact + 90, transform: "scale(1)", opacity: 0.55, easing: "ease-out" },
      { at: impact + 420, transform: "scale(1.25)", opacity: 0 },
    ]),
    ring: track([
      { at: impact, transform: "scale(0.3)", opacity: 0, easing: "linear" },
      { at: impact + 40, transform: "scale(0.42)", opacity: 0.85, easing: EASE_OUT },
      { at: impact + (light ? 500 : 650), transform: "scale(2.2)", opacity: 0 },
    ]),
  };
  const particles: SignatureParticle[] = [];
  if (!light) {
    // Clap lines: short strokes flying out of the contact point in an upper fan and to the sides.
    const angles = [-150, -118, -90, -62, -30, 180, 0, -90];
    angles.forEach((a, i) => {
      const id = `clap${i}`;
      const near = size * (i === 7 ? 0.05 : 0.08);
      const far = size * (i === 7 ? 0.2 : 0.24);
      const rotate = `rotate(${deg(a + 90)})`;
      tracks[id] = track([
        { at: impact + (i % 2) * 30, transform: `${rotate} translateY(${px(-near)})`, opacity: 0, easing: EASE_OUT },
        { at: impact + 90 + (i % 2) * 30, transform: `${rotate} translateY(${px(-(near + far) / 2)})`, opacity: 1, easing: EASE_OUT },
        { at: impact + 480 + (i % 2) * 30, transform: `${rotate} translateY(${px(-far)})`, opacity: 0 },
      ]);
      particles.push({
        id,
        shape: "line",
        color: i % 3 === 0 ? "#ffffff" : SIGNATURE_PALETTE[0],
        x: HIGH_FIVE_CONTACT.x,
        y: HIGH_FIVE_CONTACT.y,
        width: Math.max(2, r1(size * 0.014)),
        height: r1(size * 0.07),
      });
    });
  }
  return finish("high-five", motion, tracks, particles, impact, handover);
}

function balloonPlan(motion: GiftEffectMotion, hit: number, size: number, random: () => number, short: boolean): GiftSignaturePlan {
  const light = motion === "light";
  const h = hit;
  const boxIn = h * 0.3;
  const pop = h * 0.45;
  const riseStart = h * 0.5;
  const settle = h + (light ? 450 : 700);
  const lift = (n: number) => `translateY(${px(size * n)})`;
  const tracks: Record<string, SignatureTrack> = {
    box: track([
      { at: 0, transform: lift(0.12), opacity: 0, easing: EASE_OUT },
      { at: boxIn, transform: lift(0), opacity: 1 },
      { at: h, transform: lift(0), opacity: 1, easing: "ease-in" },
      { at: h + 500, transform: lift(0.14), opacity: 0 },
    ]),
    lid: track([
      { at: 0, transform: `${lift(0.12)} rotate(0deg)`, opacity: 0, easing: EASE_OUT },
      { at: boxIn, transform: `${lift(0)} rotate(0deg)`, opacity: 1 },
      { at: pop, transform: `${lift(0)} rotate(0deg)`, opacity: 1, easing: EASE_OUT },
      { at: pop + 280, transform: `translate(${px(-size * 0.09)}, ${px(-size * 0.2)}) rotate(-26deg)`, opacity: 1, easing: "ease-in" },
      { at: pop + 620, transform: `translate(${px(-size * 0.16)}, ${px(-size * 0.12)}) rotate(-48deg)`, opacity: 0 },
    ]),
    // The bunch grows out of the box from where its strings meet, rising as it stretches to full size.
    art: track([
      { at: riseStart, transform: `${lift(0.04)} scale(0.15)`, opacity: 0, easing: "linear" },
      { at: riseStart + 90, transform: `${lift(0.038)} scale(0.18)`, opacity: 1, easing: EASE_OUT },
      { at: h, transform: `${lift(0.012)} scale(0.86)`, opacity: 1, easing: EASE_IN_OUT },
      { at: settle, transform: `${lift(0)} scale(1)`, opacity: 1 },
    ]),
  };
  if (!light) {
    tracks.sway = track(
      [0, 4, -3, 1.5, 0].map((a, i) => ({ at: riseStart + i * 420, transform: `rotate(${deg(a)})`, easing: EASE_IN_OUT })),
    );
    // Then it hovers, twice (once in a Common reveal's shorter score), and comes to rest.
    tracks.hover = track(
      [
        { at: settle, transform: lift(0), easing: EASE_IN_OUT },
        { at: settle + 1200, transform: lift(-0.025), easing: EASE_IN_OUT },
        { at: settle + 2400, transform: lift(0) },
      ],
      short ? 1 : 2,
    );
  }
  const particles: SignatureParticle[] = [];
  const count = light ? 4 : 8;
  for (let i = 0; i < count; i++) {
    const id = `bit${i}`;
    const side = i % 2 === 0 ? -1 : 1;
    const dx = side * size * (0.12 + random() * 0.24);
    const dy = -size * (0.22 + random() * 0.26);
    const spin = side * (200 + random() * 300);
    const start = pop + 40 + random() * 120;
    const dur = 800 + random() * 400;
    tracks[id] = track([
      { at: start, transform: "translate(0px, 0px) rotate(0deg)", opacity: 0, easing: EASE_OUT },
      { at: start + dur * 0.15, transform: `translate(${px(dx * 0.35)}, ${px(dy * 0.45)}) rotate(${deg(spin * 0.25)})`, opacity: 1, easing: EASE_OUT },
      { at: start + dur, transform: `translate(${px(dx)}, ${px(dy)}) rotate(${deg(spin)})`, opacity: 0 },
    ]);
    particles.push(confettiPiece(id, BALLOON_BOX.x + (random() - 0.5) * 0.12, BALLOON_BOX.top + 0.01, size, random));
  }
  return finish("balloon-release", motion, tracks, particles, h, h);
}

function confettiPiece(id: string, x: number, y: number, size: number, random: () => number): SignatureParticle {
  const pick = random();
  const shape: SignatureParticle["shape"] = pick < 0.6 ? "rect" : pick < 0.85 ? "circle" : "line";
  const color = SIGNATURE_PALETTE[Math.floor(random() * SIGNATURE_PALETTE.length) % SIGNATURE_PALETTE.length];
  const unit = size / 60;
  const dims =
    shape === "rect"
      ? { width: unit * (3.6 + random() * 1.6), height: unit * (1.8 + random() * 0.9) }
      : shape === "circle"
        ? (() => {
            const d = unit * (2.2 + random() * 0.9);
            return { width: d, height: d };
          })()
        : { width: unit * (1 + random() * 0.4), height: unit * (5 + random() * 2) };
  return { id, shape, color, x: r3(x), y: r3(y), width: Math.max(2, r1(dims.width)), height: Math.max(2, r1(dims.height)) };
}

function confettiPlan(motion: GiftEffectMotion, hit: number, size: number, random: () => number): GiftSignaturePlan {
  const light = motion === "light";
  const tracks: Record<string, SignatureTrack> = {
    // The confetti icon rises into place as the centrepiece while the burst goes up around it.
    art: track([
      { at: 80, transform: `translateY(${px(size * 0.1)})`, opacity: 0, easing: EASE_OUT },
      { at: hit, transform: `translateY(${px(size * 0.02)})`, opacity: 1, easing: EASE_OUT },
      { at: hit + 220, transform: "translateY(0px)", opacity: 1 },
    ]),
  };
  const particles: SignatureParticle[] = [];
  const count = light ? 12 : 32;
  const stops = light ? [0, 0.5, 1] : [0, 0.2, 0.4, 0.6, 0.8, 1];
  for (let i = 0; i < count; i++) {
    const id = `piece${i}`;
    // A third each from the bottom centre and the two bottom edges, aimed up and a little inwards.
    const lane = i % 3;
    const x0 = lane === 0 ? 0.5 + (random() - 0.5) * 0.2 : lane === 1 ? -0.14 + random() * 0.16 : 0.98 + random() * 0.16;
    const y0 = 1.04 + random() * 0.08;
    const y1 = -0.3 + random() * 0.5;
    const dx = size * ((lane === 0 ? (random() - 0.5) * 0.9 : (lane === 1 ? 1 : -1) * (0.1 + random() * 0.3)));
    const dy = -size * (y0 - y1);
    const sway = size * (0.025 + random() * 0.045) * (random() < 0.5 ? -1 : 1);
    const turns = 1.5 + random() * 2;
    const spinZ = (random() < 0.5 ? -1 : 1) * (160 + random() * 380);
    const flipX = 360 * turns;
    const flipY = 180 + random() * 360;
    const delay = random() * 280;
    const dur = (light ? 1400 : 1700) + random() * 900;
    tracks[id] = track(
      stops.map((t) => {
        // Decelerating rise (fast launch, slow near the top), a sideways flutter, fading out near the top.
        const rise = 1 - Math.pow(1 - t, 2.2);
        const x = dx * t + sway * Math.sin(t * Math.PI * 2 * (light ? 0.5 : 1.25));
        const y = dy * rise;
        const spin = light
          ? `rotate(${deg(spinZ * t)})`
          : `rotate(${deg(spinZ * t)}) rotateX(${deg(flipX * t)}) rotateY(${deg(flipY * t)})`;
        const opacity = t === 0 ? 0 : t >= 1 ? 0 : t <= 0.6 ? 1 : r3(1 - (t - 0.6) / 0.5);
        return { at: delay + t * dur, transform: `translate(${px(x)}, ${px(y)}) ${spin}`, opacity };
      }),
    );
    particles.push(confettiPiece(id, x0, y0, size, random));
  }
  return finish("confetti-rise", motion, tracks, particles, hit, hit + 220);
}

function heartbeatPlan(motion: GiftEffectMotion, hit: number, size: number, short: boolean): GiftSignaturePlan {
  const light = motion === "light";
  // A Common reveal's score is only ~4 s: fewer beats, so it ends within it.
  const beats = light || short ? HEARTBEAT.beats.light : HEARTBEAT.beats.full;
  const period = HEARTBEAT.periodMs;
  const tracks: Record<string, SignatureTrack> = {
    art: track([
      { at: 0, transform: `translateY(${px(size * 0.08)})`, opacity: 0, easing: EASE_OUT },
      { at: hit, transform: "translateY(0px)", opacity: 1 },
    ]),
  };
  // The beat: every swell eases in and out and returns to exactly scale(1) (a tween, no spring), then a pause.
  const beatKeys: Key[] = [];
  const glowKeys: Key[] = [];
  for (let i = 0; i < beats; i++) {
    const b = hit + i * period;
    beatKeys.push(
      { at: b, transform: "scale(1)", easing: EASE_IN_OUT },
      { at: b + 120, transform: `scale(${HEARTBEAT.lubScale})`, easing: EASE_IN_OUT },
      { at: b + 270, transform: "scale(1)", easing: EASE_IN_OUT },
      { at: b + 370, transform: `scale(${HEARTBEAT.dubScale})`, easing: EASE_IN_OUT },
      { at: b + 540, transform: "scale(1)", easing: EASE_IN_OUT },
    );
    glowKeys.push(
      { at: b, opacity: 0, easing: "ease-out" },
      { at: b + 120, opacity: 0.85, easing: EASE_IN_OUT },
      { at: b + 270, opacity: 0.25, easing: EASE_IN_OUT },
      { at: b + 370, opacity: 0.55, easing: "ease-in" },
      { at: b + 760, opacity: 0 },
    );
  }
  tracks.beat = track(beatKeys);
  tracks.glow = track(glowKeys);
  if (!light) {
    for (let i = 0; i < beats; i++) {
      const b = hit + i * period;
      tracks[`ring${i}`] = track([
        { at: b, transform: "scale(0.55)", opacity: 0, easing: "ease-out" },
        { at: b + 80, transform: "scale(0.66)", opacity: 0.7, easing: EASE_OUT },
        { at: b + 760, transform: "scale(1.9)", opacity: 0 },
      ]);
      // A light runs along the pulse line, left to right, through each beat.
      const travel = size * (HEARTBEAT_LINE.to - HEARTBEAT_LINE.from);
      tracks[`trace${i}`] = track([
        { at: b - 200, transform: "translateX(0px)", opacity: 0, easing: "linear" },
        { at: b - 60, transform: `translateX(${px(travel * 0.17)})`, opacity: 1, easing: "linear" },
        { at: b + 480, transform: `translateX(${px(travel * 0.83)})`, opacity: 1, easing: "linear" },
        { at: b + 620, transform: `translateX(${px(travel)})`, opacity: 0 },
      ]);
    }
  }
  return finish("heartbeat", motion, tracks, [], hit, hit);
}

const SEEDS: Record<GiftSignatureKind, number> = {
  wave: 1,
  "high-five": 2,
  "balloon-release": 0x5ba11,
  "confetti-rise": 0xc0ff37,
  heartbeat: 0x4ea7,
};

/**
 * The signature motion of a reveal: from the kind, the tier's effect plan (which already says still / light / full)
 * and the art's size in px (particle sizes and travel are in px). Same inputs, same plan.
 */
export function giftSignaturePlan(kind: GiftSignatureKind, effect: GiftEffectPlan, size: number): GiftSignaturePlan {
  if (effect.motion === "still") return stillPlan(kind, effect.durationMs);
  const hit = signatureCueMs(effect);
  const random = seededRandom(SEEDS[kind]);
  switch (kind) {
    case "wave":
      return wavePlan(effect.motion, hit, size);
    case "high-five":
      return highFivePlan(effect.motion, hit, size);
    case "balloon-release":
      return balloonPlan(effect.motion, hit, size, random, effect.tier === "COMMON");
    case "confetti-rise":
      return confettiPlan(effect.motion, hit, size, random);
    case "heartbeat":
      return heartbeatPlan(effect.motion, hit, size, effect.tier === "COMMON");
  }
}
