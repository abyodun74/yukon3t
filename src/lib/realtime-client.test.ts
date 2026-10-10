import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChannelRegistry,
  createResyncScheduler,
  createSignalThrottle,
  type RealtimeTransport,
} from "./realtime-client";

type OpenChannel = {
  topic: string;
  emit: (event: string, payload: unknown) => void;
  status: (status: string, err?: Error) => void;
  closed: boolean;
  finishClose: () => void;
};

// Mirrors the one property of the real client the registry exists to work
// around: a close stays pending until the server acknowledges the leave.
function fakeTransport() {
  const opened: OpenChannel[] = [];
  const transport: RealtimeTransport = {
    open(topic, onBroadcast, onStatus) {
      let finishClose = () => {};
      const channel: OpenChannel = {
        topic,
        emit: onBroadcast,
        status: onStatus,
        closed: false,
        finishClose: () => finishClose(),
      };
      opened.push(channel);
      return () => {
        channel.closed = true;
        return new Promise<void>((resolve) => {
          finishClose = resolve;
        });
      };
    },
  };
  return { transport, opened };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("createChannelRegistry", () => {
  it("opens one channel per topic no matter how many listeners share it", () => {
    const { transport, opened } = fakeTransport();
    const registry = createChannelRegistry(transport, vi.fn());
    const a = vi.fn();
    const b = vi.fn();

    registry.subscribe("call:u1", "changed", a);
    registry.subscribe("call:u1", "changed", b);
    registry.subscribe("live-streams", "changed", vi.fn());

    expect(opened.map((c) => c.topic)).toEqual(["call:u1", "live-streams"]);
    opened[0]!.emit("changed", { n: 1 });
    expect(a).toHaveBeenCalledWith({ n: 1 });
    expect(b).toHaveBeenCalledWith({ n: 1 });
  });

  it("keeps the channel open for the remaining listener when another leaves", async () => {
    const { transport, opened } = fakeTransport();
    const registry = createChannelRegistry(transport, vi.fn());
    const leaving = vi.fn();
    const staying = vi.fn();

    const unsubscribe = registry.subscribe("call:u1", "changed", leaving);
    registry.subscribe("call:u1", "changed", staying);
    unsubscribe();
    await flush();

    expect(opened[0]!.closed).toBe(false);
    opened[0]!.emit("changed", {});
    expect(leaving).not.toHaveBeenCalled();
    expect(staying).toHaveBeenCalledTimes(1);
  });

  it("closes the channel once the last listener leaves", async () => {
    const { transport, opened } = fakeTransport();
    const registry = createChannelRegistry(transport, vi.fn());

    const first = registry.subscribe("call:u1", "changed", vi.fn());
    const second = registry.subscribe("call:u1", "changed", vi.fn());
    first();
    second();
    await flush();

    expect(opened).toHaveLength(1);
    expect(opened[0]!.closed).toBe(true);
  });

  it("only dispatches to listeners of the matching event", () => {
    const { transport, opened } = fakeTransport();
    const registry = createChannelRegistry(transport, vi.fn());
    const changed = vi.fn();
    const other = vi.fn();

    registry.subscribe("t", "changed", changed);
    registry.subscribe("t", "other", other);
    opened[0]!.emit("changed", {});

    expect(changed).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("keeps the channel when a topic is handed from one listener to another in the same tick", async () => {
    const { transport, opened } = fakeTransport();
    const registry = createChannelRegistry(transport, vi.fn());
    const next = vi.fn();

    const unsubscribe = registry.subscribe("call:u1", "changed", vi.fn());
    unsubscribe();
    registry.subscribe("call:u1", "changed", next);
    await flush();

    expect(opened).toHaveLength(1);
    expect(opened[0]!.closed).toBe(false);
    opened[0]!.emit("changed", {});
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending leave to finish before reopening the same topic", async () => {
    const { transport, opened } = fakeTransport();
    const registry = createChannelRegistry(transport, vi.fn());
    const handler = vi.fn();

    registry.subscribe("call:u1", "changed", vi.fn())();
    await flush();
    expect(opened[0]!.closed).toBe(true);

    registry.subscribe("call:u1", "changed", handler);
    await flush();
    expect(opened).toHaveLength(1);

    opened[0]!.finishClose();
    await flush();
    expect(opened).toHaveLength(2);
    opened[1]!.emit("changed", {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never opens a channel for a listener that left while a leave was still pending", async () => {
    const { transport, opened } = fakeTransport();
    const registry = createChannelRegistry(transport, vi.fn());

    registry.subscribe("call:u1", "changed", vi.fn())();
    await flush();
    registry.subscribe("call:u1", "changed", vi.fn())();
    await flush();
    opened[0]!.finishClose();
    await flush();

    expect(opened).toHaveLength(1);
  });

  it("reports a failed subscription once per topic", () => {
    const { transport, opened } = fakeTransport();
    const onFailure = vi.fn();
    const registry = createChannelRegistry(transport, onFailure);
    const err = new Error("boom");

    registry.subscribe("a", "changed", vi.fn());
    registry.subscribe("b", "changed", vi.fn());
    opened[0]!.status("SUBSCRIBED");
    opened[0]!.status("CLOSED");
    expect(onFailure).not.toHaveBeenCalled();

    opened[0]!.status("CHANNEL_ERROR", err);
    opened[0]!.status("CHANNEL_ERROR", err);
    opened[0]!.status("TIMED_OUT");
    opened[1]!.status("TIMED_OUT");

    expect(onFailure.mock.calls).toEqual([
      ["a", "CHANNEL_ERROR", err],
      ["b", "TIMED_OUT", undefined],
    ]);
  });
});

describe("createResyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(random = 0.5) {
    let visible = true;
    const scheduler = createResyncScheduler({
      minIntervalMs: 10_000,
      maxJitterMs: 2_000,
      isVisible: () => visible,
      random: () => random,
    });
    return { scheduler, setVisible: (v: boolean) => (visible = v) };
  }

  it("runs each source after the jitter delay, not immediately", () => {
    const { scheduler } = setup(0.5);
    const run = vi.fn();
    scheduler.add({ getHandler: () => run, run });

    scheduler.trigger();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs a handler shared by several sources only once", () => {
    const { scheduler } = setup();
    const shared = () => {};
    const runA = vi.fn();
    const runB = vi.fn();
    const runC = vi.fn();
    scheduler.add({ getHandler: () => shared, run: runA });
    scheduler.add({ getHandler: () => shared, run: runB });
    scheduler.add({ getHandler: () => runC, run: runC });

    scheduler.trigger();
    vi.advanceTimersByTime(2_000);

    expect(runA.mock.calls.length + runB.mock.calls.length).toBe(1);
    expect(runC).toHaveBeenCalledTimes(1);
  });

  it("defers a handler that ran within the minimum interval to the end of it", () => {
    const { scheduler } = setup(0);
    const run = vi.fn();
    scheduler.add({ getHandler: () => run, run });

    scheduler.trigger();
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_000);
    scheduler.trigger();
    scheduler.trigger();
    vi.advanceTimersByTime(6_999);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs again straight away once the minimum interval has passed", () => {
    const { scheduler } = setup(0);
    const run = vi.fn();
    scheduler.add({ getHandler: () => run, run });

    scheduler.trigger();
    vi.advanceTimersByTime(10_000);
    scheduler.trigger();
    vi.advanceTimersByTime(0);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs an immediate source with no jitter delay", () => {
    const { scheduler } = setup(0.5);
    const urgent = vi.fn();
    const relaxed = vi.fn();
    scheduler.add({ getHandler: () => urgent, run: urgent, immediate: true });
    scheduler.add({ getHandler: () => relaxed, run: relaxed });

    scheduler.trigger();
    vi.advanceTimersByTime(0);
    expect(urgent).toHaveBeenCalledTimes(1);
    expect(relaxed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(relaxed).toHaveBeenCalledTimes(1);
  });

  it("runs an immediate source on every trigger, ignoring the minimum interval", () => {
    const { scheduler } = setup(0.5);
    const run = vi.fn();
    scheduler.add({ getHandler: () => run, run, immediate: true });

    scheduler.trigger();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(3_000);
    scheduler.trigger();
    vi.advanceTimersByTime(0);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs a handler shared by immediate sources only once per trigger", () => {
    const { scheduler } = setup();
    const shared = () => {};
    const runA = vi.fn();
    const runB = vi.fn();
    scheduler.add({ getHandler: () => shared, run: runA, immediate: true });
    scheduler.add({ getHandler: () => shared, run: runB, immediate: true });

    scheduler.trigger();
    scheduler.trigger();
    vi.advanceTimersByTime(2_000);

    expect(runA.mock.calls.length + runB.mock.calls.length).toBe(1);
  });

  it("lets an immediate source pull forward a handler it shares with a jittered one", () => {
    const { scheduler } = setup(0.5);
    const shared = () => {};
    const jittered = vi.fn();
    const urgent = vi.fn();
    scheduler.add({ getHandler: () => shared, run: jittered });

    scheduler.trigger();
    scheduler.add({ getHandler: () => shared, run: urgent, immediate: true });
    scheduler.trigger();
    vi.advanceTimersByTime(0);
    expect(jittered.mock.calls.length + urgent.mock.calls.length).toBe(1);

    vi.advanceTimersByTime(12_000);
    expect(jittered.mock.calls.length + urgent.mock.calls.length).toBe(1);
  });

  it("skips an immediate source that was removed or hidden again before it ran", () => {
    const { scheduler, setVisible } = setup();
    const removed = vi.fn();
    const hidden = vi.fn();
    const remove = scheduler.add({ getHandler: () => removed, run: removed, immediate: true });
    scheduler.add({ getHandler: () => hidden, run: hidden, immediate: true });

    scheduler.trigger();
    remove();
    setVisible(false);
    vi.advanceTimersByTime(0);

    expect(removed).not.toHaveBeenCalled();
    expect(hidden).not.toHaveBeenCalled();
  });

  it("skips a source that was removed or hidden again before its turn", () => {
    const { scheduler, setVisible } = setup();
    const removed = vi.fn();
    const hidden = vi.fn();
    const remove = scheduler.add({ getHandler: () => removed, run: removed });
    scheduler.add({ getHandler: () => hidden, run: hidden });

    scheduler.trigger();
    remove();
    setVisible(false);
    vi.advanceTimersByTime(2_000);
    expect(removed).not.toHaveBeenCalled();
    expect(hidden).not.toHaveBeenCalled();

    setVisible(true);
    scheduler.trigger();
    vi.advanceTimersByTime(2_000);
    expect(removed).not.toHaveBeenCalled();
    expect(hidden).toHaveBeenCalledTimes(1);
  });
});

describe("createSignalThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const options = { maxDelayMs: 5_000, cooldownMs: 20_000 };

  it("runs once, after the random delay, for a burst of signals", async () => {
    const run = vi.fn();
    const throttle = createSignalThrottle(run, { ...options, random: () => 0.5 });

    throttle.signal();
    throttle.signal();
    throttle.signal();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("holds a signal that arrives during the cooldown until the cooldown ends", async () => {
    const run = vi.fn();
    const throttle = createSignalThrottle(run, { ...options, random: () => 0 });

    throttle.signal();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    throttle.signal();
    throttle.signal();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("applies only the random delay once the cooldown has already passed", async () => {
    const run = vi.fn();
    const throttle = createSignalThrottle(run, { ...options, random: () => 0.2 });

    throttle.signal();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    throttle.signal();
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("follows up once after the cooldown for signals that arrive while a run is in flight", async () => {
    let finish = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const throttle = createSignalThrottle(run, { ...options, random: () => 0 });

    throttle.signal();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    throttle.signal();
    throttle.signal();
    await vi.advanceTimersByTimeAsync(1_000);
    finish();
    await vi.advanceTimersByTimeAsync(18_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps working after a run rejects", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const throttle = createSignalThrottle(run, { ...options, random: () => 0 });

    throttle.signal();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20_000);
    throttle.signal();
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs nothing after cancel, scheduled or in-flight follow-up alike", async () => {
    let finish = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const scheduled = createSignalThrottle(run, { ...options, random: () => 0.5 });
    scheduled.signal();
    scheduled.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();

    const flying = createSignalThrottle(run, { ...options, random: () => 0 });
    flying.signal();
    await vi.advanceTimersByTimeAsync(0);
    flying.signal();
    flying.cancel();
    finish();
    flying.signal();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
