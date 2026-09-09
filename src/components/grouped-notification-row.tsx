"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { markManyAsRead } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format-date";
import { UserAvatar } from "@/components/user-link";

/**
 * A single tally row standing in for several MISSED_CALL or MESSAGE
 * notifications from the same person (see notifications/page.tsx's
 * grouping) — "3 missed calls from X" instead of three separate "X called
 * you" rows. Kept as its own component rather than folded into
 * NotificationRow: every other notification type stays one row per event
 * (a like or a comment is a single discrete thing to acknowledge, unlike a
 * missed call or message thread where the useful signal is "how many, and
 * from whom" rather than a play-by-play), so the two rendering shapes
 * don't actually share much beyond the outer link/unread styling.
 */
export function GroupedNotificationRow({
  type,
  count,
  ids,
  latestCreatedAt,
  unread,
  actor,
  conversationId,
  index = 0,
}: {
  type: "MISSED_CALL" | "MESSAGE";
  count: number;
  /** Every underlying Notification id this tally represents — marked read together on tap. */
  ids: string[];
  latestCreatedAt: Date;
  unread: boolean;
  actor: { id: string; name: string | null; avatarUrl?: string | null };
  /** Set for MESSAGE (which conversation these came from); null for MISSED_CALL, which has nowhere more specific to link than the caller's profile. */
  conversationId: string | null;
  index?: number;
}) {
  const href = type === "MESSAGE" && conversationId ? `/messages/${conversationId}` : `/u/${actor.id}`;
  const noun = type === "MESSAGE" ? "message" : "missed call";

  return (
    <Link
      href={href}
      onClick={() => {
        if (unread) markManyAsRead(ids);
      }}
      style={{ "--row-delay": `${Math.min(index, 10) * 30}ms` } as CSSProperties}
      className={cn(
        "inbox-row block rounded-lg border-l-2 px-3 py-3 text-sm hover:bg-line",
        unread ? "border-accent bg-accent/5" : "border-transparent",
      )}
    >
      <span className="flex items-start gap-2">
        <UserAvatar avatarUrl={actor.avatarUrl} name={actor.name} size={20} />
        <span>
          {count} {noun}
          {count === 1 ? "" : "s"} from <span className="break-words font-semibold">{actor.name}</span>
          <span
            className="ml-2 text-xs text-foreground-soft"
            title={formatDateTime(latestCreatedAt)}
          >
            {formatDistanceToNow(latestCreatedAt, { addSuffix: true })}
          </span>
        </span>
      </span>
    </Link>
  );
}
