import { describe, expect, it } from "vitest";
import {
  INITIAL_TURNSTILE_STATE,
  MAX_RERUNS_ON_RESUME,
  RERUN_AFTER_HIDDEN_MS,
  RESUME_GRACE_MS,
  RESUME_SETTLE_MS,
  STALLED_AFTER_MS,
  attemptTelemetry,
  heldSubmitMessage,
  heldSubmitReason,
  isSuspendedTimer,
  nextAttempt,
  nextTurnstileState,
  shouldRerunOnResume,
  stallDelayMs,
  stallPhase,
  startAttempt,
  toTurnstilePlatform,
  turnstileStatus,
  type TurnstileEvent,
  type TurnstileState,
} from "./turnstile-lifecycle";
import { sharedEn } from "@/lib/i18n/en/shared";

// Pure tests for the stall clock, token expiry and telemetry added after PostHog showed 24 `stalled` failures
// (23 of them inside the native app) in 7-14 Nov 2026. turnstile-lifecycle.test.ts covers the original lifecycle.

const strings = sharedEn.turnstile;
const T0 = 1_000_000;

function run(...events: TurnstileEvent[]): TurnstileState {
  return events.reduce(nextTurnstileState, INITIAL_TURNSTILE_STATE);
}

describe("stall clock (one tapped attempt)", () => {
  it("does not run before execute(): a tap waiting on api.js never counts as a stall", () => {
    const a = startAttempt(T0);
    expect(stallDelayMs(a, T0 + 120_000)).toBeNull();
    expect(stallPhase(a)).toBe("not_executed");
  });

  it("a real stall after the tap still reports after the full limit", () => {
    let a = startAttempt(T0);
    a = nextAttempt(a, { type: "executed", now: T0 + 500 });
    expect(stallDelayMs(a, T0 + 500)).toBe(STALLED_AFTER_MS);
    expect(stallDelayMs(a, T0 + 500 + STALLED_AFTER_MS - 1)).toBe(1);
    expect(stallDelayMs(a, T0 + 500 + STALLED_AFTER_MS)).toBe(0);
    expect(stallPhase(a)).toBe("executing");
    // Automatic retries execute again inside the same budget.
    a = nextAttempt(a, { type: "executed", now: T0 + 30_000 });
    expect(stallDelayMs(a, T0 + 30_500)).toBe(STALLED_AFTER_MS - 30_000);
  });

  it("backgrounding pauses the clock, however long the app is away", () => {
    let a = nextAttempt(startAttempt(T0), { type: "executed", now: T0 });
    a = nextAttempt(a, { type: "hidden", now: T0 + 20_000 });
    expect(stallDelayMs(a, T0 + 20_000)).toBeNull();
    expect(stallDelayMs(a, T0 + 10 * 60_000)).toBeNull();
    // Back after 5s: picks up where it left off, no re-run.
    a = nextAttempt(a, { type: "visible", now: T0 + 25_000 });
    expect(stallDelayMs(a, T0 + 25_000)).toBe(STALLED_AFTER_MS - 20_000);
    expect(shouldRerunOnResume(a)).toBe(false);
    expect(stallPhase(a)).toBe("backgrounded_during");
  });

  it("a tap made while hidden starts paused", () => {
    const a = nextAttempt(startAttempt(T0, false), { type: "executed", now: T0 });
    expect(stallDelayMs(a, T0 + 120_000)).toBeNull();
    expect(a.everHidden).toBe(true);
  });

  it("coming back always leaves at least the resume grace", () => {
    let a = nextAttempt(startAttempt(T0), { type: "executed", now: T0 });
    a = nextAttempt(a, { type: "hidden", now: T0 + 58_000 });
    a = nextAttempt(a, { type: "visible", now: T0 + 60_000 });
    expect(stallDelayMs(a, T0 + 60_000)).toBe(RESUME_GRACE_MS);
  });

  it("a check hidden long enough is re-run on return with a fresh clock, at most MAX_RERUNS_ON_RESUME times", () => {
    let a = nextAttempt(startAttempt(T0), { type: "executed", now: T0 });
    a = nextAttempt(a, { type: "hidden", now: T0 + 5_000 });
    a = nextAttempt(a, { type: "visible", now: T0 + 5_000 + RERUN_AFTER_HIDDEN_MS });
    expect(shouldRerunOnResume(a)).toBe(true);
    const now = T0 + 5_000 + RERUN_AFTER_HIDDEN_MS + RESUME_SETTLE_MS;
    a = nextAttempt(a, { type: "rerun", now });
    expect(stallDelayMs(a, now)).toBe(STALLED_AFTER_MS);
    expect(a.rerunsOnResume).toBe(1);
    expect(shouldRerunOnResume(a)).toBe(false); // nothing new to come back from
    for (let i = 0; i < 3; i++) {
      const t = now + (i + 1) * 100_000;
      a = nextAttempt(a, { type: "hidden", now: t });
      a = nextAttempt(a, { type: "visible", now: t + RERUN_AFTER_HIDDEN_MS });
      if (shouldRerunOnResume(a)) a = nextAttempt(a, { type: "rerun", now: t + RERUN_AFTER_HIDDEN_MS });
    }
    expect(a.rerunsOnResume).toBe(MAX_RERUNS_ON_RESUME);
    // Past the cap, the clock still resumes with the grace instead.
    expect(stallDelayMs(a, now + 4 * 100_000)).not.toBeNull();
  });

  it("a short trip away is not re-run", () => {
    let a = nextAttempt(startAttempt(T0), { type: "executed", now: T0 });
    a = nextAttempt(a, { type: "hidden", now: T0 + 1_000 });
    a = nextAttempt(a, { type: "visible", now: T0 + 1_000 + RERUN_AFTER_HIDDEN_MS - 1 });
    expect(shouldRerunOnResume(a)).toBe(false);
  });

  it("is not re-run on return while Cloudflare's checkbox is showing", () => {
    let a = nextAttempt(startAttempt(T0), { type: "executed", now: T0 });
    a = nextAttempt(a, { type: "interactiveStart", now: T0 + 1_000 });
    a = nextAttempt(a, { type: "hidden", now: T0 + 2_000 });
    a = nextAttempt(a, { type: "visible", now: T0 + 60_000 });
    expect(shouldRerunOnResume(a)).toBe(false);
  });

  it("waiting on Cloudflare's own checkbox is not a stall", () => {
    let a = nextAttempt(startAttempt(T0), { type: "executed", now: T0 });
    a = nextAttempt(a, { type: "interactiveStart", now: T0 + 3_000 });
    expect(stallDelayMs(a, T0 + 5 * 60_000)).toBeNull();
    expect(stallPhase(a)).toBe("interactive");
    a = nextAttempt(a, { type: "interactiveEnd", now: T0 + 5 * 60_000 });
    expect(stallDelayMs(a, T0 + 5 * 60_000)).toBe(STALLED_AFTER_MS - 3_000);
    expect(stallPhase(a)).toBe("after_interactive");
  });

  it("a timer that fires long after it was due was frozen with the page", () => {
    expect(isSuspendedTimer(T0, T0 + 100)).toBe(false);
    expect(isSuspendedTimer(T0, T0 + 10 * 60_000)).toBe(true);
  });
});

