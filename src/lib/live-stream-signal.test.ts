import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoalescer, createTrailingThrottle, liveStreamSignalKind } from "./live-stream-signal";

describe("liveStreamSignalKind", () => {
  it("returns the kind for a known signal", () => {
    expect(liveStreamSignalKind({ kind: "comment" })).toBe("comment");
    expect(liveStreamSignalKind({ kind: "presence" })).toBe("presence");
    expect(liveStreamSignalKind({ kind: "stage" })).toBe("stage");
  });

  it("returns null (full refetch) for a focus resync, an old server's empty payload, or an unknown kind", () => {
    expect(liveStreamSignalKind(null)).toBeNull();
    expect(liveStreamSignalKind(undefined)).toBeNull();
    expect(liveStreamSignalKind({})).toBeNull();
    expect(liveStreamSignalKind({ kind: "something-newer" })).toBeNull();
    expect(liveStreamSignalKind({ kind: 1 })).toBeNull();
    expect(liveStreamSignalKind("comment")).toBeNull();
  });
});

describe("createTrailingThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the first trigger immediately", () => {
    const fn = vi.fn();
    createTrailingThrottle(fn, 5000).trigger();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst into one trailing run at the end of the interval", () => {
    const fn = vi.fn();
    const throttle = createTrailingThrottle(fn, 5000);
    throttle.trigger();
    vi.advanceTimersByTime(1000);
    throttle.trigger();
    vi.advanceTimersByTime(1000);
    throttle.trigger();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2999);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never runs more than once per interval under a constant stream of triggers", () => {
    const fn = vi.fn();
    const throttle = createTrailingThrottle(fn, 5000);
    for (let i = 0; i < 300; i++) {
      throttle.trigger();
      vi.advanceTimersByTime(100);
    }
    // 30s of triggers: the leading run at 0s plus one at each 5s boundary through 30s.
    expect(fn).toHaveBeenCalledTimes(7);
  });

  it("runs immediately again once the interval has passed quietly", () => {
    const fn = vi.fn();
    const throttle = createTrailingThrottle(fn, 5000);
    throttle.trigger();
    vi.advanceTimersByTime(5000);
    throttle.trigger();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops a pending trailing run", () => {
    const fn = vi.fn();
    const throttle = createTrailingThrottle(fn, 5000);
    throttle.trigger();
    throttle.trigger();
    throttle.cancel();
    vi.advanceTimersByTime(60000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("createCoalescer", () => {
  function deferredFn() {
    const resolvers: (() => void)[] = [];
    const fn = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    return { fn, resolveNext: () => resolvers.shift()!() };
  }

  it("keeps one call in flight and collapses everything that arrives meanwhile into one trailing call", async () => {
    const { fn, resolveNext } = deferredFn();
    const run = createCoalescer();
    const trigger = () => run(fn);

    const first = trigger();
    await trigger();
    await trigger();
    await trigger();
    expect(fn).toHaveBeenCalledTimes(1);

    resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);

    resolveNext();
    await first;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("makes no trailing call when nothing arrived meanwhile, and runs again on the next trigger", async () => {
    const { fn, resolveNext } = deferredFn();
    const run = createCoalescer();
    const trigger = () => run(fn);

    const first = trigger();
    resolveNext();
    await first;
    expect(fn).toHaveBeenCalledTimes(1);

    const second = trigger();
    resolveNext();
    await second;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("recovers after a failed call instead of staying stuck in flight", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    const run = createCoalescer();
    const trigger = () => run(fn);

    await expect(trigger()).rejects.toThrow("network");
    await trigger();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
