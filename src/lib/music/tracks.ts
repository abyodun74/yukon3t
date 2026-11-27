/*
 * The built-in original tracks: each one composed here, as code, and synthesized by src/lib/music/synth.ts. No
 * samples, loops, soundfonts or recordings of any kind are used, so there is nothing to license. Each score is one
 * loop of whole bars; the synth renders it seamlessly (see synth.ts).
 *
 * Keys and the picker order live in src/lib/post-music.ts (server-safe, no audio code); this file is only loaded by
 * the browser when a track is first played, and by the tests.
 */

import { seededRandom, type DrumEvent, type DrumKind, type Instrument, type NoteEvent, type Score } from "@/lib/music/synth";
import type { PostMusicKey } from "@/lib/post-music";

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" = 60, "F#3", "Bb2". */
export function note(name: string): number {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`bad note ${name}`);
  const [, letter, accidental, octave] = match;
  return 12 * (Number(octave) + 1) + NOTE_INDEX[letter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
}

const chord = (names: string) => names.split(" ").map(note);

/** [beat in bar, note name, length in beats] */
type Phrase = readonly (readonly [number, string, number])[];

class Composer {
  notes: NoteEvent[] = [];
  drums: DrumEvent[] = [];
  private rnd: () => number;
  constructor(seed: number) {
    this.rnd = seededRandom(seed ^ 0x5eed);
  }
  /** A small, repeatable velocity variation so repeated notes don't sound mechanical. */
  private human(v: number) {
    return Math.min(1, v * (0.9 + 0.2 * this.rnd()));
  }
  add(inst: Instrument, t: number, m: number, d: number, v: number) {
    this.notes.push({ inst, t, m, d, v: this.human(v) });
  }
  chord(inst: Instrument, t: number, ms: number[], d: number, v: number) {
    for (const m of ms) this.add(inst, t, m, d, v);
  }
  phrase(inst: Instrument, barStart: number, phrase: Phrase, v: number) {
    for (const [t, name, d] of phrase) this.add(inst, barStart + t, note(name), d, v);
  }
  hit(kind: DrumKind, t: number, v: number, m?: number) {
    this.drums.push({ kind, t, v: this.human(v), ...(m === undefined ? {} : { m }) });
  }
  /** A drum pattern written one character per step ("x" loud, "o" soft, "." rest) from `barStart`. */
  steps(kind: DrumKind, barStart: number, pattern: string, stepBeats: number, loud: number, soft = loud * 0.55, swing = 0) {
    [...pattern].forEach((c, i) => {
      if (c === ".") return;
      const t = i * stepBeats;
      const offbeat = Math.abs((t % 1) - 0.5) < 1e-9;
      this.hit(kind, barStart + t + (offbeat ? swing : 0), c === "x" ? loud : soft);
    });
  }
}

/** A broken-chord pattern: `order` indexes into `tones`, one per step. */
function arpeggio(c: Composer, inst: Instrument, barStart: number, tones: number[], order: number[], step: number, d: number, v: number) {
  order.forEach((idx, i) => c.add(inst, barStart + i * step, tones[idx], d, v));
}

// ---------------------------------------------------------------------------------------------------------------

function sunrise(): Score {
  // Warm and hopeful: D major, I-V-vi-IV, electric piano and a plucked arpeggio, a melody the second time round.
  const c = new Composer(11);
  const pads = ["A3 D4 F#4", "A3 C#4 E4", "B3 D4 F#4", "B3 D4 G4"].map(chord);
  const roots = ["D2", "A2", "B2", "G2"].map(note);
  const melody: Phrase[] = [
    [[0, "F#5", 1], [1, "E5", 0.5], [1.5, "D5", 0.5], [2, "E5", 1.75]],
    [[0, "C#5", 1], [1, "E5", 1], [2, "A5", 1.75]],
    [[0, "F#5", 1.5], [1.5, "D5", 0.5], [2, "B4", 1.75]],
    [[0, "D5", 1], [1, "E5", 1], [2, "D5", 1.75]],
  ];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    const i = bar % 4;
    c.chord("pad", b, pads[i], 3.8, 0.5);
    c.chord("epiano", b, pads[i], 1.4, 0.42);
    c.chord("epiano", b + 2.5, pads[i], 1.3, 0.34);
    arpeggio(c, "pluck", b, [...pads[i].map((m) => m + 12), pads[i][0] + 24], [0, 1, 2, 3, 2, 1, 2, 3], 0.5, 0.45, bar < 4 ? 0.36 : 0.26);
    c.add("bass", b, roots[i], 1.8, 0.7);
    c.add("bass", b + 2, roots[i] + 12, 0.9, 0.5);
    c.add("bass", b + 3, roots[i], 0.8, 0.55);
    c.steps("kick", b, "x.......x.....o.", 0.25, 0.8);
    c.steps("rim", b, "....x.......x...", 0.25, 0.5);
    c.steps("hat", b, "x.o.x.o.x.o.x.o.", 0.25, 0.32);
    if (bar >= 4) c.phrase("lead", b, melody[i], 0.55);
  }
  c.steps("snare", 28, "............o.oo", 0.25, 0.5);
  return { bpm: 92, beats: 32, notes: c.notes, drums: c.drums, seed: 11, reverb: { mix: 1, room: 0.6 }, delay: { beats: 0.75, feedback: 0.3, mix: 0.6 } };
}

