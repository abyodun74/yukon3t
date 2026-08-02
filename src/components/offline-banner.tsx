"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

// Purely informational — tells the user why actions might be failing.
// Does not intercept or queue anything; posting/messaging etc. still
// just fail normally while offline, same as before this component
// existed.
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    setIsOffline(!navigator.onLine);
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-danger px-4 py-2 text-center text-sm font-medium text-accent-ink"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      You&rsquo;re offline — some actions won&rsquo;t work until you&rsquo;re back online.
    </div>
  );
}
