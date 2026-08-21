"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

interface CallForegroundPlugin {
  startActiveCall(options: { callId: string; label: string; isVideo: boolean }): Promise<void>;
  stopActiveCall(): Promise<void>;
}

/**
 * Bridges to CallForegroundService's active-call mode (see
 * android/app/src/main/java/com/yukon3t/app/CallForegroundService.java) so
 * the Android process stays Doze-exempt for the duration of a call, not just
 * while it's ringing — without this, backgrounding the app or navigating
 * elsewhere inside it mid-call risks the OS killing/throttling the process
 * out from under the still-running Daily call. Android-only: iOS instead
 * relies on `UIBackgroundModes: [audio]` in Info.plist, which keeps WKWebView's
 * own audio session alive in the background with no native plugin needed —
 * calling these on iOS/web would just reject as unimplemented, hence the
 * platform guards below rather than relying on that rejection.
 */
const CallForeground = registerPlugin<CallForegroundPlugin>("CallForeground");

export function startActiveCallForeground(callId: string, label: string, isVideo: boolean) {
  if (Capacitor.getPlatform() !== "android") return;
  CallForeground.startActiveCall({ callId, label, isVideo }).catch(() => {});
}

export function stopActiveCallForeground() {
  if (Capacitor.getPlatform() !== "android") return;
  CallForeground.stopActiveCall().catch(() => {});
}
