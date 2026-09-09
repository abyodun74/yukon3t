"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "yukon3t:feedVideoMuted";

// Module-level, not per-component state — Instagram's feed has one shared
// sound preference for every video, not a per-video toggle: unmuting one
// (by tap or by turning the hardware volume up) unmutes every other video
// too, including ones not yet scrolled to.
//
// Read once at module init (not inside getSnapshot, which useSyncExternalStore
// calls on every render to check for tearing) so this stays cheap and the
// in-memory value stays the single source of truth after that. Still defaults
// to muted — same as before — unless the viewer has explicitly unmuted on
// this device before, so the very first video someone ever sees still
// follows the safe, expected-everywhere convention.
let muted = true;
if (typeof window !== "undefined") {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored !== null) muted = stored === "1";
}

const listeners = new Set<() => void>();

function setMuted(next: boolean) {
  if (muted === next) return;
  muted = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return muted;
}

/**
 * Shared mute preference for every feed video at once, remembered across
 * visits (not just the current tab/session) once the viewer unmutes once.
 * The hardcoded `true` getServerSnapshot below is intentional, not a bug —
 * SSR and the very first client hydration pass have no access to
 * localStorage, and useSyncExternalStore is specifically designed to
 * reconcile a server/first-paint snapshot that differs from the real
 * client one immediately after hydration, so the persisted preference
 * still takes effect within the same render pass a video would start
 * autoplaying in.
 */
export function useFeedVideoMuted(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return [value, setMuted];
}
