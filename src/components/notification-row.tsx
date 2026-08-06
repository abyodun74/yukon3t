"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { markAsRead } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-link";

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
    | "EVENT_REMINDER";
  readAt: Date | null;
  createdAt: Date;
  actor: { id: string; name: string | null; avatarUrl?: string | null };
  postId: string | null;
  circle: { slug: string } | null;
};

function messageFor(type: NotificationData["type"]) {
  switch (type) {
    case "CONNECTION_REQUEST":
      return "sent you a connection request";
    case "CONNECTION_ACCEPTED":
      return "accepted your connection request";
    case "POST_LIKE":
      return "liked your post";
    case "POST_COMMENT":
      return "commented on your post";
    case "POST_REPOST":
      return "reposted your post";
    case "POST_SHARE":
      return "shared your post";
    case "EVENT_RSVP":
      return "is going to your event";
    case "CIRCLE_JOINED":
      return "joined your Circle";
    case "CIRCLE_CREATED":
      return "created a new Circle";
    case "EVENT_REMINDER":
      return "An event you're attending is starting soon";
  }
}

function hrefFor(notification: NotificationData) {
  if (notification.postId) return `/post/${notification.postId}`;
  if (notification.circle) return `/circles/${notification.circle.slug}`;
  if (notification.type === "CONNECTION_REQUEST" || notification.type === "CONNECTION_ACCEPTED") {
    return "/connections";
  }
  return `/u/${notification.actor.id}`;
}

export function NotificationRow({ notification }: { notification: NotificationData }) {
  const unread = !notification.readAt;
  // A reminder isn't "someone did something to you" — it's system-generated,
  // so the usual "{actor} {verb}" phrasing doesn't apply. messageFor already
  // returns a complete sentence for this type.
  const hasActor = notification.type !== "EVENT_REMINDER";

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
          {hasActor && <span className="font-semibold">{notification.actor.name}</span>}
          {hasActor && " "}
          {messageFor(notification.type)}
          <span className="ml-2 text-xs text-foreground-soft">
            {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
          </span>
        </span>
      </span>
    </Link>
  );
}
