// The data fields of the call-related FCM data messages (fcm.ts), read by the Android app's CallMessagingService.
// Pure, so the exact payload the phone gets is unit-tested (call-push-data.test.ts). FCM data values must be
// strings; an optional field is left out rather than sent empty.

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
 * row opens (notificationHref), which a tap on the native notification opens too (yukon3t://open, see
 * notificationDeepLinkPath in push-target.ts).
 */
export function missedCallData(input: { callId: string; callerName: string; url: string }): Record<string, string> {
  return { type: "missed_call", callId: input.callId, callerName: input.callerName, url: input.url };
}
