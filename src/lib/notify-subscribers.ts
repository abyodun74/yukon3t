import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/client";

/**
 * Fans a notification out to every one of `actorId`'s subscribers — the
 * shared shape behind every SUBSCRIPTION_* notification type (new post,
 * story, repost, live stream, RSVP, Circle join/create). Same
 * findMany-then-createMany pattern as CIRCLE_JOINED's fan-out
 * (actions/circles.ts), just generalized across callers. Each row carries
 * `subscriptionId` so a notification can be traced back to the specific
 * Subscription that produced it, same as `connectionId` on CONNECTION_*
 * notifications.
 */
export async function notifySubscribers(
  actorId: string,
  type: NotificationType,
  extra: {
    postId?: string;
    storyId?: string;
    circleId?: string;
    liveStreamId?: string;
  } = {},
) {
  const subscribers = await prisma.subscription.findMany({
    where: { subscribedToId: actorId },
    select: { id: true, subscriberId: true },
  });
  if (subscribers.length === 0) return;

  await prisma.notification.createMany({
    data: subscribers.map((s) => ({
      recipientId: s.subscriberId,
      actorId,
      type,
      subscriptionId: s.id,
      ...extra,
    })),
  });
}
