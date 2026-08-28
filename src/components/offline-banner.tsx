"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

function subscribe(callback: () => void) {
  window.addEventListener("offline", callback);
  window.addEventListener("online", callback);
  return () => {
    window.removeEventListener("offline", callback);
    window.removeEventListener("online", callback);
  };
}

function getSnapshot() {
  return !navigator.onLine;
}

function getServerSnapshot() {
  return false;
}

// Purely informational — tells the user why actions might be failing.
// Does not intercept or queue anything; posting/messaging etc. still
// just fail normally while offline, same as before this component
// existed.
export function OfflineBanner() {
  const isOffline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="animate-rise-in flex items-center justify-center gap-2 bg-danger px-4 py-2 text-center text-sm font-medium text-accent-ink"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      You&rsquo;re offline — some actions won&rsquo;t work until you&rsquo;re back online.
    </div>
  );
}
