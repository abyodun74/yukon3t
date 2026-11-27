import { beforeAll, describe, expect, it } from "vitest";
import {
  MUSIC_PEAK_CEILING_DB,
  MUSIC_SAMPLE_RATE,
  MUSIC_TARGET_RMS_DB,
  encodeWav,
  gainToDb,
  loopSamples,
  peak,
  renderScore,
  renderScoreAsync,
  rms,
  seededRandom,
  softLimit,
} from "@/lib/music/synth";
import { TRACK_SCORES, note } from "@/lib/music/tracks";
import { POST_MUSIC_KEYS, type PostMusicKey } from "@/lib/post-music";

// The rendered audio of every built-in track, measured exactly as a phone will play it (the synth is deterministic):
// loudness, peaks, the loop seam, length and that the tracks are really different from each other.

const rendered = new Map<PostMusicKey, Float32Array>();

beforeAll(() => {
  for (const key of POST_MUSIC_KEYS) rendered.set(key, renderScore(TRACK_SCORES[key]()));
}, 120_000);

function firstDifferences(samples: Float32Array): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  // out[0] is the loop seam: the step from the last sample back to the first.
  for (let i = 0; i < n; i++) out[i] = Math.abs(samples[i] - samples[(i - 1 + n) % n]);
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

describe("built-in tracks", () => {
  it("has a score for every catalogue key and nothing else", () => {
    expect(Object.keys(TRACK_SCORES).sort()).toEqual([...POST_MUSIC_KEYS].sort());
  });

  it.each(POST_MUSIC_KEYS)("%s is one loop of 10 to 30 seconds", (key) => {
    const samples = rendered.get(key)!;
    expect(samples.length).toBe(loopSamples(TRACK_SCORES[key]()));
    const seconds = samples.length / MUSIC_SAMPLE_RATE;
    expect(seconds).toBeGreaterThanOrEqual(10);
    expect(seconds).toBeLessThanOrEqual(30);
  });

  it.each(POST_MUSIC_KEYS)("%s is normalized to the shared loudness and never clips", (key) => {
    const samples = rendered.get(key)!;
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(Math.abs(gainToDb(rms(samples)) - MUSIC_TARGET_RMS_DB)).toBeLessThan(0.25);
    expect(gainToDb(peak(samples))).toBeLessThan(MUSIC_PEAK_CEILING_DB);
    // No DC offset (the master high-pass): the mean is tiny next to the level.
    const mean = samples.reduce((sum, s) => sum + s, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.002);
  });

  it.each(POST_MUSIC_KEYS)("%s loops seamlessly: the step at the seam is an ordinary one", (key) => {
    const samples = rendered.get(key)!;
    const diffs = firstDifferences(samples);
    // A click at the seam would be a step far bigger than almost every other step in the loop.
    expect(diffs[0]).toBeLessThanOrEqual(percentile(diffs, 0.999));
    // And the level change across the seam is like the change across any other bar line of the loop (a cut-off tail
    // would be a drop there that no bar line inside the loop has): 50 ms either side, within 3 dB of the largest
    // bar-line change inside the loop.
    const score = TRACK_SCORES[key]();
    const w = Math.round(0.05 * MUSIC_SAMPLE_RATE);
    const n = samples.length;
    const jump = (at: number) => {
      const before = rms(samples.subarray(at - w, at));
      const after = rms(samples.subarray(at, at + w));
      return gainToDb(after) - gainToDb(before);
    };
    const barSamples = n / (score.beats / 4);
    const inside: number[] = [];
    for (let bar = 1; bar < score.beats / 4; bar++) inside.push(jump(Math.round(bar * barSamples)));
    const seamBefore = rms(samples.subarray(n - w));
    const seamAfter = rms(samples.subarray(0, w));
    const seam = gainToDb(seamAfter) - gainToDb(seamBefore);
    expect(seam).toBeLessThanOrEqual(Math.max(...inside) + 3);
    expect(seam).toBeGreaterThanOrEqual(Math.min(...inside) - 3);
  });

  it("is deterministic: the same score renders to the same samples", () => {
    const again = renderScore(TRACK_SCORES.tender());
    expect(again).toEqual(rendered.get("tender"));
  }, 60_000);

  it("renders the same samples in slices (the browser path) as in one go", async () => {
    // sliceMs 0: it hands the thread back after every step, the most interrupted the render can be.
    const sliced = await renderScoreAsync(TRACK_SCORES.daydream(), 0);
    expect(sliced).toEqual(rendered.get("daydream"));
  }, 60_000);

  it("every pair of tracks is clearly different music", () => {
    const seconds = 6 * MUSIC_SAMPLE_RATE;
    for (let a = 0; a < POST_MUSIC_KEYS.length; a++) {
      for (let b = a + 1; b < POST_MUSIC_KEYS.length; b++) {
        const x = rendered.get(POST_MUSIC_KEYS[a])!.subarray(0, seconds);
        const y = rendered.get(POST_MUSIC_KEYS[b])!.subarray(0, seconds);
        let dot = 0;
        for (let i = 0; i < seconds; i++) dot += x[i] * y[i];
        const correlation = dot / (rms(x) * rms(y) * seconds);
        expect(Math.abs(correlation), `${POST_MUSIC_KEYS[a]} vs ${POST_MUSIC_KEYS[b]}`).toBeLessThan(0.3);
      }
    }
    const tempos = new Set(POST_MUSIC_KEYS.map((k) => TRACK_SCORES[k]().bpm));
    expect(tempos.size).toBeGreaterThanOrEqual(8);
  }, 60_000);
});

describe("synth helpers", () => {
  it("parses note names", () => {
    expect(note("C4")).toBe(60);
    expect(note("A4")).toBe(69);
    expect(note("F#3")).toBe(54);
    expect(note("Bb2")).toBe(46);
    expect(() => note("H2")).toThrow();
  });

  it("seeds its noise: the same seed, the same sequence", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("limits softly and never reaches the ceiling", () => {
    expect(softLimit(0.3, 0.6, 0.9)).toBe(0.3);
    expect(softLimit(5, 0.6, 0.9)).toBeLessThan(0.9);
    expect(softLimit(-5, 0.6, 0.9)).toBeGreaterThan(-0.9);
    expect(softLimit(0.7, 0.6, 0.9)).toBeGreaterThan(0.6);
  });

  it("writes a valid 16-bit mono WAV", () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 0.5, -0.5, 1])));
    const text = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(o + i)));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(MUSIC_SAMPLE_RATE);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(8);
    expect(wav.getInt16(46, true)).toBe(16384);
    expect(wav.getInt16(50, true)).toBe(32767);
  });
});
