"use client";

import Link from "next/link";
import { Bell, BellDot } from "lucide-react";

/** Count comes from Nav's shared useNavBadges poll (src/lib/use-nav-badges.ts) — this is purely presentational now. */
export function NotificationBell({ count }: { count: number }) {
  const Icon = count > 0 ? BellDot : Bell;

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}
      className="relative rounded-lg p-1.5 text-foreground-soft hover:bg-line"
    >
      <Icon size={20} />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