function lateNight(): Score {
  // Lo-fi, jazzy and slow: ii-V-I-vi in C with ninths, swung hats, a soft bell line the second time.
  const c = new Composer(23);
  const swing = 0.16;
  const voicings = ["F3 A3 C4 E4", "F3 B3 E4", "E3 G3 B3 D4", "G3 C4 E4"].map(chord);
  const roots = ["D2", "G2", "C2", "A2"].map(note);
  const bells: Phrase[] = [
    [[0.5 + swing, "A5", 1], [2, "E5", 1.5]],
    [[1, "D5", 1], [2.5 + swing, "B4", 1]],
    [[0, "G5", 1], [1.5 + swing, "E5", 1.5]],
    [[1, "C5", 2]],
  ];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    const i = bar % 4;
    c.chord("epiano", b, voicings[i], 1.3, 0.48);
    c.chord("epiano", b + 1.5 + swing, voicings[i], 0.6, 0.32);
    c.chord("epiano", b + 3, voicings[i], 0.8, 0.36);
    c.add("subbass", b, roots[i], 1.4, 0.75);
    c.add("bass", b + 2.5 + swing, roots[i] + 7, 0.4, 0.4);
    c.add("bass", b + 3, roots[i] + 12, 0.7, 0.42);
    c.steps("kick", b, "x.....o...x.....", 0.25, 0.75);
    c.steps("snare", b, "....x.......x...", 0.25, 0.42);
    c.steps("hat", b, "xoxoxoxo", 0.5, 0.26, 0.15, swing);
    if (bar >= 4) c.phrase("bell", b, bells[i], 0.45);
  }
  return { bpm: 76, beats: 32, notes: c.notes, drums: c.drums, seed: 23, reverb: { mix: 1.2, room: 0.55 }, delay: { beats: 0.66, feedback: 0.25, mix: 0.5 } };
}

function breeze(): Score {
  // Light and acoustic: fingerpicked G-Em-C-D, shaker, a plucked melody the second time.
  const c = new Composer(37);
  const picks = [
    ["D4", "G4", "B4", "G4", "D4", "G4", "B4", "G4"],
    ["B3", "E4", "G4", "E4", "B3", "E4", "G4", "E4"],
    ["C4", "E4", "G4", "E4", "C4", "E4", "G4", "E4"],
    ["A3", "D4", "F#4", "D4", "A3", "D4", "F#4", "D4"],
  ].map((row) => row.map(note));
  const roots = ["G2", "E2", "C3", "D3"].map(note);
  const melody: Phrase[] = [
    [[0, "B5", 1], [1, "D6", 1], [2, "B5", 1], [3, "A5", 1]],
    [[0, "G5", 2], [2, "E5", 1.75]],
    [[0, "E5", 1], [1, "G5", 1], [2, "C6", 1.5], [3.5, "B5", 0.5]],
    [[0, "A5", 1], [1, "F#5", 1], [2, "D5", 1.75]],
  ];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    const i = bar % 4;
    picks[i].forEach((m, k) => c.add("pluck", b + k * 0.5, m, 0.6, bar < 4 ? 0.42 : 0.32));
    c.add("bass", b, roots[i], 1.5, 0.62);
    c.add("bass", b + 2, roots[i] + 7, 1.5, 0.48);
    c.steps("shaker", b, "xoooxoooxoooxooo", 0.25, 0.4, 0.2);
    c.steps("kick", b, "x.......x.......", 0.25, 0.6);
    c.steps("rim", b, "....x.......x...", 0.25, 0.4);
    if (bar >= 4) c.phrase("pluck", b, melody[i], 0.5);
  }
  return { bpm: 104, beats: 32, notes: c.notes, drums: c.drums, seed: 37, reverb: { mix: 0.9, room: 0.5 }, delay: { beats: 0.5, feedback: 0.22, mix: 0.4 } };
}

