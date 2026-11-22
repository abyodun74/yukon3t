"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { DailyCall, DailyEventObjectNonFatalError } from "@daily-co/daily-js";
import {
  SCREEN_SHARE_NOTICE_MS,
  canShareScreen,
  screenShareFailure,
  type ScreenShareFailure,
} from "@/lib/screen-share-support";

function hasGetDisplayMedia() {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Whether to offer a Share screen control on this device (see screen-share-support.ts). False until known, so the
 * button never flashes up in the native app or a mobile browser where it can't work.
 */
export function useScreenShareSupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const isNativeApp = Capacitor.isNativePlatform();
    const hasApi = hasGetDisplayMedia();
    if (isNativeApp || !hasApi) return;
    import("@daily-co/daily-js")
      .then(({ default: DailyIframe }) => {
        let dailySupportsScreenShare: boolean | null = null;
        try {
          dailySupportsScreenShare = DailyIframe.supportedBrowser().supportsScreenShare;
        } catch {
          dailySupportsScreenShare = null;
        }
        if (!cancelled) setSupported(canShareScreen({ isNativeApp, hasGetDisplayMedia: hasApi, dailySupportsScreenShare }));
      })
      .catch(() => {
        if (!cancelled) setSupported(canShareScreen({ isNativeApp, hasGetDisplayMedia: hasApi, dailySupportsScreenShare: null }));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return supported;
}

/**
 * The last screen share on this call object that failed to start, for SCREEN_SHARE_NOTICE_MS (then null again).
 * Daily reports it only as a "nonfatal-error"; without listening for it a failed share did nothing visible at all.
 */
export function useScreenShareFailure(call: DailyCall | null): ScreenShareFailure | null {
  const [failure, setFailure] = useState<ScreenShareFailure | null>(null);
  useEffect(() => {
    if (!call) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onError = (ev: DailyEventObjectNonFatalError) => {
      const kind = screenShareFailure(ev);
      if (!kind) return;
      console.error("Daily screen-share-error:", ev.errorMsg);
      setFailure(kind);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setFailure(null), SCREEN_SHARE_NOTICE_MS);
    };
    const onStarted = () => {
      if (timer) clearTimeout(timer);
      setFailure(null);
    };
    call.on("nonfatal-error", onError);
    call.on("local-screen-share-started", onStarted);
    return () => {
      call.off("nonfatal-error", onError);
      call.off("local-screen-share-started", onStarted);
      if (timer) clearTimeout(timer);
    };
  }, [call]);
  return failure;
}
