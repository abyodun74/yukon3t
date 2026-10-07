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
    museId?: string;
    collabId?: string;
  } = {},
  /**
   * `onlyRecipientIds` restricts the fan-out to these user ids. For content
   * that only some people may see (a Circle-scoped live stream): telling the
   * author's other subscribers would reveal that it exists, and hand them
   * its id. `excludeRecipientIds` drops these ids instead — for a recipient
   * who's already getting a different, more specific notification for this
   * same event elsewhere (see CIRCLE_LIVE in actions/live-streams.ts), so
   * they get one notification for it, not two competing ones (same
   * reasoning as respondToConnectionRequest's own comment on this).
   */
  options: { onlyRecipientIds?: string[]; excludeRecipientIds?: string[] } = {},
) {
  const all = await prisma.subscription.findMany({
    where: { subscribedToId: actorId },
    select: { id: true, subscriberId: true },
  });
  const subscribers = filterRecipients(all, options.onlyRecipientIds, options.excludeRecipientIds);
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

/** Keeps only the subscribers in `onlyRecipientIds` (everyone, with no list), then drops anyone in `excludeRecipientIds`. Pure so the rule is testable without a database. */
export function filterRecipients<T extends { subscriberId: string }>(
  subscribers: T[],
  onlyRecipientIds?: string[],
  excludeRecipientIds?: string[],
): T[] {
  let result = subscribers;
  if (onlyRecipientIds) {
    const allowed = new Set(onlyRecipientIds);
    result = result.filter((s) => allowed.has(s.subscriberId));
  }
  if (excludeRecipientIds && excludeRecipientIds.length > 0) {
    const excluded = new Set(excludeRecipientIds);
    result = result.filter((s) => !excluded.has(s.subscriberId));
  }
  return result;
}
