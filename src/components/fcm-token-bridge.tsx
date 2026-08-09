"use client";

import { useEffect } from "react";
import { registerFcmToken } from "@/app/actions/fcm";
import { FCM_TOKEN_STORAGE_KEY } from "@/lib/fcm-token-storage";

/**
 * Receives the native Android app's FCM token. A TWA's native code has no
 * way to call an authenticated API directly (it doesn't share the page's
 * session cookie) — the standard handoff is for the native app to open the
 * page with the token as a launch query param, and let the page's own
 * authenticated JS register it. Plain window APIs, not next/navigation's
 * useSearchParams, so this needs no Suspense boundary — it only needs to
 * read the URL once on mount, not react to it changing.
 */
export function FcmTokenBridge() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("fcm_token");
    if (!token) return;

    registerFcmToken(token)
      .then((result) => {
        // Persisted so Nav's sign-out handler can unregister this exact
        // device later — the native app only hands us the token once, on
        // launch, via this one-time query param; nothing else ever sees it
        // again otherwise.
        if (!result.error) {
          localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
        }
      })
      .catch(() => {})
      .finally(() => {
        // A device token doesn't belong in a shareable link or browser
        // history entry — strip it once it's registered (or once we've
        // given up trying).
        url.searchParams.delete("fcm_token");
        window.history.replaceState({}, "", url.toString());
      });
  }, []);

  return null;
}
