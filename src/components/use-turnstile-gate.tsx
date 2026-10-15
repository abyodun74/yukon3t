"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/turnstile-shared";
import { TurnstileWidget } from "@/components/turnstile-widget";
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
 * Same stance as the rest of the Turnstile wiring: only the server enforces
 * (src/lib/turnstile.ts). This client side just avoids a wasted round trip
 * while there's no token yet, and never locks anyone out on its own —
 * if the widget gives up (script blocked, error, timeout) `attach` lets the call
 * through and the server decides.
 *
 * No token is fetched automatically: the person must tap the widget's verify button first, so `ready` becomes
 * true only after a tap produces a token (or the widget gives up). A token is single-use, so every successful
 * `attach` spends it and the next send needs another tap.
 *
 * Device attestation (native app only, docs/plans/app-attestation.md): `attach` is async. It always adds
 * `yk-app-meta` in the app. With NEXT_PUBLIC_APP_ATTEST_MODE=enforce and the plugin present there is no button:
 * `attach` fetches a single-use App Check token instead, and if none comes back it returns false and the button
 * appears. With "observe", a token fetched after the tap rides along with the Turnstile token when ready.
 *
 * `locale` is the widget's language on the account screens (see TurnstileWidget); omit it elsewhere.
 * `strings` is the button label and the hold-back notice in that language; omit it for English.
 */
export function useTurnstileGate(locale?: Locale, strings?: { verify: string; wait: string; checkingDevice?: string }) {
  const enabled = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const tokenRef = useRef<string | null>(null);
  const gaveUpRef = useRef(false);
  const [resetSignal, setResetSignal] = useState(0);
  // True once a call could go out right now: no Turnstile configured, a token in hand, or the widget gave up.
  const [turnstileReady, setTurnstileReady] = useState(!enabled);

  const attestCapable = useSyncExternalStore(subscribeToNothing, canAttest, () => false);
  // Set once attestation failed: the Turnstile button takes over.
  const [attestFailed, setAttestFailed] = useState(false);
  const enforcing = enabled && appAttestMode() === "enforce" && attestCapable && !attestFailed;
  const observedTokenRef = useRef<string | null>(null);
  const metaRef = useRef<string | null>(null);

  useEffect(() => {
    void getAppMeta()?.then((meta) => {
      metaRef.current = meta;
    });
  }, []);

  const onToken = useCallback(
    (token: string | null) => {
      tokenRef.current = token;
      if (token) {
        gaveUpRef.current = false;
        setTurnstileReady(true);
        if (appAttestMode() === "observe" && canAttest()) {
          void getAttestationToken().then((attestToken) => {
            observedTokenRef.current = attestToken;
          });
        }
      } else {
        setTurnstileReady(!enabled || gaveUpRef.current);
      }
    },
    [enabled],
  );
  const onGiveUp = useCallback(() => {
    gaveUpRef.current = true;
    setTurnstileReady(true);
  }, []);

  /** Adds the token to `formData`. Resolves false while there's no token yet — the caller should ask the user to tap the verify button and try again. */
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
      if (token) {
        formData.set(TURNSTILE_RESPONSE_FIELD, token);
        tokenRef.current = null; // spent by this call
        setResetSignal((n) => n + 1);
        if (observedTokenRef.current) {
          formData.set(APP_ATTEST_FIELD, observedTokenRef.current);
          observedTokenRef.current = null;
        }
        return true;
      }
      return gaveUpRef.current; // stopped waiting: let the server decide
    },
    [enabled, enforcing],
  );

  const widget = enforcing ? (
    <p role="status" className="mt-3 text-center text-xs text-foreground-soft">
      {strings?.checkingDevice ?? sharedEn.turnstile.checkingDevice}
    </p>
  ) : (
    <TurnstileWidget
      className="mt-3"
      onToken={onToken}
      onGiveUp={onGiveUp}
      resetSignal={resetSignal}
      locale={locale}
      strings={strings}
      attest={false}
    />
  );
  return { attach, ready: enforcing || turnstileReady, widget };
}