function daydream(): Score {
  // Ambient and floating: slow major-seventh pads, glass bells, no drums.
  const c = new Composer(41);
  const pads = ["G3 B3 E4", "G3 C4 E4", "A3 C4 E4", "A3 B3 D4"].map(chord);
  const roots = ["C3", "A2", "F2", "G2"].map(note);
  const bells: Phrase[] = [
    [[0, "E5", 2], [2, "G5", 2]],
    [[0.5, "C5", 1.5], [2, "E5", 2]],
    [[0, "A5", 1.5], [2, "G5", 1], [3, "E5", 1]],
    [[0, "D5", 2], [2, "B4", 2]],
  ];
  for (let bar = 0; bar < 4; bar++) {
    const b = bar * 4;
    c.chord("pad", b, pads[bar], 3.9, 0.62);
    c.add("bass", b, roots[bar], 3.6, 0.42);
    c.phrase("bell", b, bells[bar], 0.5);
  }
  return { bpm: 66, beats: 16, notes: c.notes, drums: c.drums, seed: 41, reverb: { mix: 1.6, room: 0.9 }, delay: { beats: 0.75, feedback: 0.35, mix: 0.6 } };
}

function groove(): Score {
  // Funky and upbeat: Em7 to A9, a syncopated bass, clap on two and four, short piano stabs.
  const c = new Composer(53);
  const stabs = [chord("D4 G4 B4"), chord("C#4 G4 B4")];
  const bass: Phrase[] = [
    [[0, "E2", 0.4], [0.75, "E3", 0.2], [1, "E2", 0.25], [1.5, "G2", 0.4], [2, "A2", 0.4], [2.75, "B2", 0.2], [3, "D3", 0.3], [3.5, "B2", 0.4]],
    [[0, "A2", 0.4], [0.75, "A3", 0.2], [1, "A2", 0.25], [1.5, "C#3", 0.4], [2, "E3", 0.3], [2.5, "A2", 0.3], [3, "G2", 0.4], [3.5, "F#2", 0.4]],
  ];
  const counter: Phrase[] = [
    [[2, "B4", 0.5], [2.5, "D5", 0.5], [3, "E5", 0.75]],
    [[2, "C#5", 0.5], [2.5, "E5", 0.5], [3, "G5", 0.75]],
  ];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    const i = bar % 2;
    for (const t of [0.5, 1.75, 2.5, 3.5]) c.chord("epiano", b + t, stabs[i], 0.2, 0.42);
    c.phrase("bass", b, bass[i], 0.72);
    c.steps("kick", b, "x..x......x.....", 0.25, 0.82);
    c.steps("clap", b, "....x.......x...", 0.25, 0.5);
    c.steps("hat", b, "xoooxoooxoooxo..", 0.25, 0.3, 0.14);
    c.steps("openhat", b, "..............x.", 0.25, 0.28);
    if (bar >= 4) c.phrase("pluck", b, counter[i], 0.4);
  }
  return { bpm: 108, beats: 32, notes: c.notes, drums: c.drums, seed: 53, reverb: { mix: 0.7, room: 0.4 }, delay: { beats: 0.75, feedback: 0.2, mix: 0.3 } };
}

function celebrate(): Score {
  // Bright and danceable: A major, four-on-the-floor, off-beat bass and a hook the second time.
  const c = new Composer(67);
  const pads = ["A3 C#4 E4", "A3 C#4 F#4", "A3 D4 F#4", "G#3 B3 E4"].map(chord);
  const roots = ["A2", "F#2", "D2", "E2"].map(note);
  const hook: Phrase[] = [
    [[0, "E5", 0.5], [0.5, "C#5", 0.5], [1, "E5", 0.5], [1.5, "F#5", 0.5], [2, "E5", 1], [3, "C#5", 0.9]],
    [[0, "C#5", 0.5], [0.5, "A4", 0.5], [1, "C#5", 0.5], [1.5, "E5", 0.5], [2, "F#5", 1.9]],
    [[0, "F#5", 0.5], [0.5, "E5", 0.5], [1, "D5", 0.5], [1.5, "E5", 0.5], [2, "F#5", 1], [3, "A5", 0.9]],
    [[0, "G#5", 1], [1, "F#5", 1], [2, "E5", 1.9]],
  ];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    const i = bar % 4;
    c.chord("pad", b, pads[i], 3.8, 0.42);
    arpeggio(c, "pluck", b, [...pads[i].map((m) => m + 12), pads[i][0] + 24], [0, 1, 2, 3, 2, 1, 0, 1], 0.5, 0.3, bar < 4 ? 0.34 : 0.22);
    for (let beat = 0; beat < 4; beat++) c.add("bass", b + beat + 0.5, roots[i], 0.35, 0.68);
    c.steps("kick", b, "x...x...x...x...", 0.25, 0.85);
    c.steps("clap", b, "....x.......x...", 0.25, 0.48);
    c.steps("openhat", b, "..x...x...x...x.", 0.25, 0.3);
    c.steps("hat", b, "o.o.o.o.o.o.o.o.", 0.25, 0.16);
    if (bar >= 4) c.phrase("lead", b, hook[i], 0.55);
  }
  return { bpm: 120, beats: 32, notes: c.notes, drums: c.drums, seed: 67, reverb: { mix: 0.8, room: 0.45 }, delay: { beats: 0.75, feedback: 0.25, mix: 0.4 } };
}

