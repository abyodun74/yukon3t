"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { markAsRead } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";
import { formatDateTime, formatTimeAgo } from "@/lib/format-date";
import { UserAvatar } from "@/components/user-link";
import { decodeNotice, noticeText } from "@/lib/notification-notice";
import { notificationHasActor } from "@/lib/notification-text";
import { useUiText } from "@/components/ui-text";
import type { pagesEn } from "@/lib/i18n/en/pages";
import { aroundPlaceholder } from "@/lib/i18n/locales";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

export function NotificationRow({
  notification,
  index = 0,
  labels,
}: {
  notification: NotificationData;
  /** The Notifications page's wording, in the reader's language. */
  labels: Pick<typeof pagesEn.notifications, "unread" | "types" | "notices">;
  // Drives the same staggered fade/slide-in used by the messages inbox
  // (see .inbox-row in globals.css) so the list animates in when you tap
  // the bell, instead of appearing all at once.
  index?: number;
}) {
  const unread = !notification.readAt;
  const hasActor = notificationHasActor(notification.type);
  const { locale, t: ui } = useUiText();
  // The sentence for this kind of notification, split around where the name goes. A row that carries its own
  // `message` (an admin's feedback preview, a notice from before messageData existed) was written when it was sent,
  // so it is shown as stored after the name; a system notice stored as data is worded here, in the reader's language.
  const [before, after] = aroundPlaceholder(labels.types[notification.type], "name");
  const notice = decodeNotice(notification.messageData);
  const message = notice ? noticeText(notice, labels.notices, ui.listSeparator) : notification.message;

  return (
    <Link
      href={notificationHref(notification)}
      onClick={() => {
        if (unread) markAsRead(notification.id);
      }}
      style={{ "--row-delay": `${Math.min(index, 10) * 30}ms` } as CSSProperties}
      className={cn(
        "inbox-row block rounded-lg border-s-2 px-3 py-3 text-sm hover:bg-line",
        unread ? "border-accent bg-accent/5" : "border-transparent",
      )}
    >
      <span className="flex items-start gap-2">
        {hasActor && (
          <UserAvatar avatarUrl={notification.actor.avatarUrl} name={notification.actor.name} size={20} />
        )}
        <span>
          {/* The unread state is otherwise only the row's accent border/tint. */}
          {unread && <span className="sr-only">{labels.unread} </span>}
          {message ? (
            <>
              {hasActor && (
                <span dir="auto" className="break-words font-semibold">
                  {notification.actor.name}
                </span>
              )}
              {hasActor && " "}
              <span dir="auto">{message}</span>
            </>
          ) : hasActor ? (
            <>
              {before}
              <span dir="auto" className="break-words font-semibold">
                {notification.actor.name ?? ui.unknownName}
              </span>
              {after}
            </>
          ) : (
            labels.types[notification.type]
          )}
          <span
            className="ms-2 text-xs text-foreground-soft"
            title={formatDateTime(notification.createdAt, locale)}
          >
            {formatTimeAgo(notification.createdAt, locale, ui.time.justNow)}
          </span>
        </span>
      </span>
    </Link>
  );
}
