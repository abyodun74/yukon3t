"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { markAsRead } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format-date";
import { UserAvatar } from "@/components/user-link";
import { NOTIFICATION_VERB, notificationHasActor } from "@/lib/notification-text";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

export function NotificationRow({
  notification,
  index = 0,
}: {
  notification: NotificationData;
  // Drives the same staggered fade/slide-in used by the messages inbox
  // (see .inbox-row in globals.css) so the list animates in when you tap
  // the bell, instead of appearing all at once.
  index?: number;
}) {
  const unread = !notification.readAt;
  const hasActor = notificationHasActor(notification.type);

  return (
    <Link
      href={notificationHref(notification)}
      onClick={() => {
        if (unread) markAsRead(notification.id);
      }}
      style={{ "--row-delay": `${Math.min(index, 10) * 30}ms` } as CSSProperties}
      className={cn(
        "inbox-row block rounded-lg border-l-2 px-3 py-3 text-sm hover:bg-line",
        unread ? "border-accent bg-accent/5" : "border-transparent",
      )}
    >
      <span className="flex items-start gap-2">
        {hasActor && (
          <UserAvatar avatarUrl={notification.actor.avatarUrl} name={notification.actor.name} size={20} />
        )}
        <span>
          {/* The unread state is otherwise only the row's accent border/tint. */}
          {unread && <span className="sr-only">Unread: </span>}
          {hasActor && <span className="break-words font-semibold">{notification.actor.name}</span>}
          {hasActor && " "}
          {notification.message ?? NOTIFICATION_VERB[notification.type]}
          <span
            className="ml-2 text-xs text-foreground-soft"
            title={formatDateTime(notification.createdAt)}
          >
            {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
          </span>
        </span>
      </span>
    </Link>
  );
}
