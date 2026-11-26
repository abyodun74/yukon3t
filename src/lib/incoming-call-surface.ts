// One incoming-call UI at a time. The in-app ring card (IncomingCallListener: Decline / Message / Accept) is the ring
// UI whenever it is on screen; each platform's own system ring gives way to it, and takes over again only where the
// platform allows it once the app is out of sight. Pure and client-safe; the server uses callPushTag too.
//
//  - Android app: the native ring (CallForegroundService's notification + ringtone, raised by CallMessagingService)
//    is not raised while the app is in the foreground, and is silenced when the card comes on screen; it is raised
//    again when the app is left while the call still rings (native IncomingRingState, needs the native build that has
//    it; older builds keep ringing natively on top of the card).
//  - iOS app: CallKit must be told about every VoIP push, so it rings first; once the card is on screen CallKit's ring
//    for that call is ended (callkit-ring-sync.ts yieldToApp), so its Accept / Decline banner is not shown on top.
//  - Browser / PWA: the web push "<name> is calling you" (no buttons) is closed once the card is on screen, and when
//    the ring is over.

export type SystemRing = "callKit" | "androidRing" | "browserNotification";

/** Which system ring this platform has (Capacitor.getPlatform(): "ios", "android" or "web"). */
export function systemRingFor(platform: string): SystemRing {
  if (platform === "ios") return "callKit";
  if (platform === "android") return "androidRing";
  return "browserNotification";
}

/**
 * The call whose in-app ring card is on screen: the card is drawn for it and the page is visible. Null otherwise, and
 * then the system ring is left alone (the app is in the background, or the screen is locked).
 */
export function inAppRingOnScreen(input: { cardCallId: string | null; pageVisible: boolean }): string | null {
  return input.cardCallId && input.pageVisible ? input.cardCallId : null;
}

/**
 * How often CallKit's ring is ended while the card is on screen: its VoIP push can arrive after the card is up, and
 * ending a ring CallKit isn't showing does nothing.
 */
export const CALLKIT_YIELD_INTERVAL_MS = 1_000;

/** The web push tag of a call's ring (public/sw.js shows it under this tag), so the page can close it. */
export function callPushTag(callId: string): string {
  return `call-${callId}`;
}
