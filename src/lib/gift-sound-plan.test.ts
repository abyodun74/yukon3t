import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GIFT_TIERS, type GiftTierName } from "@/lib/gifts-data";
import {
  GIFT_SOUND_CHUNK_MS,
  GIFT_SOUND_DURATION_MS,
  GIFT_SOUND_FADE_IN_MS,
  GIFT_SOUND_LOOKAHEAD_MS,
  GIFT_SOUND_MUTE_FADE_MS,
  GIFT_SOUND_PEAK_CEILING,
  GIFT_SOUND_PITCH_CLASSES,
  GIFT_SOUND_STOP_FADE_MS,
  dueWindows,
  eventsInWindow,
  giftSoundPlan,
  hzToMidi,
  impulseResponseSamples,
  isArmFresh,
  mayStartGiftSound,
  noiseSamples,
  peakConcurrency,
  scheduleWindows,
  softClipCurve,
  voiceNodeCount,
  GIFT_SOUND_ARM_WINDOW_MS,
  type GiftSoundPlan,
} from "@/lib/gift-sound-plan";

// The hit times the reveal passes (giftRevealTimeline's "name" step at full motion), plus extremes.
const HIT: Record<GiftTierName, number> = { COMMON: 430, RARE: 760, EPIC: 1190, LEGENDARY: 2180 };
const plans = (lowEnd: boolean) => GIFT_TIERS.map((tier) => giftSoundPlan(tier, { lowEnd, hitMs: HIT[tier] }));
const all: GiftSoundPlan[] = [...plans(false), ...plans(true), ...GIFT_TIERS.flatMap((t) => [0, 99999].map((hitMs) => giftSoundPlan(t, { lowEnd: false, hitMs })))];
const end = (e: { atMs: number; durationMs: number }) => e.atMs + e.durationMs;

describe("giftSoundPlan durations", () => {
  it("Rare, Epic and Legendary last exactly 30, 60 and 100 s; Common is a short 3-5 s sparkle", () => {
    expect(GIFT_SOUND_DURATION_MS).toEqual({ COMMON: 4000, RARE: 30000, EPIC: 60000, LEGENDARY: 100000 });
    for (const p of all) {
      expect(p.durationMs).toBe(GIFT_SOUND_DURATION_MS[p.tier]);
      expect(p.cues.endMs).toBe(p.durationMs);
    }
    const common = giftSoundPlan("COMMON", { lowEnd: false, hitMs: 430 });
    expect(common.durationMs).toBeGreaterThanOrEqual(3000);
    expect(common.durationMs).toBeLessThanOrEqual(5000);
  });

  it("every event ends inside the score, and the held tail reaches exactly the end (a natural fade, no cut)", () => {
    for (const p of all) {
      for (const e of p.events) {
        expect(e.atMs).toBeGreaterThanOrEqual(0);
        expect(end(e)).toBeLessThanOrEqual(p.durationMs);
      }
      expect(Math.max(...p.events.map(end))).toBe(p.durationMs);
      expect(p.fadeOutMs).toBeGreaterThan(0);
      expect(p.fadeOutMs).toBeLessThan(p.durationMs / 2);
    }
  });

  it("the same duration on a low-end device", () => {
    for (const tier of GIFT_TIERS) {
      expect(giftSoundPlan(tier, { lowEnd: true, hitMs: HIT[tier] }).durationMs).toBe(giftSoundPlan(tier, { lowEnd: false, hitMs: HIT[tier] }).durationMs);
    }
  });

  it("sections are contiguous and in order, from 0 to the end, with build, climax and tail in order", () => {
    for (const p of all) {
      expect(p.sections[0].startMs).toBe(0);
      expect(p.sections[p.sections.length - 1].endMs).toBe(p.durationMs);
      for (let i = 1; i < p.sections.length; i++) expect(p.sections[i].startMs).toBe(p.sections[i - 1].endMs);
      expect(p.cues.hitMs).toBeLessThanOrEqual(p.cues.climaxMs);
      expect(p.cues.climaxMs).toBeLessThanOrEqual(p.cues.tailMs);
      expect(p.cues.tailMs).toBeLessThan(p.durationMs);
    }
    // The long tiers have a real decay tail after the climax.
    for (const tier of ["RARE", "EPIC", "LEGENDARY"] as const) {
      const p = giftSoundPlan(tier, { lowEnd: false, hitMs: HIT[tier] });
      expect(p.durationMs - p.cues.tailMs).toBeGreaterThanOrEqual(5000);
      expect(p.cues.climaxMs).toBeGreaterThan(p.durationMs * 0.4);
    }
  });

  it("the hit lands on the name the reveal shows (clamped to each tier's range)", () => {
    for (const tier of GIFT_TIERS) expect(giftSoundPlan(tier, { lowEnd: false, hitMs: HIT[tier] }).cues.hitMs).toBe(HIT[tier]);
    expect(giftSoundPlan("LEGENDARY", { lowEnd: false, hitMs: 0 }).cues.hitMs).toBe(900);
    expect(giftSoundPlan("LEGENDARY", { lowEnd: false, hitMs: 99999 }).cues.hitMs).toBe(4000);
    // The Legendary hit is an impact with thunder, exactly on the cue.
    const l = giftSoundPlan("LEGENDARY", { lowEnd: false, hitMs: 2180 });
    expect(l.events.some((e) => e.voice === "impact" && e.atMs === 2180)).toBe(true);
    expect(l.events.some((e) => e.voice === "thunder" && Math.abs(e.atMs - 2180) <= 50)).toBe(true);
  });
});

