import { KITTEN_JUMP_AFTER_HIT_MS } from "@/lib/gift-composed-plan";
import type { GiftTierName } from "@/lib/gifts-data";

// The gift reveal's sound, by rarity tier: a pure, deterministic composition plan (no I/O, no randomness, no Web Audio),
// rendered by the lazily loaded synth in gift-sound-engine.ts and unit-tested in gift-sound-plan.test.ts. Everything is
// synthesized on the device from oscillators and one pre-rendered noise buffer: no audio files, no network.
//
//   COMMON     ~4 s: a bright sparkle (an E major pentatonic chime arpeggio, a bell cluster and a high shimmer).
//   RARE       30 s, D major, 90 bpm: a whoosh into the reveal hit, pad and bells, a drum build and riser, a climax
//              with brass, then a long decay tail.
//   EPIC       60 s, D minor, 72 bpm: thunder and a deep impact on the reveal, choir pad, taiko build, a thunderous
//              climax with two impacts, a resolution to D major and a tail with distant thunder.
//   LEGENDARY  100 s, D minor, 66 bpm: a swell under the light bloom, a massive impact as the name lands, two rises and
//              peaks with a quiet breath between, a final climax resolving bVI-bVII-I to D major, a 14 s tail.
//
// Every score ends exactly at its tier's duration with a natural fade. "Loud" means dense and powerful at a controlled
// loudness: the engine's master chain (fade-in, compressor, limiter and a soft-clip ceiling) never lets a sample exceed
// GIFT_SOUND_PEAK_CEILING, and the device volume stays in charge. A low-end device gets a lighter layer set (no choir,
// brass or shimmer, no drum clicks, quarter-note bells at most, a shorter reverb) for the same duration.

export const GIFT_SOUND_DURATION_MS: Record<GiftTierName, number> = {
  COMMON: 4000,
  RARE: 30000,
  EPIC: 60000,
  LEGENDARY: 100000,
};

/** The hard master ceiling (linear, about -3 dBFS). The soft-clip curve never outputs more than this. */
export const GIFT_SOUND_PEAK_CEILING = 0.708;
/** The opening fade-in of the master gain, so nothing blasts the moment the reveal opens. */
export const GIFT_SOUND_FADE_IN_MS: Record<GiftTierName, number> = { COMMON: 300, RARE: 450, EPIC: 500, LEGENDARY: 600 };
/** Stop, close, Escape, Back, a call, leaving: the output fades out this fast, then everything is torn down. */
export const GIFT_SOUND_STOP_FADE_MS = 100;
/** Mute fades this fast (then the audio clock is suspended); unmute fades back in over GIFT_SOUND_UNMUTE_FADE_MS. */
export const GIFT_SOUND_MUTE_FADE_MS = 80;
export const GIFT_SOUND_UNMUTE_FADE_MS = 250;
/** The scheduler places events in non-overlapping windows of this length, each window once, ahead of the audio clock. */
export const GIFT_SOUND_CHUNK_MS = 3000;
/** How far ahead of the audio clock a window is scheduled. */
export const GIFT_SOUND_LOOKAHEAD_MS = 3500;
/** How often the scheduler wakes up (a timer; the audio clock does the precise timing). */
export const GIFT_SOUND_TICK_MS = 500;
/** How long the opening tap's "go ahead" stays valid while the gift is being opened on the server. */
export const GIFT_SOUND_ARM_WINDOW_MS = 30000;

export type GiftSoundVoice =
  | "chime"
  | "bell"
  | "pad"
  | "choir"
  | "brass"
  | "shimmer"
  | "sub"
  | "drum"
  | "impact"
  | "thunder"
  | "riser"
  | "meow";

/** Where a voice sits: dry, a room's worth of reverb, or a hall's. */
export type GiftSoundSpace = "dry" | "room" | "hall";

export type GiftSoundEvent = {
  atMs: number;
  /** Total length including the release; every event ends at or before the score's duration. */
  durationMs: number;
  voice: GiftSoundVoice;
  /** Equal-tempered pitches (Hz); empty for unpitched voices (thunder, riser). Detune is the engine's. */
  freqs: number[];
  /** Linear peak gain of the whole voice, before the master chain. */
  gain: number;
  attackMs: number;
  releaseMs: number;
  /** "decay": percussive, decays from the peak across its length; "sustain": holds, then releases. */
  envelope: "decay" | "sustain";
  space: GiftSoundSpace;
  /** 0..1: how open the voice's filter is (pads, brass, choir). */
  brightness: number;
  /** A drum's noise click (dropped on a low-end device). */
  click?: boolean;
  /** Thunder: offsets (ms from its start) of the rumbling crackles. */
  crackles?: number[];
};

export const GIFT_SOUND_CUE_NAMES = ["hit", "climax", "tail"] as const;
export type GiftSoundCueName = (typeof GIFT_SOUND_CUE_NAMES)[number];

export type GiftSoundSection = { name: string; startMs: number; endMs: number };

