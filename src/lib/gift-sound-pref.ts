"use client";

import { useSyncExternalStore } from "react";

// The gift reveal's sound preference, per device: muted or not (default: sound on), plus whether the one-time
// "turn off silent mode" note has been shown. The only storage the gift sound code touches; every access is guarded,
// because storage can be unavailable (private mode, a blocked WebView, quota) and that must never break a reveal.

const MUTED_KEY = "yukon3t:giftSoundMuted";
const SILENT_NOTE_KEY = "yukon3t:giftSoundSilentNoteShown";

let muted: boolean | null = null;
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered on this device; the in-memory value still applies until the page reloads.
  }
}

export function readGiftSoundMuted(): boolean {
  if (muted === null) muted = typeof window !== "undefined" && read(MUTED_KEY) === "1";
  return muted;
}

export function writeGiftSoundMuted(next: boolean) {
  if (readGiftSoundMuted() === next) return;
  muted = next;
  if (typeof window !== "undefined") write(MUTED_KEY, next ? "1" : "0");
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether gift sound is muted on this device (false on the server and before hydration). */
export function useGiftSoundMuted(): boolean {
  return useSyncExternalStore(subscribe, readGiftSoundMuted, () => false);
}

/** True the first time only, on this device: the silent-switch note is shown once. */
let noteClaimed = false;

export function claimSilentSwitchNote(): boolean {
  if (noteClaimed || typeof window === "undefined" || read(SILENT_NOTE_KEY) === "1") return false;
  noteClaimed = true;
  write(SILENT_NOTE_KEY, "1");
  return true;
}
