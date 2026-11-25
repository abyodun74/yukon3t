// The soft "lub-dub" heartbeat that plays under the like heart's rise (heart-beat-audio.ts synthesizes it with Web
// Audio; no audio file). This file is the pure half: the beat schedule and the rules for when it may play, so both are
// unit tested (heart-beat.test.ts). The CSS pulse on the lead heart (`.post-heart-pulse` in globals.css) mirrors
// HEART_BEAT_START_MS and the two beat offsets below.

/** Wait after the burst starts, so the first beat lands as the lead heart pops in. Mirrored by `.post-heart-pulse`. */
export const HEART_BEAT_START_MS = 40;
/** Never louder than this (linear gain): it layers under whatever is playing, it never competes with it. */
export const HEART_BEAT_PEAK_GAIN = 0.25;

export type HeartBeat = {
  /** ms after the start of the sound. */
  atMs: number;
  /** Body frequency of the thump; it sweeps down to `endHz` as it decays. */
  startHz: number;
  endHz: number;
  /** Linear peak gain. */
  peakGain: number;
  attackMs: number;
  decayMs: number;
  type: "sine" | "triangle";
};

/** "Lub" then a slightly higher, softer, shorter "dub" about 120ms later. */
export function planHeartbeat(): HeartBeat[] {
  return [
    { atMs: 0, startHz: 90, endHz: 60, peakGain: HEART_BEAT_PEAK_GAIN, attackMs: 8, decayMs: 170, type: "sine" },
    { atMs: 120, startHz: 82, endHz: 56, peakGain: HEART_BEAT_PEAK_GAIN * 0.7, attackMs: 8, decayMs: 140, type: "triangle" },
  ];
}

/** When the whole sound is over (the last beat's decay). */
export function heartbeatDurationMs(beats: HeartBeat[] = planHeartbeat()): number {
  return beats.reduce((end, b) => Math.max(end, b.atMs + b.attackMs + b.decayMs), 0);
}

export type HeartbeatGate = {
  reducedMotion: boolean;
  documentHidden: boolean;
  /** A call is ringing or under way (isCallMediaHoldActive). */
  callActive: boolean;
  /** Web Audio exists and the context isn't known to be unusable. */
  audioAvailable: boolean;
};

/** True when the heartbeat may play: not in reduced motion, not hidden, not during a call, and audio exists. */
export function shouldPlayHeartbeat(gate: HeartbeatGate): boolean {
  return !gate.reducedMotion && !gate.documentHidden && !gate.callActive && gate.audioAvailable;
}
