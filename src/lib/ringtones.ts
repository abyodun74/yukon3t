"use client";

// Ringtones are synthesized entirely with the Web Audio API rather than
// shipped as audio files — no licensing to track, nothing to download, and
// the whole thing is a few hundred bytes of code instead of MP3 assets.

export type RingtoneId = "CLASSIC" | "CHIME" | "DIGITAL" | "MARIMBA" | "PULSE";

export const RINGTONE_IDS: RingtoneId[] = ["CLASSIC", "CHIME", "DIGITAL", "MARIMBA", "PULSE"];

export const RINGTONE_LABELS: Record<RingtoneId, string> = {
  CLASSIC: "Classic Ring",
  CHIME: "Chime",
  DIGITAL: "Digital",
  MARIMBA: "Marimba",
  PULSE: "Pulse",
};

type Note = {
  freq: number;
  start: number;
  duration: number;
  type: OscillatorType;
  gain: number;
};

type Pattern = { notes: Note[]; cycleSeconds: number };

const PATTERNS: Record<RingtoneId, Pattern> = {
  // Old telephone bell: an alternating dual-tone burst, twice per cycle.
  CLASSIC: {
    notes: [
      { freq: 480, start: 0, duration: 0.4, type: "sine", gain: 0.22 },
      { freq: 620, start: 0, duration: 0.4, type: "sine", gain: 0.18 },
      { freq: 480, start: 0.55, duration: 0.4, type: "sine", gain: 0.22 },
      { freq: 620, start: 0.55, duration: 0.4, type: "sine", gain: 0.18 },
    ],
    cycleSeconds: 1.9,
  },
  // Ascending three-note chime (C5, E5, G5).
  CHIME: {
    notes: [
      { freq: 523.25, start: 0, duration: 0.22, type: "sine", gain: 0.28 },
      { freq: 659.25, start: 0.2, duration: 0.22, type: "sine", gain: 0.28 },
      { freq: 783.99, start: 0.4, duration: 0.32, type: "sine", gain: 0.28 },
    ],
    cycleSeconds: 2.1,
  },
  // Fast electronic beep-beep-beep.
  DIGITAL: {
    notes: [
      { freq: 1000, start: 0, duration: 0.1, type: "square", gain: 0.12 },
      { freq: 1000, start: 0.16, duration: 0.1, type: "square", gain: 0.12 },
      { freq: 1000, start: 0.32, duration: 0.1, type: "square", gain: 0.12 },
    ],
    cycleSeconds: 1.3,
  },
  // Soft descending notes with a quick decay.
  MARIMBA: {
    notes: [
      { freq: 880, start: 0, duration: 0.28, type: "sine", gain: 0.24 },
      { freq: 698.46, start: 0.14, duration: 0.28, type: "sine", gain: 0.21 },
      { freq: 523.25, start: 0.28, duration: 0.32, type: "sine", gain: 0.18 },
    ],
    cycleSeconds: 1.9,
  },
  // A single low, rhythmic pulse.
  PULSE: {
    notes: [{ freq: 220, start: 0, duration: 0.45, type: "sawtooth", gain: 0.1 }],
    cycleSeconds: 1.1,
  },
};

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

/** Schedules one cycle's notes starting at `cycleStart` (an AudioContext timestamp). */
function scheduleCycle(ctx: AudioContext, notes: Note[], cycleStart: number) {
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = note.type;
    osc.frequency.value = note.freq;

    const noteStart = cycleStart + note.start;
    const noteEnd = noteStart + note.duration;
    // Short ramps in/out so notes don't click.
    gainNode.gain.setValueAtTime(0, noteStart);
    gainNode.gain.linearRampToValueAtTime(note.gain, noteStart + 0.02);
    gainNode.gain.setValueAtTime(note.gain, Math.max(noteStart + 0.02, noteEnd - 0.05));
    gainNode.gain.linearRampToValueAtTime(0, noteEnd);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(noteStart);
    osc.stop(noteEnd + 0.05);
  }
}

/** Loops a ringtone until stop() is called — used while a call is ringing. */
export class RingtonePlayer {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  start(id: RingtoneId) {
    this.stop();
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;

    const pattern = PATTERNS[id];
    const ctx = new Ctor();
    this.ctx = ctx;

    // Browsers may start a fresh AudioContext suspended until a user
    // gesture occurs on the page — if resume() rejects, we just stay
    // silent rather than throw; the visual "is calling" UI still shows.
    ctx.resume().catch(() => {});

    const loop = () => {
      if (this.ctx !== ctx) return;
      scheduleCycle(ctx, pattern.notes, ctx.currentTime);
      this.timer = setTimeout(loop, pattern.cycleSeconds * 1000);
    };
    loop();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      ctx.close().catch(() => {});
    }
  }
}

/** Plays a ringtone once, for previewing in Settings. */
export function previewRingtone(id: RingtoneId) {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return;

  const pattern = PATTERNS[id];
  const ctx = new Ctor();
  ctx.resume().catch(() => {});
  scheduleCycle(ctx, pattern.notes, ctx.currentTime);
  setTimeout(() => ctx.close().catch(() => {}), (pattern.cycleSeconds + 0.5) * 1000);
}