export type GiftSoundCues = {
  /** The reveal hit, aligned with the gift's name arriving on screen. */
  hitMs: number;
  /** The start of the biggest moment; the reveal adds one soft glow here. */
  climaxMs: number;
  /** Where the decay tail starts. */
  tailMs: number;
  endMs: number;
};

export type GiftSoundPlan = {
  tier: GiftTierName;
  lowEnd: boolean;
  durationMs: number;
  tempoBpm: number;
  key: string;
  /** Linear master gain after the fade-in, before the compressor. */
  masterGain: number;
  fadeInMs: number;
  /** The master fades to silence over this, ending exactly at durationMs. */
  fadeOutMs: number;
  reverbSeconds: number;
  sections: GiftSoundSection[];
  /** Sorted by atMs. */
  events: GiftSoundEvent[];
  cues: GiftSoundCues;
};

// --- Pitch ----------------------------------------------------------------------------------------------------------

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Pitch classes (0 = C) each tier's score may use: its key's scale, consonant by construction. */
export const GIFT_SOUND_PITCH_CLASSES: Record<GiftTierName, number[]> = {
  // E major pentatonic: E F# G# B C#.
  COMMON: [4, 6, 8, 11, 1],
  // D major.
  RARE: [2, 4, 6, 7, 9, 11, 1],
  // D natural minor plus F# for the closing D major (Picardy third).
  EPIC: [2, 4, 5, 7, 9, 10, 0, 6],
  LEGENDARY: [2, 4, 5, 7, 9, 10, 0, 6],
};

type Chord = { bass: number; pad: number[]; arp: number[] };

// Voicings in MIDI: a bass root for the sub, a five-note pad around the middle, and a high arpeggio for the bells.
const CHORDS = {
  D: { bass: 38, pad: [50, 57, 62, 66, 69], arp: [74, 78, 81, 86] },
  A: { bass: 45, pad: [45, 52, 57, 61, 64], arp: [76, 81, 85, 88] },
  Bm: { bass: 47, pad: [47, 54, 59, 62, 66], arp: [74, 78, 83, 86] },
  G: { bass: 43, pad: [43, 50, 55, 59, 62], arp: [74, 79, 83, 86] },
  Dm: { bass: 38, pad: [50, 57, 62, 65, 69], arp: [74, 77, 81, 86] },
  Bb: { bass: 46, pad: [46, 53, 58, 62, 65], arp: [74, 77, 82, 86] },
  F: { bass: 41, pad: [53, 57, 60, 65, 69], arp: [72, 77, 81, 84] },
  C: { bass: 48, pad: [48, 55, 60, 64, 67], arp: [72, 76, 79, 84] },
  Gm: { bass: 43, pad: [43, 50, 55, 58, 62], arp: [74, 79, 82, 86] },
} satisfies Record<string, Chord>;
type ChordName = keyof typeof CHORDS;

// --- Building a score -----------------------------------------------------------------------------------------------

const DEFAULTS: Record<GiftSoundVoice, Pick<GiftSoundEvent, "attackMs" | "releaseMs" | "envelope" | "space" | "brightness">> = {
  chime: { attackMs: 4, releaseMs: 1200, envelope: "decay", space: "hall", brightness: 1 },
  bell: { attackMs: 5, releaseMs: 1800, envelope: "decay", space: "hall", brightness: 1 },
  pad: { attackMs: 500, releaseMs: 900, envelope: "sustain", space: "room", brightness: 0.4 },
  choir: { attackMs: 900, releaseMs: 1200, envelope: "sustain", space: "hall", brightness: 0.5 },
  brass: { attackMs: 350, releaseMs: 700, envelope: "sustain", space: "room", brightness: 0.6 },
  shimmer: { attackMs: 700, releaseMs: 1500, envelope: "sustain", space: "hall", brightness: 1 },
  sub: { attackMs: 800, releaseMs: 1500, envelope: "sustain", space: "dry", brightness: 0 },
  drum: { attackMs: 3, releaseMs: 600, envelope: "decay", space: "room", brightness: 0.5 },
  impact: { attackMs: 5, releaseMs: 2600, envelope: "decay", space: "hall", brightness: 0.6 },
  thunder: { attackMs: 40, releaseMs: 4000, envelope: "decay", space: "hall", brightness: 0.5 },
  riser: { attackMs: 300, releaseMs: 60, envelope: "sustain", space: "hall", brightness: 1 },
  meow: { attackMs: 35, releaseMs: 230, envelope: "sustain", space: "room", brightness: 0.7 },
};

type Layers = {
  pad?: number;
  choir?: number;
  brass?: number;
  shimmer?: number;
  sub?: number;
  bells?: { gain: number; pattern: "sparse" | "quarters" | "eighths" };
  drums?: { gain: number; pattern: "pulse" | "half" | "drive" | "roll" };
  brightness?: number;
};

/** `level` scales every layer of the section: the arc from a restrained arrival to a full climax. */
type Section = { name: string; bars: number; chords: ChordName[]; level: number; layers: Layers };

