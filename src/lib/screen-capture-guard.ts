"use client";

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type CaptureKind = "screenshot" | "recording";

interface ScreenCaptureGuardPlugin {
  startWatching(): Promise<void>;
  stopWatching(): Promise<void>;
  addListener(
    eventName: "captureDetected",
    listenerFunc: (data: { kind: CaptureKind }) => void,
  ): Promise<PluginListenerHandle>;
}

/**
 * Bridges to the native screenshot/screen-recording detectors (see
 * ScreenCaptureGuardPlugin.java / ScreenCaptureGuardPlugin.swift) — Android
 * only ever reports "screenshot" (no public recording-detection API exists
 * there below whatever Google ships next), iOS reports both. No web
 * equivalent: browsers expose no screenshot/recording API at all, and
 * heuristics like blur/visibilitychange false-positive on ordinary
 * alt-tabbing, so this is native-app-only — the functions below no-op on
 * web rather than approximate it.
 */
const ScreenCaptureGuard = registerPlugin<ScreenCaptureGuardPlugin>("ScreenCaptureGuard");

function isNativePlatform() {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios";
}

export function startScreenCaptureWatch() {
  if (!isNativePlatform()) return;
  ScreenCaptureGuard.startWatching().catch(() => {});
}

export function stopScreenCaptureWatch() {
  if (!isNativePlatform()) return;
  ScreenCaptureGuard.stopWatching().catch(() => {});
}

/** Returns an unsubscribe function. No-ops (and returns a no-op unsubscribe) on web. */
export function onScreenCaptureDetected(callback: (kind: CaptureKind) => void): () => void {
  if (!isNativePlatform()) return () => {};

  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  ScreenCaptureGuard.addListener("captureDetected", (data) => callback(data.kind)).then((h) => {
    if (cancelled) {
      h.remove();
      return;
    }
    handle = h;
  });

  return () => {
    cancelled = true;
    handle?.remove();
  };
}
