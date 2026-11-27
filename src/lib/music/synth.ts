/*
 * The post-music synthesizer: turns a track's score (src/lib/music/tracks.ts) into one seamless, normalized mono loop
 * of PCM samples. Pure, deterministic (seeded noise, no Math.random, no clock), dependency-free and the same in a
 * browser and in Node, so the exact audio a phone plays is what the tests measure (peak, loudness, loop seam).
 *
 * Nothing here is sampled or recorded: every sound is computed from oscillators (wavetables of a few sine partials),
 * simple FM, seeded noise and one-pole / biquad filters, all written in this file.
 *
 * Seamless loop by construction: every note is mixed into a CIRCULAR buffer (a tail that runs past the loop end
 * continues at its start) and the delay and reverb run over the loop several times in a row, keeping their state,
 * before the last pass is kept. The input is periodic and the effects are linear and time-invariant, so after the
 * warm-up passes the output is periodic too: the last sample of the loop flows into the first exactly as any two
 * neighbouring samples do. The master limiter is per sample (memoryless), so it keeps that.
 *
 * Speed matters (it runs on phones, on the main thread in slices: renderScoreAsync): envelopes and decays are
 * per-sample multiplications, oscillators are table reads, and no closure or modulo runs per sample in the hot loops;
 * each distinct note is rendered once and scaled.
 */

export const MUSIC_SAMPLE_RATE = 24_000;
/** Loudness every track is normalized to (RMS of the whole loop, dBFS). Quieter than typical phone video on purpose. */
export const MUSIC_TARGET_RMS_DB = -20;
/** Nothing ever goes above this (dBFS): a soft limiter bends peaks toward it, so there is never clipping. */
export const MUSIC_PEAK_CEILING_DB = -1;

const SR = MUSIC_SAMPLE_RATE;
const TAU = Math.PI * 2;
const TABLE_SIZE = 4096;

// ---------------------------------------------------------------------------------------------------------------
// Score types (what tracks.ts writes)

export type Instrument = "epiano" | "pad" | "pluck" | "bass" | "subbass" | "marimba" | "bell" | "lead";
export type DrumKind = "kick" | "snare" | "clap" | "hat" | "openhat" | "shaker" | "rim" | "tom";

export type NoteEvent = {
  /** Start, in beats from the loop start. */
  t: number;
  /** Held length, in beats (the instrument's release follows). */
  d: number;
  /** MIDI note number (60 = middle C). */
  m: number;
  /** Velocity 0..1. */
  v: number;
  inst: Instrument;
};

export type DrumEvent = { t: number; kind: DrumKind; v: number; /** Tom pitch (MIDI). */ m?: number };

export type Score = {
  bpm: number;
  /** Loop length in beats. */
  beats: number;
  notes: NoteEvent[];
  drums: DrumEvent[];
  /** Per-instrument level (default 1). */
  levels?: Partial<Record<Instrument | "drums", number>>;
  reverb?: { mix: number; room: number };
  /** Feedback delay in beats. */
  delay?: { beats: number; feedback: number; mix: number };
  /** Seed for the noise generators (drums): makes each track's noise its own and repeatable. */
  seed: number;
};

// ---------------------------------------------------------------------------------------------------------------
// Small deterministic helpers

/** Mulberry32: a tiny seeded PRNG, uniform in [0, 1). */
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

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

function table(partials: readonly (readonly [number, number])[]): Float32Array {
  const out = new Float32Array(TABLE_SIZE + 1);
  let max = 0;
  for (let i = 0; i <= TABLE_SIZE; i++) {
    let s = 0;
    for (const [h, a] of partials) s += a * Math.sin((TAU * h * i) / TABLE_SIZE);
    out[i] = s;
    max = Math.max(max, Math.abs(s));
  }
  for (let i = 0; i <= TABLE_SIZE; i++) out[i] /= max;
  return out;
}

