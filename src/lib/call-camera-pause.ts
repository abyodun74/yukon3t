"use client";

import type { DailyCall } from "@daily-co/daily-js";

/** Daily app-message payload shape for a camera paused/resumed notice — see broadcastCameraPaused/cameraPausedFromAppMessage below. */
const CALL_CAMERA_PAUSED_MESSAGE_TYPE = "call-camera-paused";

/**
 * Tells the other participant this side's camera stopped (or resumed)
 * because the app went to the background — same Daily app-message channel
 * as call-hold.ts, for the same reason. Without it the peer just sees the
 * last frame frozen, indistinguishable from a broken call.
 *
 * Unlike a hold toggle, this fires from a visibility change rather than a
 * tap, so it can land while this side isn't in the room at all (mid
 * reconnect) — sendAppMessage throws outside a joined call, hence the guard.
 */
export function broadcastCameraPaused(dailyCall: DailyCall | null, paused: boolean) {
  if (!dailyCall || dailyCall.meetingState() !== "joined-meeting") return;
  dailyCall.sendAppMessage({ type: CALL_CAMERA_PAUSED_MESSAGE_TYPE, paused }, "*");
}

export function cameraPausedFromAppMessage(data: unknown): boolean | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; paused?: unknown };
  if (msg.type !== CALL_CAMERA_PAUSED_MESSAGE_TYPE) return null;
  return typeof msg.paused === "boolean" ? msg.paused : null;
}
