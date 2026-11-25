"use client";

import { isGiftSoundPlaying } from "@/lib/gift-sound";
import { HEART_BEAT_START_MS, planHeartbeat, shouldPlayHeartbeat } from "@/lib/heart-beat";
import { isCallMediaHoldActive } from "@/lib/video-playback-guard";

// One lazily created AudioContext, shared by every burst. It only adds a quiet sound to the page's output, so it
// layers under any playing video/audio (it never pauses or ducks anything). Call it from the user's gesture: the
// context is created and resumed there, which is what lets iOS/Safari and Chrome start it.
let ctx: AudioContext | null = null;
let unusable = false;

function getContext(): AudioContext | null {
  if (unusable || typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    unusable = true;
    return null;
  }
  try {
    ctx = new Ctor();
  } catch {
    unusable = true;
    ctx = null;
  }
  return ctx;
}

/** Plays the lub-dub once. Never throws; silent when blocked (see shouldPlayHeartbeat). Returns whether it was scheduled. */
export function playHeartbeat(reducedMotion: boolean): boolean {
  try {
    if (typeof document === "undefined") return false;
    // One app sound at a time: a gift's score playing keeps the like heartbeat quiet.
    if (isGiftSoundPlaying()) return false;
    const audioAvailable =
      !unusable &&
      (typeof window.AudioContext !== "undefined" ||
        typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined");
    if (
      !shouldPlayHeartbeat({
        reducedMotion,
        documentHidden: document.visibilityState === "hidden",
        callActive: isCallMediaHoldActive(),
        audioAvailable,
      })
    ) {
      return false;
    }
    const audio = getContext();
    if (!audio) return false;
    const start = () => {
      try {
        if (audio.state !== "running") return;
        schedule(audio);
      } catch {
        // Audio went away mid-way: stay silent.
      }
    };
    if (audio.state === "running") {
      start();
    } else {
      // Blocked (no gesture yet) rejects and we stay silent; a resumed context plays at once.
      audio.resume().then(start, () => {});
    }
    return true;
  } catch {
    return false;
  }
}

function schedule(audio: AudioContext) {
  const t0 = audio.currentTime + HEART_BEAT_START_MS / 1000;
  for (const b of planHeartbeat()) {
    const at = t0 + b.atMs / 1000;
    const attack = b.attackMs / 1000;
    const decay = b.decayMs / 1000;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = b.type;
    osc.frequency.setValueAtTime(b.startHz, at);
    osc.frequency.exponentialRampToValueAtTime(b.endHz, at + attack + decay);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(b.peakGain, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(at);
    osc.stop(at + attack + decay + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}
