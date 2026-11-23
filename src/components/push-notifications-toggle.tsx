"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Settings as SettingsIcon } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { hapticSelection } from "@/lib/haptics";
import { useSettingsText } from "@/components/settings-text";
import { blockedPushHelp } from "@/lib/push-permission";
import {
  checkNativePushPermission,
  openNativeAppSettings,
  requestNativePushPermission,
} from "@/lib/native-push-client";
import {
  currentWebPushPermission,
  disableWebPush,
  enableWebPush,
  hasWebPushSubscription,
} from "@/lib/web-push-client";

type Status =
  | "loading"
  | "unsupported"
  // Native app (Capacitor): the phone's own permission.
  | "native-on"
  | "native-off"
  | "native-denied"
  // Browser: Web Push.
  | "off"
  | "on"
  | "denied";

const BUTTON =
  "flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50";

/**
 * Settings -> Notifications: whether this phone or browser actually gets notifications, and the way to turn them on.
 *
 * Native app: the phone's own permission, read live (and again whenever the app comes back to the foreground, so a
 * change made in the phone's settings shows at once). Off -> a button that shows the system prompt; blocked -> how to
 * allow them in the phone's settings (iPhone: a button that opens YuKon3t's page in Settings). This used to say
 * "Notifications are already on for the app" whatever the phone's permission was, so someone who had refused (or was
 * never asked) had no idea why they only ever saw the in-app bell.
 *
 * Browser: Web Push on/off. Never inside the native app: a Web Push subscription made in the app's WebView duplicated
 * the FCM token, so every call rang twice (capacitor-bridge.tsx removes any such leftover subscription at launch).
 */
export function PushNotificationsToggle() {
  const [status, setStatus] = useState<Status>("loading");
  const t = useSettingsText().t.notifications;
  const native = Capacitor.isNativePlatform();

  const refresh = useCallback(async () => {
    if (native) {
      const permission = await checkNativePushPermission();
      setStatus(
        permission === "granted"
          ? "native-on"
          : permission === "denied"
            ? "native-denied"
            : permission === "prompt"
              ? "native-off"
              : "unsupported",
      );
      return;
    }
    const permission = currentWebPushPermission();
    if (permission === "unsupported") setStatus("unsupported");
    else if (permission === "denied") setStatus("denied");
    else if (permission === "prompt") setStatus("off");
    else setStatus((await hasWebPushSubscription()) ? "on" : "off");
  }, [native]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      refresh().catch(() => {
        if (!cancelled) setStatus("unsupported");
      });
    };
    run();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function enable() {
    setStatus("loading");
    if (native) {
      const permission = await requestNativePushPermission();
      setStatus(permission === "granted" ? "native-on" : permission === "denied" ? "native-denied" : "native-off");
      if (permission === "granted") hapticSelection();
      return;
    }
    const permission = await enableWebPush();
    setStatus(permission === "granted" ? "on" : permission === "denied" ? "denied" : permission === "unsupported" ? "unsupported" : "off");
    if (permission === "granted") hapticSelection();
  }

  async function disable() {
    setStatus("loading");
    const removed = await disableWebPush();
    if (removed) hapticSelection();
    setStatus(removed ? "off" : "on");
  }

  if (status === "loading") {
    return <div className="h-10" aria-busy="true" />;
  }

  if (status === "native-on") {
    return <p className="text-sm text-foreground-soft">{t.nativeOn}</p>;
  }

  if (status === "native-off") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground-soft">{t.nativeOff}</p>
        <button type="button" onClick={enable} className={BUTTON}>
          <BellRing size={15} />
          {t.enable}
        </button>
      </div>
    );
  }

  if (status === "native-denied") {
    const ios = blockedPushHelp(Capacitor.getPlatform()) === "open-settings";
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground-soft">{ios ? t.nativeDeniedIos : t.nativeDeniedAndroid}</p>
        {ios && (
          <button type="button" onClick={() => openNativeAppSettings()} className={BUTTON}>
            <SettingsIcon size={15} />
            {t.openSettings}
          </button>
        )}
      </div>
    );
  }

  if (status === "unsupported") {
    return <p className="text-sm text-foreground-soft">{t.unsupported}</p>;
  }

  if (status === "denied") {
    return <p className="text-sm text-foreground-soft">{t.denied}</p>;
  }

  return (
    <button type="button" onClick={status === "on" ? disable : enable} className={BUTTON}>
      <BellRing size={15} />
      {status === "on" ? t.turnOff : t.enable}
    </button>
  );
}
