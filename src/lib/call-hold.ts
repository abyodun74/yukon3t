"use client";

import type { DailyCall } from "@daily-co/daily-js";

/** Daily app-message payload shape for a hold-state change — see broadcastHoldState/holdStateFromAppMessage below. */
const CALL_HOLD_MESSAGE_TYPE = "call-hold";

/**
 * Broadcasts a local hold/resume toggle to the other participant over
 * Daily's own real-time data channel — same mechanism as capture-alert.ts's
 * screenshot/recording notice and collab-material.ts's file-share broadcast,
 * chosen for the same reason: it rides the already-open call connection, so
 * it reaches the other side instantly with no extra server round trip.
 * sendAppMessage only reaches *other* participants, not the sender, so the
 * local UI drives its own hold overlay directly rather than relying on
 * hearing this broadcast back.
 */
export function broadcastHoldState(dailyCall: DailyCall | null, onHold: boolean) {
  dailyCall?.sendAppMessage({ type: CALL_HOLD_MESSAGE_TYPE, onHold }, "*");
}

export function holdStateFromAppMessage(data: unknown): boolean | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; onHold?: unknown };
  if (msg.type !== CALL_HOLD_MESSAGE_TYPE) return null;
  return typeof msg.onHold === "boolean" ? msg.onHold : null;
}
