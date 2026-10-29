import { describe, expect, it } from "vitest";
import {
  INITIAL_TURNSTILE_STATE,
  autoRetryDelay,
  classifyWidgetError,
  durationBucket,
  heldSubmitMessage,
  isRetriable,
  nextTurnstileState,
  turnstileStatus,
  type TurnstileEvent,
  type TurnstileState,
} from "./turnstile-lifecycle";
import { sharedEn } from "@/lib/i18n/en/shared";
import { captchaErrorCode } from "@/lib/turnstile-shared";

const strings = sharedEn.turnstile;

function run(...events: TurnstileEvent[]): TurnstileState {
  return events.reduce(nextTurnstileState, INITIAL_TURNSTILE_STATE);
}

describe("classifyWidgetError", () => {
  it("treats site key / hostname problems as our config (never retried)", () => {
    for (const code of ["110100", "110110", "110200", "110420", "110430", "400020", "400070", "105001"]) {
      expect(classifyWidgetError(code)).toBe("config");
    }
    expect(isRetriable("config")).toBe(false);
  });

  it("recognises unsupported browsers and a wrong device clock", () => {
    expect(classifyWidgetError("110500")).toBe("unsupported");
    expect(classifyWidgetError("110510")).toBe("unsupported");
    expect(classifyWidgetError("200100")).toBe("clock");
    expect(isRetriable("unsupported")).toBe(false);
    expect(isRetriable("clock")).toBe(false);
  });

  it("treats load/network trouble and failed challenges as retriable", () => {
    expect(classifyWidgetError("200500")).toBe("network");
    expect(classifyWidgetError("100405")).toBe("network");
    expect(classifyWidgetError("110600")).toBe("network");
    expect(classifyWidgetError("300030")).toBe("failed");
    expect(classifyWidgetError("600010")).toBe("failed");
    expect(classifyWidgetError(undefined)).toBe("failed");
    expect(classifyWidgetError("not-a-code")).toBe("failed");
    expect(isRetriable("network")).toBe(true);
    expect(isRetriable("failed")).toBe(true);
  });
});

describe("nextTurnstileState", () => {
  it("goes idle -> checking on the tap -> verified on a token -> idle once spent", () => {
    let s = run({ type: "start" });
    expect(s).toMatchObject({ phase: "checking", slow: false });
    s = nextTurnstileState(s, { type: "token" });
    expect(s.phase).toBe("verified");
    expect(nextTurnstileState(s, { type: "spent" })).toEqual(INITIAL_TURNSTILE_STATE);
  });

  it("marks a long check as slow, but only while checking", () => {
    expect(run({ type: "start" }, { type: "slow" }).slow).toBe(true);
    expect(run({ type: "slow" })).toEqual(INITIAL_TURNSTILE_STATE);
  });

  it("re-runs a retriable error at most twice, then shows it", () => {
    let s = run({ type: "start" }, { type: "error", code: "300030" });
    expect(s).toMatchObject({ phase: "checking", autoRetries: 1 });
    s = nextTurnstileState(s, { type: "error", code: "300030" });
    expect(s).toMatchObject({ phase: "checking", autoRetries: 2 });
    s = nextTurnstileState(s, { type: "error", code: "300030" });
    expect(s).toMatchObject({ phase: "error", problem: "failed" });
    expect(autoRetryDelay(0)).toBe(2000);
    expect(autoRetryDelay(1)).toBe(5000);
    expect(autoRetryDelay(2)).toBeNull();
  });

  it("shows a non-retriable error straight away", () => {
    expect(run({ type: "start" }, { type: "error", code: "110200" })).toMatchObject({ phase: "error", problem: "config" });
    expect(run({ type: "start" }, { type: "error", code: "200100" })).toMatchObject({ phase: "error", problem: "clock" });
  });

  it("a new tap clears the error and the retry budget", () => {
    const failed = run({ type: "start" }, { type: "error", code: "110200" });
    expect(nextTurnstileState(failed, { type: "start" })).toEqual({ phase: "checking", slow: false, problem: null, autoRetries: 0 });
  });

  it("reports a blocked script and a stall", () => {
    expect(run({ type: "start" }, { type: "scriptFailed" })).toMatchObject({ phase: "error", problem: "blocked" });
    expect(run({ type: "start" }, { type: "stalled" })).toMatchObject({ phase: "error", problem: "stalled" });
    // A stall timer firing after a token arrived changes nothing.
    expect(run({ type: "start" }, { type: "token" }, { type: "stalled" }).phase).toBe("verified");
  });

  it("an expired token being refreshed counts as checking again", () => {
    expect(run({ type: "start" }, { type: "token" }, { type: "refreshing" }).phase).toBe("checking");
  });

  it("ignores widget errors before the tap", () => {
    expect(run({ type: "error", code: "110200" })).toEqual(INITIAL_TURNSTILE_STATE);
  });
});

describe("messages", () => {
  it("explains a held-back submit by phase", () => {
    expect(heldSubmitMessage(INITIAL_TURNSTILE_STATE, strings)).toBe(strings.wait);
    expect(heldSubmitMessage(run({ type: "start" }), strings)).toBe(strings.stillChecking);
    expect(heldSubmitMessage(run({ type: "start" }, { type: "scriptFailed" }), strings)).toBe(strings.blocked);
    expect(heldSubmitMessage(run({ type: "start" }, { type: "error", code: "110500" }), strings)).toBe(strings.unsupported);
  });

  it("shows nothing while a check runs normally, then 'still verifying' with Try again, and errors with Try again", () => {
    expect(turnstileStatus(run({ type: "start" }), strings)).toEqual({ text: null, tone: "info", retry: false });
    expect(turnstileStatus(run({ type: "start" }, { type: "slow" }), strings)).toEqual({
      text: strings.slow,
      tone: "info",
      retry: true,
    });
    expect(turnstileStatus(run({ type: "start" }, { type: "stalled" }), strings)).toEqual({
      text: strings.stalled,
      tone: "error",
      retry: true,
    });
    expect(turnstileStatus(run({ type: "start" }, { type: "token" }), strings).text).toBeNull();
  });

  it("has every sentence in every language", async () => {
    const keys = Object.keys(strings).sort();
    for (const locale of ["es", "fr", "pt", "ar"] as const) {
      const { shared } = await import(`@/lib/i18n/${locale}/shared`);
      expect(Object.keys(shared.turnstile).sort()).toEqual(keys);
      for (const value of Object.values(shared.turnstile)) expect(String(value).length).toBeGreaterThan(0);
    }
  });

  it("buckets durations coarsely for telemetry", () => {
    expect(durationBucket(1000)).toBe("<3s");
    expect(durationBucket(5000)).toBe("3-8s");
    expect(durationBucket(15000)).toBe("8-20s");
    expect(durationBucket(45000)).toBe("20-60s");
    expect(durationBucket(90000)).toBe(">60s");
  });
});

describe("captchaErrorCode", () => {
  it("only an outage/misconfiguration gets the 'not your fault' code", () => {
    expect(captchaErrorCode("unavailable")).toBe("captcha_unavailable");
    expect(captchaErrorCode("missing")).toBe("captcha");
    expect(captchaErrorCode("expired")).toBe("captcha");
    expect(captchaErrorCode("rejected")).toBe("captcha");
  });
});