describe("scheduling", () => {
  it("events are sorted by start time (monotonic)", () => {
    for (const p of all) {
      for (let i = 1; i < p.events.length; i++) expect(p.events[i].atMs).toBeGreaterThanOrEqual(p.events[i - 1].atMs);
    }
  });

  it("windows are contiguous and never overlap, and every event falls in exactly one", () => {
    for (const p of all) {
      const windows = scheduleWindows(p.durationMs);
      expect(windows[0].startMs).toBe(0);
      expect(windows[windows.length - 1].endMs).toBe(p.durationMs);
      for (let i = 1; i < windows.length; i++) expect(windows[i].startMs).toBe(windows[i - 1].endMs);
      const counts = new Map(p.events.map((e) => [e, 0]));
      for (const w of windows) for (const e of eventsInWindow(p.events, w, p.durationMs)) counts.set(e, counts.get(e)! + 1);
      expect([...counts.values()].every((n) => n === 1)).toBe(true);
    }
  });

  it("a ticking scheduler hands out each window once, only a few seconds ahead of the clock", () => {
    const p = giftSoundPlan("LEGENDARY", { lowEnd: false, hitMs: 2180 });
    const windows = scheduleWindows(p.durationMs);
    let upTo = 0;
    const seen: number[] = [];
    for (let elapsed = 0; elapsed <= p.durationMs; elapsed += 500) {
      const due = dueWindows(windows, upTo, elapsed);
      for (const w of due) {
        expect(w.startMs).toBeLessThan(elapsed + GIFT_SOUND_LOOKAHEAD_MS);
        seen.push(w.index);
        upTo = w.index + 1;
      }
    }
    expect(seen).toEqual(windows.map((w) => w.index));
    // At the start only the first two chunks are scheduled, not the whole 100 s.
    expect(dueWindows(windows, 0, 0).length).toBe(Math.ceil(GIFT_SOUND_LOOKAHEAD_MS / GIFT_SOUND_CHUNK_MS));
  });
});

