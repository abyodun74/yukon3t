import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bezierOvershoots, cssBeziers, keyframesOvershoot } from "@/components/motion-guard";
import { giftEffectPlan, giftRevealTimeline, type GiftEffectMotion } from "@/lib/gift-effect-plan";
import { GIFT_SOUND_DURATION_MS } from "@/lib/gift-sound-plan";
import { GIFT_ITEMS, GIFT_MARKET, GIFT_PRODUCTS, GIFT_TIERS, type GiftTierName } from "@/lib/gifts-data";
import {
  GIFT_SIGNATURES,
  HEARTBEAT,
  HEARTBEAT_CENTER,
  HEARTBEAT_LINE,
  HIGH_FIVE_REST,
  HIGH_FIVE_SPLIT,
  SIGNATURE_MAX_MS,
  SIGNATURE_PALETTE,
  WAVE_PIVOT,
  giftSignatureFor,
  giftSignaturePlan,
  highFiveClips,
  seededRandom,
  signatureCueMs,
  type GiftSignatureKind,
  type GiftSignaturePlan,
  type SignatureTrack,
} from "@/lib/gift-signature-motion";

// The signature motions of Wave, High five, Birthday Balloons, Confetti and the Heartbeat Note: the registry, the plans' determinism,
// their timing against the reveal's timeline (and the tier sound), the reduced-motion and low-end plans, the no-bounce
// rule for every scale they animate, and the High five seam.

const KINDS: GiftSignatureKind[] = ["wave", "high-five", "balloon-release", "confetti-rise", "heartbeat"];
const MOTIONS: GiftEffectMotion[] = ["full", "light", "still"];
const SIZES = [150, 190, 240, 280];
const options = (motion: GiftEffectMotion) => ({ reduce: motion === "still", lowEnd: motion === "light" });
const planFor = (kind: GiftSignatureKind, tier: GiftTierName, motion: GiftEffectMotion, size = 190) =>
  giftSignaturePlan(kind, giftEffectPlan(tier, options(motion)), size);
const tierOf = (slug: string): GiftTierName => {
  const product = GIFT_PRODUCTS.find((p) => !p.isBox && p.items[0].slug === slug)!;
  return GIFT_MARKET.find((g) => g.sku === product.sku)!.tier;
};
const scalesOf = (t: SignatureTrack) =>
  t.keyframes.flatMap((k) => [...(k.transform ?? "").matchAll(/\bscale\((-?[0-9.]+)\)/g)].map((m) => Number(m[1])));
const end = (t: SignatureTrack) => t.delayMs + t.durationMs * t.iterations;
const STRUCTURAL = new Set(["art", "swing", "sway", "hover", "beat"]);
/**
 * Tracks whose scale may rise and come back to where it started, with the reason (like KEYFRAME_ALLOW in
 * motion-defaults.test.ts). Each is still a tween (eased keyframes, no spring) and ends exactly at rest.
 */
const SCALE_RETURN_ALLOW: Record<string, string> = {
  "heartbeat/beat":
    "the Heartbeat Note's heartbeat pulse (lub-dub swells that return to exactly scale(1), eased in and out, finite), a rhythm like the like heart's post-heart-pulse, not an entrance or a settle",
};

function* everyPlan(): Generator<[string, GiftSignaturePlan, GiftTierName, GiftEffectMotion]> {
  for (const kind of KINDS)
    for (const tier of GIFT_TIERS)
      for (const motion of MOTIONS)
        for (const size of SIZES) yield [`${kind}/${tier}/${motion}/${size}`, planFor(kind, tier, motion, size), tier, motion];
}