describe("token expiry and held submits", () => {
  it("an expired, unused token goes back to the button (a new tap is needed)", () => {
    const s = run({ type: "start" }, { type: "token" }, { type: "expired" });
    expect(s).toEqual(INITIAL_TURNSTILE_STATE);
    expect(turnstileStatus(s, strings, { expired: true })).toEqual({ text: strings.expired, tone: "info", retry: false });
    expect(heldSubmitMessage(s, strings, { expired: true })).toBe(strings.expired);
    expect(heldSubmitReason(s, { expired: true })).toBe("expired");
    // An expiry outside "verified" changes nothing.
    expect(run({ type: "start" }, { type: "expired" }).phase).toBe("checking");
    expect(run({ type: "expired" })).toEqual(INITIAL_TURNSTILE_STATE);
  });

  it("a submit before any tap is 'not_started', never a failure of the check", () => {
    expect(heldSubmitReason(INITIAL_TURNSTILE_STATE)).toBe("not_started");
    expect(heldSubmitReason(run({ type: "start" }))).toBe("checking");
    expect(heldSubmitReason(run({ type: "start" }), { interactive: true })).toBe("interactive");
    expect(heldSubmitReason(run({ type: "start" }, { type: "stalled" }))).toBe("error");
    expect(heldSubmitReason(run({ type: "start" }, { type: "token" }))).toBeNull();
    // No tap: no stall clock, so nothing ever reaches "stalled".
    expect(run({ type: "stalled" })).toEqual(INITIAL_TURNSTILE_STATE);
  });

  it("tells the person to tap Cloudflare's checkbox while it shows", () => {
    const checking = run({ type: "start" });
    expect(turnstileStatus(checking, strings, { interactive: true })).toEqual({
      text: strings.interactive,
      tone: "info",
      retry: false,
    });
    expect(turnstileStatus(nextTurnstileState(checking, { type: "slow" }), strings, { interactive: true }).retry).toBe(true);
    expect(heldSubmitMessage(checking, strings, { interactive: true })).toBe(strings.interactive);
  });
});

describe("telemetry payloads", () => {
  it("maps Capacitor platforms and falls back to web", () => {
    expect(toTurnstilePlatform("ios")).toBe("ios");
    expect(toTurnstilePlatform("android")).toBe("android");
    expect(toTurnstilePlatform("web")).toBe("web");
    expect(toTurnstilePlatform(undefined)).toBe("web");
  });

  it("carries platform, visible time, background, interactive and widget state, and nothing else", () => {
    let a = nextAttempt(startAttempt(T0), { type: "executed", now: T0 + 1_000 });
    a = nextAttempt(a, { type: "hidden", now: T0 + 4_000 });
    a = nextAttempt(a, { type: "visible", now: T0 + 64_000 });
    a = nextAttempt(a, { type: "interactiveStart", now: T0 + 65_000 });
    const payload = attemptTelemetry(a, T0 + 70_000, { platform: "ios", widgetLoaded: true });
    expect(payload).toEqual({
      platform: "ios",
      visible: "8-20s", // 4s before the background + 6s after: the 60s away is not counted
      hidden_during: true,
      interactive: true,
      executed: true,
      reruns_on_resume: 0,
      widget_loaded: true,
    });
    expect(stallPhase(a)).toBe("interactive");
  });

  it("has the same shape with no attempt", () => {
    expect(attemptTelemetry(null, T0, { platform: "android", widgetLoaded: false })).toEqual({
      platform: "android",
      visible: null,
      hidden_during: false,
      interactive: false,
      executed: false,
      reruns_on_resume: 0,
      widget_loaded: false,
    });
    expect(stallPhase(null)).toBe("not_executed");
  });
});
