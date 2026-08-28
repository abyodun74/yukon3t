"use client";

import { useEffect } from "react";
import { pingPresence } from "@/app/actions/presence";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/presence";

/**
 * Mounted app-wide (layout.tsx) for signed-in users. Client-only effect, not
 * a server-rendered mutation — see SECURITY.md's "real bug found and fixed"
 * note on read-receipts for why a page that can be a `<Link>` prefetch
 * target must never mutate on its server-rendered path.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === "visible") {
        pingPresence().catch(() => {});
      }
    };

    ping();
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", ping);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  return null;
}
