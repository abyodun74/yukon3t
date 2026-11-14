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
 * Coming back to the app (or tab) mid-check always leaves the stall clock at least this long, so Cloudflare's iframe,
 * suspended while the app was in the background, gets time to wake up and answer before the check counts as stalled.
 */
export const RESUME_GRACE_MS = 10_000;
/** A check that was hidden at least this long is re-run on return: its iframe or its requests may have been dropped. */
export const RERUN_AFTER_HIDDEN_MS = 15_000;
/** How long to wait after coming back before deciding to re-run, so a token finished in the background lands first. */
export const RESUME_SETTLE_MS = 1_500;
/** Re-runs on return per tap, so an app switched back and forth can't loop. */
export const MAX_RERUNS_ON_RESUME = 2;
/**
 * A stall timer that fires this much later than it was due was frozen with the page (the app was suspended without a
 * visibilitychange reaching us): treated as a return from the background, not as a stall.
 */
export const SUSPENDED_TIMER_LATENESS_MS = 5_000;

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
  | { type: "stalled" }
  /**
   * An unused token expired (Cloudflare tokens live ~300s). Back to the button: the next check needs a fresh tap, as
   * the privacy policy says (refresh-expired is "never", so Cloudflare doesn't re-run it by itself).
   */
  | { type: "expired" };

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
    case "expired":
      return state.phase === "verified" ? INITIAL_TURNSTILE_STATE : state;
  }
}

export type TurnstileStrings = {
  verify: string;
  wait: string;
  checkingDevice?: string;
  stillChecking: string;
  slow: string;
  retry: string;
  /** Cloudflare is showing its own checkbox and waits for the person to tap it. */
  interactive: string;
  /** An unused token expired; the person taps Verify again. */
  expired: string;
} & Record<TurnstileProblem, string>;

/** What the widget knows besides the lifecycle state: Cloudflare's own checkbox showing, a token that just expired. */
export type TurnstileStatusExtras = { interactive?: boolean; expired?: boolean };

/** The status line under the widget, and whether a Try again button goes with it. */
export function turnstileStatus(
  state: TurnstileState,
  strings: TurnstileStrings,
  extras: TurnstileStatusExtras = {},
): { text: string | null; tone: "info" | "error"; retry: boolean } {
  if (state.phase === "error" && state.problem) return { text: strings[state.problem], tone: "error", retry: true };
  if (state.phase === "checking" && extras.interactive) return { text: strings.interactive, tone: "info", retry: state.slow };
  if (state.phase === "checking" && state.slow) return { text: strings.slow, tone: "info", retry: true };
  if (state.phase === "idle" && extras.expired) return { text: strings.expired, tone: "info", retry: false };
  return { text: null, tone: "info", retry: false };
}

/** Why a submit without a token was held back, in the person's words. */
export function heldSubmitMessage(
  state: TurnstileState,
  strings: TurnstileStrings,
  extras: TurnstileStatusExtras = {},
): string {
  if (state.phase === "error" && state.problem) return strings[state.problem];
  if (state.phase === "checking" && extras.interactive) return strings.interactive;
  if (state.phase === "checking") return strings.stillChecking;
  if (extras.expired) return strings.expired;
  return strings.wait;
}

/**
 * Telemetry reason for a submit held back without a token. Not a failure of the check: `not_started` means the person
 * never tapped Verify (or let a token expire), which the old data could not tell apart from a check that hung.
 */
export function heldSubmitReason(
  state: TurnstileState,
  extras: TurnstileStatusExtras = {},
): "not_started" | "expired" | "checking" | "interactive" | "error" | null {
  if (state.phase === "verified") return null;
  if (state.phase === "error") return "error";
  if (state.phase === "checking") return extras.interactive ? "interactive" : "checking";
  return extras.expired ? "expired" : "not_started";
}

// --- One tapped attempt: the stall clock and what telemetry says about it -------------------------------------------
//
// The stall clock (STALLED_AFTER_MS) only counts time in which Cloudflare's check can actually be making progress:
//  - from the moment execute() first runs, not from the tap (api.js has its own 2x20s budget and its own `blocked`);
//  - while the page is visible (an app in the background has its WebView suspended: the iframe and our timers freeze);
//  - while Cloudflare is NOT waiting for the person to tap its own checkbox (an interactive challenge is waiting on a
//    human, not stalled).
// Coming back from the background leaves at least RESUME_GRACE_MS on the clock; a check hidden RERUN_AFTER_HIDDEN_MS or
// longer is re-run on return (same tap, like the automatic retries), with a fresh clock.

export type TurnstileAttempt = {
  /** The tap. */
  startedAt: number;
  /** When execute() first ran on this attempt; the stall clock starts here. */
  executedAt: number | null;
  /** Stall-clock time banked so far. */
  countedMs: number;
  /** Start of the stretch now being counted; null while the clock is paused (or before execute). */
  countingSince: number | null;
  /** Visible time banked so far (telemetry). */
  visibleMs: number;
  visibleSince: number | null;
  hiddenSince: number | null;
  /** How long the most recent background stretch lasted (0 if never hidden). */
  lastHiddenMs: number;
  everHidden: boolean;
  /** Cloudflare is showing its checkbox right now. */
  interactive: boolean;
  everInteractive: boolean;
  rerunsOnResume: number;
};

export type TurnstileAttemptEvent =
  | { type: "executed"; now: number }
  | { type: "hidden"; now: number }
  | { type: "visible"; now: number }
  | { type: "interactiveStart"; now: number }
  | { type: "interactiveEnd"; now: number }
  | { type: "rerun"; now: number };

function counting(a: Pick<TurnstileAttempt, "executedAt" | "hiddenSince" | "interactive">): boolean {
  return a.executedAt !== null && a.hiddenSince === null && !a.interactive;
}