describe("the registry", () => {
  it("maps exactly the five gifts, each an existing catalogue item and marketplace gift", () => {
    expect(Object.entries(GIFT_SIGNATURES).sort()).toEqual(
      [
        ["birthday-balloons", "balloon-release"],
        ["confetti", "confetti-rise"],
        ["heartbeat-note", "heartbeat"],
        ["high-five", "high-five"],
        ["wave", "wave"],
      ].sort(),
    );
    const slugs = new Set<string>(GIFT_ITEMS.map((i) => i.slug));
    for (const slug of Object.keys(GIFT_SIGNATURES)) {
      expect(slugs.has(slug), slug).toBe(true);
      expect(tierOf(slug), slug).toBeDefined();
    }
  });

  it("only a single-item gift gets a signature (a box keeps the plain stage)", () => {
    expect(giftSignatureFor([{ slug: "wave" }])).toBe("wave");
    expect(giftSignatureFor([{ slug: "confetti" }])).toBe("confetti-rise");
    expect(giftSignatureFor([{ slug: "wave" }, { slug: "high-five" }])).toBeNull();
    expect(giftSignatureFor([{ slug: "rose" }])).toBeNull();
    expect(giftSignatureFor([])).toBeNull();
  });
});

describe("determinism", () => {
  it("the same inputs give the same plan (no randomness at render time, so server and client markup match)", () => {
    for (const kind of KINDS) {
      for (const motion of MOTIONS) {
        expect(JSON.stringify(planFor(kind, "EPIC", motion))).toBe(JSON.stringify(planFor(kind, "EPIC", motion)));
      }
    }
    const a = seededRandom(42);
    const b = seededRandom(42);
    const seq = Array.from({ length: 20 }, () => a());
    expect(Array.from({ length: 20 }, () => b())).toEqual(seq);
    for (const n of seq) expect(n >= 0 && n < 1).toBe(true);
  });

  it("the plan code never reaches for Math.random, the clock or the DOM", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/gift-signature-motion.ts"), "utf8");
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|window\.|document\.|navigator\./);
  });
});

