import { describe, expect, it } from "vitest";
import {
  createDoubleTapDetector,
  createHeartBurst,
  doubleTapNeedsLike,
  HEART_BURST_MS,
  HEART_BURST_REDUCED_MS,
  HEART_MAX,
  planHearts,
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
