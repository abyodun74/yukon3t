"use client";

import { useSyncExternalStore } from "react";

// Module-level, not per-component state — Instagram's feed has one shared
// sound preference for every video, not a per-video toggle: unmuting one
// (by tap or by turning the hardware volume up) unmutes every other video
// too, including ones not yet scrolled to.
let muted = true;
const listeners = new Set<() => void>();

function setMuted(next: boolean) {
  if (muted === next) return;
  muted = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return muted;
}

/** Shared mute preference for every feed video at once. */
export function useFeedVideoMuted(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return [value, setMuted];
}
