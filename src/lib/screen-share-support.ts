/**
 * Whether this device can share its screen in a call, and what a failed share means. Pure (no browser globals read
 * here) so the rules are unit-tested; the reading of the real environment is in use-screen-share-support.ts.
 *
 * Why the native app never offers it: Daily's startScreenShare() is getDisplayMedia() underneath, and neither the
 * Android System WebView nor iOS WKWebView implements getDisplayMedia() (Android WebView has no screen-capture path
 * at all; WKWebView exposes none to pages). Inside the Capacitor app the tap used to reach Daily, fail inside its
 * call machine and surface only as a "nonfatal-error" nobody listened to: the button did nothing at all. Real support
 * there needs native code (Android MediaProjection + a mediaProjection foreground service feeding a native WebRTC /
 * Daily client; iOS a ReplayKit broadcast upload extension), which the WebView can't be handed a track from.
 * Mobile browsers (Chrome on Android, Safari on iPhone) don't implement getDisplayMedia() either, so they are hidden by
 * the same feature check; desktop Chrome, Edge, Firefox and Safari do.
 */

export type ScreenShareEnvironment = {
  /** Capacitor.isNativePlatform(): the Android/iOS app's WebView. */
  isNativeApp: boolean;
  /** typeof navigator.mediaDevices?.getDisplayMedia === "function" */
  hasGetDisplayMedia: boolean;
  /** Daily's own DailyIframe.supportedBrowser().supportsScreenShare; null when it couldn't be read. */
  dailySupportsScreenShare: boolean | null;
};

export function canShareScreen(env: ScreenShareEnvironment): boolean {
  if (env.isNativeApp) return false;
  if (!env.hasGetDisplayMedia) return false;
  // Daily's check adds browser-version minimums on top of the feature check; unknown is left to the feature check.
  return env.dailySupportsScreenShare !== false;
}

/** What a failed share is told as. "unsupported" only if Daily itself says so (the button is normally hidden then). */
export type ScreenShareFailure = "system_denied" | "unsupported" | "failed";

/**
 * Daily reports a share that couldn't start as a "nonfatal-error" of type "screen-share-error" with a free-text
 * errorMsg (the user cancelling the picker is a separate "local-screen-share-canceled" event). Returns null for any
 * other non-fatal error, and for a cancel.
 */
export function screenShareFailure(ev: { type?: unknown; errorMsg?: unknown } | null | undefined): ScreenShareFailure | null {
  if (!ev || ev.type !== "screen-share-error") return null;
  const msg = typeof ev.errorMsg === "string" ? ev.errorMsg : "";
  // Chrome/Edge on macOS without the OS "Screen Recording" permission: "Permission denied by system".
  if (/denied by system|system permission/i.test(msg)) return "system_denied";
  if (/not supported|unsupported|not implemented|getDisplayMedia is not a function/i.test(msg)) return "unsupported";
  // The person closing the browser's picker rejects getDisplayMedia() with NotAllowedError ("Permission denied").
  // Daily normally reports that as "local-screen-share-canceled"; should it ever arrive here instead, it is still
  // the person's own choice and gets no error notice.
  if (/NotAllowedError|permission denied|cancel|abort/i.test(msg)) return null;
  return "failed";
}

/** How long a screen-share failure notice stays up in the call UI. */
export const SCREEN_SHARE_NOTICE_MS = 6000;