type TierSpec = {
  key: string;
  bpm: number;
  masterGain: number;
  fadeOutMs: number;
  reverbSeconds: number;
  /** When the build towards the hit starts (ms); the hit is placed on the reveal's name. */
  hitRange: [number, number];
  sections: Section[];
  /** The section whose start is the climax cue. */
  climaxSection: string;
  /** The final chord held through the tail. */
  tailChord: ChordName;
  tailLayers: Layers;
  /** Section names (by start) that open with an impact (+ thunder when `thunder`). */
  impacts: { section: string; atBar?: number; gain: number; thunder?: number }[];
  /** Risers ending on a section's start: length in bars. */
  risers: { into: string; bars: number; gain: number }[];
  /** Distant thunder in a section, at a bar offset. */
  distantThunder: { section: string; atBar: number; gain: number }[];
  hitThunder: number;
  hitImpact: number;
};

const SPECS: Record<Exclude<GiftTierName, "COMMON">, TierSpec> = {
  RARE: {
    key: "D major",
    bpm: 90,
    masterGain: 0.28,
    fadeOutMs: 3000,
    reverbSeconds: 2.4,
    hitRange: [500, 3000],
    sections: [
      { name: "arrival", bars: 3, chords: ["D", "A", "Bm"], level: 0.7, layers: { pad: 0.16, shimmer: 0.05, sub: 0.22, bells: { gain: 0.08, pattern: "sparse" } } },
      { name: "build", bars: 3, chords: ["G", "A", "Bm"], level: 0.9, layers: { pad: 0.17, sub: 0.25, bells: { gain: 0.08, pattern: "quarters" }, drums: { gain: 0.4, pattern: "half" } } },
      {
        name: "climax",
        bars: 3,
        chords: ["G", "A", "D"],
        level: 1.25,
        layers: { pad: 0.18, brass: 0.12, shimmer: 0.06, sub: 0.28, bells: { gain: 0.09, pattern: "eighths" }, drums: { gain: 0.5, pattern: "drive" }, brightness: 0.75 },
      },
    ],
    climaxSection: "climax",
    tailChord: "D",
    tailLayers: { pad: 0.16, shimmer: 0.05, sub: 0.2, bells: { gain: 0.07, pattern: "sparse" } },
    impacts: [{ section: "climax", gain: 0.7 }],
    risers: [{ into: "climax", bars: 1.5, gain: 0.2 }],
    distantThunder: [],
    hitThunder: 0,
    hitImpact: 0.45,
  },
  EPIC: {
    key: "D minor",
    bpm: 72,
    masterGain: 0.29,
    fadeOutMs: 5000,
    reverbSeconds: 3.2,
    hitRange: [600, 3500],
    sections: [
      { name: "arrival", bars: 3, chords: ["Dm", "Bb", "F"], level: 0.7, layers: { pad: 0.13, choir: 0.13, sub: 0.26, bells: { gain: 0.08, pattern: "sparse" }, drums: { gain: 0.42, pattern: "pulse" } } },
      { name: "build", bars: 2, chords: ["C", "Dm"], level: 0.8, layers: { pad: 0.14, choir: 0.14, sub: 0.27, bells: { gain: 0.08, pattern: "quarters" }, drums: { gain: 0.45, pattern: "half" } } },
      { name: "build-drive", bars: 2, chords: ["Bb", "C"], level: 0.95, layers: { pad: 0.15, choir: 0.15, brass: 0.1, sub: 0.28, bells: { gain: 0.08, pattern: "quarters" }, drums: { gain: 0.5, pattern: "drive" } } },
      {
        name: "climax",
        bars: 4,
        chords: ["Dm", "Bb", "F", "C"],
        level: 1.2,
        layers: { pad: 0.16, choir: 0.17, brass: 0.15, shimmer: 0.05, sub: 0.3, bells: { gain: 0.09, pattern: "eighths" }, drums: { gain: 0.56, pattern: "drive" }, brightness: 0.8 },
      },
      { name: "turn", bars: 1, chords: ["Bb"], level: 1.1, layers: { pad: 0.15, choir: 0.16, brass: 0.14, sub: 0.28, drums: { gain: 0.5, pattern: "roll" } } },
      { name: "resolution", bars: 1, chords: ["D"], level: 1.3, layers: { pad: 0.16, choir: 0.17, brass: 0.15, shimmer: 0.06, sub: 0.3, bells: { gain: 0.09, pattern: "quarters" }, brightness: 0.8 } },
    ],
    climaxSection: "climax",
    tailChord: "D",
    tailLayers: { pad: 0.14, choir: 0.14, shimmer: 0.05, sub: 0.22, bells: { gain: 0.07, pattern: "sparse" } },
    impacts: [
      { section: "climax", gain: 0.85, thunder: 0.5 },
      { section: "climax", atBar: 2, gain: 0.7 },
      { section: "resolution", gain: 0.8, thunder: 0.45 },
    ],
    risers: [
      { into: "climax", bars: 1.5, gain: 0.22 },
      { into: "resolution", bars: 1, gain: 0.2 },
    ],
    distantThunder: [{ section: "tail", atBar: 1.5, gain: 0.3 }],
    hitThunder: 0.5,
    hitImpact: 0.8,
  },
  LEGENDARY: {
    key: "D minor",
    bpm: 66,
    masterGain: 0.3,
    fadeOutMs: 8000,
    reverbSeconds: 4,
    hitRange: [900, 4000],
    sections: [
      { name: "arrival", bars: 3, chords: ["Dm", "Bb", "F"], level: 0.7, layers: { pad: 0.12, choir: 0.14, sub: 0.27, bells: { gain: 0.08, pattern: "sparse" }, drums: { gain: 0.42, pattern: "pulse" } } },
      { name: "rise", bars: 3, chords: ["C", "Dm", "Bb"], level: 0.8, layers: { pad: 0.13, choir: 0.14, sub: 0.27, bells: { gain: 0.08, pattern: "quarters" }, drums: { gain: 0.45, pattern: "half" } } },
      { name: "rise-drive", bars: 2, chords: ["F", "C"], level: 0.95, layers: { pad: 0.14, choir: 0.15, brass: 0.1, sub: 0.28, bells: { gain: 0.08, pattern: "quarters" }, drums: { gain: 0.5, pattern: "drive" } } },
      {
        name: "peak",
        bars: 4,
        chords: ["Dm", "Bb", "F", "C"],
        level: 1.1,
        layers: { pad: 0.15, choir: 0.17, brass: 0.14, shimmer: 0.05, sub: 0.3, bells: { gain: 0.09, pattern: "eighths" }, drums: { gain: 0.55, pattern: "drive" }, brightness: 0.75 },
      },
      { name: "breath", bars: 3, chords: ["Bb", "Gm", "C"], level: 0.6, layers: { pad: 0.12, shimmer: 0.04, sub: 0.22, bells: { gain: 0.07, pattern: "sparse" } } },
      { name: "rise-2", bars: 3, chords: ["Dm", "Bb", "F"], level: 0.95, layers: { pad: 0.14, choir: 0.15, brass: 0.11, sub: 0.28, bells: { gain: 0.08, pattern: "quarters" }, drums: { gain: 0.5, pattern: "drive" } } },
      { name: "rise-2-roll", bars: 1, chords: ["C"], level: 1.05, layers: { pad: 0.15, choir: 0.16, brass: 0.13, sub: 0.29, drums: { gain: 0.52, pattern: "roll" } } },
      {
        name: "climax",
        bars: 4,
        chords: ["D", "Bb", "C", "D"],
        level: 1.3,
        layers: { pad: 0.16, choir: 0.18, brass: 0.17, shimmer: 0.06, sub: 0.32, bells: { gain: 0.1, pattern: "eighths" }, drums: { gain: 0.6, pattern: "drive" }, brightness: 0.85 },
      },
    ],
    climaxSection: "climax",
    tailChord: "D",
    tailLayers: { pad: 0.14, choir: 0.15, shimmer: 0.05, sub: 0.22, bells: { gain: 0.07, pattern: "sparse" } },
    impacts: [
      { section: "peak", gain: 0.85, thunder: 0.5 },
      { section: "breath", gain: 0.5 },
      { section: "climax", gain: 0.95, thunder: 0.6 },
      { section: "climax", atBar: 3, gain: 0.8, thunder: 0.4 },
    ],
    risers: [
      { into: "peak", bars: 1.5, gain: 0.22 },
      { into: "climax", bars: 2, gain: 0.25 },
    ],
    distantThunder: [
      { section: "rise", atBar: 1, gain: 0.28 },
      { section: "breath", atBar: 1.5, gain: 0.3 },
      { section: "tail", atBar: 1, gain: 0.3 },
    ],
    hitThunder: 0.6,
    hitImpact: 0.9,
  },
};