function tender(): Score {
  // Soft and tender: broken chords on electric piano, F-Am-Dm-Bb, a quiet melody over a pad.
  const c = new Composer(71);
  const arps = [
    ["F2", "C3", "F3", "A3", "C4", "A3", "F3", "C3"],
    ["A2", "E3", "A3", "C4", "E4", "C4", "A3", "E3"],
    ["D3", "A3", "D4", "F4", "A4", "F4", "D4", "A3"],
    ["Bb2", "F3", "Bb3", "D4", "F4", "D4", "Bb3", "F3"],
  ].map((row) => row.map(note));
  const pads = ["A3 C4 F4", "A3 C4 E4", "A3 D4 F4", "Bb3 D4 F4"].map(chord);
  const melody: Phrase[] = [
    [[1, "A4", 1], [2, "C5", 1.9]],
    [[0, "E5", 1.5], [1.5, "D5", 0.5], [2, "C5", 1.9]],
    [[0, "D5", 1], [1, "F5", 1], [2, "A4", 1.9]],
    [[0, "Bb4", 1], [1, "D5", 1], [2, "C5", 1.5], [3.5, "A4", 0.45]],
  ];
  for (let bar = 0; bar < 4; bar++) {
    const b = bar * 4;
    arps[bar].forEach((m, k) => c.add("epiano", b + k * 0.5, m, k === 0 ? 2 : 0.9, k === 0 ? 0.5 : 0.36));
    c.chord("pad", b, pads[bar], 3.8, 0.34);
    c.phrase("lead", b, melody[bar], 0.48);
  }
  return { bpm: 72, beats: 16, notes: c.notes, drums: c.drums, seed: 71, reverb: { mix: 1.3, room: 0.75 }, delay: { beats: 1, feedback: 0.2, mix: 0.3 } };
}

function focus(): Score {
  // Minimal and steady: a marimba ostinato over Am-F-C-G, a soft pulse, light bells the second time.
  const c = new Composer(83);
  const tones = [
    ["A4", "C5", "E5", "C5", "A4", "C5", "E5", "G5"],
    ["F4", "A4", "C5", "A4", "F4", "A4", "C5", "E5"],
    ["E4", "G4", "C5", "G4", "E4", "G4", "C5", "D5"],
    ["D4", "G4", "B4", "G4", "D4", "G4", "B4", "D5"],
  ].map((row) => row.map(note));
  const pads = ["A3 C4 E4", "A3 C4 F4", "G3 C4 E4", "G3 B3 D4"].map(chord);
  const roots = ["A2", "F2", "C3", "G2"].map(note);
  const bells: Phrase[] = [[[2.5, "E6", 1]], [[2.5, "C6", 1]], [[2.5, "G5", 1]], [[2.5, "B5", 1]]];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    const i = bar % 4;
    tones[i].forEach((m, k) => c.add("marimba", b + k * 0.5, m, 0.4, k % 2 === 0 ? 0.5 : 0.36));
    c.chord("pad", b, pads[i], 3.8, 0.4);
    c.add("bass", b, roots[i], 3.6, 0.5);
    c.steps("kick", b, "x.......x.......", 0.25, 0.62);
    c.steps("shaker", b, "x.o.x.o.x.o.x.o.", 0.25, 0.3, 0.18);
    if (bar >= 4) c.phrase("bell", b, bells[i], 0.32);
  }
  return { bpm: 96, beats: 32, notes: c.notes, drums: c.drums, seed: 83, reverb: { mix: 0.9, room: 0.55 }, delay: { beats: 0.75, feedback: 0.3, mix: 0.45 } };
}

