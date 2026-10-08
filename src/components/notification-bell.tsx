"use client";

import Link from "next/link";
import { Bell, BellDot } from "lucide-react";

/** Count comes from Nav's shared useNavBadges poll (src/lib/use-nav-badges.ts) — this is purely presentational now. */
export function NotificationBell({ count }: { count: number }) {
  const Icon = count > 0 ? BellDot : Bell;

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className="relative rounded-lg p-1.5 text-foreground-soft hover:bg-line"
    >
      <Icon size={20} />
      {count > 0 && (
        // chrome-rem, not rem: this badge sits in nav.tsx's capped top bar,
        // where its box (h-4/min-w-4) stops growing with the iOS text size —
        // the number has to stop with it or it outgrows the badge.
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[length:calc(var(--chrome-rem)*0.625)] font-semibold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
