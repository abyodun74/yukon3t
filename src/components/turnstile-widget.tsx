"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RotateCw, ShieldCheck } from "lucide-react";
import { TURNSTILE_ORIGIN } from "@/lib/turnstile-shared";
import {
  INITIAL_TURNSTILE_STATE,
  RESUME_SETTLE_MS,
  SCRIPT_LOAD_ATTEMPTS,
  SCRIPT_RETRY_DELAY_MS,
  SCRIPT_TIMEOUT_MS,
  SLOW_AFTER_MS,
  attemptTelemetry,
  autoRetryDelay,
  durationBucket,
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
  type TurnstileAttempt,
  type TurnstileAttemptEvent,
  type TurnstileEvent,
  type TurnstileProblem,
  type TurnstileState,
  type TurnstileStatusExtras,
  type TurnstileStrings,
} from "@/lib/turnstile-lifecycle";
import { APP_ATTEST_FIELD, APP_META_FIELD, appAttestMode } from "@/lib/app-attest-shared";
import {
  appPlatform,
  basicAppMeta,
  canAttest,
  getAppMeta,
  getAttestationToken,
  isNativeApp,
  noteAttestationPending,
  noteLateAttestation,
  withAttestReason,
} from "@/lib/app-attest-client";
import { capturePostHogEvent } from "@/lib/posthog-client";
import { captureError } from "@/lib/error-tracking";
import { sharedEn } from "@/lib/i18n/en/shared";
import type { Locale } from "@/lib/i18n/locales";

// The subset of Cloudflare's explicit-render API this component uses.
type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
      appearance?: "always" | "execute" | "interaction-only";
      execution?: "render" | "execute";
      language?: string;
      retry?: "auto" | "never";
      "refresh-expired"?: "auto" | "manual" | "never";
      "refresh-timeout"?: "auto" | "manual" | "never";
      callback?: (token: string) => void;
      "error-callback"?: (errorCode?: string) => boolean | void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      "before-interactive-callback"?: () => void;
      "after-interactive-callback"?: () => void;
      "unsupported-callback"?: () => void;
    },
  ) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Cloudflare's own codes for the languages the account screens come in (its "Supported languages" list). Turnstile has
// no Swahili, so a Swahili reader gets the widget in English.
const WIDGET_LANGUAGES: Record<Locale, string> = {
  en: "en",
  es: "es",
  fr: "fr",
  pt: "pt-br",
  ar: "ar",
  de: "de",
  it: "it",
  hi: "hi",
  sw: "en",
};

const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

let scriptPromise: Promise<void> | null = null;

const subscribeToNothing = () => () => {};

// One attempt at downloading api.js, capped at SCRIPT_TIMEOUT_MS. Appended from a script that already carries the
// CSP nonce, so 'strict-dynamic' (src/proxy.ts) lets it load.
function appendScriptOnce(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (loaded && window.turnstile) {
        resolve();
      } else {
        script.remove();
        reject(new Error("Turnstile script failed to load"));
      }
    };
    const timer = setTimeout(() => finish(false), SCRIPT_TIMEOUT_MS);
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });
}

