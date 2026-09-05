let stopFn: (() => void) | null = null;

// Standard US ringback cadence: 440Hz+480Hz dual tone, 2s on / 4s off,
// repeating — synthesized via Web Audio rather than shipping an audio
// asset, so there's nothing to fetch/preload before the tone can start.
const TONE_HZ = [440, 480];
const ON_MS = 2000;
const OFF_MS = 4000;

/** Starts (or restarts, if already playing) a looping ringback tone for the caller while an outgoing call rings. No-ops during SSR. */
export function startRingback() {
  stopRingback();
  if (typeof window === "undefined") return;
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  const audioCtx = new AudioCtx();
  const gain = audioCtx.createGain();
  gain.gain.value = 0;
  gain.connect(audioCtx.destination);
  const oscillators = TONE_HZ.map((hz) => {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;
    osc.connect(gain);
    osc.start();
    return osc;
  });

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  function ringOn() {
    if (cancelled) return;
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    timer = setTimeout(ringOff, ON_MS);
  }
  function ringOff() {
    if (cancelled) return;
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    timer = setTimeout(ringOn, OFF_MS);
  }
  ringOn();

  stopFn = () => {
    cancelled = true;
    clearTimeout(timer);
    oscillators.forEach((o) => o.stop());
    audioCtx.close().catch(() => {});
  };
}

export function stopRingback() {
  stopFn?.();
  stopFn = null;
}
