// Ordinary (non-quiet) phone notifications: shown like any messaging app's, as a banner that drops down over whatever
// is on screen, with the phone's notification sound and vibration. Pure and client-safe: capacitor-bridge.tsx creates
// the Android channel named here, the server half (fcm.ts, push-replace.ts) sends to it. The quiet counterpart (no
// sound, no banner) is quiet-push.ts.
//
// Why a channel of our own: an FCM notification message that names no channel is posted by Android to Firebase's
// fallback channel ("Miscellaneous", IMPORTANCE_DEFAULT): it sits in the shade with a sound but never pops up as a
// heads-up banner, so on Android YuKon3t's notifications looked like they only existed inside the app. A device that
// doesn't have this channel yet (the app hasn't run this code since notifications were allowed) gets Firebase's
// fallback channel exactly as before, so naming it is always safe.

/**
 * The Android channel ordinary notifications are posted to. IMPORTANCE_HIGH (4): sound, vibration and a heads-up
 * banner. Android fixes a channel's importance and sound when it is first created (the person can only change them in
 * the phone's settings after that), so never reuse this id for a different behaviour; use a new id instead.
 */
export const ALERT_NOTIFICATION_CHANNEL_ID = "yk_alerts";
/** Android's NotificationManager.IMPORTANCE_HIGH. */
export const ALERT_NOTIFICATION_CHANNEL_IMPORTANCE = 4;
/**
 * NotificationCompat.VISIBILITY_PRIVATE (0): on a secure lock screen the notification's text follows the person's own
 * "sensitive content" setting instead of always being shown (the plugin's default would be PUBLIC).
 */
export const ALERT_NOTIFICATION_CHANNEL_VISIBILITY = 0;

/** The FCM `android` block for an ordinary notification: delivered at once, posted to the heads-up channel. */
export function alertAndroidConfig() {
  return {
    priority: "high" as const,
    notification: {
      channelId: ALERT_NOTIFICATION_CHANNEL_ID,
      // Android 7 and older have no channels: this is what makes those show a heads-up banner.
      priority: "high" as const,
      defaultSound: true,
      defaultVibrateTimings: true,
    },
  };
}

/**
 * The FCM `apns` block for an ordinary notification. Without a `sound` key iOS shows the notification silently (no
 * sound, no vibration), which is how every YuKon3t notification arrived on iPhone before. Priority 10 = deliver now.
 */
export function alertApnsConfig() {
  return {
    headers: { "apns-priority": "10" },
    payload: { aps: { sound: "default" } },
  };
}
