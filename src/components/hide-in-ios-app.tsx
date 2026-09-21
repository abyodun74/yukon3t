"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";

const subscribe = () => () => {};

/**
 * Renders its children everywhere EXCEPT inside the native iOS app (the
 * Capacitor shell). Used for the ad-booking ("Advertise") entry points: that
 * flow is a business-to-business purchase made on the web via Stripe, and App
 * Store review reads any purchase call-to-action inside an iOS app against the
 * in-app-purchase rules — so the iOS app doesn't surface it (the web site and
 * the Android app are unchanged).
 *
 * `hiddenOnServer` lets a server component that already knows the user agent
 * (see lib/ios-app.ts) skip painting the content at all, instead of showing it
 * until hydration; the client-side platform check is what actually decides.
 */
export function HideInIosApp({ children, hiddenOnServer = false }: { children: ReactNode; hiddenOnServer?: boolean }) {
  const inIosApp = useSyncExternalStore(subscribe, () => Capacitor.getPlatform() === "ios", () => hiddenOnServer);
  return inIosApp ? null : <>{children}</>;
}
