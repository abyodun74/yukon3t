"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { markAsRead } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format-date";
import { UserAvatar } from "@/components/user-link";
import { NOTIFICATION_VERB, notificationHasActor } from "@/lib/notification-text";

type NotificationData = {
  id: string;
  type:
    | "CONNECTION_REQUEST"
    | "CONNECTION_ACCEPTED"
    | "POST_LIKE"
    | "POST_COMMENT"
    | "POST_REPOST"
    | "POST_SHARE"
    | "EVENT_RSVP"
    | "CIRCLE_JOINED"
    | "CIRCLE_CREATED"
    | "EVENT_REMINDER"
    | "CIRCLE_JOIN_REQUEST"
    | "CIRCLE_JOIN_APPROVED"
    | "MESSAGE"
    | "GROUP_ADDED"
    | "COLLAB_JOINED"
    | "COLLAB_JOIN_REQUEST"
    | "COLLAB_JOIN_APPROVED"
    | "COLLAB_INVITE"
    | "COLLAB_INVITE_ACCEPTED"
    | "SUBSCRIPTION_POST"
    | "SUBSCRIPTION_STORY"
    | "SUBSCRIPTION_REPOST"
    | "SUBSCRIPTION_LIVE"
    | "SUBSCRIPTION_RSVP"
    | "SUBSCRIPTION_CIRCLE_JOINED"
    | "SUBSCRIPTION_CIRCLE_CREATED"
    | "VOICE_CHANNEL_INVITE"
    | "VOICE_CHANNEL_INVITE_ACCEPTED";
  readAt: Date | null;
  createdAt: Date;
  actor: { id: string; name: string | null; avatarUrl?: string | null };
  postId: string | null;
  circle: { slug: string } | null;
  conversationId: string | null;
  collab: { id: string } | null;
  liveStreamId: string | null;
  channel: { slug: string } | null;
};

function hrefFor(notification: NotificationData) {
  if (notification.liveStreamId) return `/live/${notification.liveStreamId}`;
  if (notification.postId) return `/post/${notification.postId}`;
  if (notification.channel && notification.circle) {
    return `/circles/${notification.circle.slug}?channel=${notification.channel.slug}`;
  }
  if (notification.circle) return `/circles/${notification.circle.slug}`;
  if (notification.collab) return `/collab/${notification.collab.id}`;
  if (notification.conversationId) return `/messages/${notification.conversationId}`;
  if (notification.type === "CONNECTION_REQUEST" || notification.type === "CONNECTION_ACCEPTED") {
    return "/connections";
  }
  return `/u/${notification.actor.id}`;
}

export function NotificationRow({ notification }: { notification: NotificationData }) {
  const unread = !notification.readAt;
  const hasActor = notificationHasActor(notification.type);

  return (
    <Link
      href={hrefFor(notification)}
      onClick={() => {
        if (unread) markAsRead(notification.id);
      }}
      className={cn(
        "block rounded-lg border-l-2 px-3 py-3 text-sm hover:bg-line",
        unread ? "border-accent bg-accent/5" : "border-transparent",
      )}
    >
      <span className="flex items-start gap-2">
        {hasActor && (
          <UserAvatar avatarUrl={notification.actor.avatarUrl} name={notification.actor.name} size={20} />
        )}
        <span>
          {hasActor && <span className="break-words font-semibold">{notification.actor.name}</span>}
          {hasActor && " "}
          {NOTIFICATION_VERB[notification.type]}
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
