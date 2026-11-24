import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  armSecondTapGuard,
  createDoubleTapDetector,
  createHeartBurst,
  createVideoTapToggle,
  DOUBLE_TAP_MS,
  doubleTapNeedsLike,
  hasActiveTextSelection,
  HEART_BURST_MS,
  HEART_BURST_REDUCED_MS,
  HEART_MAX,
  HEART_MAX_LOW_END,
  isDoubleTapIgnoredTarget,
  isLowEndDevice,
  LEAD_HEART_MIN_PX,
  LEAD_HEART_PX,
  planHearts,
  type CaptureTarget,
  type HeartBurstTimers,
} from "./heart-burst";

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: HeartBurstTimers = {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  return {
    timers,
    pending: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

describe("createHeartBurst", () => {
  it("shows, then hides itself after the duration", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), timers: f.timers });
    b.show();
    f.advance(HEART_BURST_MS - 1);
    expect(seen).toEqual([1]);
    f.advance(1);
    expect(seen).toEqual([1, null]);
    expect(f.pending()).toBe(0);
  });

  it("restarts cleanly: new key, one timer, full duration again", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), timers: f.timers });
    b.show();
    f.advance(1000);
    b.show();
    expect(f.pending()).toBe(1);
    f.advance(HEART_BURST_MS - 1);
    expect(seen).toEqual([1, 2]);
    f.advance(1);
    expect(seen).toEqual([1, 2, null]);
  });

  it("cancel hides now and leaves no timer", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), timers: f.timers });
    b.show();
    b.cancel();
    expect(seen).toEqual([1, null]);
    expect(f.pending()).toBe(0);
  });

  it("dispose clears the timer and never calls back or restarts", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), timers: f.timers });
    b.show();
    b.dispose();
    expect(f.pending()).toBe(0);
    b.show();
    b.cancel();
    f.advance(5000);
    expect(seen).toEqual([1]);
  });

  it("uses the short fade under reduced motion", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), reducedMotion: () => true, timers: f.timers });
    b.show();
    f.advance(HEART_BURST_REDUCED_MS);
    expect(seen).toEqual([1, null]);
  });
});

describe("double tap", () => {
  it("likes only when not already liked (never unlikes)", () => {
    expect(doubleTapNeedsLike(false)).toBe(true);
    expect(doubleTapNeedsLike(true)).toBe(false);
  });

  it("detects a second tap close in time and place, once", () => {
    const d = createDoubleTapDetector(280, 40);
    expect(d.tap(1000, 10, 10)).toBe(false);
    expect(d.tap(1200, 20, 15)).toBe(true);
    expect(d.tap(1300, 20, 15)).toBe(false); // a third tap starts over
  });

  it("ignores slow or far-apart taps", () => {
    const d = createDoubleTapDetector(280, 40);
    d.tap(1000, 0, 0);
    expect(d.tap(1400, 0, 0)).toBe(false);
    expect(d.tap(1500, 200, 0)).toBe(false);
  });
});

describe("planHearts", () => {
  function seeded(seed: number) {
    let x = seed;
    return () => {
      x = (x * 1664525 + 1013904223) % 4294967296;
      return x / 4294967296;
    };
  }

  it("is one lead heart plus 3 to 5 trailing ones, capped", () => {
    for (let seed = 1; seed < 200; seed++) {
      const hearts = planHearts(seeded(seed), false);
      expect(hearts.filter((h) => h.lead)).toHaveLength(1);
      expect(hearts.length).toBeGreaterThanOrEqual(4);
      expect(hearts.length).toBeLessThanOrEqual(HEART_MAX);
    }
    expect(planHearts(() => 0.999, false)).toHaveLength(HEART_MAX);
    expect(planHearts(() => 0, false)).toHaveLength(4);
  });

  it("always finishes inside the burst timer; the lead is biggest and starts at once", () => {
    for (let seed = 1; seed < 200; seed++) {
      const hearts = planHearts(seeded(seed), false);
      for (const h of hearts) expect(h.delayMs + h.durationMs).toBeLessThanOrEqual(HEART_BURST_MS);
      expect(hearts[0].delayMs).toBe(0);
      for (const h of hearts.slice(1)) expect(h.size).toBeLessThan(hearts[0].size);
    }
    expect(planHearts(() => 0.999, false).every((h) => h.delayMs + h.durationMs <= HEART_BURST_MS)).toBe(true);
  });

  it("gives reduced motion a single heart", () => {
    expect(planHearts(Math.random, true)).toHaveLength(1);
  });
});

