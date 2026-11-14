"use client";

import { Capacitor } from "@capacitor/core";

/**
 * Tracks whether a native picker (photo, video, camera capture, file chooser)
 * is currently in flight, and opens `<input type="file">` choosers through one
 * helper (`openFilePicker`) so a dismissed chooser can never leave later taps
 * blocked.
 *
 * Why the guard exists (ANDROID): a picker hands off to a separate system
 * Activity via startActivityForResult. That handoff pauses/resumes
 * MainActivity exactly like backgrounding/returning to the app does —
 * Capacitor's App "resume" event fires the same way for both — so anything
 * reacting to "resume" as a proxy for "the user came back to the app" (see
 * capacitor-bridge.tsx's force-navigate-to-Home-on-resume) needs to tell the
 * two apart, or every picker invocation outside /home gets its host page
 * yanked to Home mid-pick (confirmed live: this silently broke photo AND
 * video attach from any page other than Home). It also doubles as a
 * re-entrancy guard on Android: repeated taps used to queue several
 * concurrent native Activity launches, each one competing for the same
 * requestUploadUrl rate-limit budget.
 *
 * Why it must NOT block on iOS (2026-11-14, owner's iPhone screen recording):
 * iOS presents the Photo Library / Take Photo / Choose Files sheet over the
 * WebView without backgrounding the app, so no "resume" ever fires, and
 * WebKit fires no `change` when the sheet is dismissed without a choice. The
 * old `imperativeActive` flag therefore stayed up after one dismissed sheet
 * and every later "Upload from device" / "Take a photo" tap silently did
 * nothing for the full 60s failsafe. On iOS (Capacitor iOS and iOS/iPadOS
 * Safari) the imperative track is never raised now; `openFilePicker` only
 * debounces a double tap for `IOS_DOUBLE_TAP_MS`.
 *
 * Android and desktop also get real cancel detection for the imperative track
 * (`armImperativePicker`): the input's `cancel` event, or the window
 * regaining focus / the document becoming visible again after it was left,
 * resolves the guard after `CANCEL_GRACE_MS` unless a `change` arrived.
 */
// Two independent tracks, kept deliberately separate so a backstop for one
// (resolveStuckImperativePicker below) can never affect the other's own
// timing:
//  - "promise" track: withNativePickerActive wraps a pick*Native() plugin
//    call (Android only) that resolves on its own once the result arrives.
//  - "imperative" track: armImperativePicker/markNativePickerInactive
//    bracket a plain `<input type="file">.click()` hand-off, which has no
//    promise of its own to await.
let promiseActiveCount = 0;
let imperativeActive = false;

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export type PickerPlatform = "android" | "ios" | "other";

export interface PickerPlatformEnv {
  /** Capacitor.getPlatform(): "android" | "ios" | "web". */
  capacitorPlatform?: string;
  userAgent?: string;
  /** navigator.platform (deprecated but still the iPadOS-as-Mac tell). */
  platform?: string;
  maxTouchPoints?: number;
}

function currentEnv(): PickerPlatformEnv {
  let capacitorPlatform: string | undefined;
  try {
    capacitorPlatform = Capacitor.getPlatform();
  } catch {
    capacitorPlatform = undefined;
  }
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    capacitorPlatform,
    userAgent: nav?.userAgent ?? "",
    platform: nav?.platform ?? "",
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
  };
}

/**
 * Pure: which picker semantics apply. iOS covers Capacitor iOS, iPhone/iPod
 * Safari, and iPadOS 13+ Safari, which reports itself as a Mac
 * ("MacIntel" + a Macintosh UA) but has touch points (a real Mac reports 0).
 */
