import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/client";
import { chunk, NOTIFICATION_INSERT_BATCH } from "@/lib/live-stream-start";

/** The two delegates this needs: the global client, or a transaction client when the caller needs it atomic with other writes. */
export type NotifySubscribersDb = Pick<typeof prisma, "subscription" | "notification">;

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
   * Restricts the fan-out to these user ids. For content that only some
   * people may see (a Circle-scoped live stream): telling the author's
   * other subscribers would reveal that it exists, and hand them its id.
   */
  options: { onlyRecipientIds?: string[]; db?: NotifySubscribersDb } = {},
) {
  const db = options.db ?? prisma;
  const all = await db.subscription.findMany({
    where: { subscribedToId: actorId },
    select: { id: true, subscriberId: true },
  });
  const subscribers = filterRecipients(all, options.onlyRecipientIds);
  if (subscribers.length === 0) return;

  // In batches: a host with thousands of subscribers must not become one huge INSERT statement.
  for (const batch of chunk(subscribers, NOTIFICATION_INSERT_BATCH)) {
    await db.notification.createMany({
      data: batch.map((s) => ({
        recipientId: s.subscriberId,
        actorId,
        type,
        subscriptionId: s.id,
        ...extra,
      })),
    });
  }
}

/** Keeps only the subscribers in `onlyRecipientIds`; with no list, everyone. Pure so the rule is testable without a database. */
export function filterRecipients<T extends { subscriberId: string }>(subscribers: T[], onlyRecipientIds?: string[]): T[] {
  if (!onlyRecipientIds) return subscribers;
  const allowed = new Set(onlyRecipientIds);
  return subscribers.filter((s) => allowed.has(s.subscriberId));
}