describe("planHearts on low-end phones and short layers", () => {
  function seeded(seed: number) {
    let x = seed;
    return () => {
      x = (x * 1664525 + 1013904223) % 4294967296;
      return x / 4294967296;
    };
  }

  it("is at most 4 hearts (lead + 2 or 3) on a low-end phone, still inside the burst timer", () => {
    for (let seed = 1; seed < 200; seed++) {
      const hearts = planHearts(seeded(seed), false, { lowEnd: true });
      expect(hearts.filter((h) => h.lead)).toHaveLength(1);
      expect(hearts.length).toBeGreaterThanOrEqual(3);
      expect(hearts.length).toBeLessThanOrEqual(HEART_MAX_LOW_END);
      for (const h of hearts) expect(h.delayMs + h.durationMs).toBeLessThanOrEqual(HEART_BURST_MS);
    }
    expect(HEART_MAX_LOW_END).toBe(4);
    expect(planHearts(() => 0.999, false, { lowEnd: true })).toHaveLength(4);
    expect(planHearts(() => 0, false, { lowEnd: true })).toHaveLength(3);
    expect(planHearts(Math.random, true, { lowEnd: true })).toHaveLength(1);
  });

  it("keeps the full size on media and shrinks on a short text card, lead still biggest", () => {
    expect(planHearts(() => 0.5, false, { heightPx: 420 })[0].size).toBe(LEAD_HEART_PX);
    expect(planHearts(() => 0.5, false)[0].size).toBe(LEAD_HEART_PX);
    const short = planHearts(() => 0.999, false, { heightPx: 110 });
    expect(short[0].size).toBeLessThan(LEAD_HEART_PX);
    expect(short[0].size).toBeGreaterThanOrEqual(LEAD_HEART_MIN_PX);
    for (const h of short.slice(1)) expect(h.size).toBeLessThan(short[0].size);
    expect(planHearts(() => 0.5, false, { heightPx: 10 })[0].size).toBe(LEAD_HEART_MIN_PX);
    expect(planHearts(() => 0.5, false, { heightPx: Number.NaN })[0].size).toBe(LEAD_HEART_PX);
  });
});

