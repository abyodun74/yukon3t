"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";

const subscribe = () => () => {};

/**
 * Shows `app` inside the native iOS/Android app (the Capacitor shell) and `web` everywhere else, for wording or steps
 * that only make sense in one of them (a browser's "close this tab" has no meaning in the app). The client platform
 * check decides; `appOnServer` is the server's user-agent guess (src/lib/ios-app.ts) so the first paint usually
 * already matches.
 */
export function NativeAppSwitch({ app, web, appOnServer = false }: { app: ReactNode; web: ReactNode; appOnServer?: boolean }) {
  const inApp = useSyncExternalStore(subscribe, () => Capacitor.isNativePlatform(), () => appOnServer);
  return <>{inApp ? app : web}</>;
}
