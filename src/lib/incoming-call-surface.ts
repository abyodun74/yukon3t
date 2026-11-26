// The in-app ring card (IncomingCallListener: Decline / Message / Accept) and each platform's own system ring. Where
// the platform allows it, the system ring gives way to the card while the card is on screen, and takes over again
// once the app is out of sight. Pure and client-safe; the server uses callPushTag too.
//
//  - Android app: the native ring (CallForegroundService's notification + ringtone, raised by CallMessagingService)
//    is not raised while the app is in the foreground, and is silenced when the card comes on screen; it is raised
//    again when the app is left while the call still rings (native IncomingRingState, needs the native build that has
//    it; older builds keep ringing natively on top of the card).
//  - iOS app: CallKit never gives way. It rings alongside the card, and its Accept / Decline always answer / decline
//    the call (the callAnswered / callDeclined events and the native queue, IncomingCallListener). Ending CallKit's
//    ring from the page while the card was up (tried in 64b5d61, removed) left nothing ringing once the app was left,
//    and an Accept / Decline on a CallKit ring the page had ended reached nothing (NativeCallManager fails or drops an
//    action on a call it has forgotten). The in-app Accept still turns CallKit's ring into its active call and the
//    in-app Decline ends it (callkit-ring-sync.ts).
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
 * Whether this system ring gives way to the in-app card while the card is on screen. Never CallKit: its Accept /
 * Decline must keep answering / declining the call (see the iOS note above).
 */
export function systemRingGivesWay(ring: SystemRing): boolean {
  return ring !== "callKit";
}

/** The web push tag of a call's ring (public/sw.js shows it under this tag), so the page can close it. */
export function callPushTag(callId: string): string {
  return `call-${callId}`;
}
