import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/client";

/**
 * Fans a notification out to every one of `actorId`'s accepted connections
 * — used only for CONNECTION_POST (a CONNECTIONS_ONLY-visibility post,
 * see createPost in actions/circles.ts). Every other connection-facing
 * notification (new story, Muse, public Collab) goes through
 * notifySubscribers instead: accepting a connection request auto-
 * subscribes both sides (see respondToConnectionRequest in
 * actions/connections.ts), so those already reach every connection without
 * a separate fan-out — this one exists only because CONNECTIONS_ONLY posts
 * are invisible to a subscriber who isn't also a connection, so they can't
 * just piggyback on the subscriber fan-out the way the others do.
 *
 * Same findMany-then-createMany pattern as notify-subscribers.ts, just
 * querying Connection instead of Subscription: a Connection row has no
 * fixed "owner" side (requesterId/targetId, not
 * subscriberId/subscribedToId), so this maps each row to whichever side
 * isn't the actor. Each notification's connectionId traces back to the
 * specific Connection that produced it, same idea as subscriptionId on
 * SUBSCRIPTION_* notifications.
 */
export async function notifyConnections(
  actorId: string,
  type: NotificationType,
  extra: {
    postId?: string;
  } = {},
) {
  const connections = await prisma.connection.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: actorId }, { targetId: actorId }],
    },
    select: { id: true, requesterId: true, targetId: true },
  });
  if (connections.length === 0) return;

  await prisma.notification.createMany({
    data: connections.map((c) => ({
      recipientId: c.requesterId === actorId ? c.targetId : c.requesterId,
      actorId,
      type,
      connectionId: c.id,
      ...extra,
    })),
  });
}
