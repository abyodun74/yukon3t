import {
  GIFT_SOUND_CUE_NAMES,
  GIFT_SOUND_LOOKAHEAD_MS,
  GIFT_SOUND_MUTE_FADE_MS,
  GIFT_SOUND_STOP_FADE_MS,
  GIFT_SOUND_TICK_MS,
  GIFT_SOUND_UNMUTE_FADE_MS,
  MEOW,
  dueWindows,
  eventsInWindow,
  impulseResponseSamples,
  noiseSamples,
  scheduleWindows,
  softClipCurve,
  type GiftSoundCueName,
  type GiftSoundEvent,
  type GiftSoundPlan,
} from "@/lib/gift-sound-plan";

// Renders a gift's sound plan (gift-sound-plan.ts) with Web Audio. Loaded only when a reveal is about to play sound
// (dynamic import from gift-sound.ts), never at startup. No files, no network: oscillators, one pre-rendered noise
// buffer and one generated reverb impulse response per score.
//
// Graph: voices -> three buses (dry / room / hall; room and hall also feed one ConvolverNode) -> master (fade-in, final
// fade-out) -> compressor -> limiter -> soft-clip WaveShaper (the hard ceiling) -> output (mute / stop fades) ->
// speakers. Every voice ramps in from 0 and back to 0 before its sources stop (no clicks), and disconnects itself once
// it has ended. Events are scheduled in non-overlapping windows a few seconds ahead of the audio clock, so a score
// never holds more than a few dozen voices at once.

type Timers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const defaultTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type GiftScoreHandle = {
  /** Fades the output out over `fadeMs` (default GIFT_SOUND_STOP_FADE_MS), cancels the scheduler, closes the context. */
  stop(fadeMs?: number): void;
  /** Fades out, then suspends the audio clock (the score pauses where it is). */
  mute(): void;
  /** Resumes the clock and fades back in. */
  unmute(): void;
  /** The page was hidden / shown: pause or continue the clock (the output level is left alone). */
  suspend(): void;
  resume(): void;
  readonly state: "playing" | "muted" | "ended" | "stopped";
};

export type GiftScoreOptions = {
  /** A cue from the plan (hit / climax / tail) is reached on the audio clock. */
  onCue?: (cue: GiftSoundCueName) => void;
  /** The score played to its end on its own (not stopped). */
  onEnded?: () => void;
  timers?: Timers;
  /** Seconds between "now" and the score's 0 (a Replay waits for the previous score's fade-out). */
  startDelayS?: number;
};

const DETUNE_CENTS = 6;