// Loaded once per page (shared by every widget on it), with one automatic retry. A failed load is forgotten so the
// next "Try again" downloads it afresh.
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await appendScriptOnce();
        return;
      } catch (err) {
        if (window.turnstile) return; // a timed-out attempt finished late
        if (attempt >= SCRIPT_LOAD_ATTEMPTS) throw err;
        await new Promise((resolve) => setTimeout(resolve, SCRIPT_RETRY_DELAY_MS));
      }
    }
  })().catch((err: unknown) => {
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

/**
 * Cloudflare Turnstile bot check, gated on a real tap. Renders nothing at all until NEXT_PUBLIC_TURNSTILE_SITE_KEY is
 * set (see src/lib/turnstile.ts). Every Turnstile-gated screen uses this one component (sign-in password + email link,
 * sign-up, Apple, forgot password, verify email/device, /try, phone verification via useTurnstileGate, ad booking).
 *
 * Nothing is checked on page load (api.js is only downloaded, so the tap is quick): the widget is rendered with
 * `execution: "execute"`, and the check runs when the person taps "Verify you're human". Lifecycle rules live in
 * src/lib/turnstile-lifecycle.ts:
 *  - api.js gets two download attempts of 20s each; if it never loads (content blocker, Private DNS, VPN, ISP), the
 *    person is told exactly that, with a Try again button.
 *  - Cloudflare's own retry is off (`retry: "never"`): its "auto" retry loops forever, which is what showed people an
 *    endless "Verifying…". Instead a retriable error is re-run here at most twice (2s, 5s), then shown.
 *  - After 8s without a token: "Still verifying… can take up to a minute on a slow connection" + Try again.
 *    After 60s of time the check could actually run (from execute(), page visible, Cloudflare not waiting on its own
 *    checkbox): stop, and say what to try. The app going to the background pauses that clock; coming back leaves at
 *    least 10s, and a check hidden 15s or more is re-run (same tap). See the stall clock in turnstile-lifecycle.ts.
 *  - Cloudflare's own checkbox (an interactive challenge) is scrolled into view with "Tap the checkbox above".
 *  - A timed-out interactive challenge is refreshed by Cloudflare itself (`refresh-timeout: "auto"`). An unused token
 *    that expires (~300s) is NOT re-run (`refresh-expired: "never"`): back to the button with "expired, tap again",
 *    so the check only ever runs after a tap.
 *  - Config errors (unknown hostname 110200, bad site key) and unsupported browsers get their own message and are
 *    reported (Sentry for config, PostHog `turnstile_failed` for everything; `turnstile_verified` with a duration
 *    bucket for the success rate; both with platform / visible time / background / interactive / widget_loaded).
 *    `turnstile_incomplete` (not a failure) records a submit held before any tap (`not_started`), an expired token,
 *    and leaving the page mid-check.
 *
 * Two ways to consume the token:
 *  - Inside a <form>: Cloudflare writes it into a hidden `cf-turnstile-response` input, so a server-action form needs
 *    nothing else. This component also guards that form: a submit with no token is held back with a sentence saying
 *    why (not tapped yet / still running / what failed), instead of reaching the server just to be rejected.
 *  - Outside a form (useTurnstileGate, ad-booking-form.tsx): pass `onToken`, which fires with the token, and with null
 *    once it's spent or expired; `onStateChange` reports the lifecycle so the caller can explain a hold-back too.
 *
 * The server is the only thing that enforces (src/lib/turnstile.ts); a tokenless submit never gets through it. Note
 * this means a site key set WITHOUT the secret (server not enforcing) plus a widget that can't produce a token would
 * hold submits back in the browser; turnstile.ts logs that half-configuration loudly at startup.
 *
 * Device attestation (in-form mode only, native app only — see docs/plans/app-attestation.md and
 * src/lib/bot-gate.ts): every native submit carries `yk-app-meta`. With NEXT_PUBLIC_APP_ATTEST_MODE=observe and the
 * attestation plugin present, the tap also fetches a single-use App Check token that rides along if it's ready by
 * submit. With "enforce", there is no button: a submit is held while a token is fetched, then re-submitted with it; if
 * no token comes back the button appears and the person taps it as on the web. Renders nothing until mounted, since
 * the server can't know it's in the app.
 */
export function TurnstileWidget({
  onToken,
  onStateChange,
  resetSignal = 0,
  className,
  locale,
  strings = sharedEn.turnstile,
  attest = true,
}: {
  onToken?: (token: string | null) => void;
  /** Every lifecycle change (see turnstile-lifecycle.ts) — for callers outside a form that hold submits themselves. */
  onStateChange?: (state: TurnstileState) => void;
  /** Bump this to discard the current token; the next attempt needs a fresh tap. */
  resetSignal?: number;
  className?: string;
  /**
   * The language of the widget's own text, on the account screens. Left out everywhere else, where Cloudflare goes
   * by the browser's language as it always has.
   */
  locale?: Locale;
  /** The button labels and status sentences, in that same language (`shared.turnstile`). */
  strings?: TurnstileStrings;
  /** False for consumers that handle (or skip) device attestation themselves — every non-form consumer. */
  attest?: boolean;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  // The lifecycle state, as a ref too: handleSubmit below is a native listener created once per mount, so it has to
  // read the *current* value when a submit arrives.
  const stateRef = useRef<TurnstileState>(INITIAL_TURNSTILE_STATE);
  const [state, setState] = useState<TurnstileState>(INITIAL_TURNSTILE_STATE);
  const onTokenRef = useRef(onToken);
  const onStateChangeRef = useRef(onStateChange);
  const stringsRef = useRef(strings);
  // Lets the buttons and the resetSignal effect reach the mount effect's own helpers.
  const startCheckRef = useRef<(() => void) | null>(null);
  const discardTokenRef = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Cloudflare's checkbox showing / an unused token that just expired (status line and held-submit sentence).
  const [extras, setExtras] = useState<TurnstileStatusExtras>({});
  const extrasRef = useRef<TurnstileStatusExtras>({});

  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const native = useSyncExternalStore(subscribeToNothing, isNativeApp, () => false);
  const attestCapable = useSyncExternalStore(subscribeToNothing, canAttest, () => false);
  // Set once attestation failed on this page: the Turnstile button takes over.
  const [attestFailed, setAttestFailed] = useState(false);
  const attesting = attest && appAttestMode() === "enforce" && attestCapable && !attestFailed;
  const attestingRef = useRef(attesting);
  const metaInputRef = useRef<HTMLInputElement>(null);
  const attestInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onTokenRef.current = onToken;
    onStateChangeRef.current = onStateChange;
    stringsRef.current = strings;
    attestingRef.current = attesting;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!siteKey || !container) return undefined;

    let cancelled = false;
    const observing = attest && appAttestMode() === "observe";
    // Observe mode: a token fetched on the tap, sent with the next submit if ready.
    let observedToken: string | null = null;
    // Diagnostic only: a token fetch still running / resolving after the submit.
    let observePending = false;
    let submittedWhilePending = false;
    // Enforce mode: a token fetch already under way (started on first focus or on submit).
    let pendingAttestation: Promise<string | null> | null = null;
    let attestInFlight = false;
    let metaValue: string | null = null;
    if (attest) void getAppMeta()?.then((meta) => (metaValue = meta));

    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let stalledTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    let startedAt = 0;
    // Whether execute() has run on this widget since it was rendered: later runs reset it first.
    let executed = false;
    let widgetPromise: Promise<string | null> | null = null;
    // The current tap's stall clock and telemetry (turnstile-lifecycle.ts); null before the first tap.
    let attempt: TurnstileAttempt | null = null;
    // Cloudflare's iframe was seen loading, or answered at all, on this page (telemetry only).
    let widgetLoaded = false;
    // Held-submit telemetry is capped per mount.
    let heldReports = 0;

    function setExtrasNow(next: TurnstileStatusExtras) {
      extrasRef.current = next;
      if (!cancelled) setExtras(next);
    }

    function clearTimers() {
      clearTimeout(slowTimer);
      clearTimeout(stalledTimer);
      clearTimeout(retryTimer);
      clearTimeout(resumeTimer);
    }

    function platform() {
      return toTurnstilePlatform(appPlatform());
    }

    function capture(event: string, props: Record<string, string | number | boolean | null>) {
      try {
        capturePostHogEvent(event, props);
      } catch {
        // Telemetry never affects the check.
      }
    }

    function apply(event: TurnstileEvent): { prev: TurnstileState; next: TurnstileState } {
      const prev = stateRef.current;
      const next = nextTurnstileState(prev, event);
      if (next !== prev && !cancelled) {
        stateRef.current = next;
        setState(next);
        setNotice(null);
        onStateChangeRef.current?.(next);
      }
      return { prev, next };
    }

    function report(problem: TurnstileProblem, code: string | null) {
      clearTimers();
      try {
        capturePostHogEvent("turnstile_failed", {
          reason: problem,
          code,
          retries: stateRef.current.autoRetries,
          duration: startedAt ? durationBucket(Date.now() - startedAt) : null,
          native: isNativeApp(),
          online: navigator.onLine,
          path: window.location.pathname,
          phase_when_stalled: problem === "stalled" ? stallPhase(attempt) : null,
          ...attemptTelemetry(attempt, Date.now(), { platform: platform(), widgetLoaded }),
        });
        // Our own setup is wrong (e.g. 110200: this hostname isn't on the site key's allowed list): owner action.
        if (problem === "config") {
          void captureError(new Error(`Turnstile widget configuration error ${code ?? ""}`.trim()), {
            code,
            hostname: window.location.hostname,
          });
        }
      } catch {
        // Telemetry never affects the check.
      }
    }

    // Feeds the attempt's stall clock and re-arms (or pauses) the stall timer to match.
    function updateAttempt(event: TurnstileAttemptEvent) {
      if (!attempt) return;
      attempt = nextAttempt(attempt, event);
      scheduleStall();
    }

    function scheduleStall() {
      clearTimeout(stalledTimer);
      if (cancelled || !attempt || stateRef.current.phase !== "checking") return;
      const now = Date.now();
      const delay = stallDelayMs(attempt, now);
      if (delay === null) return; // paused: not executed yet, in the background, or waiting on Cloudflare's checkbox
      const dueAt = now + delay;
      stalledTimer = setTimeout(() => onStallTimer(dueAt), delay);
    }

    function onStallTimer(dueAt: number) {
      if (cancelled || !attempt || stateRef.current.phase !== "checking") return;
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        updateAttempt({ type: "hidden", now });
        return;
      }
      if (isSuspendedTimer(dueAt, now)) {
        // Frozen with a suspended app and no visibilitychange reached us: a return from the background, not a stall.
        attempt = nextAttempt(attempt, { type: "hidden", now: dueAt });
        onVisible(now);
        return;
      }
      const remaining = stallDelayMs(attempt, now);
      if (remaining === null || remaining > 0) {
        scheduleStall();
        return;
      }
      const { next } = apply({ type: "stalled" });
      if (next.phase === "error") {
        resetWidget();
        report("stalled", null);
      }
    }

    // Back in the foreground mid-check: the clock resumes with at least RESUME_GRACE_MS left, and a check hidden long
    // enough is re-run once things settle (unless a token or Cloudflare's checkbox turned up meanwhile).
    function onVisible(now: number) {
      updateAttempt({ type: "visible", now });
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (cancelled || !attempt || stateRef.current.phase !== "checking") return;
        if (!shouldRerunOnResume(attempt)) return;
        updateAttempt({ type: "rerun", now: Date.now() });
        setExtrasNow({});
        runWidget();
      }, RESUME_SETTLE_MS);
    }

    function handleVisibilityChange() {
      if (!attempt || stateRef.current.phase !== "checking") return;
      if (document.visibilityState === "hidden") {
        clearTimeout(resumeTimer);
        updateAttempt({ type: "hidden", now: Date.now() });
      } else {
        onVisible(Date.now());
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cloudflare's iframe finishing its load (load doesn't bubble, but a capturing listener on an ancestor sees it).
    function handleFrameLoad(e: Event) {
      if ((e.target as Element | null)?.tagName === "IFRAME") widgetLoaded = true;
    }
    container.addEventListener("load", handleFrameLoad, true);

    function armTimers() {
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => apply({ type: "slow" }), SLOW_AFTER_MS);
      scheduleStall();
    }

    function resetWidget() {
      const id = widgetIdRef.current;
      if (!id) return;
      try {
        window.turnstile?.reset(id);
      } catch {
        // A widget Cloudflare already tore down: nothing to reset.
      }
    }

    function fail(problem: TurnstileProblem, code: string | null) {
      resetWidget();
      report(problem, code);
    }

    function onWidgetError(code: string | null) {
      tokenRef.current = null;
      onTokenRef.current?.(null);
      const { prev, next } = apply({ type: "error", code });
      if (next.autoRetries > prev.autoRetries) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (!cancelled && stateRef.current.phase === "checking") runWidget();
        }, autoRetryDelay(prev.autoRetries) ?? 0);
      } else if (next.phase === "error" && prev.phase !== "error" && next.problem) {
        fail(next.problem, code);
      }
    }

    function renderWidget(): string | null {
      if (cancelled || !window.turnstile || !container) return null;
      if (widgetIdRef.current) return widgetIdRef.current;
      const widgetId = window.turnstile.render(container, {
        sitekey: siteKey!,
        theme: "auto",
        size: "flexible",
        appearance: "execute",
        execution: "execute",
        retry: "never",
        // An expired, unused token is not re-run behind the person's back: the check only runs after a tap.
        "refresh-expired": "never",
        "refresh-timeout": "auto",
        ...(locale ? { language: WIDGET_LANGUAGES[locale] } : {}),
        callback: (token) => {
          if (cancelled) return;
          widgetLoaded = true;
          tokenRef.current = token;
          onTokenRef.current?.(token);
          clearTimers();
          const { prev } = apply({ type: "token" });
          setExtrasNow({});
          if (prev.phase === "checking") {
            capture("turnstile_verified", {
              duration: durationBucket(Date.now() - startedAt),
              retries: prev.autoRetries,
              native: isNativeApp(),
              ...attemptTelemetry(attempt, Date.now(), { platform: platform(), widgetLoaded }),
            });
          }
        },
        "error-callback": (code) => {
          if (cancelled) return true;
          if (code) widgetLoaded = true;
          if (extrasRef.current.interactive) {
            updateAttempt({ type: "interactiveEnd", now: Date.now() });
            setExtrasNow({});
          }
          onWidgetError(code ?? null);
          return true; // handled here: no retry loop of Cloudflare's own
        },
        // ~300s after it was issued, unused: back to the button (refresh-expired "never").
        "expired-callback": () => {
          if (cancelled) return;
          tokenRef.current = null;
          onTokenRef.current?.(null);
          const { prev, next } = apply({ type: "expired" });
          if (prev.phase === "verified" && next.phase === "idle") {
            clearTimers();
            resetWidget();
            attempt = null;
            setExtrasNow({ expired: true });
            capture("turnstile_incomplete", {
              reason: "expired",
              native: isNativeApp(),
              platform: platform(),
              path: window.location.pathname,
            });
          }
        },
        // An interactive challenge nobody answered in time: Cloudflare re-runs it (refresh-timeout "auto").
        "timeout-callback": () => {
          if (cancelled) return;
          tokenRef.current = null;
          onTokenRef.current?.(null);
          apply({ type: "refreshing" });
        },
        // Cloudflare wants a tap on its own checkbox: that waits on the person, so the stall clock pauses, and the
        // checkbox is brought into view (it can sit under the keyboard or below the fold on a phone).
        "before-interactive-callback": () => {
          if (cancelled) return;
          widgetLoaded = true;
          updateAttempt({ type: "interactiveStart", now: Date.now() });
          setExtrasNow({ interactive: true });
          try {
            container.scrollIntoView({ block: "center" });
          } catch {
            // Best effort.
          }
        },
        "after-interactive-callback": () => {
          if (cancelled) return;
          updateAttempt({ type: "interactiveEnd", now: Date.now() });
          setExtrasNow({});
        },
        "unsupported-callback": () => {
          if (!cancelled) onWidgetError("110500");
        },
      });
      widgetIdRef.current = widgetId;
      executed = false;
      return widgetId;
    }

    // Downloads api.js if needed and renders the (not yet running) widget. Shared by the page-load preload and the tap.
    function ensureWidget(): Promise<string | null> {
      if (widgetIdRef.current) return Promise.resolve(widgetIdRef.current);
      widgetPromise ??= loadTurnstileScript()
        .then(renderWidget)
        .finally(() => {
          widgetPromise = null;
        });
      return widgetPromise;
    }

    // Runs (or re-runs) the check on the rendered widget.
    function runWidget() {
      ensureWidget()
        .then((widgetId) => {
          if (cancelled || !widgetId || stateRef.current.phase !== "checking") return;
          try {
            if (executed) window.turnstile!.reset(widgetId);
            window.turnstile!.execute(widgetId);
            executed = true;
            updateAttempt({ type: "executed", now: Date.now() });
          } catch {
            onWidgetError(null);
          }
        })
        .catch(() => {
          if (cancelled || stateRef.current.phase !== "checking") return;
          const { next } = apply({ type: "scriptFailed" });
          if (next.phase === "error") report("blocked", null);
        });
    }

    // Spent token (or a non-form consumer's reset): drop it and wait for another tap.
    function discardToken() {
      clearTimers();
      tokenRef.current = null;
      onTokenRef.current?.(null);
      resetWidget();
      attempt = null;
      apply({ type: "spent" });
      setExtrasNow({});
    }
    discardTokenRef.current = discardToken;

    // The tap ("Verify you're human" or "Try again"): only now does Cloudflare run its check.
    function startCheck() {
      if (observing && canAttest()) {
        const attestStartedAt = Date.now();
        observePending = true;
        submittedWhilePending = false;
        void getAttestationToken().then((token) => {
          observePending = false;
          if (cancelled) return;
          observedToken = token;
          if (token && submittedWhilePending) noteLateAttestation(Date.now() - attestStartedAt);
        });
      }
      clearTimers();
      tokenRef.current = null;
      startedAt = Date.now();
      attempt = startAttempt(startedAt, document.visibilityState !== "hidden");
      apply({ type: "start" });
      setNotice(null);
      setExtrasNow({});
      armTimers();
      runWidget();
    }
    startCheckRef.current = startCheck;

    // Preload: download api.js and render the idle widget now, so the tap doesn't wait for it. A failure here
    // is silent; the tap retries the download and reports it then.
    ensureWidget().catch(() => {});

    function switchToTurnstile() {
      attestingRef.current = false;
      setAttestFailed(true);
      setNotice(stringsRef.current.wait);
    }

    // Single-use: deferred so the form's FormData is captured with it first.
    function spendAttestToken(input: HTMLInputElement) {
      setTimeout(() => {
        input.value = "";
      }, 0);
    }

    const form = container.closest("form");

    function handleFocus() {
      if (attestingRef.current && !pendingAttestation && canAttest()) pendingAttestation = getAttestationToken();
    }

    function handleSubmit(e: Event) {
      if (observePending) {
        submittedWhilePending = true;
        noteAttestationPending();
      }
      if (metaInputRef.current) metaInputRef.current.value = withAttestReason(metaValue ?? basicAppMeta()) ?? "";

      const attestInput = attestInputRef.current;
      if (attestingRef.current && attestInput && form) {
        if (attestInput.value) {
          spendAttestToken(attestInput);
          return;
        }
        e.preventDefault();
        if (attestInFlight) return;
        if (!canAttest()) {
          // The server turned down an earlier token and set the fallback cookie.
          switchToTurnstile();
          return;
        }
        attestInFlight = true;
        const submitter = (e as SubmitEvent).submitter;
        const attestation = pendingAttestation ?? getAttestationToken();
        pendingAttestation = null;
        void attestation.then((token) => {
          attestInFlight = false;
          if (cancelled) return;
          if (!token) {
            switchToTurnstile();
            return;
          }
          attestInput.value = token;
          try {
            form.requestSubmit(submitter);
          } catch {
            form.requestSubmit();
          }
        });
        return;
      }

      if (!tokenRef.current) {
        // Never sent without a token: the server would only reject it. Say why instead.
        e.preventDefault();
        setNotice(heldSubmitMessage(stateRef.current, stringsRef.current, extrasRef.current));
        const reason = heldSubmitReason(stateRef.current, extrasRef.current);
        if (reason && heldReports < 3) {
          heldReports++;
          capture("turnstile_incomplete", {
            reason: reason === "not_started" ? "not_started" : `submitted_while_${reason}`,
            native: isNativeApp(),
            platform: platform(),
            path: window.location.pathname,
          });
        }
        return;
      }
      if (observedToken && attestInput) {
        attestInput.value = observedToken;
        observedToken = null;
        spendAttestToken(attestInput);
      }
      // Deferred so the form's FormData is captured with this token first;
      // then drop it (it's spent) so the next attempt needs a fresh tap.
      setTimeout(discardToken, 0);
    }
    form?.addEventListener("submit", handleSubmit);
    form?.addEventListener("focusin", handleFocus);

    return () => {
      // Left the page (or the widget remounted) while a check was still running: not a failure of the check.
      if (attempt && stateRef.current.phase === "checking") {
        capture("turnstile_incomplete", {
          reason: "left_during_check",
          phase_when_stalled: stallPhase(attempt),
          native: isNativeApp(),
          path: window.location.pathname,
          ...attemptTelemetry(attempt, Date.now(), { platform: platform(), widgetLoaded }),
        });
      }
      cancelled = true;
      clearTimers();
      startCheckRef.current = null;
      discardTokenRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      container.removeEventListener("load", handleFrameLoad, true);
      form?.removeEventListener("submit", handleSubmit);
      form?.removeEventListener("focusin", handleFocus);
      if (widgetIdRef.current) {
        try {
          window.turnstile?.remove(widgetIdRef.current);
        } catch {
          // Already gone.
        }
        widgetIdRef.current = null;
      }
      tokenRef.current = null;
      // A remount (locale change, Strict Mode) starts from the button again.
      stateRef.current = INITIAL_TURNSTILE_STATE;
      setState(INITIAL_TURNSTILE_STATE);
      extrasRef.current = {};
      setExtras({});
    };
  }, [siteKey, locale, mounted, attest]);

  // Non-form consumers drop a spent token by bumping resetSignal.
  const firstResetSignal = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === firstResetSignal.current) return;
    discardTokenRef.current?.();
  }, [resetSignal]);

  if (!siteKey || !mounted) return null;

  const status = turnstileStatus(state, strings, extras);
  const message = notice ?? status.text;
  const isError = Boolean(notice) || status.tone === "error";

  return (
    <div className={className}>
      <div className="w-full">
        {attest && native && <input ref={metaInputRef} type="hidden" name={APP_META_FIELD} defaultValue="" />}
        {attest && attestCapable && <input ref={attestInputRef} type="hidden" name={APP_ATTEST_FIELD} defaultValue="" />}
        {attesting ? (
          <p role="status" className="text-center text-xs text-foreground-soft">
            {strings.checkingDevice ?? sharedEn.turnstile.checkingDevice}
          </p>
        ) : (
          state.phase === "idle" && (
            <button
              type="button"
              onClick={() => startCheckRef.current?.()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent"
            >
              <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
              {strings.verify}
            </button>
          )
        )}
        <div ref={containerRef} className="flex justify-center" />
        {message && (
          <p
            role={isError ? "alert" : "status"}
            className={`mt-2 text-center text-xs ${isError ? "text-danger" : "text-foreground-soft"}`}
          >
            {message}
          </p>
        )}
        {status.retry && !attesting && (
          <button
            type="button"
            onClick={() => startCheckRef.current?.()}
            className="mx-auto mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            {strings.retry}
          </button>
        )}
      </div>
    </div>
  );
}