export function detectPickerPlatform(env: PickerPlatformEnv = currentEnv()): PickerPlatform {
  if (env.capacitorPlatform === "android") return "android";
  if (env.capacitorPlatform === "ios") return "ios";
  const ua = env.userAgent ?? "";
  if (/android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  const platform = env.platform ?? "";
  if (platform === "iPhone" || platform === "iPad" || platform === "iPod") return "ios";
  const touch = env.maxTouchPoints ?? 0;
  if (touch > 1 && (platform === "MacIntel" || /Macintosh/i.test(ua))) return "ios";
  return "other";
}

let platformOverride: PickerPlatform | null = null;

/** Test hook. Pass null to go back to real detection. */
export function __setPickerPlatformForTests(platform: PickerPlatform | null) {
  platformOverride = platform;
}

function pickerPlatform(): PickerPlatform {
  return platformOverride ?? detectPickerPlatform();
}

/**
 * Synchronous: should this tap go through the Android-native GalleryPicker
 * plugin (pickImagesNative / pickVideoNative) before falling back to the
 * `<input>`? Only on Capacitor Android with the plugin present in the
 * installed build. Everything else (iOS above all, where a programmatic
 * `input.click()` must run inside the user gesture with no `await` before
 * it) must call `openFilePicker` in the same tick instead.
 */
export function shouldUseAndroidNativePicker(): boolean {
  if (pickerPlatform() !== "android") return false;
  try {
    return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("GalleryPicker");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Guard state
// ---------------------------------------------------------------------------

/**
 * "A picker may be on screen right now." Read by capacitor-bridge.tsx's
 * resume handler, hidden-relock.tsx and stale-build-client.ts so they don't
 * navigate, relock or reload under an open picker. On iOS the imperative
 * track is never raised, so this is never true because of an `<input>`
 * chooser there. Taps go through `openFilePicker` / `canOpenPicker`.
 */
export function isNativePickerActive() {
  return promiseActiveCount > 0 || imperativeActive;
}

// How long to keep the guard up after a native pick call itself resolves.
// Confirmed live: dropping the guard the instant the pick promise settles
// still let a photo pick get yanked to Home — the Activity-transition
// "resume" event and the plugin's own result message aren't guaranteed to
// arrive at the WebView in a fixed order, so a resume that lands a beat
// after the result still needs to see the guard up.
export const SETTLE_MS = 1500;

/** After a cancel signal, how long a real `change` (already in flight) gets to arrive first. */
export const CANCEL_GRACE_MS = 800;

/**
 * Failsafe for a pick that never reports back at all. Android keeps the old
 * 60s, because a genuine slow pick there (browsing the gallery, a big video)
 * is a separate Activity whose return must still see the guard up; cancel
 * detection and the resume backstop clear a dismissed chooser far sooner.
 * Elsewhere 15s. Either way the timer is re-armed while the document is
 * hidden (the chooser is on top of us), up to IMPERATIVE_FAILSAFE_MAX_MS.
 */
export const IMPERATIVE_FAILSAFE_MS_ANDROID = 60_000;
export const IMPERATIVE_FAILSAFE_MS = 15_000;
export const IMPERATIVE_FAILSAFE_MAX_MS = 10 * 60_000;

/** iOS only: a second tap within this window is a double tap, not a retry. */
export const IOS_DOUBLE_TAP_MS = 1000;

export async function withNativePickerActive<T>(fn: () => Promise<T>): Promise<T> {
  promiseActiveCount++;
  try {
    return await fn();
  } finally {
    setTimeout(() => {
      promiseActiveCount = Math.max(0, promiseActiveCount - 1);
    }, SETTLE_MS);
  }
}

let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
let settleTimeout: ReturnType<typeof setTimeout> | null = null;
let lastIosOpenAt = Number.NEGATIVE_INFINITY;

/** Removes the cancel-detection listeners of the current arm, if any. */
let disarmCurrent: (() => void) | null = null;

function clearFailsafe() {
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
}

function clearSettle() {
  if (settleTimeout) {
    clearTimeout(settleTimeout);
    settleTimeout = null;
  }
}

function documentHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function startFailsafe() {
  clearFailsafe();
  const step = pickerPlatform() === "android" ? IMPERATIVE_FAILSAFE_MS_ANDROID : IMPERATIVE_FAILSAFE_MS;
  let elapsed = 0;
  const tick = () => {
    elapsed += step;
    // Still under the chooser (document hidden): keep the guard, up to the cap.
    if (documentHidden() && elapsed < IMPERATIVE_FAILSAFE_MAX_MS) {
      pendingTimeout = setTimeout(tick, step);
      return;
    }
    pendingTimeout = null;
    resolveStuckImperativePicker();
  };
  pendingTimeout = setTimeout(tick, step);
}

/**
 * Low-level: mark the imperative track active (no listeners). Prefer
 * `openFilePicker`; kept for anything that opens a chooser without an
 * `<input>` element. Calls `.click()` nowhere.
 */
export function markNativePickerActive() {
  // iOS: the sheet never backgrounds the app (no "resume" to protect
  // against) and gives no reliable close signal, so the imperative track is
  // never raised there. See the module doc comment.
  if (pickerPlatform() === "ios") return;
  clearSettle();
  imperativeActive = true;
  startFailsafe();
}

/** Called from the input's onChange: a pick arrived. Clears after SETTLE_MS. */
export function markNativePickerInactive() {
  clearFailsafe();
  if (disarmCurrent) {
    const d = disarmCurrent;
    disarmCurrent = null;
    d();
  }
  clearSettle();
  // Same settle-time reasoning as withNativePickerActive above.
  settleTimeout = setTimeout(() => {
    settleTimeout = null;
    imperativeActive = false;
  }, SETTLE_MS);
}

/**
 * Force-clears just the imperative track (never the promise one). Used by
 * cancel detection, the failsafe, and capacitor-bridge.tsx's Android
 * "resume" backstop.
 */
export function resolveStuckImperativePicker() {
  imperativeActive = false;
  clearFailsafe();
  clearSettle();
  if (disarmCurrent) {
    const d = disarmCurrent;
    disarmCurrent = null;
    d();
  }
}

/**
 * Marks the imperative track active for `input` and listens (once, all
 * listeners removed on resolution) for the chooser closing without a pick:
 *  - the input's `cancel` event (Chromium 113+, Safari 16.4+, Firefox 91+);
 *  - the window regaining `focus`, or the document turning `visible`, after
 *    it was left (`blur` / `hidden`) since arming.
 * On any of these, if no `change` arrived within CANCEL_GRACE_MS, the guard
 * is resolved. A `change` resolves it through the input's own onChange
 * (markNativePickerInactive) and removes these listeners.
 */
export function armImperativePicker(input: HTMLInputElement) {
  if (disarmCurrent) {
    const d = disarmCurrent;
    disarmCurrent = null;
    d();
  }
  if (pickerPlatform() === "ios") return;
  markNativePickerActive();

  const win: EventTarget | undefined = typeof window !== "undefined" ? window : undefined;
  const doc: EventTarget | undefined = typeof document !== "undefined" ? document : undefined;
  let left = documentHidden();
  let changed = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  const onChange = () => {
    changed = true;
    disarm();
  };
  const scheduleResolve = () => {
    if (changed || graceTimer) return;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      if (changed) return;
      if (disarmCurrent === disarm) resolveStuckImperativePicker();
    }, CANCEL_GRACE_MS);
  };
  const onCancel = () => scheduleResolve();
  const onBlur = () => {
    left = true;
  };
  const onFocus = () => {
    if (left) scheduleResolve();
  };
  const onVisibility = () => {
    if (documentHidden()) {
      left = true;
      return;
    }
    if (left) scheduleResolve();
  };

  function disarm() {
    input.removeEventListener("change", onChange);
    input.removeEventListener("cancel", onCancel);
    win?.removeEventListener("blur", onBlur);
    win?.removeEventListener("focus", onFocus);
    doc?.removeEventListener("visibilitychange", onVisibility);
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    if (disarmCurrent === disarm) disarmCurrent = null;
  }

  input.addEventListener("change", onChange);
  input.addEventListener("cancel", onCancel);
  win?.addEventListener("blur", onBlur);
  win?.addEventListener("focus", onFocus);
  doc?.addEventListener("visibilitychange", onVisibility);
  disarmCurrent = disarm;
}

/**
 * Tap guard for a picker about to open. Android/desktop: blocked while any
 * picker is in flight. iOS: the imperative track never blocks; only a
 * double tap within IOS_DOUBLE_TAP_MS of the last open (and an in-flight
 * promise-track pick, which iOS never has).
 */
export function canOpenPicker(now: number = Date.now()): boolean {
  if (promiseActiveCount > 0) return false;
  if (pickerPlatform() === "ios") return now - lastIosOpenAt >= IOS_DOUBLE_TAP_MS;
  return !imperativeActive;
}

/**
 * The one way to open an `<input type="file">` chooser. Call it synchronously
 * from the tap handler (no `await` before it: iOS WebKit drops a
 * programmatic `.click()` that has lost the user activation). Returns false
 * when nothing was opened (no input, or blocked by the guard).
 */
export function openFilePicker(input: HTMLInputElement | null | undefined, now: number = Date.now()): boolean {
  if (!input) return false;
  if (!canOpenPicker(now)) return false;
  if (pickerPlatform() === "ios") lastIosOpenAt = now;
  // A no-op on iOS (see armImperativePicker / markNativePickerActive).
  armImperativePicker(input);
  input.click();
  return true;
}

/** Test hook: back to a clean state. */
export function __resetNativePickerActivityForTests() {
  if (disarmCurrent) {
    const d = disarmCurrent;
    disarmCurrent = null;
    d();
  }
  clearFailsafe();
  clearSettle();
  promiseActiveCount = 0;
  imperativeActive = false;
  lastIosOpenAt = Number.NEGATIVE_INFINITY;
  platformOverride = null;
}
