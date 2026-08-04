"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `poll` immediately, then every `intervalMs` — paused while the tab
 * isn't visible, and immediately re-run once it becomes visible again so
 * nothing feels stale after switching back. Used by every polling-based
 * "live" UI in the app (incoming calls, chat threads, circle voice rooms)
 * so their aggregate DB load scales with actively-viewed tabs, not every
 * open tab.
 */
export function usePolling(poll: () => void, intervalMs: number, enabled = true) {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!interval) interval = setInterval(() => pollRef.current(), intervalMs);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        pollRef.current();
        start();
      } else {
        stop();
      }
    };

    pollRef.current();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [intervalMs, enabled]);
}