describe("no clicks, no clipping", () => {
  it("every voice ramps in and out", () => {
    for (const p of all) {
      for (const e of p.events) {
        expect(e.attackMs).toBeGreaterThanOrEqual(3);
        expect(e.releaseMs).toBeGreaterThanOrEqual(10);
        expect(e.attackMs).toBeLessThanOrEqual(e.durationMs);
        if (e.envelope === "sustain") expect(e.attackMs + e.releaseMs).toBeLessThanOrEqual(e.durationMs);
        expect(e.gain).toBeGreaterThan(0);
        expect(e.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a gentle 300-600 ms fade-in, and stop / mute fades under 150 ms", () => {
    for (const p of all) {
      expect(p.fadeInMs).toBe(GIFT_SOUND_FADE_IN_MS[p.tier]);
      expect(p.fadeInMs).toBeGreaterThanOrEqual(300);
      expect(p.fadeInMs).toBeLessThanOrEqual(600);
      expect(p.masterGain).toBeGreaterThan(0);
      expect(p.masterGain).toBeLessThanOrEqual(1);
    }
    expect(GIFT_SOUND_STOP_FADE_MS).toBeLessThan(150);
    expect(GIFT_SOUND_MUTE_FADE_MS).toBeLessThan(150);
  });

  it("the master ceiling is a documented constant the soft clip can never exceed", () => {
    expect(GIFT_SOUND_PEAK_CEILING).toBeCloseTo(0.708, 3);
    const curve = softClipCurve();
    const peak = Math.max(...Array.from(curve, Math.abs));
    expect(peak).toBeLessThanOrEqual(GIFT_SOUND_PEAK_CEILING);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThan(curve[i - 1]);
    // Near-linear for quiet signals: the clip only shapes peaks.
    const at = (x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];
    for (const x of [-0.15, -0.05, 0, 0.05, 0.15]) expect(Math.abs(at(x) - x)).toBeLessThan(0.01);
  });
});

describe("music", () => {
  it("every pitch is equal-tempered and in the tier's key (consonant by construction)", () => {
    for (const p of all) {
      for (const e of p.events) {
        if (e.voice === "drum" || e.voice === "impact") continue;
        for (const f of e.freqs) {
          const midi = hzToMidi(f);
          expect(Math.abs(midi - Math.round(midi))).toBeLessThan(0.01);
          expect(GIFT_SOUND_PITCH_CLASSES[p.tier]).toContain(((Math.round(midi) % 12) + 12) % 12);
        }
      }
    }
  });

  it("drums sit on the tempo's eighth-note grid from the hit", () => {
    for (const tier of ["RARE", "EPIC", "LEGENDARY"] as const) {
      const p = giftSoundPlan(tier, { lowEnd: false, hitMs: HIT[tier] });
      const eighth = 60000 / p.tempoBpm / 2;
      const drums = p.events.filter((e) => e.voice === "drum");
      expect(drums.length).toBeGreaterThan(8);
      for (const d of drums) {
        const steps = (d.atMs - p.cues.hitMs) / eighth;
        expect(Math.abs(steps - Math.round(steps)) * eighth).toBeLessThanOrEqual(1);
      }
    }
  });

  it("tiers clearly differ in size: more layers, impacts and thunder as the tier rises", () => {
    const [c, r, e, l] = plans(false);
    const count = (p: GiftSoundPlan, v: string) => p.events.filter((x) => x.voice === v).length;
    expect(c.events.length).toBeLessThan(r.events.length);
    expect(r.events.length).toBeLessThan(e.events.length);
    expect(e.events.length).toBeLessThan(l.events.length);
    expect(count(c, "drum") + count(c, "impact") + count(c, "thunder")).toBe(0);
    expect(count(r, "thunder")).toBe(0);
    expect(count(e, "thunder")).toBeGreaterThan(0);
    expect(count(l, "thunder")).toBeGreaterThan(count(e, "thunder"));
    expect(count(r, "impact")).toBeLessThan(count(e, "impact"));
    expect(count(e, "impact")).toBeLessThan(count(l, "impact"));
    expect(count(e, "choir")).toBeGreaterThan(0);
    expect(new Set(l.events.map((x) => x.voice)).size).toBeGreaterThanOrEqual(10);
  });

  it("is deterministic: the same input gives the same score, and the code has no randomness or clock", () => {
    for (const tier of GIFT_TIERS) {
      expect(giftSoundPlan(tier, { lowEnd: false, hitMs: 1000 })).toEqual(giftSoundPlan(tier, { lowEnd: false, hitMs: 1000 }));
    }
    const src = readFileSync(path.join(process.cwd(), "src/lib/gift-sound-plan.ts"), "utf8");
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date/);
    expect(noiseSamples(256)).toEqual(noiseSamples(256));
  });
});

describe("battery and CPU bounds", () => {
  it("keeps the number of simultaneous voices and nodes bounded", () => {
    for (const p of plans(false)) {
      const peak = peakConcurrency(p.events);
      expect(peak.voices).toBeLessThanOrEqual(24);
      expect(peak.nodes).toBeLessThanOrEqual(130);
    }
    for (const p of plans(true)) {
      const peak = peakConcurrency(p.events);
      expect(peak.voices).toBeLessThanOrEqual(14);
      expect(peak.nodes).toBeLessThanOrEqual(70);
    }
    // Even the 100 s score is a few hundred events, scheduled a few seconds at a time.
    expect(giftSoundPlan("LEGENDARY", { lowEnd: false, hitMs: 2180 }).events.length).toBeLessThan(400);
  });

  it("a low-end device gets a lighter layer set: no choir, brass, shimmer or drum clicks, a shorter reverb", () => {
    for (const tier of GIFT_TIERS) {
      const light = giftSoundPlan(tier, { lowEnd: true, hitMs: HIT[tier] });
      const full = giftSoundPlan(tier, { lowEnd: false, hitMs: HIT[tier] });
      expect(light.events.some((e) => ["choir", "brass", "shimmer"].includes(e.voice))).toBe(false);
      expect(light.events.some((e) => e.click)).toBe(false);
      expect(light.events.length).toBeLessThanOrEqual(full.events.length);
      expect(peakConcurrency(light.events).nodes).toBeLessThanOrEqual(peakConcurrency(full.events).nodes);
      expect(light.reverbSeconds).toBeLessThanOrEqual(1.6);
    }
  });

  it("counts nodes per voice", () => {
    const p = giftSoundPlan("LEGENDARY", { lowEnd: false, hitMs: 2180 });
    for (const e of p.events) expect(voiceNodeCount(e)).toBeGreaterThan(0);
  });

  it("pre-renders a decaying, click-free reverb once", () => {
    const [left, right] = impulseResponseSamples(8000, 2);
    expect(left.length).toBe(16000);
    expect(right).not.toEqual(left);
    const energy = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((s, x) => s + x * x, 0);
    expect(energy(left, 14400, 16000)).toBeLessThan(energy(left, 0, 1600) / 100);
    expect(Math.abs(left[left.length - 1])).toBe(0);
  });
});

describe("when sound may start", () => {
  const ok = { armed: true, muted: false, callActive: false, documentHidden: false, audioAvailable: true };
  it("needs the opening tap, and is refused when muted, in a call, hidden or without Web Audio", () => {
    expect(mayStartGiftSound(ok)).toBe(true);
    expect(mayStartGiftSound({ ...ok, armed: false })).toBe(false);
    expect(mayStartGiftSound({ ...ok, muted: true })).toBe(false);
    expect(mayStartGiftSound({ ...ok, callActive: true })).toBe(false);
    expect(mayStartGiftSound({ ...ok, documentHidden: true })).toBe(false);
    expect(mayStartGiftSound({ ...ok, audioAvailable: false })).toBe(false);
  });

  it("the tap counts for a limited time only", () => {
    expect(isArmFresh(null, 1000)).toBe(false);
    expect(isArmFresh(1000, 1000)).toBe(true);
    expect(isArmFresh(1000, 1000 + GIFT_SOUND_ARM_WINDOW_MS)).toBe(true);
    expect(isArmFresh(1000, 1001 + GIFT_SOUND_ARM_WINDOW_MS)).toBe(false);
    expect(isArmFresh(1000, 999)).toBe(false);
  });
});
