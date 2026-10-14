import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for daily-js: each created call object's join stays pending until the test settles it.
type FakeCall = {
  join: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  settleJoin: (ok: boolean) => void;
};
const created: FakeCall[] = [];
const createCallObject = vi.fn(() => {
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
});
vi.mock("@daily-co/daily-js", () => ({ default: { createCallObject } }));

const { prewarmCall, cancelPrewarm, takePrewarmedCall } = await import("@/lib/call-prewarm");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const options = { roomUrl: "https://example.daily.co/room", token: "t", type: "VIDEO" as const };

beforeEach(() => {
  created.length = 0;
  createCallObject.mockClear();
});

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
