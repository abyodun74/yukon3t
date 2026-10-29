import type { ApnsConfig } from "firebase-admin/messaging";

// The data fields of the call-related FCM data messages (fcm.ts), read by the Android app's CallMessagingService,
// and the APNs block each one carries for iOS. Pure, so the exact payload the phone gets is unit-tested
// (call-push-data.test.ts). FCM data values must be strings; an optional field is left out rather than sent empty.

/**
 * iOS block for the call messages that must stay invisible there (`incoming_call`, `call_cancelled`): a silent
 * background push (no alert; priority 5 is what APNs requires for that type). Ringing and clearing the ring on iOS is
 * the VoIP/CallKit path's job (apns-voip.ts), not this one's.
 */
export const SILENT_CALL_APNS: ApnsConfig = {
  headers: { "apns-priority": "5", "apns-push-type": "background" },
  payload: { aps: { contentAvailable: true } },
};

/**
 * iOS block for `missed_call`: a visible alert, so an iPhone shows "Missed call / <name> called you" while the app is
 * backgrounded or killed (the iOS app builds no notification of its own; Android ignores this block and builds its
 * native one from the data fields). The FCM data fields (incl. `url`) ride along as custom keys, which the
 * @capacitor-firebase/messaging plugin hands to capacitor-bridge.tsx's notificationActionPerformed listener on a tap.
 * `apns-collapse-id` + `thread-id` per caller: repeated missed calls from one person replace each other instead of
 * stacking. No sound (the ring was the sound) and no picture (would need a native notification service extension).
 */
export function missedCallApns(input: { callerId: string; title: string; body: string }): ApnsConfig {
  const key = `missed-call-${input.callerId}`;
  return {
    headers: { "apns-priority": "10", "apns-push-type": "alert", "apns-collapse-id": key },
    payload: { aps: { alert: { title: input.title, body: input.body }, threadId: key } },
  };
}

/** `incoming_call`: starts the native ring. `callerAvatarUrl` only when the server has a usable one (call-avatar-server.ts). */
export function incomingCallData(input: {
  callId: string;
  callerName: string;
  callType: "AUDIO" | "VIDEO";
  callerAvatarUrl?: string | null;
}): Record<string, string> {
  return {
    type: "incoming_call",
    callId: input.callId,
    callerName: input.callerName,
    callType: input.callType,
    ...(input.callerAvatarUrl ? { callerAvatarUrl: input.callerAvatarUrl } : {}),
  };
}

/**
 * `missed_call`: leaves the native "Missed call" notification. `url` is the same in-app path the bell's MISSED_CALL
 * row opens (notificationHref), which a tap on the native notification opens too (Android: yukon3t://open, see
 * notificationDeepLinkPath in push-target.ts; iOS: the alert from missedCallApns, via notificationActionPerformed).
 */
export function missedCallData(input: { callId: string; callerName: string; url: string }): Record<string, string> {
  return { type: "missed_call", callId: input.callId, callerName: input.callerName, url: input.url };
}
