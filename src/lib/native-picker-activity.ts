"use client";

/**
 * Tracks whether a native Android picker (photo, video, camera capture — any
 * flow that hands off to a separate system Activity via startActivityForResult)
 * is currently in flight. That handoff pauses/resumes MainActivity exactly
 * like backgrounding/returning to the app does — Capacitor's App "resume"
 * event fires the same way for both — so anything reacting to "resume" as a
 * proxy for "the user came back to the app" (see capacitor-bridge.tsx's
 * force-navigate-to-Home-on-resume) needs to tell the two apart, or every
 * picker invocation outside /home gets its host page yanked to Home mid-pick
 * (confirmed live: this silently broke photo AND video attach from any page
 * other than Home, no error, the composer just vanished under the user).
 */
// Two independent tracks, kept deliberately separate so a backstop for one
// (resolveStuckImperativePicker below) can never affect the other's own
// timing:
//  - "promise" track: withNativePickerActive wraps a pick*Native() plugin
//    call (post-composer.tsx's native gallery/video picker) that resolves
//    on its own once the result arrives.
//  - "imperative" track: markNativePickerActive/markNativePickerInactive
//    bracket a plain `<input type="file">.click()` hand-off (chat-thread.tsx's
//    messaging attach, and post-composer.tsx's own camera-capture input),
//    which has no promise of its own to await.
let promiseActiveCount = 0;
let imperativeActive = false;

// Also doubles as a re-entrancy guard: nothing previously disabled "Upload
// from device"/"Take a photo" while a pick was still awaiting a result, so
// repeated taps (someone retrying because nothing visibly happened yet)
// queued up multiple concurrent native Activity launches — each one
// silently competing for the same requestUploadUrl rate-limit budget,
// which is how a handful of retries could exhaust it and make every
// subsequent attempt fail outright. Callers should check this synchronously
// (no `await` in between) right before invoking a pick*Native()/
// markNativePickerActive() call and bail out early if it's already true —
// see post-composer.tsx.
export function isNativePickerActive() {
  return promiseActiveCount > 0 || imperativeActive;
}

// How long to keep the guard up after a native pick call itself resolves.
// Confirmed live: dropping the guard the instant the pick promise settles
// still let a photo pick (unlike a tested video pick, apparently just by
// timing luck) get yanked to Home — the Activity-transition "resume" event
// and the plugin's own result message aren't guaranteed to arrive at the
// WebView in a fixed order, so a resume that lands a beat after the result
// still needs to see the guard up. This absorbs that race without needing
// to depend on event ordering at all.
const SETTLE_MS = 1500;

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

/**
 * Imperative counterpart for a plain `<input capture>` camera hand-off,
 * which has no promise to bracket with withNativePickerActive above —
 * mark active right before `.click()`, mark inactive once the input's own
 * change/cancel resolves it (pickImages/pickVideo's onChange handlers
 * already run for that). The 60s failsafe below guards against the user
 * backgrounding the app entirely mid-capture and never returning through
 * this input's change event at all — but see resolveStuckImperativePicker
 * for the much more common gap this alone doesn't cover.
 */
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

export function markNativePickerActive() {
  imperativeActive = true;
  if (pendingTimeout) clearTimeout(pendingTimeout);
  pendingTimeout = setTimeout(() => {
    pendingTimeout = null;
    markNativePickerInactive();
  }, 60_000);
}

export function markNativePickerInactive() {
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  // Same settle-time reasoning as withNativePickerActive above.
  setTimeout(() => {
    imperativeActive = false;
  }, SETTLE_MS);
}

/**
 * Force-clears just the imperative track (never the promise one — a
 * still-pending pick*Native() call resolves, and clears itself, on its own
 * regardless of how many resumes fire while it's in flight). Used only by
 * capacitor-bridge.tsx's "resume" listener, as a backstop for the one case
 * markNativePickerInactive can't reach on its own: the OS file/camera
 * chooser closes — cancelled, or just a flaky WebView — without the
 * `<input>`'s change/cancel event ever firing at all. Without this, that one
 * cancelled/flaky attempt left every later "Upload from device"/"Take a
 * photo"/video tap silently blocked (isNativePickerActive() stayed true) for
 * up to the full 60s failsafe above — long enough that a user retrying
 * within that window (the normal case) saw the picker as simply broken.
 * "resume" itself is confirmed to fire reliably the instant that Activity
 * closes either way (see the module doc comment above), so the caller can
 * safely treat it as "the chooser is definitely gone now" far sooner than
 * 60s, with a short grace delay first for a genuine change event already in
 * flight to resolve this on its own (the normal case, where this is a
 * harmless no-op).
 */
export function resolveStuckImperativePicker() {
  imperativeActive = false;
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
}
