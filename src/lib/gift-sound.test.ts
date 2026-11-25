import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGiftSoundController, type GiftSoundEnv } from "@/lib/gift-sound";
import type { GiftScoreHandle, GiftScoreOptions } from "@/lib/gift-sound-engine";
import { GIFT_SOUND_ARM_WINDOW_MS, GIFT_SOUND_STOP_FADE_MS, type GiftSoundPlan } from "@/lib/gift-sound-plan";

// The rules for when a gift's sound plays and how it stops, with a fake browser: a fake AudioContext, a fake clock and
// a fake engine (the synth itself is covered in gift-sound-engine.test.ts).

type FakeCtx = { state: string; resume: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; suspend: ReturnType<typeof vi.fn> };
type FakeHandle = GiftScoreHandle & { calls: string[]; stopFade: number | null; opts: GiftScoreOptions; plan: GiftSoundPlan };

let now: number;
let muted: boolean;
let callHeld: boolean;
let hidden: boolean;
let contexts: FakeCtx[];
let handles: FakeHandle[];
let listeners: { call: Set<() => void>; visibility: Set<() => void>; pagehide: Set<() => void> };
let timeouts: Map<number, () => void>;
let engineLoads: number;
let resolveEngine: (() => void) | null;
let deferEngine: boolean;
let noAudio: boolean;

function fakeHandle(plan: GiftSoundPlan, opts: GiftScoreOptions): FakeHandle {
  const h: FakeHandle = {
    calls: [],
    stopFade: null,
    opts,
    plan,
    state: "playing",
    stop(fade = GIFT_SOUND_STOP_FADE_MS) {
      h.calls.push("stop");
      h.stopFade = fade;
      (h as { state: string }).state = "stopped";
    },
    mute() {
      h.calls.push("mute");
      (h as { state: string }).state = "muted";
    },
    unmute() {
      h.calls.push("unmute");
      (h as { state: string }).state = "playing";
    },
    suspend() {
      h.calls.push("suspend");
    },
    resume() {
      h.calls.push("resume");
    },
  };
  handles.push(h);
  return h;
}

const engine = {
  playGiftScore: (_ctx: AudioContext, plan: GiftSoundPlan, opts?: GiftScoreOptions) => fakeHandle(plan, opts ?? {}),
};

function env(): GiftSoundEnv {
  let id = 0;
  return {
    createContext() {
      if (noAudio) return null;
      const c: FakeCtx = {
        state: "running",
        resume: vi.fn(() => Promise.resolve()),
        close: vi.fn(() => Promise.resolve()),
        suspend: vi.fn(() => Promise.resolve()),
      };
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    loadEngine() {
      engineLoads++;
      if (!deferEngine) return Promise.resolve(engine);
      return new Promise((resolve) => {
        resolveEngine = () => resolve(engine);
      });
    },
    now: () => now,
    isCallHeld: () => callHeld,
    subscribeCallHold: (l) => (listeners.call.add(l), () => listeners.call.delete(l)),
    isHidden: () => hidden,
    subscribeVisibility: (l) => (listeners.visibility.add(l), () => listeners.visibility.delete(l)),
    subscribePageHide: (l) => (listeners.pagehide.add(l), () => listeners.pagehide.delete(l)),
    readMuted: () => muted,
    writeMuted: (m) => {
      muted = m;
    },
    setTimeout: (fn) => {
      timeouts.set(++id, fn);
      return id;
    },
    clearTimeout: (t) => {
      timeouts.delete(t as number);
    },
  };
}

const req = { tier: "LEGENDARY" as const, lowEnd: false, hitMs: 2180 };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  now = 1_000_000;
  muted = false;
  callHeld = false;
  hidden = false;
  contexts = [];
  handles = [];
  listeners = { call: new Set(), visibility: new Set(), pagehide: new Set() };
  timeouts = new Map();
  engineLoads = 0;
  resolveEngine = null;
  deferEngine = false;
  noAudio = false;
});

describe("gift sound gating", () => {
  it("never starts without the opening tap", async () => {
    const c = createGiftSoundController(env());
    expect(c.start(req)).toBe(false);
    await flush();
    expect(handles).toHaveLength(0);
    expect(contexts).toHaveLength(0);
    expect(engineLoads).toBe(0);
  });

  it("the tap creates and resumes the audio inside the gesture, and the reveal then plays once", async () => {
    const c = createGiftSoundController(env());
    c.arm();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    expect(c.start(req)).toBe(true);
    await flush();
    expect(handles).toHaveLength(1);
    expect(handles[0].plan.durationMs).toBe(100000);
    // The tap is used up: a second start needs a new tap.
    expect(c.start(req)).toBe(false);
  });

  it("an old tap no longer counts, and its unused audio is closed", () => {
    const c = createGiftSoundController(env());
    c.arm();
    now += GIFT_SOUND_ARM_WINDOW_MS + 1;
    expect(c.start(req)).toBe(false);
    expect(contexts[0].close).toHaveBeenCalled();
  });

  it("stays silent when muted on this device: no audio is even created", () => {
    muted = true;
    const c = createGiftSoundController(env());
    c.arm();
    expect(contexts).toHaveLength(0);
    expect(c.start(req)).toBe(false);
  });

  it("stays silent during a call or with the page hidden", () => {
    const c = createGiftSoundController(env());
    callHeld = true;
    c.arm();
    expect(c.start(req)).toBe(false);
    callHeld = false;
    hidden = true;
    c.arm();
    expect(c.start(req)).toBe(false);
  });

  it("never throws without Web Audio", () => {
    noAudio = true;
    const c = createGiftSoundController(env());
    expect(() => c.arm()).not.toThrow();
    expect(c.start(req)).toBe(false);
    expect(() => c.stop()).not.toThrow();
    expect(() => c.setMuted(true)).not.toThrow();
  });
});

