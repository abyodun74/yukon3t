"use client";

import type { DailyCall } from "@daily-co/daily-js";
import type { CaptureKind } from "@/lib/screen-capture-guard";

/** Daily app-message payload shape for a capture alert — see broadcastCaptureAlert/captureAlertFromAppMessage below. */
export const CAPTURE_ALERT_MESSAGE_TYPE = "capture-alert";

/**
 * Broadcasts a locally-detected screenshot/recording to the other
 * participant(s) over Daily's own real-time data channel — same mechanism
 * as collab-material.ts's file-share broadcast, chosen for the same reason:
 * it rides the already-open call connection, so it reaches the other side
 * instantly with no extra server round trip. sendAppMessage only reaches
 * *other* participants, not the sender, so the local UI has to show its own
 * alert directly rather than relying on hearing this broadcast back.
 */
export function broadcastCaptureAlert(dailyCall: DailyCall | null, kind: CaptureKind) {
  dailyCall?.sendAppMessage({ type: CAPTURE_ALERT_MESSAGE_TYPE, kind }, "*");
}

export function captureAlertFromAppMessage(data: unknown): CaptureKind | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; kind?: unknown };
  if (msg.type !== CAPTURE_ALERT_MESSAGE_TYPE) return null;
  return msg.kind === "screenshot" || msg.kind === "recording" ? msg.kind : null;
}
