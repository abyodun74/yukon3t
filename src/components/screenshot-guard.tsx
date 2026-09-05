"use client";

import { useEffect } from "react";
import { startScreenCaptureWatch, stopScreenCaptureWatch, onScreenCaptureDetected } from "@/lib/screen-capture-guard";
import { getScreenshotContext } from "@/lib/screenshot-context";
import { useCallSession } from "@/lib/call-session";
import { notifyScreenshotTaken } from "@/app/actions/screenshot";

/**
 * App-wide screenshot detection for posts/stories/DMs/profiles — a sibling
 * to call-session.tsx's own call-scoped start/stop (double-starting the
 * native watcher is a no-op, see ScreenCaptureGuardPlugin.java's null guard,
 * so the two coexist safely). While an active call session exists,
 * global-call-frame.tsx's own listener already owns the response
 * (broadcasting to the other participant) — this one defers to it instead
 * of also notifying, since there's no separate "content owner" during a
 * call.
 */
export function ScreenshotGuard() {
  const { session } = useCallSession();

  useEffect(() => {
    startScreenCaptureWatch();
    return () => stopScreenCaptureWatch();
  }, []);

  useEffect(() => {
    return onScreenCaptureDetected(() => {
      if (session) return;
      const ctx = getScreenshotContext();
      if (!ctx) return;
      notifyScreenshotTaken(ctx).catch(() => {});
    });
  }, [session]);

  return null;
}
