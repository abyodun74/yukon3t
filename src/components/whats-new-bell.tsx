"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 60_000;

/** Mirrors NotificationBell — links out to a dedicated page rather than a dropdown, same pattern. */
export function WhatsNewBell() {
  const [unread, setUnread] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements/unread-count");
      if (!res.ok) return;
      const data = await res.json();
      setUnread(Boolean(data.unread));
    } catch {
      // A failed poll should not be visible to the user — try again next tick.
    }
  }, []);

  usePolling(poll, POLL_INTERVAL_MS);

  return (
    <Link
      href="/whats-new"
      aria-label={unread ? "What's new — unread updates" : "What's new"}
      className="relative rounded-lg p-1.5 text-foreground-soft hover:bg-line"
    >
      <Megaphone size={20} />
      {unread && (
        <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-danger" />
      )}
    </Link>
  );
}