function adventure(): Score {
  // Cinematic and bold: D minor, Dm-Bb-F-C, a driving bass ostinato, toms, a heroic melody the second time.
  const c = new Composer(97);
  const pads = ["A3 D4 F4", "Bb3 D4 F4", "A3 C4 F4", "G3 C4 E4"].map(chord);
  const roots = ["D2", "Bb2", "F2", "C3"].map(note);
  const melody: Phrase[] = [
    [[0, "D5", 1.5], [1.5, "E5", 0.5], [2, "F5", 1], [3, "A5", 0.9]],
    [[0, "G5", 1.5], [1.5, "F5", 0.5], [2, "D5", 1.9]],
    [[0, "C5", 1], [1, "F5", 1], [2, "A5", 1.5], [3.5, "G5", 0.45]],
    [[0, "G5", 2], [2, "E5", 1.9]],
  ];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    const i = bar % 4;
    c.chord("pad", b, pads[i], 3.8, 0.55);
    [0, 0, 12, 0, 0, 12, 0, 12].forEach((o, k) => c.add("bass", b + k * 0.5, roots[i] + o, 0.4, k % 2 === 0 ? 0.7 : 0.52));
    c.steps("kick", b, "x.....x.x.......", 0.25, 0.85);
    c.steps("snare", b, "........x.......", 0.25, 0.48);
    c.steps("shaker", b, "oooooooooooooooo", 0.25, 0.18);
    if (i === 3) {
      c.hit("tom", b + 3, 0.7, note("A2"));
      c.hit("tom", b + 3.5, 0.75, note("F2"));
    }
    if (bar >= 4) c.phrase("lead", b, melody[i], 0.58);
  }
  return { bpm: 88, beats: 32, notes: c.notes, drums: c.drums, seed: 97, reverb: { mix: 1.2, room: 0.7 }, delay: { beats: 0.75, feedback: 0.25, mix: 0.35 } };
}

function island(): Score {
  // Tropical and sunny: a marimba tune over C-F-G-C, a clave, off-beat chords and a bouncy bass.
  const c = new Composer(101);
  const tune: Phrase[] = [
    [[0, "G4", 0.5], [0.5, "C5", 0.5], [1, "E5", 1], [2, "D5", 0.5], [2.5, "C5", 0.5], [3, "E5", 0.9]],
    [[0, "F5", 0.5], [0.5, "E5", 0.5], [1, "C5", 1], [2, "A4", 0.5], [2.5, "C5", 0.5], [3, "F5", 0.9]],
    [[0, "D5", 0.5], [0.5, "G5", 0.5], [1, "B4", 1], [2, "D5", 0.5], [2.5, "F5", 0.5], [3, "D5", 0.9]],
    [[0, "E5", 1], [1, "G5", 0.5], [1.5, "E5", 0.5], [2, "C5", 1.9]],
  ];
  const chords = ["C4 E4 G4", "C4 F4 A4", "B3 D4 G4", "C4 E4 G4"].map(chord);
  const roots = ["C3", "F2", "G2", "C3"].map(note);
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    const i = bar % 4;
    c.phrase("marimba", b, tune[i], bar < 4 ? 0.6 : 0.52);
    for (let beat = 0; beat < 4; beat++) c.chord("marimba", b + beat + 0.5, chords[i], 0.3, 0.2);
    c.add("bass", b, roots[i], 0.45, 0.68);
    c.add("bass", b + 1.5, roots[i] + 7, 0.45, 0.55);
    c.add("bass", b + 2, roots[i], 0.45, 0.62);
    c.add("bass", b + 3, roots[i] + 12, 0.45, 0.5);
    c.steps("kick", b, "x.......x.......", 0.25, 0.7);
    c.steps("shaker", b, "xoxoxoxoxoxoxoxo", 0.25, 0.3, 0.16);
    // 3-2 son clave across each pair of bars.
    c.steps("rim", b, bar % 2 === 0 ? "x.....x.....x..." : "....x...x.......", 0.25, 0.42);
  }
  return { bpm: 100, beats: 32, notes: c.notes, drums: c.drums, seed: 101, reverb: { mix: 0.8, room: 0.45 }, delay: { beats: 0.75, feedback: 0.2, mix: 0.3 } };
}

/** Every track's score, by key. */
export const TRACK_SCORES: Record<PostMusicKey, () => Score> = {
  sunrise,
  lateNight,
  breeze,
  daydream,
  groove,
  celebrate,
  tender,
  focus,
  adventure,
  island,
};