export function playGiftScore(ctx: AudioContext, plan: GiftSoundPlan, opts: GiftScoreOptions = {}): GiftScoreHandle {
  const timers = opts.timers ?? defaultTimers;
  const t0 = ctx.currentTime + (opts.startDelayS ?? 0.03);
  const endS = t0 + plan.durationMs / 1000;
  const lowEnd = plan.lowEnd;

  // Master chain.
  const output = ctx.createGain();
  output.gain.value = 1;
  output.connect(ctx.destination);

  const clipper = ctx.createWaveShaper();
  clipper.curve = softClipCurve();
  clipper.oversample = lowEnd ? "none" : "2x";
  clipper.connect(output);

  const limiter = ctx.createDynamicsCompressor();
  setParam(limiter.threshold, -6);
  setParam(limiter.knee, 0);
  setParam(limiter.ratio, 20);
  setParam(limiter.attack, 0.001);
  setParam(limiter.release, 0.12);
  limiter.connect(clipper);

  const compressor = ctx.createDynamicsCompressor();
  setParam(compressor.threshold, -16);
  setParam(compressor.knee, 8);
  setParam(compressor.ratio, 5);
  setParam(compressor.attack, 0.006);
  setParam(compressor.release, 0.25);
  compressor.connect(limiter);

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(plan.masterGain, t0 + plan.fadeInMs / 1000);
  master.gain.setValueAtTime(plan.masterGain, endS - plan.fadeOutMs / 1000);
  master.gain.linearRampToValueAtTime(0, endS);
  master.connect(compressor);

  const reverb = ctx.createConvolver();
  const ir = impulseResponseSamples(ctx.sampleRate, plan.reverbSeconds);
  const irBuffer = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
  irBuffer.getChannelData(0).set(ir[0]);
  irBuffer.getChannelData(1).set(ir[1]);
  reverb.buffer = irBuffer;
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  reverb.connect(wet);
  wet.connect(master);

  const chain: AudioNode[] = [output, clipper, limiter, compressor, master, reverb, wet];
  const buses = {
    dry: bus(0),
    room: bus(0.3),
    hall: bus(0.75),
  };
  function bus(send: number): GainNode {
    const g = ctx.createGain();
    g.connect(master);
    chain.push(g);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(reverb);
      chain.push(s);
    }
    return g;
  }

  const noiseData = noiseSamples(Math.floor(ctx.sampleRate * 2));
  const noise = ctx.createBuffer(1, noiseData.length, ctx.sampleRate);
  noise.getChannelData(0).set(noiseData);

  // Voices still sounding: their sources (to stop) and every node (to disconnect).
  const live = new Set<{ sources: AudioScheduledSourceNode[]; nodes: AudioNode[] }>();
  let state: GiftScoreHandle["state"] = "playing";
  const windows = scheduleWindows(plan.durationMs);
  let scheduledUpTo = 0;
  const firedCues = new Set<GiftSoundCueName>();
  const cueTimers = new Set<unknown>();

  function elapsedMs(): number {
    return (ctx.currentTime - t0) * 1000;
  }

  function tick() {
    if (state === "stopped" || state === "ended") return;
    const elapsed = elapsedMs();
    for (const w of dueWindows(windows, scheduledUpTo, elapsed, GIFT_SOUND_LOOKAHEAD_MS)) {
      for (const e of eventsInWindow(plan.events, w, plan.durationMs)) scheduleEvent(e);
      scheduledUpTo = w.index + 1;
    }
    for (const key of GIFT_SOUND_CUE_NAMES) {
      const at = plan.cues[`${key}Ms`];
      if (firedCues.has(key) || at > elapsed + GIFT_SOUND_TICK_MS) continue;
      firedCues.add(key);
      const id = timers.setTimeout(() => {
        cueTimers.delete(id);
        if (state === "playing") opts.onCue?.(key);
      }, Math.max(0, at - elapsed));
      cueTimers.add(id);
    }
    if (elapsed >= plan.durationMs + 150) finish("ended");
  }

  function scheduleEvent(e: GiftSoundEvent) {
    const now = ctx.currentTime;
    const planned = t0 + e.atMs / 1000;
    const at = Math.max(planned, now + 0.02);
    const late = at - planned;
    // A timer that woke up late: a percussive hit that has missed its moment is dropped, a held voice starts shorter.
    if (late > 0.25 && e.envelope === "decay") return;
    const dur = e.durationMs / 1000 - late;
    if (dur < 0.08) return;
    try {
      renderVoice(e, at, dur);
    } catch {
      // A node the browser refused: that one voice stays silent.
    }
  }

  function renderVoice(e: GiftSoundEvent, at: number, dur: number) {
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    const end = at + dur;
    const voice = ctx.createGain();
    nodes.push(voice);
    envelope(voice.gain, { ...e, gain: e.gain * voiceScale(e) }, at, dur);
    voice.connect(buses[e.space]);

    const osc = (type: OscillatorType, freq: number, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, at);
      if (detune) o.detune.setValueAtTime(detune, at);
      sources.push(o);
      nodes.push(o);
      return o;
    };
    const gainNode = (value: number) => {
      const g = ctx.createGain();
      g.gain.value = value;
      nodes.push(g);
      return g;
    };
    const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, at);
      f.Q.setValueAtTime(q, at);
      nodes.push(f);
      return f;
    };
    const noiseSource = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      sources.push(s);
      nodes.push(s);
      return s;
    };
    switch (e.voice) {
      case "chime":
      case "bell": {
        // A sine and one inharmonic partial per note (bell 2.76x, chime 4x an octave up, brighter), mixed down.
        const ratio = e.voice === "bell" ? 2.756 : 4;
        for (const f of e.freqs) {
          const partial = gainNode(e.voice === "bell" ? 0.3 : 0.18);
          const fundamental = osc("sine", f);
          const overtone = osc("sine", Math.min(f * ratio, 16000));
          fundamental.connect(voice);
          overtone.connect(partial);
          partial.connect(voice);
        }
        break;
      }
      case "pad":
      case "brass": {
        const lp = filter("lowpass", e.voice === "brass" ? 380 : 500 + e.brightness * 2600, 0.6);
        if (e.voice === "brass") {
          // The brass swell: the filter opens with the attack.
          lp.frequency.linearRampToValueAtTime(500 + e.brightness * 3500, at + Math.max(0.05, e.attackMs / 1000));
        }
        for (const f of e.freqs) {
          osc("sawtooth", f, -DETUNE_CENTS).connect(lp);
          osc("sawtooth", f, DETUNE_CENTS).connect(lp);
        }
        lp.connect(voice);
        break;
      }
      case "choir": {
        // Detuned triangles with a slow shared vibrato, a soft low-pass and a vowel-like peak around 900 Hz.
        const lp = filter("lowpass", 1300 + e.brightness * 900, 0.5);
        const formant = filter("peaking", 900, 1.2);
        formant.gain.setValueAtTime(6, at);
        const lfo = osc("sine", 4.8);
        const depth = gainNode(9);
        lfo.connect(depth);
        for (const f of e.freqs) {
          for (const d of [-8, 8]) {
            const o = osc("triangle", f, d);
            depth.connect(o.detune);
            o.connect(lp);
          }
        }
        lp.connect(formant);
        formant.connect(voice);
        break;
      }
      case "shimmer":
      case "sub": {
        for (const f of e.freqs) osc("sine", f).connect(voice);
        break;
      }
      case "drum": {
        // A taiko-like body: a sine sweeping down onto the note, plus (not on a low-end device) a short noise click.
        const body = osc("sine", e.freqs[0] * 2.5);
        body.frequency.exponentialRampToValueAtTime(e.freqs[0], at + 0.14);
        body.connect(voice);
        if (e.click) {
          const src = noiseSource();
          const lp = filter("lowpass", 1400, 0.8);
          const g = gainNode(0);
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(0.5, at + 0.003);
          g.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
          g.gain.linearRampToValueAtTime(0, at + 0.08);
          src.connect(lp);
          lp.connect(g);
          g.connect(voice);
        }
        break;
      }
      case "impact": {
        // A deep boom (a sine falling onto the note) with a darkening burst of noise on top.
        const body = osc("sine", e.freqs[0] * 2.5);
        body.frequency.exponentialRampToValueAtTime(e.freqs[0], at + Math.min(1, dur * 0.4));
        const bodyGain = gainNode(0.85);
        body.connect(bodyGain);
        bodyGain.connect(voice);
        const src = noiseSource();
        const lp = filter("lowpass", 2600, 0.7);
        lp.frequency.exponentialRampToValueAtTime(180, at + Math.min(1.5, dur * 0.6));
        const burst = gainNode(0);
        burst.gain.setValueAtTime(0, at);
        burst.gain.linearRampToValueAtTime(0.6, at + 0.005);
        burst.gain.exponentialRampToValueAtTime(0.001, at + Math.min(1.6, dur * 0.7));
        burst.gain.linearRampToValueAtTime(0, at + Math.min(1.62, dur * 0.72));
        src.connect(lp);
        lp.connect(burst);
        burst.connect(voice);
        break;
      }
      case "thunder": {
        // Looped noise through a low-pass that closes as it rolls away; the crackles are bumps in its level.
        const src = noiseSource();
        src.playbackRate.setValueAtTime(0.5 + e.brightness * 0.4, at);
        const lp = filter("lowpass", 300 + e.brightness * 1100, 0.6);
        lp.frequency.exponentialRampToValueAtTime(110, at + dur * 0.8);
        src.connect(lp);
        lp.connect(voice);
        break;
      }
      case "riser": {
        // A whoosh: noise through a band-pass sweeping up, rising in level to the end.
        const src = noiseSource();
        const bp = filter("bandpass", 260, 2.2);
        bp.frequency.exponentialRampToValueAtTime(5200, end);
        src.connect(bp);
        bp.connect(voice);
        break;
      }
      case "meow": {
        // A kitten's meow, synthesized: a bright buzzy source (a sawtooth, like vocal folds) whose pitch rises and falls
        // (freqs = start, peak, end) with a little vibrato, shaped by three formant band-passes that glide from an
        // "ee" through an open "ah" to a rounded "ow" (mi-a-ow), set high for a small cat's mouth.
        const [startHz, peakHz, endHz] = e.freqs;
        const peakAt = at + dur * MEOW.peakAt;
        const source = osc("sawtooth", startHz);
        source.frequency.linearRampToValueAtTime(peakHz, peakAt);
        source.frequency.exponentialRampToValueAtTime(endHz, end);
        const lfo = osc("sine", 6.2);
        const depth = gainNode(22);
        lfo.connect(depth);
        depth.connect(source.detune);
        const formants: [number, number, number, number, number][] = [
          // start, middle, end (Hz), Q, level
          [1000, 1600, 700, 5, 1],
          [2600, 2100, 1300, 7, 0.7],
          [4200, 4200, 3600, 8, 0.25],
        ];
        for (const [f0, f1, f2, q, level] of formants) {
          const bp = filter("bandpass", f0, q);
          bp.frequency.linearRampToValueAtTime(f1, peakAt);
          bp.frequency.exponentialRampToValueAtTime(f2, end);
          const g = gainNode(level);
          source.connect(bp);
          bp.connect(g);
          g.connect(voice);
        }
        break;
      }
    }

    for (const s of sources) {
      s.start(at);
      s.stop(end + 0.03);
    }
    const entry = { sources, nodes };
    live.add(entry);
    const last = sources[sources.length - 1];
    if (last) {
      last.onended = () => {
        live.delete(entry);
        for (const node of nodes) node.disconnect();
      };
    }
  }

  const interval = timers.setInterval(tick, GIFT_SOUND_TICK_MS);
  tick();

  function teardown() {
    timers.clearInterval(interval);
    for (const id of cueTimers) timers.clearTimeout(id);
    cueTimers.clear();
    for (const v of live) {
      for (const s of v.sources) {
        try {
          s.onended = null;
          s.stop();
        } catch {
          // Already stopped.
        }
      }
      for (const node of v.nodes) node.disconnect();
    }
    live.clear();
    for (const node of chain) node.disconnect();
    ctx.close().catch(() => {});
  }

  function finish(next: "ended" | "stopped", fadeMs = 0) {
    if (state === "ended" || state === "stopped") return;
    const wasMuted = state === "muted";
    state = next;
    timers.clearInterval(interval);
    if (next === "ended") opts.onEnded?.();
    if (fadeMs <= 0 || wasMuted || ctx.state !== "running") {
      teardown();
      return;
    }
    fadeOutput(fadeMs);
    timers.setTimeout(teardown, fadeMs + 20);
  }

  function fadeOutput(ms: number) {
    const now = ctx.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);
    output.gain.linearRampToValueAtTime(0, now + ms / 1000);
  }

  let muteTimer: unknown = null;

  return {
    get state() {
      return state;
    },
    stop(fadeMs = GIFT_SOUND_STOP_FADE_MS) {
      finish("stopped", fadeMs);
    },
    mute() {
      if (state !== "playing") return;
      state = "muted";
      fadeOutput(GIFT_SOUND_MUTE_FADE_MS);
      muteTimer = timers.setTimeout(() => {
        muteTimer = null;
        if (state === "muted") ctx.suspend().catch(() => {});
      }, GIFT_SOUND_MUTE_FADE_MS + 10);
    },
    unmute() {
      if (state !== "muted") return;
      state = "playing";
      if (muteTimer !== null) timers.clearTimeout(muteTimer);
      muteTimer = null;
      const fadeIn = () => {
        const now = ctx.currentTime;
        output.gain.cancelScheduledValues(now);
        output.gain.setValueAtTime(output.gain.value, now);
        output.gain.linearRampToValueAtTime(1, now + GIFT_SOUND_UNMUTE_FADE_MS / 1000);
      };
      if (ctx.state === "running") fadeIn();
      else ctx.resume().then(fadeIn, () => {});
    },
    suspend() {
      if (state === "playing") ctx.suspend().catch(() => {});
    },
    resume() {
      if (state === "playing" && ctx.state !== "running") ctx.resume().catch(() => {});
    },
  };
}