describe("isLowEndDevice", () => {
  it("flags <= 4 cores or <= 2 GB, never throws, and treats missing values as a normal phone", () => {
    expect(isLowEndDevice({ hardwareConcurrency: 4 })).toBe(true);
    expect(isLowEndDevice({ hardwareConcurrency: 2, deviceMemory: 8 })).toBe(true);
    expect(isLowEndDevice({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(true);
    expect(isLowEndDevice({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe(false);
    expect(isLowEndDevice({ hardwareConcurrency: 8 })).toBe(false);
    expect(isLowEndDevice({})).toBe(false);
    expect(isLowEndDevice({ hardwareConcurrency: 0, deviceMemory: 0 })).toBe(false);
    expect(isLowEndDevice({ hardwareConcurrency: "4" })).toBe(false);
    expect(isLowEndDevice(undefined)).toBe(false);
    expect(isLowEndDevice(null)).toBe(false);
    const throwing = {
      get hardwareConcurrency(): number {
        throw new Error("blocked");
      },
    };
    expect(isLowEndDevice(throwing)).toBe(false);
  });
});

describe("text double tap guards", () => {
  function el(matches: boolean, inside = true) {
    const hit = { inside };
    return {
      target: { closest: () => (matches ? hit : null) },
      boundary: { contains: (other: unknown) => (other as { inside: boolean }).inside },
    };
  }

  it("ignores links, buttons and other interactive elements inside the text, not plain text", () => {
    const plain = el(false);
    expect(isDoubleTapIgnoredTarget(plain.target, plain.boundary)).toBe(false);
    const link = el(true);
    expect(isDoubleTapIgnoredTarget(link.target, link.boundary)).toBe(true);
    // An interactive ancestor outside the text area (the card sits in some clickable wrapper) doesn't count.
    const outside = el(true, false);
    expect(isDoubleTapIgnoredTarget(outside.target, outside.boundary)).toBe(false);
    // Not an element at all: never counts as a tap.
    expect(isDoubleTapIgnoredTarget(null)).toBe(true);
    expect(isDoubleTapIgnoredTarget({})).toBe(true);
  });

  it("asks closest() for links, buttons, form fields and the opt-out attribute", () => {
    const seen: string[] = [];
    isDoubleTapIgnoredTarget({
      closest: (s: string) => {
        seen.push(s);
        return null;
      },
    });
    const parts = seen[0].split(", ");
    for (const part of ["a", "button", "input", "textarea", "select", '[role="button"]', "[data-no-double-tap-like]"]) {
      expect(parts).toContain(part);
    }
  });

  it("ignores taps while text is selected", () => {
    expect(hasActiveTextSelection({ isCollapsed: false, toString: () => "hello" })).toBe(true);
    expect(hasActiveTextSelection({ isCollapsed: true, toString: () => "" })).toBe(false);
    expect(hasActiveTextSelection({ isCollapsed: false, toString: () => "  " })).toBe(false);
    expect(hasActiveTextSelection(null)).toBe(false);
    expect(
      hasActiveTextSelection({
        isCollapsed: false,
        toString: () => {
          throw new Error("detached");
        },
      }),
    ).toBe(false);
  });
});

describe("createVideoTapToggle", () => {
  function fakeVideo(paused: boolean, playResult: unknown = Promise.resolve()) {
    const v = {
      paused,
      plays: 0,
      pauses: 0,
      play() {
        v.plays += 1;
        v.paused = false;
        return playResult;
      },
      pause() {
        v.pauses += 1;
        v.paused = true;
      },
    };
    return v;
  }

  it("a single tap plays or pauses at once", () => {
    const playing = fakeVideo(false);
    expect(createVideoTapToggle(280, 40).tap(1000, 10, 10, playing)).toBe("toggled");
    expect(playing.paused).toBe(true);
    const paused = fakeVideo(true);
    expect(createVideoTapToggle(280, 40).tap(1000, 10, 10, paused)).toBe("toggled");
    expect(paused.paused).toBe(false);
  });

  it("a double tap leaves a playing video playing and a paused one paused (no net change)", () => {
    const toggle = createVideoTapToggle(280, 40);
    const playing = fakeVideo(false);
    toggle.tap(1000, 10, 10, playing);
    expect(toggle.tap(1150, 14, 12, playing)).toBe("double");
    expect(playing.paused).toBe(false);

    const toggle2 = createVideoTapToggle(280, 40);
    const paused = fakeVideo(true);
    toggle2.tap(1000, 10, 10, paused);
    expect(toggle2.tap(1150, 14, 12, paused)).toBe("double");
    expect(paused.paused).toBe(true);
  });

  it("restores the state from before the first tap even if something else moved it in between", () => {
    const toggle = createVideoTapToggle(280, 40);
    const v = fakeVideo(false);
    toggle.tap(1000, 10, 10, v); // paused it
    v.play(); // autoplay-on-view started it again
    const pausesBefore = v.pauses;
    const playsBefore = v.plays;
    expect(toggle.tap(1100, 10, 10, v)).toBe("double");
    // Already playing, as it was before the first tap: no extra toggle.
    expect(v.paused).toBe(false);
    expect(v.pauses).toBe(pausesBefore);
    expect(v.plays).toBe(playsBefore);
  });

  it("swallows a refused play() and treats a slow second tap as a new single tap", async () => {
    const rejected = Promise.reject(new Error("NotAllowedError"));
    const v = fakeVideo(true, rejected);
    const toggle = createVideoTapToggle(280, 40);
    toggle.tap(1000, 10, 10, v);
    await Promise.resolve();
    expect(toggle.tap(1500, 10, 10, v)).toBe("toggled");
    expect(v.paused).toBe(true);
  });
});

describe("armSecondTapGuard (photo opens on the first tap; the second tap lands on the viewer)", () => {
  type TapEvent = { clientX: number; clientY: number; preventDefault: () => void; stopImmediatePropagation: () => void };
  function fakeTarget() {
    const listeners = new Map<string, Set<(e: TapEvent) => void>>();
    const target: CaptureTarget = {
      addEventListener: (type, fn, opts) => {
        expect(opts.capture).toBe(true);
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type, fn) => void listeners.get(type)?.delete(fn),
    };
    function send(type: string, e: TapEvent) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
      return e;
    }
    return {
      target,
      count: (type: string) => listeners.get(type)?.size ?? 0,
      send,
      dispatch: (type: string, x: number, y: number) =>
        send(type, { clientX: x, clientY: y, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }),
    };
  }
  function fakeClockTimers() {
    let now = 0;
    const pending = new Map<number, { at: number; fn: () => void }>();
    let id = 1;
    const timers: HeartBurstTimers = {
      set: (fn, ms) => {
        pending.set(id, { at: now + ms, fn });
        return id++;
      },
      clear: (h) => void pending.delete(h as number),
    };
    return {
      timers,
      now: () => now,
      pending: () => pending.size,
      advance(ms: number) {
        now += ms;
        for (const [k, t] of [...pending]) {
          if (t.at <= now) {
            pending.delete(k);
            t.fn();
          }
        }
      },
    };
  }

  it("a quick second tap on the same spot is swallowed, likes once, and the browser dblclick is swallowed too", () => {
    const t = fakeTarget();
    const clock = fakeClockTimers();
    const onDoubleTap = vi.fn();
    armSecondTapGuard({ target: t.target, first: { t: 0, x: 100, y: 200 }, now: clock.now, onDoubleTap, timers: clock.timers });
    clock.advance(150);
    const click = t.dispatch("click", 110, 205);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(click.stopImmediatePropagation).toHaveBeenCalled();
    expect(click.preventDefault).toHaveBeenCalled();
    expect(t.count("click")).toBe(0);
    const dbl = t.dispatch("dblclick", 110, 205);
    expect(dbl.stopImmediatePropagation).toHaveBeenCalled();
    expect(t.count("dblclick")).toBe(0);
    // A third tap is never a second like.
    t.dispatch("click", 110, 205);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    clock.advance(DOUBLE_TAP_MS * 2);
    expect(clock.pending()).toBe(0);
  });

  it("a tap elsewhere in the viewer (its close button) goes through and disarms", () => {
    const t = fakeTarget();
    const clock = fakeClockTimers();
    const onDoubleTap = vi.fn();
    armSecondTapGuard({ target: t.target, first: { t: 0, x: 100, y: 200 }, now: clock.now, onDoubleTap, timers: clock.timers });
    clock.advance(100);
    const click = t.dispatch("click", 360, 20);
    expect(onDoubleTap).not.toHaveBeenCalled();
    expect(click.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(t.count("click")).toBe(0);
    expect(t.count("dblclick")).toBe(0);
    expect(clock.pending()).toBe(0);
  });

  it("a slow second tap is the viewer's own tap; after the window nothing is listening", () => {
    const t = fakeTarget();
    const clock = fakeClockTimers();
    const onDoubleTap = vi.fn();
    armSecondTapGuard({ target: t.target, first: { t: 0, x: 100, y: 200 }, now: clock.now, onDoubleTap, timers: clock.timers });
    clock.advance(DOUBLE_TAP_MS);
    expect(t.count("click")).toBe(0);
    expect(t.count("dblclick")).toBe(0);
    const click = t.dispatch("click", 100, 200);
    expect(click.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it("ignores the first tap's own event and can be disarmed (unmount) any time", () => {
    const t = fakeTarget();
    const clock = fakeClockTimers();
    const onDoubleTap = vi.fn();
    const firstEvent: TapEvent = { clientX: 100, clientY: 200, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    const disarm = armSecondTapGuard({
      target: t.target,
      first: { t: 0, x: 100, y: 200 },
      now: clock.now,
      onDoubleTap,
      ignore: firstEvent,
      timers: clock.timers,
    });
    t.send("click", firstEvent);
    expect(onDoubleTap).not.toHaveBeenCalled();
    expect(firstEvent.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(t.count("click")).toBe(1); // still armed for the real second tap
    disarm();
    disarm();
    expect(t.count("click")).toBe(0);
    expect(t.count("dblclick")).toBe(0);
    expect(clock.pending()).toBe(0);
    t.dispatch("click", 100, 200);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });
});

describe("heart styles work without container query units (older iOS) and without CSS filters", () => {
  const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
  const start = css.indexOf("/* The hearts that float up a post");
  const end = css.indexOf("/* ---------- Gift universes");
  const heartCss = css.slice(start, end);
  const art = readFileSync(join(__dirname, "..", "components", "like-heart-art.tsx"), "utf8");

  it("has its section", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(heartCss).toContain("@keyframes post-heart-float");
  });

  it("rises by the measured --hb-h px, never cqh / container-type", () => {
    expect(heartCss).not.toMatch(/\d(cqh|cqw|cqi|cqb|cqmin|cqmax)\b/);
    expect(heartCss).not.toContain("container-type");
    expect(heartCss).toContain("var(--hb-h");
    expect(heartCss).toMatch(/contain:\s*layout paint/);
  });

  it("uses no CSS filter on the hearts", () => {
    expect(heartCss).not.toMatch(/\bfilter\s*:/);
    expect(art).not.toMatch(/filter\s*:/);
    expect(art).not.toContain("drop-shadow");
  });
});
