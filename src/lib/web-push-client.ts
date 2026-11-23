"use client";

// Browser (web and installed web app) notifications through Web Push. Never used inside the native app: there
// notifications go through FCM (capacitor-bridge.tsx), and a Web Push subscription made in the app's WebView would
// make every call ring twice (see push-notifications-toggle.tsx). Every function is best-effort and never throws.

import { subscribeToPush, unsubscribeFromPush } from "@/app/actions/push";
import { WEB_PUSH_OFF_KEY, webPushPermission, type PushPermission } from "@/lib/push-permission";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// Web Push wants the VAPID key as a raw Uint8Array, but only hands it out as a URL-safe base64 string.
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: nothing to remember then.
  }
}

/** This browser's notification state (no prompt is shown). */
export function currentWebPushPermission(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  return webPushPermission({
    vapidKey: Boolean(VAPID_PUBLIC_KEY),
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notificationPermission: "Notification" in window ? Notification.permission : null,
  });
}

/** Whether this browser has a live subscription right now. */
export async function hasWebPushSubscription(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

async function subscribeAndSave(): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));
  const result = await subscribeToPush(
    subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } },
  );
  return !result.error;
}

/**
 * Asks the browser (this must run from a tap: browsers ignore a permission request without one), then subscribes this
 * browser for the signed-in account. Returns the permission afterwards; "granted" also means the subscription is saved.
 */
export async function enableWebPush(): Promise<PushPermission> {
  if (currentWebPushPermission() === "unsupported") return "unsupported";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return permission === "denied" ? "denied" : "prompt";
    storageSet(WEB_PUSH_OFF_KEY, null);
    return (await subscribeAndSave()) ? "granted" : "prompt";
  } catch {
    // Allowed but not subscribed (the push service or our server failed) reads as "not on yet", so the button stays.
    const after = currentWebPushPermission();
    return after === "granted" ? "prompt" : after;
  }
}

/** Settings' "Turn off notifications": unsubscribes and remembers not to subscribe again on its own. */
export async function disableWebPush(): Promise<boolean> {
  storageSet(WEB_PUSH_OFF_KEY, "1");
  return removeWebPushSubscription();
}

/**
 * Removes this browser's subscription from the account and from the browser (sign-out, and "Turn off"). Returns false
 * if it couldn't. Doesn't touch the "turned off" flag, so signing out never counts as turning notifications off.
 */
export async function removeWebPushSubscription(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return true;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return true;
    await unsubscribeFromPush(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
    return true;
  } catch {
    return false;
  }
}

/**
 * On every load for a signed-in member: when the browser already allows notifications (and they weren't turned off in
 * Settings), make sure this browser is subscribed and the subscription belongs to the account signed in now. This is
 * what re-attaches notifications after a sign-out / sign-in or an account switch, and after a browser rotates the
 * subscription, without asking again. Never shows a prompt.
 */
export async function syncWebPushSubscription(): Promise<void> {
  if (currentWebPushPermission() !== "granted") return;
  if (storageGet(WEB_PUSH_OFF_KEY) === "1") return;
  try {
    await subscribeAndSave();
  } catch {
    // Best-effort: the Settings button can still turn them on.
  }
}
