"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Bell, BellDot } from "lucide-react";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 25_000;

export function NotificationBell() {
  const [count, setCount] = useState(0);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.count ?? 0);
    } catch {
      // A failed poll should not be visible to the user — try again next tick.
    }
  }, []);

  // Mounted app-wide (in Nav) for every signed-in user — same visibility-
  // aware pausing as IncomingCallListener/ChatThread/CircleVoiceRoom, so
  // backgrounded tabs stop polling instead of hitting the DB every 25s
  // regardless of whether anyone's looking.
  usePolling(poll, POLL_INTERVAL_MS);

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
