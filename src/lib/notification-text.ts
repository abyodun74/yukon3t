import type { NotificationType } from "@/generated/prisma/client";

// Single source of truth for "what happened" copy — shared by the in-app
// notification list (notification-row.tsx) and the opt-in email sent by
// createNotification (src/lib/notify.ts), so the two never drift apart.
export const NOTIFICATION_VERB: Record<NotificationType, string> = {
  CONNECTION_REQUEST: "sent you a connection request",
  CONNECTION_ACCEPTED: "accepted your connection request",
  POST_LIKE: "liked your post",
  POST_COMMENT: "commented on your post",
  POST_REPOST: "reposted your post",
  POST_SHARE: "shared your post",
  EVENT_RSVP: "is going to your event",
  CIRCLE_JOINED: "joined your Circle",
  CIRCLE_CREATED: "created a new Circle",
  EVENT_REMINDER: "An event you're attending is starting soon",
  CIRCLE_JOIN_REQUEST: "requested to join your Circle",
  CIRCLE_JOIN_APPROVED: "approved your request to join their Circle",
  MESSAGE: "sent you a message",
  GROUP_ADDED: "added you to a group chat",
  COLLAB_JOINED: "joined your collaboration",
  SUBSCRIPTION_POST: "posted something new",
  SUBSCRIPTION_STORY: "added a new story",
};

// A reminder isn't "someone did something to you" — it's system-generated,
// so the usual "{actor} {verb}" phrasing doesn't apply; NOTIFICATION_VERB
// already returns a complete sentence for it.
export function notificationHasActor(type: NotificationType) {
  return type !== "EVENT_REMINDER";
}