describe("every plan", () => {
  it("animates only transform and opacity, with finite tracks and well-formed keyframes", () => {
    for (const [label, plan] of everyPlan()) {
      for (const [id, t] of Object.entries(plan.tracks)) {
        const where = `${label} ${id}`;
        expect(Number.isInteger(t.iterations) && t.iterations >= 1 && t.iterations <= 3, where).toBe(true);
        expect(t.durationMs, where).toBeGreaterThan(0);
        expect(t.delayMs, where).toBeGreaterThanOrEqual(0);
        expect(t.keyframes[0].offset, where).toBe(0);
        expect(t.keyframes[t.keyframes.length - 1].offset, where).toBe(1);
        for (let i = 1; i < t.keyframes.length; i++) expect(t.keyframes[i].offset, where).toBeGreaterThanOrEqual(t.keyframes[i - 1].offset);
        for (const k of t.keyframes) {
          expect(Object.keys(k).every((key) => ["offset", "transform", "opacity", "easing"].includes(key)), where).toBe(true);
          if (k.opacity !== undefined) expect(k.opacity >= 0 && k.opacity <= 1, where).toBe(true);
          for (const ease of cssBeziers(k.easing ?? "")) expect(bezierOvershoots(ease), `${where} ${k.easing}`).toBe(false);
          expect(k.easing ?? "", where).not.toMatch(/\blinear\(|steps\(/);
        }
      }
    }
  });

  it("never overshoots a scale and settles back (the no-bounce rule): every scale only grows or only shrinks", () => {
    for (const [label, plan] of everyPlan()) {
      for (const [id, t] of Object.entries(plan.tracks)) {
        if (SCALE_RETURN_ALLOW[`${plan.kind}/${id}`]) continue;
        expect(keyframesOvershoot(scalesOf(t)), `${label} ${id}: ${scalesOf(t).join(" -> ")}`).toBe(false);
      }
    }
  });

  it("starts every transient layer invisible, so nothing shows before its moment (fill: backwards)", () => {
    for (const [label, plan] of everyPlan()) {
      for (const [id, t] of Object.entries(plan.tracks)) {
        if (STRUCTURAL.has(id)) continue;
        expect(t.keyframes[0].opacity, `${label} ${id}`).toBe(0);
      }
    }
  });

  it("gives every particle a track of its own", () => {
    for (const [label, plan] of everyPlan()) {
      const ids = plan.particles.map((p) => p.id);
      expect(new Set(ids).size, label).toBe(ids.length);
      for (const id of ids) expect(plan.tracks[id], `${label} ${id}`).toBeDefined();
    }
  });

  it("fits the reveal: the key beat lands on the name's step (the sound's hit), the art is in place before the last line, and it all ends within the tier's score", () => {
    for (const [label, plan, tier, motion] of everyPlan()) {
      const effect = giftEffectPlan(tier, options(motion));
      const timeline = giftRevealTimeline(effect, { hasMessage: false });
      const nameStep = timeline.steps.find((s) => s.step === "name")!.delayMs;
      expect(signatureCueMs(effect), label).toBe(nameStep);
      if (motion !== "still") expect(plan.keyBeatMs, label).toBe(nameStep);
      expect(plan.arrivedMs, label).toBeLessThanOrEqual(timeline.doneMs);
      expect(plan.endMs, label).toBe(Math.max(...Object.values(plan.tracks).map(end)));
      expect(plan.endMs, label).toBeLessThanOrEqual(SIGNATURE_MAX_MS);
      expect(plan.endMs, label).toBeLessThanOrEqual(GIFT_SOUND_DURATION_MS[tier]);
    }
  });

  it("each gift's own tier: Wave, High five and Confetti are Common, Birthday Balloons Epic, the Heartbeat Note Rare", () => {
    expect(["wave", "high-five", "confetti", "birthday-balloons", "heartbeat-note"].map(tierOf)).toEqual(["COMMON", "COMMON", "COMMON", "EPIC", "RARE"]);
  });
});

describe("reduced motion and low-end devices", () => {
  it("reduced motion: the final pose with one 300-400 ms fade, no particles, no swing", () => {
    for (const kind of KINDS) {
      for (const tier of GIFT_TIERS) {
        const plan = planFor(kind, tier, "still");
        expect(Object.keys(plan.tracks)).toEqual(["art"]);
        expect(plan.particles).toEqual([]);
        const fade = plan.tracks.art;
        expect(fade.delayMs).toBe(0);
        expect(fade.durationMs).toBeGreaterThanOrEqual(300);
        expect(fade.durationMs).toBeLessThanOrEqual(400);
        expect(fade.keyframes.map((k) => k.opacity)).toEqual([0, 1]);
        expect(fade.keyframes.every((k) => k.transform === undefined)).toBe(true);
      }
    }
  });

  it("a low-end device: fewer particles, no 3D flutter, no hover or sway, no motion lines, a shorter swing", () => {
    for (const kind of KINDS) {
      const full = planFor(kind, "EPIC", "full");
      const light = planFor(kind, "EPIC", "light");
      expect(light.particles.length).toBeLessThanOrEqual(full.particles.length);
      expect(Object.keys(light.tracks).length).toBeLessThanOrEqual(Object.keys(full.tracks).length);
      expect(JSON.stringify(light.tracks)).not.toMatch(/rotate[XY]\(/);
      for (const id of ["hover", "sway", "linesEnd", "linesStart"]) expect(light.tracks[id]).toBeUndefined();
      expect(light.endMs).toBeLessThanOrEqual(full.endMs);
    }
    expect(planFor("confetti-rise", "COMMON", "full").particles).toHaveLength(32);
    expect(planFor("confetti-rise", "COMMON", "light").particles).toHaveLength(12);
    expect(planFor("high-five", "COMMON", "light").particles).toHaveLength(0);
  });
});

describe("Wave", () => {
  it("swings around the wrist with decaying amplitude (+-18deg down to +-6deg) over about 1.8 s, ending at rest", () => {
    const swing = planFor("wave", "COMMON", "full").tracks.swing;
    const angles = swing.keyframes.map((k) => Number(k.transform!.match(/rotate\((-?[0-9.]+)deg\)/)![1]));
    expect(angles[0]).toBe(0);
    expect(angles[angles.length - 1]).toBe(0);
    const extremes = angles.slice(1, -1);
    expect(extremes.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(extremes[0])).toBe(18);
    expect(Math.abs(extremes[extremes.length - 1])).toBe(6);
    for (let i = 1; i < extremes.length; i++) {
      expect(Math.sign(extremes[i])).toBe(-Math.sign(extremes[i - 1]));
      expect(Math.abs(extremes[i])).toBeLessThan(Math.abs(extremes[i - 1]));
    }
    expect(swing.durationMs).toBeGreaterThanOrEqual(1500);
    expect(swing.durationMs).toBeLessThanOrEqual(2000);
    expect(swing.iterations).toBe(1);
    // The pivot is low, at the forearm in the cuff, not the middle of the picture.
    expect(WAVE_PIVOT.y).toBeGreaterThanOrEqual(0.7);
  });
});

describe("High five", () => {
  it("the two clips cover the art exactly once: they meet at the split with no gap and no overlap", () => {
    const clips = highFiveClips();
    expect(clips.startWidth + clips.endWidth).toBe(100);
    expect(clips.startWidth).toBe(HIGH_FIVE_SPLIT * 100);
    const startRight = Number(clips.start.match(/^inset\(0% ([0-9.]+)% 0% 0%\)$/)![1]);
    const endLeft = Number(clips.end.match(/^inset\(0% 0% 0% ([0-9.]+)%\)$/)![1]);
    // The start half shows [0, 100 - startRight), the end half [endLeft, 100): the same line.
    expect(100 - startRight).toBe(endLeft);
    for (const split of [0.25, 0.5, 0.51, 0.333]) {
      const c = highFiveClips(split);
      expect(c.startWidth + c.endWidth).toBeCloseTo(100, 6);
    }
  });

  it("the halves come in from opposite sides and are both at rest (identity) at the impact, on the name's step", () => {
    for (const motion of ["full", "light"] as const) {
      const plan = planFor("high-five", "COMMON", motion);
      const { halfStart, halfEnd, art } = plan.tracks;
      const x0 = (t: SignatureTrack) => Number(t.keyframes[0].transform!.match(/translateX\((-?[0-9.]+)px\)/)![1]);
      expect(x0(halfStart)).toBeLessThan(0);
      expect(x0(halfEnd)).toBeGreaterThan(0);
      expect(x0(halfStart)).toBe(-x0(halfEnd));
      for (const t of [halfStart, halfEnd]) {
        const atImpact = t.keyframes.filter((k) => t.delayMs + k.offset * t.durationMs >= plan.keyBeatMs);
        expect(atImpact.length).toBeGreaterThan(0);
        for (const k of atImpact) expect(k.transform).toBe(HIGH_FIVE_REST);
      }
      // The whole art takes over on the very frame the halves go: same end, so no blink and no double image.
      expect(end(art)).toBe(end(halfStart));
      expect(end(art)).toBe(end(halfEnd));
      expect(art.keyframes.every((k) => k.opacity === 0)).toBe(true);
      expect(plan.arrivedMs).toBe(end(art));
    }
  });

  it("the impact: a flash and a shockwave ring from the contact point, and clap lines with full motion", () => {
    const plan = planFor("high-five", "COMMON", "full");
    expect(plan.tracks.flash.delayMs).toBe(plan.keyBeatMs);
    expect(plan.tracks.ring.delayMs).toBe(plan.keyBeatMs);
    expect(plan.particles.filter((p) => p.shape === "line").length).toBeGreaterThanOrEqual(6);
    // Soft, not a strobe: the flash peaks once and below full opacity.
    expect(Math.max(...plan.tracks.flash.keyframes.map((k) => k.opacity ?? 0))).toBeLessThanOrEqual(0.6);
  });
});

describe("Birthday Balloons", () => {
  it("box in, lid pops, then the bunch grows out of it to full size and the box goes", () => {
    const plan = planFor("balloon-release", "EPIC", "full");
    const { box, lid, art, hover } = plan.tracks;
    expect(lid.keyframes.length).toBeGreaterThanOrEqual(4);
    expect(art.delayMs).toBeGreaterThan(box.delayMs);
    const scales = scalesOf(art);
    expect(scales[0]).toBeLessThanOrEqual(0.2);
    expect(scales[scales.length - 1]).toBe(1);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1]);
    // Out of the box by the name's step, the box gone once the bunch has settled.
    expect(art.delayMs).toBeLessThan(plan.keyBeatMs);
    expect(box.keyframes[box.keyframes.length - 1].opacity).toBe(0);
    expect(lid.keyframes[lid.keyframes.length - 1].opacity).toBe(0);
    expect(hover.iterations).toBe(2);
    expect(plan.particles.length).toBeGreaterThan(0);
  });
});

describe("Confetti", () => {
  it("launches from the bottom, rises, flutters in 3D and fades near the top, in the palette", () => {
    const plan = planFor("confetti-rise", "COMMON", "full");
    for (const p of plan.particles) {
      expect(p.y).toBeGreaterThanOrEqual(1);
      expect(SIGNATURE_PALETTE as readonly string[]).toContain(p.color);
      const t = plan.tracks[p.id];
      const last = t.keyframes[t.keyframes.length - 1];
      const dy = Number(last.transform!.match(/translate\((-?[0-9.]+)px, (-?[0-9.]+)px\)/)![2]);
      expect(dy).toBeLessThan(0);
      expect(last.opacity).toBe(0);
      expect(last.transform).toMatch(/rotateX\(/);
    }
    const lanes = plan.particles.map((p) => (p.x < 0.3 ? "start" : p.x > 0.7 ? "end" : "centre"));
    expect(new Set(lanes)).toEqual(new Set(["start", "centre", "end"]));
  });
});

describe("Heartbeat Note", () => {
  it("pulsates from the name's step: smooth lub-dub swells around the note that always come back to exactly rest", () => {
    for (const motion of ["full", "light"] as const) {
      const plan = planFor("heartbeat", "RARE", motion);
      const beat = plan.tracks.beat;
      expect(beat.delayMs).toBe(plan.keyBeatMs);
      const scales = scalesOf(beat);
      expect(scales[0]).toBe(1);
      expect(scales[scales.length - 1]).toBe(1);
      expect(Math.max(...scales)).toBe(HEARTBEAT.lubScale);
      expect(Math.min(...scales)).toBe(1);
      const beats = motion === "full" ? HEARTBEAT.beats.full : HEARTBEAT.beats.light;
      expect(scales.filter((s) => s === HEARTBEAT.lubScale)).toHaveLength(beats);
      expect(scales.filter((s) => s === HEARTBEAT.dubScale)).toHaveLength(beats);
      expect(HEARTBEAT.dubScale).toBeLessThan(HEARTBEAT.lubScale);
      expect(HEARTBEAT.lubScale).toBeLessThanOrEqual(1.12);
      // Every step is eased in and out (a tween), never a spring or a step.
      for (const k of beat.keyframes.slice(0, -1)) expect(k.easing).toBe("cubic-bezier(0.45, 0, 0.55, 1)");
      // Only the beat scales up and back; every other scaled layer (the rings) only grows.
      for (const [id, t] of Object.entries(plan.tracks)) if (id !== "beat") expect(keyframesOvershoot(scalesOf(t)), id).toBe(false);
    }
  });

  it("a glow with every beat, and with full motion a ring and a light along the pulse line per beat", () => {
    const full = planFor("heartbeat", "RARE", "full");
    const ids = Object.keys(full.tracks);
    expect(ids.filter((id) => id.startsWith("ring"))).toHaveLength(HEARTBEAT.beats.full);
    expect(ids.filter((id) => id.startsWith("trace"))).toHaveLength(HEARTBEAT.beats.full);
    expect(Math.max(...full.tracks.glow.keyframes.map((k) => k.opacity ?? 0))).toBeLessThanOrEqual(0.9);
    const light = planFor("heartbeat", "RARE", "light");
    expect(Object.keys(light.tracks).sort()).toEqual(["art", "beat", "glow"]);
    expect(HEARTBEAT_CENTER.x).toBeGreaterThan(0.4);
    expect(HEARTBEAT_LINE.to).toBeGreaterThan(HEARTBEAT_LINE.from);
  });
});
