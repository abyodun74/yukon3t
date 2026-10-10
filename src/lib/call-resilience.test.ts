import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALL_PEER_LOSS_FIRST_CHECK_MS,
  CALL_PEER_LOSS_GRACE_MS,
  CALL_PEER_LOSS_NOTICE_DELAY_MS,
  CALL_PEER_LOSS_STATUS_POLL_MS,
  CALL_RECONNECT_WINDOW_MS,
  CALL_STATUS_CHECK_TIMEOUT_MS,
  END_CALL_ATTEMPT_TIMEOUT_MS,
  END_CALL_RETRY_WINDOW_MS,
  cameraRecoveryAction,
  dailyErrorType,
  endCallRetryDelayMs,
  involuntaryLeaveAction,
  isCallOverStatus,
  isExpectedCallExpiry,
  latestJoined,
  reconnectDelayMs,
  remotesByUser,
  retryUntilAnswered,
  sessionNeedsWakeLock,
  settledWithin,
  shouldAnnounceCameraPaused,
  shouldEndAfterLeave,
} from "./call-resilience";

describe("reconnectDelayMs", () => {
  it("doubles from 1s and caps at 8s", () => {
    expect([0, 1, 2, 3, 4, 5].map((attempt) => reconnectDelayMs(attempt, 0))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });

  it("gives up once the next wait would run past the reconnect window", () => {
    expect(reconnectDelayMs(5, CALL_RECONNECT_WINDOW_MS - 8001)).toBe(8000);
    expect(reconnectDelayMs(5, CALL_RECONNECT_WINDOW_MS - 8000)).toBeNull();
    expect(reconnectDelayMs(0, CALL_RECONNECT_WINDOW_MS)).toBeNull();
  });

  it("fits several attempts inside the window", () => {
    let elapsed = 0;
    let attempts = 0;
    for (;;) {
      const delay = reconnectDelayMs(attempts, elapsed);
      if (delay === null) break;
      elapsed += delay;
      attempts++;
    }
    expect(attempts).toBeGreaterThanOrEqual(8);
    expect(elapsed).toBeLessThan(CALL_RECONNECT_WINDOW_MS);
  });
});

describe("peer-loss grace", () => {
  it("outlasts the peer's own reconnect window, so the two sides don't race", () => {
    expect(CALL_PEER_LOSS_GRACE_MS).toBeGreaterThan(CALL_RECONNECT_WINDOW_MS);
  });
});

describe("dailyErrorType", () => {
  it("reads the type from an error event", () => {
    expect(dailyErrorType({ action: "error", errorMsg: "x", error: { type: "ejected", msg: "x" } })).toBe("ejected");
  });

  it("reads the type from a bare error object (a rejected join)", () => {
    expect(dailyErrorType({ type: "connection-error", msg: "x" })).toBe("connection-error");
  });

  it("returns null for anything without one", () => {
    expect(dailyErrorType(null)).toBeNull();
    expect(dailyErrorType(undefined)).toBeNull();
    expect(dailyErrorType("ejected")).toBeNull();
    expect(dailyErrorType(new Error("boom"))).toBeNull();
    expect(dailyErrorType({ action: "error", errorMsg: "x" })).toBeNull();
    expect(dailyErrorType({ error: { type: 1 } })).toBeNull();
  });
});

describe("involuntaryLeaveAction", () => {
  it("retries a network drop, a connection error or a leave with no reason", () => {
    expect(involuntaryLeaveAction({ errorType: null, callOver: false })).toBe("reconnect");
    expect(involuntaryLeaveAction({ errorType: "connection-error", callOver: false })).toBe("reconnect");
  });

  it("retries an error type it doesn't recognise rather than dropping the call", () => {
    expect(involuntaryLeaveAction({ errorType: "something-newer", callOver: false })).toBe("reconnect");
  });

  it("ends without retrying when the room or token is gone", () => {
    for (const errorType of ["ejected", "no-room", "exp-room", "exp-token", "not-allowed", "nbf-room", "nbf-token", "meeting-full", "end-of-life"]) {
      expect(involuntaryLeaveAction({ errorType, callOver: false })).toBe("end");
    }
  });

  it("ends without retrying once the call row is over, whatever Daily said", () => {
    expect(involuntaryLeaveAction({ errorType: null, callOver: true })).toBe("end");
    expect(involuntaryLeaveAction({ errorType: "connection-error", callOver: true })).toBe("end");
  });
});

describe("isExpectedCallExpiry", () => {
  it("is true only for the room/token lifetime running out", () => {
    expect(isExpectedCallExpiry("exp-room")).toBe(true);
    expect(isExpectedCallExpiry("exp-token")).toBe(true);
    expect(isExpectedCallExpiry("ejected")).toBe(false);
    expect(isExpectedCallExpiry(null)).toBe(false);
  });
});

describe("isCallOverStatus", () => {
  it("separates finished calls from live ones", () => {
    expect(["ENDED", "MISSED", "DECLINED"].map(isCallOverStatus)).toEqual([true, true, true]);
    expect(["RINGING", "ACCEPTED"].map(isCallOverStatus)).toEqual([false, false]);
  });
});

describe("latestJoined", () => {
  it("returns undefined for nobody", () => {
    expect(latestJoined([])).toBeUndefined();
  });

  it("prefers the rejoined participant over their stale earlier one, in either order", () => {
    const stale = { id: "stale", joined_at: new Date(1000) };
    const live = { id: "live", joined_at: new Date(2000) };
    expect(latestJoined([stale, live])).toBe(live);
    expect(latestJoined([live, stale])).toBe(live);
  });

  it("still returns someone when joined_at is missing", () => {
    const only: { id: string; joined_at?: Date } = { id: "only" };
    expect(latestJoined([only])).toBe(only);
  });
});

describe("remotesByUser", () => {
  it("returns nobody for an empty room", () => {
    expect(remotesByUser([])).toEqual([]);
  });

  it("keeps one entry per person, the most recently joined session", () => {
    const stale = { session_id: "s1", user_id: "bola", joined_at: new Date(1000) };
    const other = { session_id: "s2", user_id: "ada", joined_at: new Date(1500) };
    const live = { session_id: "s3", user_id: "bola", joined_at: new Date(2000) };
    expect(remotesByUser([stale, other, live])).toEqual([live, other]);
    expect(remotesByUser([live, other, stale])).toEqual([live, other]);
  });

  it("matches latestJoined when there is only one other person", () => {
    const stale = { session_id: "s1", user_id: "bola", joined_at: new Date(1000) };
    const live = { session_id: "s2", user_id: "bola", joined_at: new Date(2000) };
    expect(remotesByUser([stale, live])).toEqual([latestJoined([stale, live])]);
  });

  it("treats sessions without a user id as separate people", () => {
    const a: { session_id: string; user_id?: string; joined_at?: Date } = { session_id: "s1" };
    const b: { session_id: string; user_id?: string; joined_at?: Date } = { session_id: "s2", user_id: "" };
    expect(remotesByUser([a, b])).toEqual([a, b]);
  });
});

describe("shouldEndAfterLeave", () => {
  it("keeps a call with two or more people in it", () => {
    expect(shouldEndAfterLeave({ joined: 2, ringing: 0 })).toBe(false);
    expect(shouldEndAfterLeave({ joined: 3, ringing: 1 })).toBe(false);
  });

  it("ends once one person is left and nobody is being rung", () => {
    expect(shouldEndAfterLeave({ joined: 1, ringing: 0 })).toBe(true);
  });

  it("keeps an invite alive while one person is still there to be joined", () => {
    expect(shouldEndAfterLeave({ joined: 1, ringing: 1 })).toBe(false);
    expect(shouldEndAfterLeave({ joined: 1, ringing: 3 })).toBe(false);
  });

  it("ends once nobody is in the call, whoever is still ringing", () => {
    expect(shouldEndAfterLeave({ joined: 0, ringing: 0 })).toBe(true);
    expect(shouldEndAfterLeave({ joined: 0, ringing: 2 })).toBe(true);
  });
});

describe("cameraRecoveryAction", () => {
  const live = { wantVideo: true, trackState: "playable", trackEnded: false, trackMuted: false, mutedIsStale: false };

  it("leaves a healthy camera alone", () => {
    expect(cameraRecoveryAction(live)).toBe("none");
  });

  it("never turns on a camera the user had off", () => {
    expect(cameraRecoveryAction({ ...live, wantVideo: false, trackState: "off" })).toBe("none");
    expect(cameraRecoveryAction({ ...live, wantVideo: false, trackEnded: true })).toBe("none");
  });

  it("re-enables a camera Daily turned off", () => {
    expect(cameraRecoveryAction({ ...live, trackState: "off" })).toBe("enable");
  });

  it("restarts a camera whose track ended while backgrounded", () => {
    expect(cameraRecoveryAction({ ...live, trackEnded: true })).toBe("restart");
  });

  it("gives a muted track a chance to come back before restarting it", () => {
    expect(cameraRecoveryAction({ ...live, trackMuted: true })).toBe("none");
    expect(cameraRecoveryAction({ ...live, trackMuted: true, mutedIsStale: true })).toBe("restart");
  });

  it("does nothing for a blocked camera or before there is a local participant", () => {
    expect(cameraRecoveryAction({ ...live, trackState: "blocked", trackEnded: true })).toBe("none");
    expect(cameraRecoveryAction({ ...live, trackState: undefined })).toBe("none");
  });
});

describe("shouldAnnounceCameraPaused", () => {
  const base = { hidden: true, wantVideo: true, trackMuted: false, trackEnded: false, platformAlwaysPauses: false };

  it("stays quiet while a backgrounded tab is still sending video", () => {
    expect(shouldAnnounceCameraPaused(base)).toBe(false);
  });

  it("announces once capture has actually stopped", () => {
    expect(shouldAnnounceCameraPaused({ ...base, trackMuted: true })).toBe(true);
    expect(shouldAnnounceCameraPaused({ ...base, trackEnded: true })).toBe(true);
  });

  it("announces straight away where the platform always stops capture", () => {
    expect(shouldAnnounceCameraPaused({ ...base, platformAlwaysPauses: true })).toBe(true);
  });

  it("never announces while visible or with the camera off", () => {
    expect(shouldAnnounceCameraPaused({ ...base, hidden: false, trackMuted: true })).toBe(false);
    expect(shouldAnnounceCameraPaused({ ...base, wantVideo: false, platformAlwaysPauses: true })).toBe(false);
  });
});

describe("status-check timing", () => {
  it("gives up on a hung check before the next poll is due, so they can't pile up", () => {
    expect(CALL_STATUS_CHECK_TIMEOUT_MS).toBeLessThan(CALL_PEER_LOSS_STATUS_POLL_MS);
  });

  it("first checks on a vanished peer before the connection-lost notice would show", () => {
    expect(CALL_PEER_LOSS_FIRST_CHECK_MS).toBeLessThan(CALL_PEER_LOSS_NOTICE_DELAY_MS);
  });
});

describe("settledWithin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through a value that arrives in time, false included", async () => {
    await expect(settledWithin(Promise.resolve(true), 1000)).resolves.toBe(true);
    await expect(settledWithin(Promise.resolve(false), 1000)).resolves.toBe(false);
  });

  it("resolves null for a rejection", async () => {
    await expect(settledWithin(Promise.reject(new Error("offline")), 1000)).resolves.toBeNull();
  });

  it("resolves null once the timeout passes on a promise that never settles", async () => {
    const result = settledWithin(new Promise<boolean>(() => {}), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBeNull();
  });
});

