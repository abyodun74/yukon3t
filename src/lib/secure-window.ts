"use client";

import { useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { createSecureWindowCounter } from "@/lib/secure-window-count";

// Blocks screenshots and screen recordings of the Android app (FLAG_SECURE, SecureWindowPlugin.java) while a view
// that asks for it is open: today only someone else's profile picture shown enlarged (the protected Lightbox, opened
// from a profile's picture). FLAG_SECURE covers the whole window, so it is never on app-wide: on while such a view is
// mounted, off when the last one unmounts. While on, a screenshot or recording of the app comes out black, and so
// does the Recents thumbnail if the app is backgrounded with the view still open.
//
// Android app builds that have the plugin only: everything below is a no-op in a browser, on iOS (which has no
// equivalent) and on older Android builds without it (feature-detected with Capacitor.isPluginAvailable).

interface SecureWindowPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
}

const SecureWindow = registerPlugin<SecureWindowPlugin>("SecureWindow");

function isSupported(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("SecureWindow");
}

const counter = createSecureWindowCounter((secure) => {
  if (!isSupported()) return;
  (secure ? SecureWindow.enable() : SecureWindow.disable()).catch(() => {});
});

/** Keeps the Android app window screenshot-proof while `active` is true and the calling component is mounted. */
export function useSecureWindow(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    return counter.acquire();
  }, [active]);
}
