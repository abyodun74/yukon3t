import { beforeEach, describe, expect, it } from "vitest";
import { playGiftScore } from "@/lib/gift-sound-engine";
import {
  GIFT_SOUND_PEAK_CEILING,
  GIFT_SOUND_STOP_FADE_MS,
  giftSoundPlan,
  voiceNodeCount,
  type GiftSoundPlan,
} from "@/lib/gift-sound-plan";

// A recording stand-in for AudioContext: every node, every connection and every automation call, on a clock the test
// moves by hand. Enough of the Web Audio API for the engine, nothing more.

type Call = [string, number, number?];

class FakeParam {
  value: number;
  calls: Call[] = [];
  constructor(value = 1) {
    this.value = value;
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["linear", v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v <= 0) throw new RangeError("exponential ramp to 0");
    this.calls.push(["exp", v, t]);
  }
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", t]);
  }
}

class FakeNode {
  outputs: unknown[] = [];
  disconnected = false;
  constructor(
    readonly kind: string,
    readonly ctx: FakeContext,
  ) {
    ctx.nodes.push(this);
  }
  connect(target: unknown) {
    this.outputs.push(target);
    return target;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super("gain", ctx);
  }
}

class FakeSource extends FakeNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  playbackRate = new FakeParam(1);
  type = "sine";
  buffer: unknown = null;
  loop = false;
  start(t: number) {
    this.startedAt = t;
  }
  stop(t?: number) {
    this.stoppedAt = t ?? this.ctx.currentTime;
  }
}

class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  gain = new FakeParam(0);
  constructor(ctx: FakeContext) {
    super("filter", ctx);
  }
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
  constructor(ctx: FakeContext) {
    super("compressor", ctx);
  }
}

class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = "none";
  constructor(ctx: FakeContext) {
    super("shaper", ctx);
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  state: "running" | "suspended" | "closed" = "running";
  nodes: FakeNode[] = [];
  destination = { kind: "destination" };
  suspendCalls = 0;
  resumeCalls = 0;
  closeCalls = 0;
  createGain() {
    return new FakeGain(this);
  }
  createOscillator() {
    return new FakeSource("oscillator", this);
  }
  createBufferSource() {
    return new FakeSource("buffer-source", this);
  }
  createBiquadFilter() {
    return new FakeFilter(this);
  }
  createConvolver() {
    const n = new FakeNode("convolver", this) as FakeNode & { buffer: unknown };
    n.buffer = null;
    return n;
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }
  createWaveShaper() {
    return new FakeShaper(this);
  }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, getChannelData: (i: number) => data[i] };
  }
  suspend() {
    this.suspendCalls++;
    this.state = "suspended";
    return Promise.resolve();
  }
  resume() {
    this.resumeCalls++;
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    this.closeCalls++;
    this.state = "closed";
    return Promise.resolve();
  }
  sources() {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
}

class FakeTimers {
  intervals = new Map<number, () => void>();
  timeouts = new Map<number, { fn: () => void; ms: number }>();
  private id = 0;
  setInterval = (fn: () => void) => {
    this.intervals.set(++this.id, fn);
    return this.id;
  };
  clearInterval = (id: unknown) => {
    this.intervals.delete(id as number);
  };
  setTimeout = (fn: () => void, ms: number) => {
    this.timeouts.set(++this.id, { fn, ms });
    return this.id;
  };
  clearTimeout = (id: unknown) => {
    this.timeouts.delete(id as number);
  };
  tick() {
    for (const fn of [...this.intervals.values()]) fn();
  }
  flushTimeouts() {
    const due = [...this.timeouts.entries()];
    this.timeouts.clear();
    for (const [, t] of due) t.fn();
  }
}

let ctx: FakeContext;
let timers: FakeTimers;
const MASTER_CHAIN_NODES = 12; // output, clipper, limiter, compressor, master, reverb, wet, 3 buses, 2 sends

beforeEach(() => {
  ctx = new FakeContext();
  timers = new FakeTimers();
});

function start(plan: GiftSoundPlan, extra: Parameters<typeof playGiftScore>[2] = {}) {
  return playGiftScore(ctx as unknown as AudioContext, plan, { timers, startDelayS: 0, ...extra });
}

function runTo(seconds: number) {
  while (ctx.currentTime < seconds) {
    ctx.currentTime = Math.min(seconds, ctx.currentTime + 0.5);
    timers.tick();
  }
}

const legendary = () => giftSoundPlan("LEGENDARY", { lowEnd: false, hitMs: 2180 });

