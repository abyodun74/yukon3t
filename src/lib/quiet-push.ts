// Quiet notifications: shown in the tray / notification centre, but with no sound, no vibration and no screen-waking
// interruption. Only the birthday-reminders cron's midnight reminder uses them (src/lib/birthdays-data.ts). Pure and
// client-safe: capacitor-bridge.tsx creates the Android channel named here, the server half (fcm.ts, push.ts) sends to it.

/**
 * The Android notification channel quiet notices are posted to. IMPORTANCE_LOW (2): shown in the shade and status bar,
 * never makes a sound or vibrates, never peeks. Android fixes a channel's sound/importance when it is first created, so
 * never reuse this id for a louder channel; to change its behaviour, use a new id.
 */
export const QUIET_NOTIFICATION_CHANNEL_ID = "quiet_reminders";
/** Android's NotificationManager.IMPORTANCE_LOW. */
export const QUIET_NOTIFICATION_CHANNEL_IMPORTANCE = 2;

/** The FCM `android` block for a quiet notice (a device without the channel yet falls back to the app's default one). */
export function quietAndroidConfig() {
  return {
    priority: "high" as const,
    notification: {
      channelId: QUIET_NOTIFICATION_CHANNEL_ID,
      priority: "low" as const,
      defaultSound: false,
      defaultVibrateTimings: false,
    },
  };
}

/**
 * The FCM `apns` block for a quiet notice: no `sound` key (so iOS plays none) and interruption level "passive" (iOS 15+:
 * added to the notification list without lighting the screen or breaking through a Focus).
 */
export function quietApnsConfig() {
  return { payload: { aps: { "interruption-level": "passive" } } };
}
