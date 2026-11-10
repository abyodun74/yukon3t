import { VOIP_TOKEN_MAX_LENGTH, type CallDevice } from "@/lib/voip-ring-targets";

// What the iOS app's native side (NativeCallManager.swift) sends to POST /api/calls/native when CallKit's own End
// (side button, lock screen, system call screen) hangs up a call answered on that iPhone. Pure, so it is unit-tested
// without a server.
//
// Why native and not only the web page: pressing End locks the phone or leaves the app in the background, CallKit
// deactivates the audio session, and WebKit suspends the web page. The page's `callEnded` listener (and so endCall)
// then only ran once the user opened the app again, so the other person stayed "connected" to nobody. The native side
// now reports the hang-up straight to the server with the web view's own session cookie; the page still hangs up too
// when it runs, and endCall's guarded write makes the second one a no-op.

/** Sent on every request; a cross-site form can't set it, and JSON + a custom header needs a CORS preflight. */
export const NATIVE_CALL_HEADER = "x-yukon3t-native-call";

export type NativeCallEndRequest = { callId: string; device: CallDevice };

const CALL_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The request, or null if it isn't one this route accepts. */
export function parseNativeCallEndRequest(headerValue: string | null, body: unknown): NativeCallEndRequest | null {
  if (headerValue !== "1") return null;
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (value.action !== "end") return null;
  if (typeof value.callId !== "string" || !CALL_ID.test(value.callId)) return null;
  const voipToken =
    typeof value.voipToken === "string" && value.voipToken.length > 0 && value.voipToken.length <= VOIP_TOKEN_MAX_LENGTH
      ? value.voipToken
      : null;
  // CallKit already ended its call on this iPhone: the server sends it no cancel push for it.
  return { callId: value.callId, device: { platform: "ios", voipToken, callKitEnded: true } };
}
