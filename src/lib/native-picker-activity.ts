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
let activeCount = 0;

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
  return activeCount > 0;
}

export async function withNativePickerActive<T>(fn: () => Promise<T>): Promise<T> {
  activeCount++;
  try {
    return await fn();
  } finally {
    activeCount = Math.max(0, activeCount - 1);
  }
}

/**
 * Imperative counterpart for a plain `<input capture>` camera hand-off,
 * which has no promise to bracket with withNativePickerActive above —
 * mark active right before `.click()`, mark inactive once the input's own
 * change/cancel resolves it (pickImages/pickVideo's onChange handlers
 * already run for that). The safety timeout guards only against the user
 * backgrounding the app entirely mid-capture and never returning through
 * this input's change event — worst case a later real resume goes
 * unhandled once, not a stuck app.
 */
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

export function markNativePickerActive() {
  activeCount++;
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
  activeCount = Math.max(0, activeCount - 1);
}
