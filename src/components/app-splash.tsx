"use client";

import { useEffect, useState } from "react";

const SPLASH_SESSION_KEY = "yk3-splash-shown";
const HOLD_MS = 500;
const FADE_MS = 500;

function isStandalone() {
  const navAny = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navAny.standalone === true;
}

/**
 * A branded intro shown only when YuKon3t is launched as an installed PWA
 * (tapped from the home screen) — bridges the OS's own static splash (icon
 * + manifest background_color, which can't be animated or themed) into the
 * app's real aurora-gradient background with a 3D-animated wordmark, instead
 * of a hard cut from a solid color straight to content. Skipped for ordinary
 * browser tabs, and only plays once per session (sessionStorage) so internal
 * client-side navigation and repeat visits never replay it.
 */
export function AppSplash() {
  const [phase, setPhase] = useState<"hidden" | "visible" | "fading">("hidden");

  useEffect(() => {
    if (!isStandalone()) return;
    if (sessionStorage.getItem(SPLASH_SESSION_KEY)) return;

    // The sessionStorage write happens once this first timer actually
    // fires, not synchronously in the effect body — React's dev-only
    // StrictMode mount→cleanup→remount cycle would otherwise let the
    // throwaway first pass write the "already shown" flag (via a
    // synchronous write) before its own timers get cancelled, leaving the
    // real, lasting mount to see the flag already set and never show
    // anything. Deferring the write into the timer callback means the
    // cancelled first pass never touches sessionStorage at all.
    const showTimer = setTimeout(() => {
      sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
      setPhase("visible");
    }, 0);
    const fadeTimer = setTimeout(() => setPhase("fading"), HOLD_MS);
    const hideTimer = setTimeout(() => setPhase("hidden"), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <div className={`app-splash ${phase === "fading" ? "app-splash-fade" : ""}`} aria-hidden>
      <div className="aurora-bg">
        <div className="aurora-blob" />
        <div className="aurora-blob" />
        <div className="aurora-blob" />
      </div>
      <div className="splash-logo">
        <span className="splash-logo-inner font-display">YuKon3t</span>
      </div>
    </div>
  );
}
