"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 25_000;

export type NavBadgeCounts = {
  unreadMessages: number;
  pendingConnections: number;
  unreadNotifications: number;
  hasNewAnnouncement: boolean;
};

const EMPTY: NavBadgeCounts = {
  unreadMessages: 0,
  pendingConnections: 0,
  unreadNotifications: 0,
  hasNewAnnouncement: false,
};

/**
 * One poll backing all 4 of Nav's badges (messages, connections,
 * notifications, what's-new) — see src/app/api/badge-counts/route.ts for
 * why these were merged from 4 independent polls into 1. `enabled` mirrors
 * the previous per-badge behavior of only polling while signed in.
 */
export function useNavBadges(enabled: boolean): NavBadgeCounts {
  const [counts, setCounts] = useState<NavBadgeCounts>(EMPTY);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/badge-counts");
      if (!res.ok) return;
      const data = (await res.json()) as Partial<NavBadgeCounts>;
      setCounts({
        unreadMessages: data.unreadMessages ?? 0,
        pendingConnections: data.pendingConnections ?? 0,
        unreadNotifications: data.unreadNotifications ?? 0,
        hasNewAnnouncement: Boolean(data.hasNewAnnouncement),
      });
    } catch {
      // A failed poll should not be visible to the user — try again next tick.
    }
  }, []);

  usePolling(poll, POLL_INTERVAL_MS, enabled);

  return counts;
}