describe("gift sound stopping", () => {
  async function playing() {
    const c = createGiftSoundController(env());
    c.arm();
    c.start(req);
    await flush();
    return c;
  }

  it("stops at once (fade under 150 ms) on close / Escape / Back / unmount", async () => {
    const c = await playing();
    c.stop();
    expect(handles[0].calls).toContain("stop");
    expect(handles[0].stopFade!).toBeLessThan(150);
    expect(c.isPlaying()).toBe(false);
    expect(listeners.call.size + listeners.visibility.size + listeners.pagehide.size).toBe(0);
  });

  it("stops when a call starts", async () => {
    const c = await playing();
    callHeld = true;
    listeners.call.forEach((l) => l());
    expect(handles[0].calls).toContain("stop");
    expect(c.isPlaying()).toBe(false);
  });

  it("stops when the page is unloaded", async () => {
    await playing();
    listeners.pagehide.forEach((l) => l());
    expect(handles[0].calls).toContain("stop");
  });

  it("suspends while the page is hidden and resumes when it is visible again", async () => {
    await playing();
    hidden = true;
    listeners.visibility.forEach((l) => l());
    hidden = false;
    listeners.visibility.forEach((l) => l());
    expect(handles[0].calls).toEqual(["suspend", "resume"]);
  });

  it("a stop before the synth has loaded closes the audio and never plays", async () => {
    deferEngine = true;
    const c = createGiftSoundController(env());
    c.arm();
    c.start(req);
    c.stop();
    expect(contexts[0].close).toHaveBeenCalled();
    resolveEngine?.();
    await flush();
    expect(handles).toHaveLength(0);
  });

  it("a call that starts while the synth loads keeps it silent", async () => {
    deferEngine = true;
    const c = createGiftSoundController(env());
    c.arm();
    c.start(req);
    callHeld = true;
    resolveEngine?.();
    await flush();
    expect(handles).toHaveLength(0);
    expect(contexts[0].close).toHaveBeenCalled();
  });

  it("Replay restarts cleanly: the old score is stopped first and the new one starts after its fade (no overlap)", async () => {
    const c = await playing();
    // Replay: stop, a new tap, start.
    c.stop();
    c.arm();
    expect(c.start(req)).toBe(true);
    await flush();
    expect(handles).toHaveLength(2);
    expect(handles[0].calls).toContain("stop");
    expect(handles[1].opts.startDelayS!).toBeGreaterThanOrEqual(GIFT_SOUND_STOP_FADE_MS / 1000);
    expect(handles.filter((h) => h.state === "playing")).toHaveLength(1);
  });

  it("one score at a time app-wide: a new start stops the one playing", async () => {
    const c = await playing();
    c.arm();
    c.start({ ...req, tier: "RARE" });
    await flush();
    expect(handles[0].calls).toContain("stop");
    expect(handles[1].plan.tier).toBe("RARE");
  });

  it("the synth's late arrival keeps the hit on the reveal's name", async () => {
    deferEngine = true;
    const c = createGiftSoundController(env());
    c.arm();
    c.start(req);
    now += 400;
    resolveEngine?.();
    await flush();
    expect(handles[0].plan.cues.hitMs).toBe(1780);
  });
});

describe("gift sound mute", () => {
  it("remembers the choice and fades the score out / back in", async () => {
    const c = createGiftSoundController(env());
    c.arm();
    c.start(req);
    await flush();
    c.setMuted(true);
    expect(muted).toBe(true);
    expect(handles[0].calls).toEqual(["mute"]);
    expect(c.isPlaying()).toBe(false);
    c.setMuted(false);
    expect(muted).toBe(false);
    expect(handles[0].calls).toEqual(["mute", "unmute"]);
    expect(c.isPlaying()).toBe(true);
  });

  it("muting while the synth loads cancels the score", async () => {
    deferEngine = true;
    const c = createGiftSoundController(env());
    c.arm();
    c.start(req);
    c.setMuted(true);
    resolveEngine?.();
    await flush();
    expect(handles).toHaveLength(0);
    expect(c.hasSession()).toBe(false);
  });
});
