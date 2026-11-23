// When and how YuKon3t asks to send phone/browser notifications. Pure and client-safe; tested in
// push-permission.test.ts. Used by PushPermissionPrompt (the "Turn on notifications?" sheet), the Settings
// notifications row (push-notifications-toggle.tsx) and capacitor-bridge.tsx.
//
// Why there is a sheet before the system prompt: iOS shows its own permission prompt exactly once per install, and
// Android 13+ stops showing it after two refusals. Asking with no context (the bare system prompt) is the main way
// people end up with notifications blocked, which leaves them with only the in-app bell. The sheet says what
// notifications are for first and only then opens the system prompt; "Not now" costs nothing and asks again later.

/** Where a device stands on notifications, the same words for the native app and a browser. */
export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

/** capacitor-bridge.tsx re-reads the permission (and registers this phone) when this event fires on `window`. */
export const PUSH_PERMISSION_CHANGED_EVENT = "yk:push-permission-changed";

/** How long "Not now" holds the sheet back. */
export const PUSH_ASK_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
/** After this many showings the sheet stops coming back on its own; Settings -> Notifications always has the button. */
export const PUSH_ASK_MAX = 3;
/** The only page the sheet opens on: Home, a calm moment after sign-in, sign-up (/home?onboarded=1) or app launch. */
export const PUSH_ASK_PATH = "/home";

/** @capacitor-firebase/messaging's `receive` state -> PushPermission. */
export function nativePushPermission(receive: unknown): PushPermission {
  if (receive === "granted") return "granted";
  if (receive === "denied") return "denied";
  // Android reports "prompt-with-rationale" after one refusal: the system prompt can still be shown.
  if (receive === "prompt" || receive === "prompt-with-rationale") return "prompt";
  return "unsupported";
}

/**
 * A browser's state. Web push needs a service worker, the Push API, the Notification API and our VAPID key; iPhone
 * Safari has the Push API only in a web app added to the Home Screen, so a normal Safari tab is "unsupported".
 */
export function webPushPermission(env: {
  vapidKey: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notificationPermission: string | null;
}): PushPermission {
  if (!env.vapidKey || !env.serviceWorker || !env.pushManager || env.notificationPermission === null) {
    return "unsupported";
  }
  if (env.notificationPermission === "granted") return "granted";
  if (env.notificationPermission === "denied") return "denied";
  return "prompt";
}

/** How often the sheet has been shown to this account on this device (localStorage). */
export type PushAskRecord = { asks: number; lastAskedAt: number };

export function pushAskStorageKey(userId: string): string {
  return `yk.pushAsk.${userId}`;
}

/** A stored record, or null for anything missing or malformed (never throws). */
export function parsePushAskRecord(raw: string | null | undefined): PushAskRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return null;
    const { asks, lastAskedAt } = value as Record<string, unknown>;
    if (typeof asks !== "number" || !Number.isInteger(asks) || asks < 0) return null;
    if (typeof lastAskedAt !== "number" || !Number.isFinite(lastAskedAt)) return null;
    return { asks, lastAskedAt };
  } catch {
    return null;
  }
}

/** The record after one more showing. */
export function nextPushAskRecord(record: PushAskRecord | null, now: number): PushAskRecord {
  return { asks: (record?.asks ?? 0) + 1, lastAskedAt: now };
}

/**
 * Whether to open the "Turn on notifications?" sheet now: only while the system prompt can still be shown, only on
 * Home, and only when this device hasn't been asked too often or too recently.
 */
export function shouldOfferPushPrompt(input: {
  permission: PushPermission;
  pathname: string;
  record: PushAskRecord | null;
  now: number;
  /** Another sheet or dialog is open (an aria-modal element): never stack on top of it. */
  otherModalOpen?: boolean;
}): boolean {
  if (input.otherModalOpen) return false;
  if (input.permission !== "prompt") return false;
  if (input.pathname !== PUSH_ASK_PATH) return false;
  const { record } = input;
  if (!record) return true;
  if (record.asks >= PUSH_ASK_MAX) return false;
  // A clock that went backwards counts as "too recent" rather than asking twice in a row.
  return input.now - record.lastAskedAt >= PUSH_ASK_SNOOZE_MS;
}

/**
 * Where the Settings row can send someone whose notifications are blocked. iOS opens the app's own page in the
 * Settings app through the `app-settings:` URL (Capacitor hands non-web URLs to the system); Android's WebView has no
 * URL for an app's notification settings, so there it is written instructions only.
 */
export function blockedPushHelp(platform: string): "open-settings" | "instructions" {
  return platform === "ios" ? "open-settings" : "instructions";
}

/** The URL iOS opens the app's own page in the Settings app for (UIApplication.openSettingsURLString). */
export const IOS_APP_SETTINGS_URL = "app-settings:";

/** localStorage flag: this browser's notifications were turned off in Settings, so the page must not re-subscribe. */
export const WEB_PUSH_OFF_KEY = "yk.webPushOff";
