"use client";

import { useSyncExternalStore } from "react";
import { callPushTag } from "@/lib/incoming-call-surface";

// The browser halves of incoming-call-surface.ts: whether the page is on screen, and closing a call's web push.

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** True while the page is visible (document.visibilityState); false on the server. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => false,
  );
}

/** Closes the "<name> is calling you" web push of this call, if this browser is showing it. Never throws. */
export async function closeCallPushNotifications(callId: string): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const shown = await registration?.getNotifications({ tag: callPushTag(callId) });
    shown?.forEach((notification) => notification.close());
  } catch {
    // Best effort: the notification stays until it is dismissed, as before.
  }
}
