"use client";

// The native app's (Capacitor, Android and iOS) notification permission, for the "Turn on notifications?" sheet and
// the Settings row. Registering the phone's FCM token stays in capacitor-bridge.tsx, which re-reads the permission
// whenever PUSH_PERMISSION_CHANGED_EVENT fires. The plugin is imported dynamically so it never loads on the web.

import { Capacitor } from "@capacitor/core";
import {
  IOS_APP_SETTINGS_URL,
  PUSH_PERMISSION_CHANGED_EVENT,
  nativePushPermission,
  type PushPermission,
} from "@/lib/push-permission";

/** Tells capacitor-bridge.tsx to read the permission again and register this phone if it is allowed now. */
export function announcePushPermissionChanged() {
  try {
    window.dispatchEvent(new Event(PUSH_PERMISSION_CHANGED_EVENT));
  } catch {
    // Nothing listening: the next launch registers the phone anyway.
  }
}

/** This phone's notification permission (no prompt is shown). */
export async function checkNativePushPermission(): Promise<PushPermission> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  try {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const result = await FirebaseMessaging.checkPermissions();
    return nativePushPermission(result.receive);
  } catch {
    return "unsupported";
  }
}

/**
 * Shows the system permission prompt (iOS: only the first time ever; Android 13+: until refused twice; older Android
 * allows notifications without asking) and then has capacitor-bridge.tsx register the phone. Returns the permission
 * afterwards.
 */
export async function requestNativePushPermission(): Promise<PushPermission> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  try {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const result = await FirebaseMessaging.requestPermissions();
    const permission = nativePushPermission(result.receive);
    announcePushPermissionChanged();
    return permission;
  } catch {
    return checkNativePushPermission();
  }
}

/**
 * iOS only: opens YuKon3t's own page in the Settings app (Notifications is on it). Capacitor hands a URL that isn't
 * the app's own site to the system, which is what opens Settings. Returns false where that isn't possible (Android).
 */
export function openNativeAppSettings(): boolean {
  if (Capacitor.getPlatform() !== "ios") return false;
  try {
    window.location.href = IOS_APP_SETTINGS_URL;
    return true;
  } catch {
    return false;
  }
}
