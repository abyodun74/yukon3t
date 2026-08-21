"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

interface CallForegroundPlugin {
  startActiveCall(options: { callId: string; label: string; isVideo: boolean }): Promise<void>;
  stopActiveCall(): Promise<void>;
  requestIgnoreBatteryOptimizations(): Promise<{ alreadyIgnoring: boolean }>;
}

// Ask at most once ever per install, not once per call — Play policy expects
// this system dialog not to be re-shown once the user's made a choice, and
// repeat prompting reads as nagging regardless of policy.
const BATTERY_PROMPT_STORAGE_KEY = "yukon3t_battery_opt_prompted";

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

/**
 * Surfaces the system "ignore battery optimizations?" dialog the first time
 * a call starts on this install — some OEMs (Samsung's One UI battery
 * manager, notably — see CallForegroundPlugin.java's doc comment) can freeze
 * this app's process mid-call even with the active-call foreground service
 * above running, and this is the only in-app way to get out from under that.
 * No-ops entirely once already prompted, regardless of whether the user
 * granted it — never re-prompt.
 */
export function requestIgnoreBatteryOptimizationsOnce() {
  if (Capacitor.getPlatform() !== "android") return;
  if (localStorage.getItem(BATTERY_PROMPT_STORAGE_KEY)) return;
  localStorage.setItem(BATTERY_PROMPT_STORAGE_KEY, "1");
  CallForeground.requestIgnoreBatteryOptimizations().catch(() => {});
}
