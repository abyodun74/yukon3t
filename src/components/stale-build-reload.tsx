"use client";

import { useEffect } from "react";
import { looksLikeStaleBuildError } from "@/lib/stale-build";
import { reloadIfStale } from "@/lib/stale-build-client";

// Moves a tab (or the native app's WebView) left open across a deploy onto
// the new build, instead of leaving it to break on the first chunk or Server
// Action the new deploy no longer has. Two triggers: coming back to the
// foreground — one small request, at most once a minute, so a returning user
// is on the new build before they can touch anything — and, as a backstop, an
// error that looks like staleness. Never calls preventDefault, so Sentry
// still sees every one of those errors.
export function StaleBuildReload() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (looksLikeStaleBuildError(event.error ?? event.message)) void reloadIfStale("error");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (looksLikeStaleBuildError(event.reason)) void reloadIfStale("error");
    };
    const onVisibility = () => void reloadIfStale(document.visibilityState === "visible" ? "foreground" : "hidden");
    // Only a restore from the back/forward cache: an ordinary load has just
    // fetched this build's HTML and has nothing to check.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void reloadIfStale("foreground");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}
