"use client";

import { WifiOff, RefreshCw } from "lucide-react";
import { useShellText } from "@/components/ui-text";
import { useIsRetrying, useNetworkQuality } from "@/lib/network-quality-client";

// Purely informational — tells the user why actions might be failing or
// slow. Does not intercept or queue anything; posting/messaging etc. still
// just fail normally while offline, same as before this component existed.
// Offline: the full-width strip. Online but a request the reader is waiting
// on (a feed page, see fetchWithRetryClient) is being retried after a failed
// attempt: a small pill under the top bar that takes no layout space and
// goes away by itself. A connection that's merely slow shows nothing — the
// app adapts quietly (see useNetworkQuality) instead of nagging about it.
export function OfflineBanner() {
  const { t } = useShellText();
  const quality = useNetworkQuality();
  const retrying = useIsRetrying();

  if (quality === "offline") {
    return (
      <div
        role="status"
        className="animate-offline-banner-in flex items-center justify-center gap-2 bg-danger px-4 py-2 text-center text-sm font-medium text-accent-ink"
      >
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
        {t.offline}
      </div>
    );
  }

  if (!retrying) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--top-bar-height)+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))] z-40 flex justify-center px-4 pt-2">
      <p
        role="status"
        className="animate-offline-banner-in flex items-center gap-2 rounded-full bg-surface/95 px-3 py-1.5 text-xs font-medium text-foreground-soft shadow-md ring-1 ring-line"
      >
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        {t.slowRetrying}
      </p>
    </div>
  );
}
