// Pure rules for the Turnstile widget's lifecycle (components/turnstile-widget.tsx): no DOM, no React, so they can
// be unit-tested in node. The component owns the side effects (timers, Cloudflare's render/execute/reset calls,
// telemetry) and asks these functions what state comes next and what to tell the person.

/** Show "still verifying" (with a Try again button) once a check has run this long without a token. */
export const SLOW_AFTER_MS = 8_000;
/**
 * Give up on a check that has neither produced a token nor reported an error after this long. Cloudflare's own
 * challenge can legitimately take tens of seconds on 2G/3G and low-end phones, so this is deliberately generous;
 * the person can always tap Try again sooner (it appears at SLOW_AFTER_MS).
 */
export const STALLED_AFTER_MS = 60_000;
/** Each attempt to download Cloudflare's api.js gets this long before it counts as failed. */
export const SCRIPT_TIMEOUT_MS = 20_000;
/** api.js download attempts per load (one automatic retry). */
export const SCRIPT_LOAD_ATTEMPTS = 2;
export const SCRIPT_RETRY_DELAY_MS = 2_000;
/** Automatic re-runs after a retriable widget error, before the error is shown with a Try again button. */
const AUTO_RETRY_DELAYS_MS = [2_000, 5_000] as const;

/**
 * What went wrong, as far as the person is concerned. Each maps to its own sentence (shared.turnstile.*).
 *  - blocked: api.js never loaded (content blocker, Private DNS, VPN, ISP, offline).
 *  - stalled: ran for STALLED_AFTER_MS with no answer at all.
 *  - network: Cloudflare reported it couldn't load/reach its own resources.
 *  - config: our site key / hostname setup is wrong (owner action; reported to Sentry).
 *  - unsupported: the browser / WebView is too old or missing features.
 *  - clock: the device's date/time is wrong.
 *  - failed: the challenge itself failed (anything else).
 */
export type TurnstileProblem = "blocked" | "stalled" | "network" | "config" | "unsupported" | "clock" | "failed";

/**
 * Maps a Cloudflare client-side error code to a problem. Families per
 * https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
 */
export function classifyWidgetError(code: string | undefined | null): TurnstileProblem {
  const c = String(code ?? "").trim();
  if (!/^\d{3,7}$/.test(c)) return "failed";
  // Site key / hostname / parameter misconfiguration: retrying never helps.
  if (["110100", "110110", "110200", "110420", "110430", "400020", "400030", "400040", "400070"].includes(c)) {
    return "config";
  }
  if (c.startsWith("105")) return "config"; // API compatibility (wrong api.js usage)
  if (c === "110500" || c === "110510") return "unsupported";
  if (c.startsWith("2001")) return "clock"; // 200100: device clock is off
  if (c === "200500" || c.startsWith("100") || c === "110600" || c === "110620") return "network";
  return "failed"; // 102xxx-106xxx params, 120xxx, 300xxx, 600xxx: challenge didn't pass
}

/** Problems worth an automatic re-run: transient ones. A config/clock/unsupported problem won't fix itself. */
export function isRetriable(problem: TurnstileProblem): boolean {
  return problem === "network" || problem === "failed";
}

/** Delay before automatic re-run number `retriesSoFar + 1`, or null once the budget is spent. */
export function autoRetryDelay(retriesSoFar: number): number | null {
  return AUTO_RETRY_DELAYS_MS[retriesSoFar] ?? null;
}

export type TurnstilePhase = "idle" | "checking" | "verified" | "error";

export type TurnstileState = {
  phase: TurnstilePhase;
  /** checking only: SLOW_AFTER_MS passed without a token. */
  slow: boolean;
  /** error only. */
  problem: TurnstileProblem | null;
  /** Automatic re-runs used since the last tap. */
  autoRetries: number;
};

export const INITIAL_TURNSTILE_STATE: TurnstileState = { phase: "idle", slow: false, problem: null, autoRetries: 0 };

export type TurnstileEvent =
  /** The person tapped "Verify you're human" or "Try again". */
  | { type: "start" }
  | { type: "slow" }
  | { type: "token" }
  /** The token was spent by a submit (or a non-form consumer reset it): the next attempt needs a fresh tap. */
  | { type: "spent" }
  /** Cloudflare is refreshing an expired token / timed-out interactive challenge by itself (refresh-* "auto"). */
  | { type: "refreshing" }
  | { type: "error"; code?: string | null }
  | { type: "scriptFailed" }
  | { type: "stalled" };

/**
 * The next state. For an `error` event the caller compares `autoRetries` before/after: if it went up, schedule a
 * reset + execute after `autoRetryDelay(before)`; if the phase became "error", show it (and report it).
 */
export function nextTurnstileState(state: TurnstileState, event: TurnstileEvent): TurnstileState {
  switch (event.type) {
    case "start":
      return { phase: "checking", slow: false, problem: null, autoRetries: 0 };
    case "slow":
      return state.phase === "checking" ? { ...state, slow: true } : state;
    case "token":
      return { ...state, phase: "verified", slow: false, problem: null };
    case "spent":
      return INITIAL_TURNSTILE_STATE;
    case "refreshing":
      // Keep the "slow" flag: from the person's point of view it's the same wait.
      return state.phase === "error" ? state : { ...state, phase: "checking", problem: null };
    case "error": {
      if (state.phase !== "checking" && state.phase !== "verified") return state;
      const problem = classifyWidgetError(event.code);
      if (isRetriable(problem) && autoRetryDelay(state.autoRetries) !== null) {
        return { ...state, phase: "checking", problem: null, autoRetries: state.autoRetries + 1 };
      }
      return { ...state, phase: "error", slow: false, problem };
    }
    case "scriptFailed":
      return { ...state, phase: "error", slow: false, problem: "blocked" };
    case "stalled":
      return state.phase === "checking" ? { ...state, phase: "error", slow: false, problem: "stalled" } : state;
  }
}

export type TurnstileStrings = {
  verify: string;
  wait: string;
  checkingDevice?: string;
  stillChecking: string;
  slow: string;
  retry: string;
} & Record<TurnstileProblem, string>;

/** The status line under the widget, and whether a Try again button goes with it. */
export function turnstileStatus(
  state: TurnstileState,
  strings: TurnstileStrings,
): { text: string | null; tone: "info" | "error"; retry: boolean } {
  if (state.phase === "error" && state.problem) return { text: strings[state.problem], tone: "error", retry: true };
  if (state.phase === "checking" && state.slow) return { text: strings.slow, tone: "info", retry: true };
  return { text: null, tone: "info", retry: false };
}

/** Why a submit without a token was held back, in the person's words. */
export function heldSubmitMessage(state: TurnstileState, strings: TurnstileStrings): string {
  if (state.phase === "error" && state.problem) return strings[state.problem];
  if (state.phase === "checking") return strings.stillChecking;
  return strings.wait;
}

/** Coarse duration bucket for telemetry: no exact timings needed to see "slow networks" in aggregate. */
export function durationBucket(ms: number): string {
  if (ms < 3_000) return "<3s";
  if (ms < 8_000) return "3-8s";
  if (ms < 20_000) return "8-20s";
  if (ms < 60_000) return "20-60s";
  return ">60s";
}
