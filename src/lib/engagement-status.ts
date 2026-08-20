import { prisma } from "@/lib/prisma";

export type ConnectionStatus = "PENDING" | "ACCEPTED" | "DECLINED" | null;

export type AuthorEngagementStatus = {
  connectionStatus: ConnectionStatus;
  connectionIsRequester: boolean;
  conversationId: string | null;
  subscribedByMe: boolean;
};

const EMPTY_STATUS: AuthorEngagementStatus = {
  connectionStatus: null,
  connectionIsRequester: false,
  conversationId: null,
  subscribedByMe: false,
};

/**
 * Batches Connection + Subscription status for the Connect/Subscribe icons
 * across a set of author ids relative to one viewer — shared by every
 * surface that renders those icons (PostCard's attachViewerState in
 * post-card-data.ts, Collab board cards) so each one doesn't reimplement
 * the same handful of queries. Returns a lookup with an always-present
 * default entry for authors with no connection/subscription at all.
 */
export async function getAuthorEngagementStatus(viewerId: string, authorIds: string[]) {
  const distinctAuthorIds = [...new Set(authorIds.filter((id) => id !== viewerId))];
  const map = new Map<string, AuthorEngagementStatus>();
  if (distinctAuthorIds.length === 0) return map;

  const [connections, subscriptions] = await Promise.all([
    prisma.connection.findMany({
      where: {
        OR: [
          { requesterId: viewerId, targetId: { in: distinctAuthorIds } },
          { requesterId: { in: distinctAuthorIds }, targetId: viewerId },
        ],
      },
    }),
    prisma.subscription.findMany({
      where: { subscriberId: viewerId, subscribedToId: { in: distinctAuthorIds } },
      select: { subscribedToId: true },
    }),
  ]);

  const subscribedSet = new Set(subscriptions.map((s) => s.subscribedToId));
  const connectionByAuthorId = new Map<string, { status: ConnectionStatus; isRequester: boolean }>();
  for (const c of connections) {
    const otherId = c.requesterId === viewerId ? c.targetId : c.requesterId;
    connectionByAuthorId.set(otherId, { status: c.status, isRequester: c.requesterId === viewerId });
  }

  // For any author the viewer is already ACCEPTED-connected to, resolve the
  // shared 2-person conversation so the Connect popover can link straight
  // into the chat — same batched approach as /connections/page.tsx.
  const acceptedAuthorIds = distinctAuthorIds.filter(
    (id) => connectionByAuthorId.get(id)?.status === "ACCEPTED",
  );
  const conversations = acceptedAuthorIds.length
    ? await prisma.conversation.findMany({
        where: {
          isGroup: false,
          AND: [
            { members: { some: { userId: viewerId } } },
            { members: { some: { userId: { in: acceptedAuthorIds } } } },
          ],
        },
        include: { members: { select: { userId: true } } },
      })
    : [];
  const conversationIdByAuthorId = new Map<string, string>();
  for (const c of conversations) {
    const other = c.members.find((m) => m.userId !== viewerId);
    if (other) conversationIdByAuthorId.set(other.userId, c.id);
  }

  for (const authorId of distinctAuthorIds) {
    const connection = connectionByAuthorId.get(authorId);
    map.set(authorId, {
      connectionStatus: connection?.status ?? null,
      connectionIsRequester: connection?.isRequester ?? false,
      conversationId: conversationIdByAuthorId.get(authorId) ?? null,
      subscribedByMe: subscribedSet.has(authorId),
    });
  }
  return map;
}

/** Convenience accessor — returns the default (no connection/subscription) shape for an id not in the map. */
export function engagementStatusFor(
  map: Map<string, AuthorEngagementStatus>,
  authorId: string,
): AuthorEngagementStatus {
  return map.get(authorId) ?? EMPTY_STATUS;
}