const SINE = table([[1, 1]]);
// A soft, band-limited saw (8 partials, rolled off faster than 1/n): warm pad and lead voices.
const SOFT_SAW = table([1, 2, 3, 4, 5, 6, 7, 8].map((h) => [h, 1 / h ** 1.35] as const));
// Bass: a sine with a little second and third harmonic so it is heard on a phone speaker.
const WARM = table([
  [1, 1],
  [2, 0.32],
  [3, 0.12],
]);

/** Linear-interpolated table read at a non-negative phase in cycles. */
function readTable(tab: Float32Array, phase: number): number {
  const x = (phase - (phase | 0)) * TABLE_SIZE;
  const i = x | 0;
  const a = tab[i];
  return a + (tab[i + 1] - a) * (x - i);
}

/** Keeps an oscillator phase in [0, 1). */
function wrap(phase: number): number {
  return phase >= 1 ? phase - (phase | 0) : phase;
}

type Filter = (x: number) => number;

/** RBJ biquad band-pass / high-pass / low-pass. */
function biquad(kind: "bandpass" | "highpass" | "lowpass", freq: number, q: number): Filter {
  const w = (TAU * freq) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  let b0: number, b1: number, b2: number;
  if (kind === "bandpass") {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else if (kind === "highpass") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  }
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/** One-pole low-pass coefficient for a cutoff. */
function onePole(freq: number): number {
  return 1 - Math.exp((-TAU * freq) / SR);
}

/** Per-sample multiplier of an exponential decay with time constant `tau` seconds. */
function decayFactor(tau: number): number {
  return Math.exp(-1 / (tau * SR));
}

/** Samples a release needs to fall below -60 dB (inaudible under the mix). */
function releaseSamples(release: number): number {
  return Math.ceil(release * 6.9 * SR);
}

/**
 * The amplitude envelope, one sample at a time: a linear attack, an exponential fall toward `sustain`, and from
 * note-off (`held` samples) an exponential release. Multiplications only.
 */
class Envelope {
  private n = 0;
  private d = 1;
  private r = 1;
  private readonly attack: number;
  private readonly kd: number;
  private readonly kr: number;
  constructor(
    attackSec: number,
    decayTau: number,
    private readonly sustain: number,
    releaseTau: number,
    private readonly held: number,
  ) {
    this.attack = Math.max(1, Math.round(attackSec * SR));
    this.kd = decayFactor(decayTau);
    this.kr = decayFactor(releaseTau);
  }
  next(): number {
    const n = this.n++;
    let a: number;
    if (n < this.attack) a = n / this.attack;
    else {
      a = this.sustain + (1 - this.sustain) * this.d;
      this.d *= this.kd;
    }
    if (n >= this.held) {
      a *= this.r;
      this.r *= this.kr;
    }
    return a;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Instruments: each returns the note's samples (from its start), which renderScore mixes into the loop.

function epiano(heldSec: number, hz: number, v: number): Float32Array {
  const release = 0.28;
  const held = Math.ceil(heldSec * SR);
  const out = new Float32Array(held + releaseSamples(release));
  // Higher notes fade sooner, like a real electric piano.
  const env = new Envelope(0.004, 1.6 * Math.min(1, 300 / hz) + 0.35, 0, release, held);
  const step = hz / SR;
  const kIndex = decayFactor(0.18);
  const kTine = decayFactor(0.03);
  let index = 1.6;
  let tine = 0.06;
  let phase = 0;
  for (let n = 0; n < out.length; n++) {
    // FM, 1:1: the modulator bends the carrier's phase; its depth falls quickly from bright to mellow.
    const mod = readTable(SINE, phase) * (index + 0.25);
    const p = phase + mod / TAU;
    const s = readTable(SINE, p < 0 ? p + 2 : p) + readTable(SINE, (phase * 7) % 1) * tine;
    out[n] = s * v * env.next();
    phase = wrap(phase + step);
    index *= kIndex;
    tine *= kTine;
  }
  return out;
}

function pad(heldSec: number, hz: number, v: number): Float32Array {
  const release = 0.6;
  const held = Math.ceil(heldSec * SR);
  const out = new Float32Array(held + releaseSamples(release));
  const env = new Envelope(0.7, 1.2, 0.8, release, held);
  const s1 = (hz * 0.9958) / SR;
  const s2 = hz / SR;
  const s3 = (hz * 1.0042) / SR;
  let p1 = 0.1,
    p2 = 0.37,
    p3 = 0.71;
  const lp = onePole(Math.min(2600, hz * 6));
  let y = 0;
  for (let n = 0; n < out.length; n++) {
    const s = (readTable(SOFT_SAW, p1) + readTable(SOFT_SAW, p2) + readTable(SOFT_SAW, p3)) / 3;
    y += lp * (s - y);
    out[n] = y * v * env.next();
    p1 = wrap(p1 + s1);
    p2 = wrap(p2 + s2);
    p3 = wrap(p3 + s3);
  }
  return out;
}

const PLUCK_HARMONICS = 8;

function pluck(heldSec: number, hz: number, v: number): Float32Array {
  const release = 0.12;
  const held = Math.ceil(heldSec * SR);
  const out = new Float32Array(held + releaseSamples(release));
  const env = new Envelope(0.002, 1, 1, release, held);
  // A plucked string: harmonics that start bright and fade fastest at the top, so it mellows as it rings.
  const count = Math.min(PLUCK_HARMONICS, Math.floor((SR * 0.45) / hz));
  const amps = new Float64Array(count);
  const ks = new Float64Array(count);
  const phases = new Float64Array(count);
  for (let h = 1; h <= count; h++) {
    amps[h - 1] = (1 / h) * (h === 2 ? 0.8 : 1) * 0.55;
    ks[h - 1] = decayFactor(0.9 / (1 + (h - 1) * 0.9));
  }
  for (let n = 0; n < out.length; n++) {
    let s = 0;
    for (let h = 0; h < count; h++) {
      s += amps[h] * readTable(SINE, phases[h]);
      amps[h] *= ks[h];
      phases[h] = wrap(phases[h] + ((h + 1) * hz) / SR);
    }
    out[n] = s * v * env.next();
  }
  return out;
}

function bass(heldSec: number, hz: number, v: number, sub: boolean): Float32Array {
  const release = 0.07;
  const held = Math.ceil(heldSec * SR);
  const out = new Float32Array(held + releaseSamples(release));
  const env = new Envelope(0.006, 0.45, 0.65, release, held);
  const tab = sub ? SINE : WARM;
  const lp = onePole(sub ? 400 : 1100);
  const step = hz / SR;
  let y = 0;
  let phase = 0;
  for (let n = 0; n < out.length; n++) {
    y += lp * (readTable(tab, phase) - y);
    out[n] = y * v * env.next();
    phase = wrap(phase + step);
  }
  return out;
}

// Partial ratio / level / decay time: a marimba bar (1, 3.9, 9.2) and a soft glass bell (inharmonic).
const MALLETS = {
  marimba: { release: 0.1, partials: [[1, 1, 0.42], [3.93, 0.22, 0.09], [9.2, 0.05, 0.025]] },
  bell: { release: 0.5, partials: [[1, 1, 1.9], [2.76, 0.35, 0.9], [5.4, 0.16, 0.4], [8.93, 0.06, 0.18]] },
} as const;

function mallet(heldSec: number, hz: number, v: number, kind: keyof typeof MALLETS): Float32Array {
  const spec = MALLETS[kind];
  const longest = Math.max(...spec.partials.map((p) => p[2]));
  const held = Math.ceil((heldSec + longest * 2.3) * SR);
  const out = new Float32Array(held + releaseSamples(spec.release));
  const env = new Envelope(0.0015, 1, 1, spec.release, held);
  const parts = spec.partials.filter(([ratio]) => hz * ratio < SR * 0.45);
  const amps = parts.map(([, a]) => a);
  const ks = parts.map(([, , tau]) => decayFactor(tau));
  const steps = parts.map(([ratio]) => (hz * ratio) / SR);
  const phases = parts.map(() => 0);
  for (let n = 0; n < out.length; n++) {
    let s = 0;
    for (let k = 0; k < parts.length; k++) {
      s += amps[k] * readTable(SINE, phases[k]);
      amps[k] *= ks[k];
      phases[k] = wrap(phases[k] + steps[k]);
    }
    out[n] = s * v * env.next();
  }
  return out;
}

function lead(heldSec: number, hz: number, v: number): Float32Array {
  const release = 0.22;
  const held = Math.ceil(heldSec * SR);
  const out = new Float32Array(held + releaseSamples(release));
  const env = new Envelope(0.03, 0.6, 0.75, release, held);
  const lp = onePole(Math.min(3200, hz * 4));
  const vibStep = 5.2 / SR;
  const vibIn = Math.round(0.25 * SR);
  const vibRamp = Math.round(0.3 * SR);
  let y = 0;
  let phase = 0;
  let vib = 0;
  for (let n = 0; n < out.length; n++) {
    // A gentle vibrato that only arrives once the note has settled.
    const depth = n < vibIn ? 0 : Math.min(1, (n - vibIn) / vibRamp) * 0.004;
    phase = wrap(phase + (hz * (1 + depth * readTable(SINE, vib))) / SR);
    vib = wrap(vib + vibStep);
    y += lp * (0.65 * readTable(SINE, phase) + 0.35 * readTable(SOFT_SAW, phase) - y);
    out[n] = y * v * env.next();
  }
  return out;
}

function drum(ev: DrumEvent, rnd: () => number): Float32Array {
  const noise = () => rnd() * 2 - 1;
  const v = ev.v;
  switch (ev.kind) {
    case "kick": {
      const out = new Float32Array(Math.ceil(0.45 * SR));
      const kAmp = decayFactor(0.2);
      const kSweep = decayFactor(0.032);
      const click = Math.round(0.0015 * SR);
      let amp = 1;
      let sweep = 1;
      let phase = 0;
      for (let n = 0; n < out.length; n++) {
        phase = wrap(phase + (46 + 95 * sweep) / SR);
        out[n] = readTable(SINE, phase) * amp * Math.min(1, n / click) * v;
        amp *= kAmp;
        sweep *= kSweep;
      }
      return out;
    }
    case "tom": {
      const base = midiToHz(ev.m ?? 45);
      const out = new Float32Array(Math.ceil(0.5 * SR));
      const kAmp = decayFactor(0.18);
      const kBend = decayFactor(0.05);
      let amp = 0.8 * v;
      let bend = 0.5;
      let phase = 0;
      const attack = Math.round(0.002 * SR);
      for (let n = 0; n < out.length; n++) {
        phase = wrap(phase + (base * (1 + bend)) / SR);
        out[n] = readTable(SINE, phase) * amp * Math.min(1, n / attack);
        amp *= kAmp;
        bend *= kBend;
      }
      return out;
    }
    case "snare": {
      const bp = biquad("bandpass", 1900, 0.7);
      const out = new Float32Array(Math.ceil(0.3 * SR));
      const kTone = decayFactor(0.05);
      const kSnap = decayFactor(0.09);
      const kBend = decayFactor(0.01);
      let tone = 0.45;
      let snap = 1.6;
      let bend = 0.3;
      let phase = 0;
      for (let n = 0; n < out.length; n++) {
        phase = wrap(phase + (180 * (1 + bend)) / SR);
        out[n] = (readTable(SINE, phase) * tone + bp(noise()) * snap) * Math.min(1, n / 24) * v * 0.6;
        tone *= kTone;
        snap *= kSnap;
        bend *= kBend;
      }
      return out;
    }
    case "clap": {
      const bp = biquad("bandpass", 1400, 0.9);
      const out = new Float32Array(Math.ceil(0.35 * SR));
      const hits = [0, 0.011, 0.022].map((s) => Math.round(s * SR));
      const kHit = decayFactor(0.007);
      const kRoom = decayFactor(0.11);
      let hit = 0;
      let room = 0.55;
      for (let n = 0; n < out.length; n++) {
        if (hits.includes(n)) hit = 1;
        let env = hit;
        if (n >= hits[2]) {
          env = Math.max(env, room);
          room *= kRoom;
        }
        out[n] = bp(noise()) * env * v * 1.5;
        hit *= kHit;
      }
      return out;
    }
    case "hat":
    case "openhat":
    case "shaker": {
      const filter =
        ev.kind === "shaker" ? biquad("bandpass", 5200, 1.1) : biquad("highpass", ev.kind === "hat" ? 7200 : 6500, 0.8);
      const tau = ev.kind === "hat" ? 0.03 : ev.kind === "openhat" ? 0.16 : 0.05;
      const attack = Math.max(1, Math.round((ev.kind === "shaker" ? 0.012 : 0.0008) * SR));
      const out = new Float32Array(attack + Math.ceil(tau * 7 * SR));
      const k = decayFactor(tau);
      const level = v * (ev.kind === "shaker" ? 0.6 : 0.42);
      let amp = 1;
      for (let n = 0; n < out.length; n++) {
        let env: number;
        if (n < attack) env = n / attack;
        else {
          env = amp;
          amp *= k;
        }
        out[n] = filter(noise()) * env * level;
      }
      return out;
    }
    case "rim": {
      const out = new Float32Array(Math.ceil(0.08 * SR));
      const k = decayFactor(0.012);
      let amp = v * 0.55;
      let p1 = 0;
      let p2 = 0;
      for (let n = 0; n < out.length; n++) {
        out[n] = (readTable(SINE, p1) * 0.6 + readTable(SINE, p2) * 0.4) * amp;
        p1 = wrap(p1 + 1650 / SR);
        p2 = wrap(p2 + 820 / SR);
        amp *= k;
      }
      return out;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Mixing and effects (circular: run several passes over the loop, keep the last)

type Bus = { dry: Float32Array; reverb: Float32Array; delay: Float32Array };

// Effect sends per instrument: pads and bells sit further back; bass stays dry so the low end is tight.
const SENDS: Record<Instrument | "drums", { reverb: number; delay: number; level: number }> = {
  epiano: { reverb: 0.32, delay: 0.12, level: 0.55 },
  pad: { reverb: 0.55, delay: 0, level: 0.3 },
  pluck: { reverb: 0.3, delay: 0.28, level: 0.42 },
  bass: { reverb: 0.04, delay: 0, level: 0.62 },
  subbass: { reverb: 0, delay: 0, level: 0.7 },
  marimba: { reverb: 0.3, delay: 0.18, level: 0.5 },
  bell: { reverb: 0.6, delay: 0.25, level: 0.32 },
  lead: { reverb: 0.35, delay: 0.22, level: 0.3 },
  drums: { reverb: 0.07, delay: 0, level: 0.72 },
};

/** Adds a note's samples into a loop-long stem from sample `start`, wrapping past the end to the beginning. */
function mixInto(stem: Float32Array, samples: Float32Array, start: number, gain: number) {
  const n = stem.length;
  let k = start % n;
  let i = 0;
  while (i < samples.length) {
    // Straight runs between wraps, so the inner loop has no branch.
    const run = Math.min(samples.length - i, n - k);
    for (let j = 0; j < run; j++) stem[k + j] += samples[i + j] * gain;
    i += run;
    k = 0;
  }
}

function circularDelay(input: Float32Array, delaySamples: number, feedback: number, passes: number): Float32Array {
  const n = input.length;
  const line = new Float32Array(delaySamples);
  const out = new Float32Array(n);
  const lp = onePole(3500);
  let damp = 0;
  let w = 0;
  for (let p = 0; p < passes; p++) {
    const last = p === passes - 1;
    for (let i = 0; i < n; i++) {
      const delayed = line[w];
      damp += lp * (delayed - damp);
      line[w] = input[i] + damp * feedback;
      if (++w === delaySamples) w = 0;
      if (last) out[i] = delayed;
    }
  }
  return out;
}

/** A small Schroeder/Freeverb-style room: parallel damped combs into series all-passes. */
function* circularReverb(input: Float32Array, room: number, passes: number): Generator<void, Float32Array> {
  const n = input.length;
  const scale = SR / 44_100;
  const feedback = 0.7 + 0.28 * room;
  const damp = 0.35;
  // Each stage over the whole loop in turn (the combs in parallel, then the all-passes in series): one tight loop per
  // filter, which is several times faster than stepping every filter per sample.
  const wet = new Float32Array(n);
  for (const length of [1557, 1617, 1491, 1422, 1277, 1356]) {
    const buf = new Float32Array(Math.round(length * scale));
    const len = buf.length;
    let k = 0;
    let store = 0;
    for (let p = 0; p < passes; p++) {
      const last = p === passes - 1;
      for (let i = 0; i < n; i++) {
        const y = buf[k];
        store = y * (1 - damp) + store * damp;
        buf[k] = input[i] * 0.06 + store * feedback;
        if (++k === len) k = 0;
        if (last) wet[i] += y;
      }
    }
    yield;
  }
  let signal = wet;
  for (const length of [556, 441, 341, 225]) {
    const buf = new Float32Array(Math.round(length * scale));
    const len = buf.length;
    const out = new Float32Array(n);
    let k = 0;
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < n; i++) {
        const b = buf[k];
        const s = signal[i];
        buf[k] = s + b * 0.5;
        out[i] = b - s * 0.5;
        if (++k === len) k = 0;
      }
    }
    signal = out;
    yield;
  }
  return signal;
}

/** DC / rumble removal (one-pole high-pass), circular. */
function circularHighPass(input: Float32Array, freq: number, passes: number): Float32Array {
  const n = input.length;
  const out = new Float32Array(n);
  const r = Math.exp((-TAU * freq) / SR);
  let x1 = 0;
  let y1 = 0;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const y = input[i] - x1 + r * y1;
      x1 = input[i];
      y1 = y;
      out[i] = y;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Levels

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function peak(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]));
  return p;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}

/** Memoryless soft limiter: linear below `knee`, then a tanh curve that approaches (never reaches) `ceiling`. */
export function softLimit(x: number, knee: number, ceiling: number): number {
  const a = Math.abs(x);
  if (a <= knee) return x;
  const room = ceiling - knee;
  return Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
}

/**
 * Brings the loop to MUSIC_TARGET_RMS_DB and bends any peak under MUSIC_PEAK_CEILING_DB. The limiter takes a little
 * loudness off loud peaks, so the gain is re-measured after it.
 */
export function normalize(samples: Float32Array): Float32Array {
  return finish(normalizeSteps(samples));
}

function* normalizeSteps(samples: Float32Array): Generator<void, Float32Array> {
  const target = dbToGain(MUSIC_TARGET_RMS_DB);
  const ceiling = dbToGain(MUSIC_PEAK_CEILING_DB);
  const knee = ceiling * 0.7;
  const out = new Float32Array(samples.length);
  const current = rms(samples);
  if (current === 0) return out;
  let gain = target / current;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < samples.length; i++) out[i] = softLimit(samples[i] * gain, knee, ceiling);
    if (pass < 2) gain *= target / rms(out);
    yield;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering

/** Samples in one loop of the score (rounded to a whole sample). */
export function loopSamples(score: Score): number {
  return Math.round((score.beats * 60 * SR) / score.bpm);
}

function renderNote(note: NoteEvent, heldSec: number): Float32Array {
  const hz = midiToHz(note.m);
  switch (note.inst) {
    case "epiano":
      return epiano(heldSec, hz, note.v);
    case "pad":
      return pad(heldSec, hz, note.v);
    case "pluck":
      return pluck(heldSec, hz, note.v);
    case "bass":
    case "subbass":
      return bass(heldSec, hz, note.v, note.inst === "subbass");
    case "marimba":
    case "bell":
      return mallet(heldSec, hz, note.v, note.inst);
    case "lead":
      return lead(heldSec, hz, note.v);
  }
}

/** Runs a stepped computation to the end at once. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** Renders a score to one seamless, normalized loop of mono samples in (-1, 1). Deterministic. */
export function renderScore(score: Score): Float32Array {
  return finish(renderScoreSteps(score));
}

/**
 * The same render, handing the main thread back every `sliceMs` (a note, an effect stage or a normalizing pass is the
 * unit of work), so a phone keeps scrolling and animating while a track is made. Same samples as renderScore.
 */
export async function renderScoreAsync(score: Score, sliceMs = 12): Promise<Float32Array> {
  const steps = renderScoreSteps(score);
  let sliceStart = performance.now();
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    if (performance.now() - sliceStart >= sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
  }
}

function* renderScoreSteps(score: Score): Generator<void, Float32Array> {
  const n = loopSamples(score);
  const secondsPerBeat = 60 / score.bpm;
  const sampleOf = (beat: number) => {
    const b = ((beat % score.beats) + score.beats) % score.beats;
    return Math.round(b * secondsPerBeat * SR) % n;
  };
  const level = (key: Instrument | "drums") => score.levels?.[key] ?? 1;

  // One stem per instrument (and one for the drums); the effect sends are applied to whole stems at the end, so a
  // note costs one add per sample.
  const stems = new Map<Instrument | "drums", Float32Array>();
  const stem = (key: Instrument | "drums") => {
    let s = stems.get(key);
    if (!s) {
      s = new Float32Array(n);
      stems.set(key, s);
    }
    return s;
  };
  // Every instrument is linear in velocity (it only scales the output), so each distinct (instrument, pitch, length)
  // is rendered once at velocity 1 and scaled while mixing: a repeated chord or arpeggio costs one render.
  const cache = new Map<string, Float32Array>();
  for (const note of score.notes) {
    const id = `${note.inst}|${note.m}|${note.d}`;
    let samples = cache.get(id);
    if (!samples) {
      samples = renderNote({ ...note, v: 1 }, note.d * secondsPerBeat);
      cache.set(id, samples);
    }
    mixInto(stem(note.inst), samples, sampleOf(note.t), note.v);
    yield;
  }
  const rnd = seededRandom(score.seed);
  for (const ev of score.drums) mixInto(stem("drums"), drum(ev, rnd), sampleOf(ev.t), 1);
  yield;

  const bus: Bus = { dry: new Float32Array(n), reverb: new Float32Array(n), delay: new Float32Array(n) };
  for (const [key, samples] of stems) {
    const send = SENDS[key];
    const gain = send.level * level(key);
    const r = gain * send.reverb;
    const d = gain * send.delay;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      bus.dry[i] += s * gain;
      bus.reverb[i] += s * r;
      bus.delay[i] += s * d;
    }
  }

  const mix = new Float32Array(n);
  mix.set(bus.dry);
  if (score.reverb) {
    // Two passes: after one loop (>= 13 s) even the longest tail (room 1, ~0.98 per 30 ms) is below -200 dB.
    const wet = yield* circularReverb(bus.reverb, score.reverb.room, 2);
    for (let i = 0; i < n; i++) mix[i] += wet[i] * score.reverb.mix;
  }
  if (score.delay) {
    const d = Math.round(score.delay.beats * secondsPerBeat * SR);
    const wet = circularDelay(bus.delay, d, score.delay.feedback, 3);
    for (let i = 0; i < n; i++) mix[i] += wet[i] * score.delay.mix;
  }
  yield;
  return yield* normalizeSteps(circularHighPass(mix, 28, 2));
}

/** A 16-bit mono PCM WAV file of the samples. */
export function encodeWav(samples: Float32Array, sampleRate = MUSIC_SAMPLE_RATE): ArrayBuffer {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return buffer;
}
