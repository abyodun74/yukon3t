"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/turnstile-shared";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { INITIAL_TURNSTILE_STATE, heldSubmitMessage, type TurnstileState, type TurnstileStrings } from "@/lib/turnstile-lifecycle";
import { APP_ATTEST_FIELD, APP_META_FIELD, appAttestMode } from "@/lib/app-attest-shared";
import { basicAppMeta, canAttest, getAppMeta, getAttestationToken } from "@/lib/app-attest-client";
import { sharedEn } from "@/lib/i18n/en/shared";
import type { Locale } from "@/lib/i18n/locales";

const subscribeToNothing = () => () => {};

/**
 * Turnstile for client forms that build their own FormData and call a Server
 * Action from an event handler (the phone-verification forms), where the
 * widget's usual "hidden input inside a <form>" mode doesn't fit: `attach`
 * puts the current token on the FormData just before the call, and `widget`
 * is the widget (a "Verify you're human" button) to render OUTSIDE any <form> (see TurnstileWidget's
 * non-form mode).
 *
 * Same stance as the rest of the Turnstile wiring: only the server enforces (src/lib/turnstile.ts), and a call without
 * a token would only be rejected there, so `attach` resolves false while there's no token and `holdMessage()` says why
 * (not tapped yet / still running / what failed), the same sentence the in-form widget shows.
 *
 * No token is fetched automatically: the person must tap the widget's verify button first, so `ready` becomes
 * true only after a tap produces a token. A token is single-use, so every successful `attach` spends it and the next
 * send needs another tap.
 *
 * Device attestation (native app only, docs/plans/app-attestation.md): `attach` is async. It always adds
 * `yk-app-meta` in the app. With NEXT_PUBLIC_APP_ATTEST_MODE=enforce and the plugin present there is no button:
 * `attach` fetches a single-use App Check token instead, and if none comes back it returns false and the button
 * appears. With "observe", a token fetched after the tap rides along with the Turnstile token when ready.
 *
 * `locale` is the widget's language on the account screens (see TurnstileWidget); omit it elsewhere.
 * `strings` is `shared.turnstile` in that language; omit it for English.
 */
export function useTurnstileGate(locale?: Locale, strings: TurnstileStrings = sharedEn.turnstile) {
  const enabled = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const tokenRef = useRef<string | null>(null);
  const widgetStateRef = useRef<TurnstileState>(INITIAL_TURNSTILE_STATE);
  const stringsRef = useRef(strings);
  const [resetSignal, setResetSignal] = useState(0);
  // True once a call could go out right now: no Turnstile configured, or a token in hand.
  const [turnstileReady, setTurnstileReady] = useState(!enabled);

  const attestCapable = useSyncExternalStore(subscribeToNothing, canAttest, () => false);
  // Set once attestation failed: the Turnstile button takes over.
  const [attestFailed, setAttestFailed] = useState(false);
  const enforcing = enabled && appAttestMode() === "enforce" && attestCapable && !attestFailed;
  const observedTokenRef = useRef<string | null>(null);
  const metaRef = useRef<string | null>(null);

  useEffect(() => {
    stringsRef.current = strings;
  });

  useEffect(() => {
    void getAppMeta()?.then((meta) => {
      metaRef.current = meta;
    });
  }, []);

  const onToken = useCallback(
    (token: string | null) => {
      tokenRef.current = token;
      setTurnstileReady(!enabled || Boolean(token));
      if (token && appAttestMode() === "observe" && canAttest()) {
        void getAttestationToken().then((attestToken) => {
          observedTokenRef.current = attestToken;
        });
      }
    },
    [enabled],
  );
  const onStateChange = useCallback((state: TurnstileState) => {
    widgetStateRef.current = state;
  }, []);

  /** Adds the token to `formData`. Resolves false while there's no token yet — show `holdMessage()`. */
  const attach = useCallback(
    async (formData: FormData) => {
      if (!enabled) return true;
      const meta = metaRef.current ?? basicAppMeta();
      if (meta) formData.set(APP_META_FIELD, meta);

      if (enforcing) {
        const attestToken = canAttest() ? await getAttestationToken() : null;
        if (attestToken) {
          formData.set(APP_ATTEST_FIELD, attestToken);
          return true;
        }
        setAttestFailed(true);
        return false;
      }

      const token = tokenRef.current;
      if (!token) return false;
      formData.set(TURNSTILE_RESPONSE_FIELD, token);
      tokenRef.current = null; // spent by this call
      setResetSignal((n) => n + 1);
      if (observedTokenRef.current) {
        formData.set(APP_ATTEST_FIELD, observedTokenRef.current);
        observedTokenRef.current = null;
      }
      return true;
    },
    [enabled, enforcing],
  );

  /** Why `attach` just resolved false, in the person's language. */
  const holdMessage = useCallback(
    () => (enforcing ? stringsRef.current.wait : heldSubmitMessage(widgetStateRef.current, stringsRef.current)),
    [enforcing],
  );

  const widget = enforcing ? (
    <p role="status" className="mt-3 text-center text-xs text-foreground-soft">
      {strings.checkingDevice ?? sharedEn.turnstile.checkingDevice}
    </p>
  ) : (
    <TurnstileWidget
      className="mt-3"
      onToken={onToken}
      onStateChange={onStateChange}
      resetSignal={resetSignal}
      locale={locale}
      strings={strings}
      attest={false}
    />
  );
  return { attach, holdMessage, ready: enforcing || turnstileReady, widget };
}
