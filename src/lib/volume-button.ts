"use client";

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface VolumeButtonPlugin {
  addListener(eventName: "volumeUp", listenerFunc: () => void): Promise<PluginListenerHandle>;
}

/**
 * Bridges to VolumeButtonPlugin.java (Android only — MainActivity.onKeyDown
 * forwards the hardware volume-up key here; there's no equivalent wired up
 * for iOS or web, where this simply never fires). Purely observational on
 * the native side, so this never affects the actual system volume — it
 * just lets a muted feed video auto-unmute when the user physically turns
 * the volume up, matching mainstream apps' behavior.
 */
const VolumeButton = registerPlugin<VolumeButtonPlugin>("VolumeButton");

function isAndroid() {
  return Capacitor.getPlatform() === "android";
}

/** Returns an unsubscribe function. No-ops (and returns a no-op unsubscribe) off Android. */
export function onVolumeUp(callback: () => void): () => void {
  if (!isAndroid()) return () => {};

  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  VolumeButton.addListener("volumeUp", callback).then((h) => {
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
