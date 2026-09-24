"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";

const subscribe = () => () => {};

/**
 * Renders its children ONLY inside the native iOS app (the Capacitor
 * shell) — the inverse of HideInIosApp. For content that's iOS-specific
 * rather than iOS-excluded, e.g. "Sign in with Apple": there's no reason
 * to offer it as a login option on the web site or the Android app, only
 * on iOS.
 *
 * `shownOnServer` lets a server component that already knows the user
 * agent (see lib/ios-app.ts) skip painting the content at all when it's
 * confidently NOT the iOS app, instead of flashing it until hydration
 * removes it; the client-side platform check is what actually decides.
 */
export function IosAppOnly({ children, shownOnServer = false }: { children: ReactNode; shownOnServer?: boolean }) {
  const inIosApp = useSyncExternalStore(subscribe, () => Capacitor.getPlatform() === "ios", () => shownOnServer);
  return inIosApp ? <>{children}</> : null;
}
