"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { TURNSTILE_ORIGIN } from "@/lib/turnstile-shared";
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
      callback?: (token: string) => void;
      "error-callback"?: (errorCode?: string) => boolean | void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
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

// How long after the tap a submit is held back waiting for a token before
// the widget stops standing in the way — see the "give up" note below.
const GIVE_UP_AFTER_MS = 10_000;

// Cloudflare's own codes for the languages the account screens come in.
const WIDGET_LANGUAGES: Record<Locale, string> = { en: "en", es: "es", fr: "fr", pt: "pt-br", ar: "ar" };

let scriptPromise: Promise<void> | null = null;

// Loaded once per page, on demand. Appended from a script that already
// carries the CSP nonce, so 'strict-dynamic' (src/proxy.ts) lets it load.
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null; // let a later mount retry
        reject(new Error("Turnstile script failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Cloudflare Turnstile bot check, gated on a real tap. Renders nothing at all
 * until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (see src/lib/turnstile.ts).
 *
 * Nothing is checked on page load: the widget is rendered with Cloudflare's
 * `execution: "execute"`, so no challenge runs — and no token exists — until
 * the person taps "Verify you're human". Only then does Cloudflare run (and
 * show its own checkbox if it decides it wants one). Every token is
 * single-use, so once it's spent or expires the button comes back and the
 * next attempt needs another tap.
 *
 * Two ways to consume the token:
 *  - Inside a <form>: Cloudflare writes it into a hidden
 *    `cf-turnstile-response` input, so a server-action form needs nothing
 *    else. This component also guards that form: a submit with no token yet
 *    is held back with `strings.wait` instead of reaching the server just to
 *    be rejected.
 *  - Outside a form (ad-booking-form.tsx builds its own FormData): pass
 *    `onToken`, which fires with the token, and with null once it's spent or
 *    expired; `onGiveUp` fires if none arrives (see below).
 *
 * The server is the ONLY thing that enforces (src/lib/turnstile.ts). This
 * client guard exists purely to spare people a wasted round trip, so it must
 * never be able to lock anyone out by itself: if no token has arrived
 * GIVE_UP_AFTER_MS after the tap, or the widget reports an error (script
 * blocked, bad hostname config, network), it stops holding submits back and
 * lets them through. If the server is enforcing, it rejects the tokenless
 * submit with a clear message; if it isn't (only the site key is configured),
 * sign-in just works. Without this, a half-configured deploy — site key baked
 * into the client bundle, secret not set — would block every sign-in in the
 * browser while enforcing nothing on the server.
 */
export function TurnstileWidget({
  onToken,
  onGiveUp,
  resetSignal = 0,
  className,
  locale,
  strings = sharedEn.turnstile,
}: {
  onToken?: (token: string | null) => void;
  /** Called when no token arrived in time after the tap, or the widget errored — stop waiting for one. */
  onGiveUp?: () => void;
  /** Bump this to discard the current token; the next attempt needs a fresh tap. */
  resetSignal?: number;
  className?: string;
  /**
   * The language of the widget's own text, on the account screens. Left out everywhere else, where Cloudflare goes
   * by the browser's language as it always has.
   */
  locale?: Locale;
  /** The button label, and the notice shown when a submit is held back, in that same language. */
  strings?: { verify: string; wait: string };
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  // True once we've stopped waiting for a token (timeout or widget error).
  // A ref, not state: handleSubmit below is a native listener created once
  // per mount, so it has to read the *current* value when a submit arrives.
  const gaveUpRef = useRef(false);
  const onTokenRef = useRef(onToken);
  const onGiveUpRef = useRef(onGiveUp);
  const waitMessageRef = useRef(strings.wait);
  // Lets the button and the resetSignal effect reach the mount effect's own helpers.
  const startCheckRef = useRef<(() => void) | null>(null);
  const discardTokenRef = useRef<(() => void) | null>(null);
  // "idle": waiting for the tap. "checking": tapped — Cloudflare's widget is
  // running or has passed. "off": gave up on the widget (error / script blocked).
  const [phase, setPhase] = useState<"idle" | "checking" | "off">("idle");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    onTokenRef.current = onToken;
    onGiveUpRef.current = onGiveUp;
    waitMessageRef.current = strings.wait;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!siteKey || !container) return undefined;

    let cancelled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    // Tapped before the script finished loading — run as soon as it renders.
    let executeWhenRendered = false;

    function giveUp() {
      clearTimeout(graceTimer);
      if (cancelled || tokenRef.current) return;
      gaveUpRef.current = true;
      setNotice(null);
      setPhase("off");
      onGiveUpRef.current?.();
    }

    function setToken(token: string) {
      tokenRef.current = token;
      onTokenRef.current?.(token);
      clearTimeout(graceTimer);
      gaveUpRef.current = false;
      setNotice(null);
    }

    // Spent, expired or timed-out token: drop it and wait for another tap.
    function discardToken() {
      clearTimeout(graceTimer);
      executeWhenRendered = false;
      tokenRef.current = null;
      onTokenRef.current?.(null);
      gaveUpRef.current = false;
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
      setPhase("idle");
    }
    discardTokenRef.current = discardToken;

    // The tap: only now does Cloudflare run its check.
    function startCheck() {
      setNotice(null);
      setPhase("checking");
      clearTimeout(graceTimer);
      gaveUpRef.current = false;
      graceTimer = setTimeout(giveUp, GIVE_UP_AFTER_MS);
      if (widgetIdRef.current) window.turnstile?.execute(widgetIdRef.current);
      else executeWhenRendered = true;
    }
    startCheckRef.current = startCheck;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile || !container) return;
        const widgetId = window.turnstile.render(container, {
          sitekey: siteKey,
          theme: "auto",
          size: "flexible",
          appearance: "execute",
          execution: "execute",
          ...(locale ? { language: WIDGET_LANGUAGES[locale] } : {}),
          callback: (token) => setToken(token),
          "expired-callback": () => discardToken(),
          "timeout-callback": () => discardToken(),
          "error-callback": () => {
            tokenRef.current = null;
            onTokenRef.current?.(null);
            giveUp();
          },
        });
        widgetIdRef.current = widgetId;
        if (executeWhenRendered) {
          executeWhenRendered = false;
          window.turnstile.execute(widgetId);
        }
      })
      .catch(() => giveUp());

    const form = container.closest("form");
    function handleSubmit(e: Event) {
      if (!tokenRef.current) {
        if (!gaveUpRef.current) {
          e.preventDefault();
          setNotice(waitMessageRef.current);
        }
        // else: we've stopped waiting — let the server decide.
        return;
      }
      // Deferred so the form's FormData is captured with this token first;
      // then drop it (it's spent) so the next attempt needs a fresh tap.
      setTimeout(discardToken, 0);
    }
    form?.addEventListener("submit", handleSubmit);

    return () => {
      cancelled = true;
      clearTimeout(graceTimer);
      startCheckRef.current = null;
      discardTokenRef.current = null;
      form?.removeEventListener("submit", handleSubmit);
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      tokenRef.current = null;
    };
  }, [siteKey, locale]);

  // Non-form consumers drop a spent token by bumping resetSignal.
  const firstResetSignal = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === firstResetSignal.current) return;
    discardTokenRef.current?.();
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <div className={className}>
      {phase === "idle" && (
        <button
          type="button"
          onClick={() => startCheckRef.current?.()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent"
        >
          <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
          {strings.verify}
        </button>
      )}
      <div ref={containerRef} className="flex justify-center" />
      {notice && (
        <p role="status" className="mt-2 text-center text-xs text-danger">
          {notice}
        </p>
      )}
    </div>
  );
}