/** Banks the running stretches up to `now` and restarts them as the new flags say. */
function settle(a: TurnstileAttempt, now: number, next: Partial<TurnstileAttempt>): TurnstileAttempt {
  const countedMs = a.countedMs + (a.countingSince !== null ? Math.max(0, now - a.countingSince) : 0);
  const visibleMs = a.visibleMs + (a.visibleSince !== null ? Math.max(0, now - a.visibleSince) : 0);
  const merged: TurnstileAttempt = { ...a, countedMs, visibleMs, ...next };
  return {
    ...merged,
    countingSince: counting(merged) ? now : null,
    visibleSince: merged.hiddenSince === null ? now : null,
  };
}

export function startAttempt(now: number, visible = true): TurnstileAttempt {
  return {
    startedAt: now,
    executedAt: null,
    countedMs: 0,
    countingSince: null,
    visibleMs: 0,
    visibleSince: visible ? now : null,
    hiddenSince: visible ? null : now,
    lastHiddenMs: 0,
    everHidden: !visible,
    interactive: false,
    everInteractive: false,
    rerunsOnResume: 0,
  };
}

export function nextAttempt(a: TurnstileAttempt, event: TurnstileAttemptEvent): TurnstileAttempt {
  const { now } = event;
  switch (event.type) {
    case "executed":
      // Automatic retries execute again within the same budget: only the first run starts the clock.
      return a.executedAt !== null ? a : settle(a, now, { executedAt: now });
    case "hidden":
      return a.hiddenSince !== null ? a : settle(a, now, { hiddenSince: now, everHidden: true });
    case "visible": {
      if (a.hiddenSince === null) return a;
      const back = settle(a, now, { hiddenSince: null, lastHiddenMs: Math.max(0, now - a.hiddenSince) });
      return { ...back, countedMs: Math.min(back.countedMs, STALLED_AFTER_MS - RESUME_GRACE_MS) };
    }
    case "interactiveStart":
      return a.interactive ? a : settle(a, now, { interactive: true, everInteractive: true });
    case "interactiveEnd":
      return a.interactive ? settle(a, now, { interactive: false }) : a;
    case "rerun": {
      const fresh = settle(a, now, { interactive: false, rerunsOnResume: a.rerunsOnResume + 1, lastHiddenMs: 0 });
      return { ...fresh, countedMs: 0 };
    }
  }
}

/** Milliseconds until the check counts as stalled, or null while the clock is paused (not executed, hidden, waiting on a tap). */
export function stallDelayMs(a: TurnstileAttempt, now: number): number | null {
  if (a.countingSince === null) return null;
  return Math.max(0, STALLED_AFTER_MS - a.countedMs - Math.max(0, now - a.countingSince));
}

/** On return from the background (after RESUME_SETTLE_MS, still no token): re-run the check rather than wait on it? */
export function shouldRerunOnResume(a: TurnstileAttempt): boolean {
  return (
    a.hiddenSince === null &&
    !a.interactive &&
    a.executedAt !== null &&
    a.lastHiddenMs >= RERUN_AFTER_HIDDEN_MS &&
    a.rerunsOnResume < MAX_RERUNS_ON_RESUME
  );
}

/** A stall timer fired: was it simply frozen with a suspended page? `dueAt` is when it was meant to fire. */
export function isSuspendedTimer(dueAt: number, now: number): boolean {
  return now - dueAt > SUSPENDED_TIMER_LATENESS_MS;
}

export type TurnstileStallPhase = "not_executed" | "interactive" | "after_interactive" | "backgrounded_during" | "executing";

/** Where a check was when it was given up on, for `phase_when_stalled`. */
export function stallPhase(a: TurnstileAttempt | null): TurnstileStallPhase {
  if (!a || a.executedAt === null) return "not_executed";
  if (a.interactive) return "interactive";
  if (a.everInteractive) return "after_interactive";
  if (a.everHidden) return "backgrounded_during";
  return "executing";
}

export type TurnstilePlatform = "ios" | "android" | "web";

export function toTurnstilePlatform(platform: string | null | undefined): TurnstilePlatform {
  return platform === "ios" || platform === "android" ? platform : "web";
}

/**
 * The attempt fields every `turnstile_verified` / `turnstile_failed` event carries (no token, no timings finer than a
 * bucket, nothing typed). `widget_loaded`: Cloudflare's iframe was seen loading or answered at all (a token, an
 * error code, an interactive challenge) at any point on this page.
 */
export function attemptTelemetry(
  a: TurnstileAttempt | null,
  now: number,
  context: { platform: TurnstilePlatform; widgetLoaded: boolean },
): {
  platform: TurnstilePlatform;
  visible: string | null;
  hidden_during: boolean;
  interactive: boolean;
  executed: boolean;
  reruns_on_resume: number;
  widget_loaded: boolean;
} {
  const visibleMs = a ? a.visibleMs + (a.visibleSince !== null ? Math.max(0, now - a.visibleSince) : 0) : null;
  return {
    platform: context.platform,
    visible: visibleMs === null ? null : durationBucket(visibleMs),
    hidden_during: a?.everHidden ?? false,
    interactive: a?.everInteractive ?? false,
    executed: a ? a.executedAt !== null : false,
    reruns_on_resume: a?.rerunsOnResume ?? 0,
    widget_loaded: context.widgetLoaded,
  };
}

/** Coarse duration bucket for telemetry: no exact timings needed to see "slow networks" in aggregate. */
export function durationBucket(ms: number): string {
  if (ms < 3_000) return "<3s";
  if (ms < 8_000) return "3-8s";
  if (ms < 20_000) return "8-20s";
  if (ms < 60_000) return "20-60s";
  return ">60s";
}
