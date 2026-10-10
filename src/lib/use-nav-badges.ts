"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

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
 * Backs all 4 of Nav's badges (messages, connections, notifications,
 * what's-new) from one shared fetch — see src/app/api/badge-counts/route.ts
 * for why these were merged from 4 independent endpoints into 1. Refetches
 * on a realtime signal instead of polling: subscribes to this user's own
 * `nav-badges:{userId}` channel (published to by sendMessage,
 * requestConnection/respondToConnection, and the notifications
 * mark-as-read actions), and once more on tab-focus-regain as a safety net
 * (see useRealtimeEvent's own doc comment). The global `announcements`
 * channel only lights the what's-new badge — see markNewAnnouncement
 * below. `userId` is null/undefined while signed out, which skips both
 * subscriptions entirely.
 */
export function useNavBadges(userId: string | null | undefined): NavBadgeCounts {
  const [counts, setCounts] = useState<NavBadgeCounts>(EMPTY);

  const refetch = useCallback(async () => {
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
      // A failed fetch should not be visible to the user — the next signal
      // (or tab-focus resync) tries again.
    }
  }, []);

  // Ref indirection (rather than calling refetch directly) so the effect
  // below reads as a plain property access to React's own static analysis —
  // same pattern usePolling.ts uses for its own pollRef, avoiding a
  // "setState synchronously within an effect" lint false-positive for what
  // is actually an async fetch-then-setState.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  useEffect(() => {
    if (userId) refetchRef.current();
  }, [userId]);

  // The announcements channel reaches every signed-in user at once, and its
  // only publisher is createAnnouncement, right after the new row exists —
  // at which point /api/badge-counts would answer hasNewAnnouncement: true
  // for anyone (the newest announcement is newer than any
  // lastSeenAnnouncementAt). So the signal sets that locally instead of
  // sending every client to refetch all four counts in the same instant.
  // Its tab-focus resync (null payload) is a no-op: the nav-badges
  // subscription below is live under the same condition and its resync
  // already refetches everything, announcement flag included.
  const markNewAnnouncement = useCallback((payload: unknown) => {
    if (payload === null) return;
    setCounts((prev) => ({ ...prev, hasNewAnnouncement: true }));
  }, []);

  useRealtimeEvent(userId ? REALTIME_CHANNELS.navBadges(userId) : null, "changed", refetch);
  useRealtimeEvent(userId ? REALTIME_CHANNELS.announcements() : null, "changed", markNewAnnouncement);

  // Presented rather than reset via an effect+setState (which would also be
  // a "setState in effect" antipattern for a plain derived value): once
  // signed out, both subscriptions above are already skipped (channel is
  // null), so whatever was last fetched simply stops updating — this just
  // hides it instead of leaving stale counts on screen.
  return userId ? counts : EMPTY;
}