describe("sessionNeedsWakeLock", () => {
  it("always holds it for a live stream or Collab", () => {
    expect(sessionNeedsWakeLock({ renderer: "custom", type: "AUDIO", localVideoOn: null })).toBe(true);
    expect(sessionNeedsWakeLock({ renderer: "prebuilt", type: "AUDIO", localVideoOn: false })).toBe(true);
    expect(sessionNeedsWakeLock({ renderer: undefined, type: "VIDEO", localVideoOn: null })).toBe(true);
  });

  it("goes by the call's starting type until the local camera state is known", () => {
    expect(sessionNeedsWakeLock({ renderer: "direct", type: "VIDEO", localVideoOn: null })).toBe(true);
    expect(sessionNeedsWakeLock({ renderer: "direct", type: "AUDIO", localVideoOn: null })).toBe(false);
  });

  it("follows the live camera state after that, in both directions", () => {
    expect(sessionNeedsWakeLock({ renderer: "direct", type: "AUDIO", localVideoOn: true })).toBe(true);
    expect(sessionNeedsWakeLock({ renderer: "direct", type: "VIDEO", localVideoOn: false })).toBe(false);
  });
});

describe("endCallRetryDelayMs", () => {
  it("doubles from 2s and caps at 30s", () => {
    expect([1, 2, 3, 4, 5, 6].map((failures) => endCallRetryDelayMs(failures, 0))).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("gives up once the next wait would run past the retry window", () => {
    expect(endCallRetryDelayMs(6, END_CALL_RETRY_WINDOW_MS - 30001)).toBe(30000);
    expect(endCallRetryDelayMs(6, END_CALL_RETRY_WINDOW_MS - 30000)).toBeNull();
    expect(endCallRetryDelayMs(1, END_CALL_RETRY_WINDOW_MS)).toBeNull();
  });
});

describe("retryUntilAnswered", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function harness(attempt: () => Promise<unknown>) {
    const state = { retryNow: () => {}, subscribed: false, settled: 0 };
    const attemptSpy = vi.fn(attempt);
    retryUntilAnswered({
      attempt: attemptSpy,
      subscribeOnline: (retryNow) => {
        state.retryNow = retryNow;
        state.subscribed = true;
        return () => {
          state.subscribed = false;
        };
      },
      onSettled: () => {
        state.settled += 1;
      },
    });
    return { state, attemptSpy };
  }

  it("stops after the first attempt the server answers, whatever the answer", async () => {
    const { state, attemptSpy } = harness(async () => ({ error: "not_found" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptSpy).toHaveBeenCalledTimes(1);
    expect(state.settled).toBe(1);
    expect(state.subscribed).toBe(false);
    await vi.advanceTimersByTimeAsync(END_CALL_RETRY_WINDOW_MS);
    expect(attemptSpy).toHaveBeenCalledTimes(1);
  });

  it("retries a failed attempt on the backoff schedule until one gets through", async () => {
    let calls = 0;
    const { state, attemptSpy } = harness(async () => {
      calls += 1;
      if (calls < 3) throw new Error("offline");
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(attemptSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attemptSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(attemptSpy).toHaveBeenCalledTimes(3);
    expect(state.settled).toBe(1);
    await vi.advanceTimersByTimeAsync(END_CALL_RETRY_WINDOW_MS);
    expect(attemptSpy).toHaveBeenCalledTimes(3);
  });

  it("retries straight away when the connection comes back, without doubling up", async () => {
    let online = false;
    const { state, attemptSpy } = harness(async () => {
      if (!online) throw new Error("offline");
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptSpy).toHaveBeenCalledTimes(1);
    online = true;
    state.retryNow();
    state.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptSpy).toHaveBeenCalledTimes(2);
    expect(state.settled).toBe(1);
    await vi.advanceTimersByTimeAsync(END_CALL_RETRY_WINDOW_MS);
    expect(attemptSpy).toHaveBeenCalledTimes(2);
  });

  it("treats an attempt that never returns as failed and moves on", async () => {
    let calls = 0;
    const { state, attemptSpy } = harness(() => {
      calls += 1;
      return calls === 1 ? new Promise(() => {}) : Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(END_CALL_ATTEMPT_TIMEOUT_MS - 1);
    expect(attemptSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + 2000);
    expect(attemptSpy).toHaveBeenCalledTimes(2);
    expect(state.settled).toBe(1);
  });

  it("gives up, and stops listening, once the retry window is spent", async () => {
    const { state, attemptSpy } = harness(async () => {
      throw new Error("offline");
    });
    await vi.advanceTimersByTimeAsync(END_CALL_RETRY_WINDOW_MS);
    const attempts = attemptSpy.mock.calls.length;
    expect(attempts).toBeGreaterThan(3);
    expect(state.settled).toBe(1);
    expect(state.subscribed).toBe(false);
    state.retryNow();
    await vi.advanceTimersByTimeAsync(END_CALL_RETRY_WINDOW_MS);
    expect(attemptSpy).toHaveBeenCalledTimes(attempts);
  });
});
