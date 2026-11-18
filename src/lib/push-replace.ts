// Replacing a notification that was already delivered. A push can't be deleted from someone's device once it is shown,
// but a later push carrying the same replacement key takes its place instead of stacking a second one:
//  - web push: the service worker's `showNotification(..., { tag })` (public/sw.js) replaces a shown notification with
//    the same tag; `renotify: false` keeps the replacement from sounding or vibrating again.
//  - Android (FCM notification message, shown by the system while the app is in the background): `android.notification.tag`
//    replaces a notification with the same tag in the drawer.
//  - iOS (FCM via APNs): the `apns-collapse-id` header replaces a delivered notification with the same id.
// None of these can remove a notification: if the original was already dismissed or tapped, the replacement shows up
// as a new (quiet) notification. Pure and client-safe; fcm.ts and push.ts send with it.

import { quietAndroidConfig, quietApnsConfig } from "@/lib/quiet-push";

/** APNs refuses an `apns-collapse-id` longer than 64 bytes; tags are kept to that everywhere. */
export const PUSH_REPLACE_KEY_MAX_BYTES = 64;

/** A replacement key that every platform accepts: printable ASCII, at most 64 bytes, or null. */
export function safeReplaceKey(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!/^[\x21-\x7e]+$/.test(raw)) return null;
  return raw.length <= PUSH_REPLACE_KEY_MAX_BYTES ? raw : null;
}

/**
 * The FCM `android` and `apns` blocks for a notification that replaces (or can later be replaced under) `key`.
 * `quiet`: no sound, vibration or screen wake (the quiet channel / interruption level "passive", quiet-push.ts), for a
 * replacement that only corrects what is already on screen.
 */
export function replaceableFcmConfig(key: string, options: { quiet?: boolean } = {}) {
  const tag = safeReplaceKey(key);
  if (!tag) throw new Error("invalid replacement key");
  const quietAndroid = options.quiet ? quietAndroidConfig() : null;
  const quietApns = options.quiet ? quietApnsConfig() : null;
  return {
    android: {
      priority: "high" as const,
      notification: { ...(quietAndroid?.notification ?? {}), tag },
    },
    apns: {
      headers: { "apns-collapse-id": tag },
      ...(quietApns ?? {}),
    },
  };
}