/**
 * Notes of one voice add up incoherently (different pitches, detuned copies), so a voice's peak is spread over the
 * square root of its oscillator count: e.gain stays what the plan says the whole voice peaks at.
 */
function voiceScale(e: GiftSoundEvent): number {
  const n = Math.max(1, e.freqs.length);
  switch (e.voice) {
    case "chime":
    case "bell":
    case "shimmer":
    case "sub":
      return 1 / Math.sqrt(n);
    case "pad":
    case "brass":
      return 1 / Math.sqrt(2 * n);
    case "choir":
      return 1.3 / Math.sqrt(2 * n);
    default:
      return 1;
  }
}

function setParam(param: AudioParam, value: number) {
  param.value = value;
}

/**
 * Attack from 0 to the peak, then either a decay across the rest (percussive) or a hold and a release, always ending
 * at exactly 0 (an exponential ramp can't reach 0, so it lands near it and a short linear ramp finishes): no clicks.
 */
function envelope(param: AudioParam, e: GiftSoundEvent, at: number, dur: number) {
  const attack = Math.min(e.attackMs / 1000, dur / 3);
  const end = at + dur;
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(e.gain, at + attack);
  if (e.envelope === "decay") {
    if (e.crackles?.length) {
      // Thunder: a fast drop to a rumble, bumped by each crackle, then rolling away.
      let level = e.gain;
      for (const c of e.crackles) {
        const t = at + c / 1000;
        if (t <= at + attack || t >= end - 0.1) continue;
        level *= 0.82;
        param.linearRampToValueAtTime(level * 0.55, t);
        param.linearRampToValueAtTime(level, t + 0.03);
      }
    }
    param.exponentialRampToValueAtTime(Math.max(0.0004, e.gain * 0.0008), end - 0.012);
    param.linearRampToValueAtTime(0, end);
    return;
  }
  const release = Math.min(e.releaseMs / 1000, dur - attack);
  param.setValueAtTime(e.gain, end - release);
  param.linearRampToValueAtTime(0, end);
}