describe("playGiftScore", () => {
  it("builds the master chain in order: compressor, limiter, then the soft-clip ceiling before the speakers", () => {
    start(legendary());
    const [output, clipper, limiter, compressor, master] = ctx.nodes;
    expect(output.outputs).toEqual([ctx.destination]);
    expect(clipper.kind).toBe("shaper");
    expect(clipper.outputs).toEqual([output]);
    expect(limiter.outputs).toEqual([clipper]);
    expect(compressor.outputs).toEqual([limiter]);
    expect(master.outputs).toEqual([compressor]);
    const curve = (clipper as FakeShaper).curve!;
    expect(Math.max(...Array.from(curve, Math.abs))).toBeLessThanOrEqual(GIFT_SOUND_PEAK_CEILING);
    // The master fades in from 0 and back to 0 exactly at the end.
    const m = (master as FakeGain).gain.calls;
    expect(m[0]).toEqual(["set", 0, 0]);
    expect(m[m.length - 1]).toEqual(["linear", 0, 100]);
  });

  it("schedules a few seconds ahead only, then each event exactly once as the clock moves", () => {
    const plan = legendary();
    start(plan);
    const firstEvents = plan.events.filter((e) => e.atMs < 6000);
    const nodesFor = (events: typeof plan.events) => events.reduce((n, e) => n + voiceNodeCount(e), 0);
    expect(ctx.nodes.length - MASTER_CHAIN_NODES).toBe(nodesFor(firstEvents));
    runTo(plan.durationMs / 1000);
    // Every event once, built exactly as voiceNodeCount says (the CPU bound the plan tests rely on).
    expect(ctx.nodes.length - MASTER_CHAIN_NODES).toBe(nodesFor(plan.events));
  });

  it("renders the kitten's meow exactly as voiceNodeCount says, with a click-free envelope", () => {
    const plan = giftSoundPlan("EPIC", { lowEnd: false, hitMs: 1190, accent: "meow" });
    start(plan);
    runTo(plan.durationMs / 1000);
    expect(ctx.nodes.length - MASTER_CHAIN_NODES).toBe(plan.events.reduce((n, ev) => n + voiceNodeCount(ev), 0));
    const gains = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.gain.calls.length > 0);
    for (const g of gains) {
      const valued = g.gain.calls.filter((c) => c[0] !== "cancel");
      expect(valued[0][1]).toBe(0);
      expect(valued[valued.length - 1]).toEqual(["linear", 0, expect.any(Number)]);
    }
  });

  it("every enveloped gain starts at 0 and ends at 0 (no clicks), and every source stops after its envelope", () => {
    const plan = giftSoundPlan("EPIC", { lowEnd: false, hitMs: 1190 });
    start(plan);
    runTo(plan.durationMs / 1000);
    const gains = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.gain.calls.length > 0);
    expect(gains.length).toBeGreaterThan(100);
    for (const g of gains) {
      const valued = g.gain.calls.filter((c) => c[0] !== "cancel");
      expect(valued[0][1]).toBe(0);
      expect(valued[valued.length - 1]).toEqual(["linear", 0, expect.any(Number)]);
    }
    for (const s of ctx.sources()) {
      expect(s.startedAt).not.toBeNull();
      expect(s.stoppedAt!).toBeGreaterThan(s.startedAt!);
    }
  });

  it("stop fades the output out in under 150 ms, then stops every source, cancels the scheduler and closes", () => {
    const handle = start(legendary());
    runTo(10);
    ctx.currentTime = 10.2;
    handle.stop();
    const output = ctx.nodes[0] as FakeGain;
    const last = output.gain.calls[output.gain.calls.length - 1];
    expect(last[0]).toBe("linear");
    expect(last[1]).toBe(0);
    expect(last[2]! - 10.2).toBeLessThanOrEqual(0.15);
    expect(last[2]! - 10.2).toBeCloseTo(GIFT_SOUND_STOP_FADE_MS / 1000, 5);
    expect(timers.intervals.size).toBe(0);
    timers.flushTimeouts();
    expect(ctx.closeCalls).toBe(1);
    expect(ctx.sources().every((s) => s.stoppedAt !== null)).toBe(true);
    expect(ctx.nodes.every((n) => n.disconnected)).toBe(true);
    // Nothing more is scheduled after a stop.
    const count = ctx.nodes.length;
    runTo(30);
    expect(ctx.nodes.length).toBe(count);
    expect(handle.state).toBe("stopped");
  });

  it("mute fades out fast and suspends the clock; unmute resumes and fades back in", async () => {
    const handle = start(legendary());
    ctx.currentTime = 5;
    handle.mute();
    const output = ctx.nodes[0] as FakeGain;
    const muteRamp = output.gain.calls[output.gain.calls.length - 1];
    expect(muteRamp[1]).toBe(0);
    expect(muteRamp[2]! - 5).toBeLessThan(0.15);
    timers.flushTimeouts();
    expect(ctx.suspendCalls).toBe(1);
    expect(handle.state).toBe("muted");
    handle.unmute();
    await Promise.resolve();
    expect(ctx.resumeCalls).toBe(1);
    expect(output.gain.calls[output.gain.calls.length - 1][1]).toBe(1);
    expect(handle.state).toBe("playing");
  });

  it("reports the climax cue and the natural end, then tears itself down", () => {
    const plan = giftSoundPlan("RARE", { lowEnd: false, hitMs: 760 });
    const cues: string[] = [];
    let ended = 0;
    start(plan, { onCue: (c) => cues.push(c), onEnded: () => ended++ });
    for (let t = 0; t <= plan.durationMs / 1000 + 1; t += 0.5) {
      ctx.currentTime = t;
      timers.tick();
      timers.flushTimeouts();
    }
    expect(cues).toEqual(["hit", "climax", "tail"]);
    expect(ended).toBe(1);
    expect(ctx.closeCalls).toBe(1);
  });

  it("a timer that wakes up late drops missed hits and shortens held voices instead of piling them up", () => {
    const plan = legendary();
    start(plan);
    const before = ctx.nodes.length;
    // The page stalled for 20 s without the context being suspended.
    ctx.currentTime = 20;
    timers.tick();
    const due = plan.events.filter((e) => e.atMs >= 6000 && e.atMs < 24000);
    const expected = due.filter((e) => {
      const planned = e.atMs / 1000;
      const late = Math.max(planned, 20.02) - planned;
      if (late > 0.25 && e.envelope === "decay") return false;
      return e.durationMs / 1000 - late >= 0.08;
    });
    expect(expected.length).toBeLessThan(due.length);
    expect(ctx.nodes.length - before).toBe(expected.reduce((n, e) => n + voiceNodeCount(e), 0));
    for (const s of ctx.sources().slice(-5)) expect(s.startedAt!).toBeGreaterThanOrEqual(20);
  });
});
