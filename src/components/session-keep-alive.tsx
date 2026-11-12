"use client";

import { useEffect } from "react";
import {
  SESSION_REFRESH_STORAGE_KEY,
  parseLastRefreshAt,
  shouldRefreshSession,
} from "@/lib/session-refresh-rules";

const REFRESH_TIMEOUT_MS = 10_000;
let inFlight = false;

function readLastRefreshAt(): number | null {
  try {
    return parseLastRefreshAt(localStorage.getItem(SESSION_REFRESH_STORAGE_KEY));
  } catch {
    return null;
  }
}

async function refreshIfDue() {
  if (inFlight || navigator.onLine === false) return;
  if (!shouldRefreshSession(readLastRefreshAt(), Date.now())) return;
  inFlight = true;
  try {
    const res = await fetch("/api/session/refresh", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const { refreshed } = (await res.json()) as { refreshed?: unknown };
    // Only a real re-issue starts the 12h wait; anything else is retried on the next launch / foreground.
    if (refreshed === true) {
      try {
        localStorage.setItem(SESSION_REFRESH_STORAGE_KEY, String(Date.now()));
      } catch {
        // Not remembered: the next foreground asks again, which is harmless.
      }
    }
  } catch {
    // Offline, timed out, or mid-deploy: the cookie is untouched, try again later.
  } finally {
    inFlight = false;
  }
}

/**
 * Keeps a signed-in member signed in for as long as they keep using the app: at launch and on every return to the
 * foreground (at most every 12 hours) it asks /api/session/refresh to re-issue the session cookie with a fresh 30-day
 * expiry. Without it every session ended exactly 30 days after sign-in (see session-refresh-rules.ts). Mounted in
 * layout.tsx for members only (never a guest preview). It never signs anyone out, clears storage or navigates.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    const timer = setTimeout(() => void refreshIfDue(), 0);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshIfDue();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
