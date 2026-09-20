"use client";

import { useEffect, useRef, useState } from "react";
import { TURNSTILE_ORIGIN } from "@/lib/turnstile-shared";

// The subset of Cloudflare's explicit-render API this component uses.
type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
      appearance?: "always" | "execute" | "interaction-only";
      callback?: (token: string) => void;
      "error-callback"?: (errorCode?: string) => boolean | void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// How long a submit is held back waiting for a token before the widget
// stops standing in the way — see the "give up" note on TurnstileWidget.
const GIVE_UP_AFTER_MS = 10_000;

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
 * Cloudflare Turnstile bot check. Renders nothing at all until
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (see src/lib/turnstile.ts), and is
 * invisible for most real users — the widget only shows itself when
 * Cloudflare decides it needs an interactive challenge.
 *
 * Two ways to consume the token:
 *  - Inside a <form>: Cloudflare writes it into a hidden
 *    `cf-turnstile-response` input, so a server-action form needs nothing
 *    else. This component also guards that form: a submit that arrives
 *    while the token is still on its way is held back with a message
 *    instead of reaching the server just to be rejected.
 *  - Outside a form (ad-booking-form.tsx builds its own FormData): pass
 *    `onToken`, which fires with the token, and with null once it's spent or
 *    expired; `onGiveUp` fires if none arrives (see below).
 *
 * The server is the ONLY thing that enforces (src/lib/turnstile.ts). This
 * client guard exists purely to spare people a wasted round trip, so it must
 * never be able to lock anyone out by itself: if no token has arrived after
 * GIVE_UP_AFTER_MS, or the widget reports an error (script blocked, bad
 * hostname config, network), it stops holding submits back and lets them
 * through. If the server is enforcing, it rejects the tokenless submit with
 * a clear message; if it isn't (only the site key is configured), sign-in
 * just works. Without this, a half-configured deploy — site key baked into
 * the client bundle, secret not set — would block every sign-in in the
 * browser while enforcing nothing on the server.
 *
 * A token is single-use and is consumed by the server-side check whether or
 * not the action then succeeds, so after every submit — and after any
 * `resetSignal` change, for the non-form case — the widget fetches a fresh
 * one. Without that, a second wrong-password attempt on the same page would
 * resubmit an already-spent token and be rejected as a bot.
 */
export function TurnstileWidget({
  onToken,
  onGiveUp,
  resetSignal = 0,
  className,
}: {
  onToken?: (token: string | null) => void;
  /** Called when no token arrived in time, or the widget errored — stop waiting for one. */
  onGiveUp?: () => void;
  /** Bump this to discard the current token and get a fresh one. */
  resetSignal?: number;
  className?: string;
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
  // Lets the resetSignal effect below reach the mount effect's own helper.
  const discardTokenRef = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    onTokenRef.current = onToken;
    onGiveUpRef.current = onGiveUp;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!siteKey || !container) return undefined;

    let cancelled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    function giveUp() {
      clearTimeout(graceTimer);
      if (cancelled || tokenRef.current) return;
      gaveUpRef.current = true;
      setNotice(null);
      onGiveUpRef.current?.();
    }

    // Start (or restart) the clock on waiting for a token.
    function armGrace() {
      clearTimeout(graceTimer);
      gaveUpRef.current = false;
      graceTimer = setTimeout(giveUp, GIVE_UP_AFTER_MS);
    }

    function setToken(token: string | null) {
      tokenRef.current = token;
      onTokenRef.current?.(token);
      if (token) {
        clearTimeout(graceTimer);
        gaveUpRef.current = false;
        setNotice(null);
      } else {
        armGrace();
      }
    }

    // Spent (or expired) token: drop it and fetch a fresh one.
    function discardToken() {
      setToken(null);
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    }
    discardTokenRef.current = discardToken;

    armGrace();

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile || !container) return;
        widgetIdRef.current = window.turnstile.render(container, {
          sitekey: siteKey,
          theme: "auto",
          size: "flexible",
          appearance: "interaction-only",
          callback: (token) => setToken(token),
          "expired-callback": () => setToken(null),
          "timeout-callback": () => setToken(null),
          "error-callback": () => {
            tokenRef.current = null;
            onTokenRef.current?.(null);
            giveUp();
          },
        });
      })
      .catch(() => giveUp());

    const form = container.closest("form");
    function handleSubmit(e: Event) {
      if (!tokenRef.current) {
        if (!gaveUpRef.current) {
          e.preventDefault();
          setNotice("Finishing the security check — try again in a moment.");
        }
        // else: we've stopped waiting — let the server decide.
        return;
      }
      // Deferred so the form's FormData is captured with this token first;
      // then get a new one for the next attempt (this one is spent).
      setTimeout(discardToken, 0);
    }
    form?.addEventListener("submit", handleSubmit);

    return () => {
      cancelled = true;
      clearTimeout(graceTimer);
      discardTokenRef.current = null;
      form?.removeEventListener("submit", handleSubmit);
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      tokenRef.current = null;
    };
  }, [siteKey]);

  // Non-form consumers ask for a fresh token by bumping resetSignal.
  const firstResetSignal = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === firstResetSignal.current) return;
    discardTokenRef.current?.();
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <div className={className}>
      <div ref={containerRef} />
      {notice && (
        <p role="status" className="mt-2 text-center text-xs text-danger">
          {notice}
        </p>
      )}
    </div>
  );
}
