"use client";

import { Capacitor } from "@capacitor/core";

// Removes pushes already sitting in the phone's notification drawer / the browser's notification list once the thing
// they are about is open: a chat's message pushes when the chat is on screen, a story's pushes when the story is.
// Best-effort only: every step is wrapped, nothing here can break or slow a page (it is never awaited by callers),
// and anything that can't be matched precisely is left where it is.
//  - iPhone app (@capacitor-firebase/messaging, already installed; no native change): getDeliveredNotifications hands
//    back each push's data, `url` included (the APNs userInfo); removeDeliveredNotifications for the matches.
//  - Android app: nothing to do here. MainActivity.onResume already clears every non-call notification of the app's
//    from the drawer whenever the app comes to the foreground, and FCM puts nothing in the drawer while it is there.
//    (The plugin's Android result carries no push data anyway, so a match by url would find nothing.)
//  - Web push (public/sw.js shows them with `data.url`): the service worker registration's getNotifications(), then
//    close() on the matches.

/** A delivered notification as the plugin or the browser describes it (only what matching reads). */
export type DeliveredPush = { data?: unknown };

/** The in-app path + query a delivered push opens, or null (its `url` missing, or not on this site). */
function deliveredPushPath(data: unknown, origin: string): string | null {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>).url : undefined;
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Whether a delivered push is about exactly `target` (an in-app path such as `/messages/<id>` or
 * `/u/<owner>?story=<id>`): its url opens that same path + query. Pure; never matches a push about another chat or
 * story, or one whose url leads elsewhere (a hidden chat's generic push opens /home).
 */
export function deliveredPushMatches(push: DeliveredPush, target: string, origin: string): boolean {
  return deliveredPushPath(push.data, origin) === target.split("#")[0];
}

/** Removes the delivered pushes about `target`. Fire-and-forget; resolves (never rejects) whatever happens. */
export async function clearDeliveredPushesFor(target: string): Promise<void> {
  if (typeof window === "undefined") return;
  const origin = window.location.origin;
  try {
    if (Capacitor.isNativePlatform()) {
      if (Capacitor.getPlatform() !== "ios" || !Capacitor.isPluginAvailable("FirebaseMessaging")) return;
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      const { notifications } = await FirebaseMessaging.getDeliveredNotifications();
      const matches = notifications.filter((n) => deliveredPushMatches(n, target, origin));
      if (matches.length > 0) await FirebaseMessaging.removeDeliveredNotifications({ notifications: matches });
      return;
    }
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration || typeof registration.getNotifications !== "function") return;
    const shown = await registration.getNotifications();
    for (const notification of shown) {
      if (deliveredPushMatches(notification, target, origin)) notification.close();
    }
  } catch {
    // Unsupported, permission missing, plugin missing on an old build: the pushes simply stay.
  }
}
