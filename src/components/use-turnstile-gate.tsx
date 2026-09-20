"use client";

import { useCallback, useRef, useState } from "react";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/turnstile-shared";
import { TurnstileWidget } from "@/components/turnstile-widget";

export const TURNSTILE_WAIT_MESSAGE = "Finishing the security check — try again in a moment.";

/**
 * Turnstile for client forms that build their own FormData and call a Server
 * Action from an event handler (the phone-verification forms), where the
 * widget's usual "hidden input inside a <form>" mode doesn't fit: `attach`
 * puts the current token on the FormData just before the call, and `widget`
 * is the invisible widget to render OUTSIDE any <form> (see TurnstileWidget's
 * non-form mode).
 *
 * Same stance as the rest of the Turnstile wiring: only the server enforces
 * (src/lib/turnstile.ts). This client side just avoids a wasted round trip
 * while the token is still arriving, and never locks anyone out on its own —
 * if the widget gives up (script blocked, error, timeout) `attach` lets the call
 * through and the server decides. A token is single-use, so every successful
 * `attach` discards it and fetches a fresh one.
 */
export function useTurnstileGate() {
  const enabled = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const tokenRef = useRef<string | null>(null);
  const gaveUpRef = useRef(false);
  const [resetSignal, setResetSignal] = useState(0);
  // True once a call could go out right now: no Turnstile configured, a token in hand, or the widget gave up.
  const [ready, setReady] = useState(!enabled);

  const onToken = useCallback(
    (token: string | null) => {
      tokenRef.current = token;
      if (token) {
        gaveUpRef.current = false;
        setReady(true);
      } else {
        setReady(!enabled || gaveUpRef.current);
      }
    },
    [enabled],
  );
  const onGiveUp = useCallback(() => {
    gaveUpRef.current = true;
    setReady(true);
  }, []);

  /** Adds the token to `formData`. Returns false while a token is still on its way — the caller should ask the user to try again in a moment. */
  const attach = useCallback(
    (formData: FormData) => {
      if (!enabled) return true;
      const token = tokenRef.current;
      if (token) {
        formData.set(TURNSTILE_RESPONSE_FIELD, token);
        tokenRef.current = null; // spent by this call
        setResetSignal((n) => n + 1);
        return true;
      }
      return gaveUpRef.current; // stopped waiting: let the server decide
    },
    [enabled],
  );

  const widget = <TurnstileWidget className="mt-3" onToken={onToken} onGiveUp={onGiveUp} resetSignal={resetSignal} />;
  return { attach, ready, widget };
}
