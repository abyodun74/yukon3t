"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";

/** `unread` comes from Nav's shared useNavBadges poll (src/lib/use-nav-badges.ts) — this is purely presentational now. Mirrors NotificationBell — links out to a dedicated page rather than a dropdown, same pattern. */
export function WhatsNewBell({ unread }: { unread: boolean }) {
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
