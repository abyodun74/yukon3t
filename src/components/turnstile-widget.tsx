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

type Status = "loading" | "ready" | "error";

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
 *    before the token is ready is held back with a message instead of
 *    reaching the server just to be rejected.
 *  - Outside a form (ad-booking-form.tsx builds its own FormData): pass
 *    `onToken`, which fires with the token, and with null once it's spent or
 *    expired.
 *
 * A token is single-use and is consumed by the server-side check whether or
 * not the action then succeeds, so after every submit — and after any
 * `resetSignal` change, for the non-form case — the widget fetches a fresh
 * one. Without that, a second wrong-password attempt on the same page would
 * resubmit an already-spent token and be rejected as a bot.
 */
export function TurnstileWidget({
  onToken,
  resetSignal = 0,
  className,
}: {
  onToken?: (token: string | null) => void;
  /** Bump this to discard the current token and get a fresh one. */
  resetSignal?: number;
  className?: string;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  // A ref, not state: handleSubmit below is a native listener created once
  // per mount, so it has to read the *current* status when a submit arrives,
  // not the value captured when the effect ran.
  const statusRef = useRef<Status>("loading");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!siteKey || !container) return undefined;

    let cancelled = false;

    function setToken(token: string | null) {
      tokenRef.current = token;
      onTokenRef.current?.(token);
      if (token) {
        statusRef.current = "ready";
        setNotice(null);
      }
    }

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
            setToken(null);
            statusRef.current = "error";
          },
        });
      })
      .catch(() => {
        if (!cancelled) statusRef.current = "error";
      });

    const form = container.closest("form");
    function handleSubmit(e: Event) {
      if (!tokenRef.current) {
        e.preventDefault();
        setNotice(
          statusRef.current === "error"
            ? "Couldn't load the security check. Turn off any content blocker or try another network, then reload."
            : "Finishing the security check — try again in a moment.",
        );
        return;
      }
      // Deferred so the form's FormData is captured with this token first;
      // then get a new one for the next attempt (this one is spent).
      setTimeout(() => {
        tokenRef.current = null;
        onTokenRef.current?.(null);
        if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
      }, 0);
    }
    form?.addEventListener("submit", handleSubmit);

    return () => {
      cancelled = true;
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
    tokenRef.current = null;
    onTokenRef.current?.(null);
    if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
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