const LOW_END_SKIP: ReadonlySet<GiftSoundVoice> = new Set(["choir", "brass", "shimmer"]);
const LOW_END_REVERB_MAX_S = 1.6;

class Score {
  readonly events: GiftSoundEvent[] = [];
  constructor(
    readonly durationMs: number,
    readonly lowEnd: boolean,
  ) {}

  add(voice: GiftSoundVoice, atMs: number, durationMs: number, freqs: number[], gain: number, extra: Partial<GiftSoundEvent> = {}) {
    if (this.lowEnd && LOW_END_SKIP.has(voice)) return;
    const at = Math.max(0, Math.round(atMs));
    const end = Math.min(this.durationMs, Math.round(atMs + durationMs));
    const length = end - at;
    if (length < 80 || gain <= 0) return;
    const base = DEFAULTS[voice];
    const attackMs = Math.min(extra.attackMs ?? base.attackMs, Math.floor(length / 3));
    const releaseMs = Math.min(extra.releaseMs ?? base.releaseMs, length - attackMs);
    const event: GiftSoundEvent = {
      ...base,
      ...extra,
      atMs: at,
      durationMs: length,
      voice,
      freqs,
      gain: round3(gain),
      attackMs: Math.max(3, attackMs),
      releaseMs: Math.max(10, releaseMs),
    };
    if (this.lowEnd) delete event.click;
    this.events.push(event);
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const hz = (midis: number[]) => midis.map((m) => Math.round(midiToHz(m) * 1000) / 1000);

/** Lays out one chord's worth of a section's layers. */
function chordLayers(score: Score, chord: Chord, startMs: number, lengthMs: number, beatMs: number, raw: Layers, level: number, chordIndex: number) {
  const overlap = 350;
  const layers = scaleLayers(raw, level);
  const brightness = layers.brightness ?? 0.45;
  if (layers.pad) score.add("pad", startMs, lengthMs + overlap, hz(chord.pad), layers.pad, { brightness });
  if (layers.choir) score.add("choir", startMs, lengthMs + overlap, hz(chord.pad.slice(1, 4).map((m) => m + 12)), layers.choir, { brightness });
  if (layers.brass) score.add("brass", startMs, lengthMs + overlap, hz(chord.pad.slice(0, 3)), layers.brass, { brightness });
  if (layers.shimmer) score.add("shimmer", startMs, lengthMs + overlap, hz([chord.arp[1], chord.arp[3]]), layers.shimmer);
  if (layers.sub) score.add("sub", startMs, lengthMs + overlap, hz([chord.bass]), layers.sub, { attackMs: 400, releaseMs: 700 });

  const beats = Math.round(lengthMs / beatMs);
  if (layers.bells) {
    const bellsMode = score.lowEnd && layers.bells.pattern === "eighths" ? "quarters" : layers.bells.pattern;
    const step = bellsMode === "eighths" ? 0.5 : 1;
    // Up-down through the chord's arpeggio; "sparse" rings on beats 2 and 4 only.
    const order = [0, 1, 2, 3, 2, 1];
    let n = chordIndex * 2;
    for (let b = 0; b < beats; b += step) {
      if (bellsMode === "sparse" && b % 2 !== 1) continue;
      const note = chord.arp[order[n++ % order.length]];
      const accent = b % 4 === 0 ? 1 : 0.8;
      score.add("bell", startMs + b * beatMs, bellsMode === "eighths" ? 1600 : 2200, hz([note]), layers.bells.gain * accent);
    }
  }
  if (layers.drums) {
    const { gain, pattern } = layers.drums;
    const low = hz([33])[0]; // A1, a taiko's body; its attack sweeps down onto this.
    const hits: [number, number][] = [];
    for (let b = 0; b < beats; b++) {
      const bar = b % 4;
      if (pattern === "pulse" && bar === 0) hits.push([b, 1]);
      if (pattern === "half" && (bar === 0 || bar === 2)) hits.push([b, bar === 0 ? 1 : 0.8]);
      if (pattern === "drive") {
        if (bar === 0) hits.push([b, 1]);
        if (bar === 1) hits.push([b + 0.5, 0.7]);
        if (bar === 2) hits.push([b, 0.85]);
        if (bar === 3) hits.push([b, 0.75], [b + 0.5, 0.65]);
      }
    }
    if (pattern === "roll") {
      // Eighth notes, rising in level across the chord: the run-up into the next downbeat.
      const steps = beats * 2;
      for (let i = 0; i < steps; i++) hits.push([i / 2, 0.45 + (0.55 * i) / Math.max(1, steps - 1)]);
    }
    for (const [beat, level] of hits) {
      score.add("drum", startMs + beat * beatMs, 900, [low], gain * level, { click: true });
    }
  }
}

function scaleLayers(l: Layers, level: number): Layers {
  const k = (g: number | undefined) => (g === undefined ? undefined : g * level);
  return {
    ...l,
    pad: k(l.pad),
    choir: k(l.choir),
    brass: k(l.brass),
    shimmer: k(l.shimmer),
    sub: k(l.sub),
    bells: l.bells && { ...l.bells, gain: l.bells.gain * level },
    drums: l.drums && { ...l.drums, gain: l.drums.gain * level },
  };
}

function thunderCrackles(lengthMs: number, seed: number): number[] {
  // Deterministic, uneven offsets: a few crackles early, sparser later (thunder rolls off).
  const out: number[] = [];
  let t = 90 + (seed % 5) * 40;
  let i = 0;
  while (t < lengthMs * 0.6 && out.length < 6) {
    out.push(Math.round(t));
    t += 180 + ((i * 97 + seed * 31) % 260) + i * 120;
    i++;
  }
  return out;
}

function commonPlan(lowEnd: boolean, hitMs: number): Omit<GiftSoundPlan, "tier" | "lowEnd"> {
  const durationMs = GIFT_SOUND_DURATION_MS.COMMON;
  const score = new Score(durationMs, lowEnd);
  const hit = clamp(hitMs, 250, 1200);
  // A rising sparkle E5 G#5 B5 E6, then a bell cluster as the name lands, a high shimmer and three falling glints.
  [76, 80, 83, 88].forEach((m, i) => score.add("chime", 40 + i * 75, 1500, hz([m]), 0.15));
  score.add("bell", hit, durationMs - hit, hz([88, 92, 95]), 0.12);
  score.add("shimmer", hit - 100, durationMs - hit + 100, hz([76, 80, 83]), 0.06, { attackMs: 300, releaseMs: 1600 });
  [97, 95, 92].forEach((m, i) => score.add("chime", hit + 220 + i * 140, 1300, hz([m]), 0.07));
  return {
    durationMs,
    tempoBpm: 0,
    key: "E major pentatonic",
    masterGain: 0.6,
    fadeInMs: GIFT_SOUND_FADE_IN_MS.COMMON,
    fadeOutMs: 800,
    reverbSeconds: lowEnd ? 1.2 : 1.5,
    sections: [
      { name: "sparkle", startMs: 0, endMs: hit },
      { name: "chime", startMs: hit, endMs: durationMs },
    ],
    events: sortEvents(score.events),
    cues: { hitMs: hit, climaxMs: hit, tailMs: hit, endMs: durationMs },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function sortEvents(events: GiftSoundEvent[]): GiftSoundEvent[] {
  // Stable: equal times keep their authored order.
  return events.map((e, i) => [e, i] as const).sort((a, b) => a[0].atMs - b[0].atMs || a[1] - b[1]).map(([e]) => e);
}

function tieredPlan(tier: Exclude<GiftTierName, "COMMON">, lowEnd: boolean, hitMs: number, accent: GiftSoundAccent | null): Omit<GiftSoundPlan, "tier" | "lowEnd"> {
  const spec = SPECS[tier];
  const durationMs = GIFT_SOUND_DURATION_MS[tier];
  const score = new Score(durationMs, lowEnd);
  const beatMs = 60000 / spec.bpm;
  const barMs = beatMs * 4;
  const hit = clamp(hitMs, spec.hitRange[0], spec.hitRange[1]);

  // Sections run on the beat grid from the hit; the tail takes whatever is left up to the end.
  const sections: GiftSoundSection[] = [{ name: "intro", startMs: 0, endMs: Math.round(hit) }];
  let cursor = hit;
  for (const s of spec.sections) {
    sections.push({ name: s.name, startMs: Math.round(cursor), endMs: Math.round(cursor + s.bars * barMs) });
    cursor += s.bars * barMs;
  }
  sections.push({ name: "tail", startMs: Math.round(cursor), endMs: durationMs });
  const startOf = (name: string) => sections.find((s) => s.name === name)!.startMs;

  // Intro: a swell and a whoosh into the hit (Legendary's choir swell rises under the light bloom).
  score.add("sub", 0, hit + 600, hz([38]), 0.2, { attackMs: Math.min(1200, hit) });
  score.add("riser", Math.max(0, hit - 2400), Math.min(2400, hit), [], 0.16);
  if (tier === "LEGENDARY") score.add("choir", 0, hit + 500, hz([62, 69, 74]), 0.1, { attackMs: Math.min(1300, hit - 100) });

  // The hit, on the gift's name.
  score.add("impact", hit, 3200, hz([26]), spec.hitImpact);
  if (spec.hitThunder && !accent) score.add("thunder", hit + 30, 6500, [], spec.hitThunder, { crackles: thunderCrackles(6500, 1) });
  score.add("bell", hit, 3800, hz(tier === "RARE" ? [86, 90, 93] : [86, 89, 93]), 0.1);

  // The body: each section's layers, chord by chord.
  spec.sections.forEach((s, si) => {
    const start = startOf(s.name);
    const chordLength = (s.bars * barMs) / s.chords.length;
    s.chords.forEach((name, ci) => chordLayers(score, CHORDS[name], start + ci * chordLength, chordLength, beatMs, s.layers, s.level, si * 4 + ci));
  });

  // Tail: the final chord, held to the very end, with a few falling bells.
  const tailStart = startOf("tail");
  const tailLength = durationMs - tailStart;
  const tail = CHORDS[spec.tailChord];
  const tl = spec.tailLayers;
  const brightness = 0.5;
  const tailRelease = Math.round(tailLength * 0.7);
  if (tl.pad) score.add("pad", tailStart, tailLength, hz(tail.pad), tl.pad, { brightness, releaseMs: tailRelease });
  if (tl.choir) score.add("choir", tailStart, tailLength, hz(tail.pad.slice(1, 4).map((m) => m + 12)), tl.choir, { brightness, releaseMs: tailRelease });
  if (tl.shimmer) score.add("shimmer", tailStart, tailLength, hz([tail.arp[1], tail.arp[3]]), tl.shimmer, { releaseMs: tailRelease });
  if (tl.sub) score.add("sub", tailStart, tailLength, hz([tail.bass]), tl.sub, { releaseMs: tailRelease });
  if (tl.bells) {
    const falling = [...tail.arp].reverse();
    falling.forEach((m, i) => score.add("bell", tailStart + (i + 1) * beatMs * 1.5, 2600, hz([m]), tl.bells!.gain * (1 - i * 0.15)));
  }

  // Impacts, risers and distant thunder.
  spec.impacts.forEach((imp, i) => {
    const at = startOf(imp.section) + (imp.atBar ?? 0) * barMs;
    score.add("impact", at, 3000, hz([26]), imp.gain);
    if (imp.thunder) score.add("thunder", at + 30, 6000, [], imp.thunder, { crackles: thunderCrackles(6000, i + 2) });
  });
  for (const r of spec.risers) {
    const end = startOf(r.into);
    score.add("riser", end - r.bars * barMs, r.bars * barMs, [], r.gain);
  }
  spec.distantThunder.forEach((d, i) => {
    const at = startOf(d.section) + d.atBar * barMs;
    score.add("thunder", at, 5500, [], d.gain, { crackles: thunderCrackles(5500, i + 7), brightness: 0.25 });
  });

  return {
    durationMs,
    tempoBpm: spec.bpm,
    key: spec.key,
    masterGain: spec.masterGain,
    fadeInMs: GIFT_SOUND_FADE_IN_MS[tier],
    fadeOutMs: spec.fadeOutMs,
    reverbSeconds: lowEnd ? Math.min(spec.reverbSeconds, LOW_END_REVERB_MAX_S) : spec.reverbSeconds,
    sections,
    events: sortEvents(score.events),
    cues: { hitMs: Math.round(hit), climaxMs: startOf(spec.climaxSection), tailMs: tailStart, endMs: durationMs },
  };
}

// --- Accents: a sound of the gift's own on top of its tier's score --------------------------------------------------

/** A gift's own sound over the score: today only the Playful Kitten's meow as it jumps out of its box. */
export type GiftSoundAccent = "meow";

/** The accent for a reveal's items (one item with an accent), or null. */
export function giftSoundAccentFor(items: readonly { slug: string }[]): GiftSoundAccent | null {
  return items.length === 1 && items[0].slug === "playful-kitten" ? "meow" : null;
}

/** The meow starts this long after the kitten leaves the box (it meows in the air, at the top of its leap). */
export const MEOW_AFTER_JUMP_MS = 90;
/**
 * The meow's shape: the pitch rises from `startHz` to `peakHz` over the first `peakAt` of it and falls to `endHz`
 * ("mi-a-ow"); a kitten's voice, high (a grown cat's is lower). Length and level before the master chain.
 */
export const MEOW = { durationMs: 680, startHz: 640, peakHz: 930, endHz: 520, peakAt: 0.34, gain: 2.4 } as const;

/** When the meow starts, for the reveal's hit (the kitten's jump is timed from the same hit, gift-composed-plan.ts). */
export function meowAtMs(hitMs: number): number {
  return Math.round(Math.max(0, hitMs) + KITTEN_JUMP_AFTER_HIT_MS + MEOW_AFTER_JUMP_MS);
}

/**
 * The score for a tier. `hitMs` is when the reveal shows the gift's name (giftRevealTimeline's "name" step), so the
 * hit lands with it; it is clamped into each tier's range. Same input, same plan. With an accent (the Playful Kitten's
 * meow) the accent is added on its own cue, and the hit's thunder is left out so nothing rumbles under the kitten.
 */
export function giftSoundPlan(tier: GiftTierName, opts: { lowEnd: boolean; hitMs: number; accent?: GiftSoundAccent | null }): GiftSoundPlan {
  const body = tier === "COMMON" ? commonPlan(opts.lowEnd, opts.hitMs) : tieredPlan(tier, opts.lowEnd, opts.hitMs, opts.accent ?? null);
  if (opts.accent === "meow") {
    // The meow follows the kitten (the scene's own hit, not the tier's clamped one).
    const score = new Score(body.durationMs, opts.lowEnd);
    score.add("meow", meowAtMs(opts.hitMs), MEOW.durationMs, [MEOW.startHz, MEOW.peakHz, MEOW.endHz], MEOW.gain);
    body.events = sortEvents([...body.events, ...score.events]);
  }
  return { tier, lowEnd: opts.lowEnd, ...body };
}

// --- Scheduling -----------------------------------------------------------------------------------------------------

export type ScheduleWindow = { index: number; startMs: number; endMs: number };

/** Contiguous, non-overlapping windows covering [0, durationMs]; each is scheduled exactly once. */
export function scheduleWindows(durationMs: number, chunkMs: number = GIFT_SOUND_CHUNK_MS): ScheduleWindow[] {
  const out: ScheduleWindow[] = [];
  for (let i = 0, start = 0; start < durationMs; i++, start += chunkMs) {
    out.push({ index: i, startMs: start, endMs: Math.min(durationMs, start + chunkMs) });
  }
  return out;
}

/** The events that start inside a window ([start, end), the last window also takes its end). */
export function eventsInWindow(events: GiftSoundEvent[], w: ScheduleWindow, durationMs: number): GiftSoundEvent[] {
  const last = w.endMs >= durationMs;
  return events.filter((e) => e.atMs >= w.startMs && (e.atMs < w.endMs || (last && e.atMs <= w.endMs)));
}

/** Which windows are due: every window starting before `elapsedMs + lookahead` that hasn't been scheduled yet. */
export function dueWindows(windows: ScheduleWindow[], scheduledUpTo: number, elapsedMs: number, lookaheadMs: number = GIFT_SOUND_LOOKAHEAD_MS): ScheduleWindow[] {
  return windows.filter((w) => w.index >= scheduledUpTo && w.startMs < elapsedMs + lookaheadMs);
}

// --- Bounds (battery/CPU) -------------------------------------------------------------------------------------------

/** How many Web Audio nodes the engine creates for one event (it builds exactly this graph). */
export function voiceNodeCount(e: GiftSoundEvent): number {
  const n = Math.max(1, e.freqs.length);
  switch (e.voice) {
    case "chime":
    case "bell":
      return n * 3 + 1;
    case "pad":
    case "brass":
      return n * 2 + 2;
    case "choir":
      return n * 2 + 5;
    case "shimmer":
    case "sub":
      return n + 1;
    case "drum":
      return e.click ? 5 : 2;
    case "impact":
      return 6;
    case "thunder":
    case "riser":
      return 3;
    case "meow":
      return 10;
  }
}

/** The most voices (and their nodes) sounding at any one moment. */
export function peakConcurrency(events: GiftSoundEvent[]): { voices: number; nodes: number } {
  const edges: [number, number, number][] = [];
  for (const e of events) {
    edges.push([e.atMs, 1, voiceNodeCount(e)]);
    edges.push([e.atMs + e.durationMs, -1, -voiceNodeCount(e)]);
  }
  // Ends before starts at the same instant.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let voices = 0;
  let nodes = 0;
  let peak = { voices: 0, nodes: 0 };
  for (const [, dv, dn] of edges) {
    voices += dv;
    nodes += dn;
    if (voices > peak.voices) peak = { ...peak, voices };
    if (nodes > peak.nodes) peak = { ...peak, nodes };
  }
  return peak;
}

// --- Master ceiling and pre-rendered buffers --------------------------------------------------------------------------

/**
 * The soft-clip curve the engine's WaveShaper uses as the last stage: y = c * tanh(x / c). Near-linear for quiet
 * signals, it bends smoothly instead of clipping, and since a WaveShaper clamps its input to [-1, 1], the output can
 * never exceed c * tanh(1 / c) < c = GIFT_SOUND_PEAK_CEILING.
 */
export function softClipCurve(samples = 2049, ceiling = GIFT_SOUND_PEAK_CEILING): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = ceiling * Math.tanh(x / ceiling);
  }
  return curve;
}

/** A small deterministic PRNG (mulberry32): the noise and the reverb are the same on every device, every time. */
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

/** White noise in [-1, 1], rendered once per score and looped by every noise voice. */
export function noiseSamples(length: number, seed = 7): Float32Array<ArrayBuffer> {
  const rand = seededRandom(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rand() * 2 - 1;
  return out;
}

/**
 * A hall-like impulse response: decaying noise (-60 dB at its end), a short pre-delay, darker as it decays (a one-pole
 * low-pass whose cutoff falls), slightly different per channel for width. The ConvolverNode normalizes it.
 */
export function impulseResponseSamples(sampleRate: number, seconds: number, seed = 11): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const preDelay = Math.floor(sampleRate * 0.012);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  channels.forEach((data, ch) => {
    const rand = seededRandom(seed + ch * 101);
    let lp = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / (length - preDelay);
      const env = Math.exp(-6.9 * t);
      const smoothing = 0.15 + 0.8 * t;
      lp = lp * smoothing + (rand() * 2 - 1) * (1 - smoothing);
      data[i] = lp * env;
    }
    // A last-millisecond fade so the response itself never ends on a step.
    const fade = Math.min(length, Math.floor(sampleRate * 0.005));
    for (let i = 0; i < fade; i++) data[length - 1 - i] *= i / fade;
  });
  return channels;
}

// --- When a score may start -----------------------------------------------------------------------------------------

export type GiftSoundGate = {
  /** The person's own tap opened (or replayed) this reveal within GIFT_SOUND_ARM_WINDOW_MS. */
  armed: boolean;
  muted: boolean;
  /** A call is ringing or under way (isCallMediaHoldActive). */
  callActive: boolean;
  documentHidden: boolean;
  audioAvailable: boolean;
};

/** True only when a gift's sound may start: never without the opening tap, never muted, in a call or hidden. */
export function mayStartGiftSound(gate: GiftSoundGate): boolean {
  return gate.armed && !gate.muted && !gate.callActive && !gate.documentHidden && gate.audioAvailable;
}

/** Whether the opening tap (at `armedAt`, ms) still counts at `now`. */
export function isArmFresh(armedAt: number | null, now: number): boolean {
  return armedAt !== null && now >= armedAt && now - armedAt <= GIFT_SOUND_ARM_WINDOW_MS;
}
