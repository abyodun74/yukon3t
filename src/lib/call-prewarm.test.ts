import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for daily-js: each created call object's join stays pending until the test settles it.
type FakeCall = {
  join: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  settleJoin: (ok: boolean) => void;
};
const created: FakeCall[] = [];
function defaultCreate() {
  let resolveJoin!: () => void;
  let rejectJoin!: (err: Error) => void;
  const joined = new Promise<void>((resolve, reject) => {
    resolveJoin = resolve;
    rejectJoin = reject;
  });
  const call: FakeCall = {
    join: vi.fn(() => joined),
    // Like daily-js: destroying a call object whose join is still pending makes that join fail.
    destroy: vi.fn(() => {
      rejectJoin(new Error("destroyed"));
      return Promise.resolve();
    }),
    settleJoin: (ok) => (ok ? resolveJoin() : rejectJoin(new Error("join failed"))),
  };
  created.push(call);
  return call;
}
const createCallObject = vi.fn(defaultCreate);
const getCallInstance = vi.fn((): { destroy: () => Promise<void> } | undefined => undefined);
vi.mock("@daily-co/daily-js", () => ({ default: { createCallObject, getCallInstance } }));

const {
  prewarmCall,
  cancelPrewarm,
  takePrewarmedCall,
  trackDailyDestroy,
  readyForNewDailyInstance,
  createCallObjectWhenReady,
  DAILY_TEARDOWN_WAIT_MS,
  CALL_OBJECT_CREATE_ATTEMPTS,
} = await import("@/lib/call-prewarm");
const daily = { createCallObject, getCallInstance } as unknown as Parameters<typeof createCallObjectWhenReady>[0];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const options = { roomUrl: "https://example.daily.co/room", token: "t", type: "VIDEO" as const };

beforeEach(() => {
  created.length = 0;
  createCallObject.mockClear();
  getCallInstance.mockReset();
  getCallInstance.mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// A destroy() the test finishes by hand, like daily-js's (leave() first, deregistered only at the end).
function pendingDestroy() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => (finish = resolve));
  return { promise, finish };
}

describe("cancelPrewarm", () => {
  it("destroys a call whose join is still in flight straight away, once", async () => {
    prewarmCall("call:a", options);
    await flush();
    expect(created).toHaveLength(1);

    cancelPrewarm("call:a");
    expect(created[0].destroy).toHaveBeenCalledTimes(1);
    await flush();
    // The join that destroy() failed doesn't destroy it a second time.
    expect(created[0].destroy).toHaveBeenCalledTimes(1);
    expect(takePrewarmedCall("call:a")).toBeUndefined();
  });

  it("never creates the call object when cancelled before daily-js has loaded", async () => {
    prewarmCall("call:b", options);
    cancelPrewarm("call:b");
    await flush();
    expect(createCallObject).not.toHaveBeenCalled();
  });

  it("destroys an already-joined call", async () => {
    prewarmCall("call:c", options);
    await flush();
    created[0].settleJoin(true);
    await flush();
    cancelPrewarm("call:c");
    expect(created[0].destroy).toHaveBeenCalledTimes(1);
  });
});

describe("prewarmCall", () => {
  it("hands a joined call to whoever takes it, without destroying it", async () => {
    prewarmCall("call:d", options);
    await flush();
    created[0].settleJoin(true);
    const taken = takePrewarmedCall("call:d");
    await expect(taken).resolves.toBe(created[0]);
    expect(created[0].destroy).not.toHaveBeenCalled();
  });

  it("destroys a call whose join failed by itself, once, and rejects", async () => {
    prewarmCall("call:e", options);
    await flush();
    const taken = takePrewarmedCall("call:e");
    created[0].settleJoin(false);
    await expect(taken).rejects.toThrow("join failed");
    expect(created[0].destroy).toHaveBeenCalledTimes(1);
  });
});

describe("readyForNewDailyInstance", () => {
  it("waits for a tracked destroy to finish", async () => {
    const destroy = pendingDestroy();
    void trackDailyDestroy(destroy.promise);
    let ready = false;
    const waiting = readyForNewDailyInstance(daily, { evictStray: false }).then(() => (ready = true));
    await flush();
    expect(ready).toBe(false);
    destroy.finish();
    await waiting;
    expect(ready).toBe(true);
  });

  it("treats a failed destroy as finished", async () => {
    void trackDailyDestroy(Promise.reject(new Error("leave failed")));
    await expect(readyForNewDailyInstance(daily, { evictStray: false })).resolves.toBeUndefined();
  });

  it("stops waiting on a destroy that hangs after DAILY_TEARDOWN_WAIT_MS", async () => {
    vi.useFakeTimers();
    const hung = pendingDestroy();
    void trackDailyDestroy(hung.promise);
    let ready = false;
    void readyForNewDailyInstance(daily, { evictStray: false }).then(() => (ready = true));
    await vi.advanceTimersByTimeAsync(DAILY_TEARDOWN_WAIT_MS - 1);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toBe(true);
    // Still tracked (a later wait would wait on it again) until it does finish.
    hung.finish();
  });

  it("destroys an instance still registered when evicting, and only then", async () => {
    const stray = { destroy: vi.fn(() => Promise.resolve()) };
    getCallInstance.mockReturnValue(stray);
    await readyForNewDailyInstance(daily, { evictStray: false });
    expect(stray.destroy).not.toHaveBeenCalled();
    await readyForNewDailyInstance(daily, { evictStray: true });
    expect(stray.destroy).toHaveBeenCalledTimes(1);
  });

  it("makes a prewarm wait for a previous call object's destroy before creating its own", async () => {
    const destroy = pendingDestroy();
    void trackDailyDestroy(destroy.promise);
    prewarmCall("call:f", options);
    await flush();
    expect(createCallObject).not.toHaveBeenCalled();
    destroy.finish();
    await flush();
    expect(createCallObject).toHaveBeenCalledTimes(1);
    cancelPrewarm("call:f");
  });
});

describe("createCallObjectWhenReady", () => {
  it("retries a createCallObject() that throws, then returns the call", async () => {
    vi.useFakeTimers();
    createCallObject.mockImplementationOnce(() => {
      throw new Error("Duplicate DailyIframe instances are not allowed");
    });
    const result = createCallObjectWhenReady(daily, () => false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBe(created[0]);
    expect(createCallObject).toHaveBeenCalledTimes(2);
  });

  it("gives up after CALL_OBJECT_CREATE_ATTEMPTS and throws the last error", async () => {
    vi.useFakeTimers();
    createCallObject.mockImplementation(() => {
      throw new Error("Duplicate DailyIframe instances are not allowed");
    });
    const result = createCallObjectWhenReady(daily, () => false);
    const outcome = result.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await outcome) as Error).toBeInstanceOf(Error);
    expect(createCallObject).toHaveBeenCalledTimes(CALL_OBJECT_CREATE_ATTEMPTS);
    createCallObject.mockReset();
    createCallObject.mockImplementation(defaultCreate);
  });

  it("returns null without creating anything once cancelled", async () => {
    await expect(createCallObjectWhenReady(daily, () => true)).resolves.toBeNull();
    expect(createCallObject).not.toHaveBeenCalled();
  });
});
