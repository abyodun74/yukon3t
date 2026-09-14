"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { connectionRequestSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { track } from "@/lib/analytics";
import { pushActivityNotification } from "@/lib/notify-push";

// Matches /connections/page.tsx's own PAGE_SIZE (src/app/connections/page.tsx).
const CONNECTIONS_PAGE_SIZE = 20;

const connectionUserSelect = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  trustBand: true,
  lastSeenAt: true,
} as const;

export async function requestConnection(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("connectionRequest", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const parsed = connectionRequestSchema.safeParse({
    targetId: formData.get("targetId"),
    intentTag: formData.get("intentTag"),
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { targetId, intentTag } = parsed.data;

  if (targetId === user.id) {
    return { error: "invalid" };
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.status !== "ACTIVE") {
    return { error: "not_found" };
  }
  // Deliberately indistinguishable from "not_found" — a request shouldn't
  // reveal to the sender that they've been blocked.
  if (await isBlockedEitherWay(user.id, targetId)) {
    return { error: "not_found" };
  }
  if (!target.openToIntents.includes(intentTag)) {
    return { error: "intent_not_open" };
  }

  // The unique constraint is on the ordered (requesterId, targetId) pair, so
  // it can't catch the reverse case: target already has a pending request
  // out to us. Without this check that creates a second, independent
  // Connection row for the same two people instead of the natural "respond
  // to the existing request" flow.
  const reverse = await prisma.connection.findUnique({
    where: { requesterId_targetId: { requesterId: targetId, targetId: user.id } },
  });
  if (reverse && reverse.status === "PENDING") {
    return { error: "pending_from_them" };
  }

  const connection = await prisma.connection.upsert({
    where: { requesterId_targetId: { requesterId: user.id, targetId } },
    create: { requesterId: user.id, targetId, intentTag },
    update: { intentTag, status: "PENDING" },
  });

  await prisma.notification.create({
    data: {
      recipientId: targetId,
      actorId: user.id,
      type: "CONNECTION_REQUEST",
      connectionId: connection.id,
    },
  });
  await pushActivityNotification(targetId, "CONNECTION_REQUEST", user.name ?? "Someone", "/connections");
  await track("CONNECTION_REQUESTED", user.id, { targetId, intentTag });

  revalidatePath("/connections");
  return { error: null };
}

export async function respondToConnection(connectionId: string, accept: boolean) {
  const user = await requireVerifiedUser();

  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
  });
  if (!connection || connection.targetId !== user.id) {
    return { error: "not_found" };
  }
  if (connection.status !== "PENDING") {
    // Already responded — without this, a duplicate submit (double click, a
    // retried request) creates a second DM conversation and a second
    // "connection accepted" notification for the same pair.
    return { error: "already_responded" };
  }

  const updated = await prisma.connection.update({
    where: { id: connectionId },
    data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
  });

  if (accept) {
    // A prior connection between the same two people (declined, then later
    // re-requested and re-accepted) would otherwise leave its old DM
    // conversation orphaned and spawn a second one here — reuse it instead,
    // same find-before-create pattern as replyToStory in actions/stories.ts.
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { members: { some: { userId: updated.requesterId } } },
          { members: { some: { userId: updated.targetId } } },
        ],
      },
      select: { id: true },
    });
    const conversation =
      existingConversation ??
      (await prisma.conversation.create({
        data: {
          members: {
            create: [
              { userId: updated.requesterId },
              { userId: updated.targetId },
            ],
          },
        },
      }));

    // Accepting a connection also subscribes each side to the other's posts
    // (Subscription is otherwise a separate, one-directional, no-approval
    // "follow" — see toggleSubscription in actions/subscriptions.ts) rather
    // than adding a second, parallel "connection posted" notification type:
    // this reuses the exact fan-out createPost/createStory/etc. already do
    // for subscribers, so an accepted connection just starts getting those
    // same notifications instead of a duplicate/competing signal. Either
    // side may already subscribe to the other from before this connection
    // was accepted — skipDuplicates rather than a toggle, since a toggle
    // would incorrectly unsubscribe someone who already opted in.
    await prisma.subscription.createMany({
      data: [
        { subscriberId: updated.requesterId, subscribedToId: updated.targetId },
        { subscriberId: updated.targetId, subscribedToId: updated.requesterId },
      ],
      skipDuplicates: true,
    });

    await prisma.notification.create({
      data: {
        recipientId: updated.requesterId,
        actorId: user.id,
        type: "CONNECTION_ACCEPTED",
        connectionId: updated.id,
      },
    });
    await pushActivityNotification(updated.requesterId, "CONNECTION_ACCEPTED", user.name ?? "Someone", "/connections");
    await track("CONNECTION_ACCEPTED", user.id, { requesterId: updated.requesterId });

    revalidatePath("/messages");
    revalidatePath("/connections");
    return { error: null, conversationId: conversation.id };
  }

  revalidatePath("/connections");
  return { error: null };
}

/**
 * Starts a DM with someone the caller isn't connected to yet — Instagram/
 * Messenger's "message request" pattern. Reuses the Connection model as the
 * backing "do you want to talk to this person" state (rather than adding a
 * parallel request concept) so the rest of the app — posts visibility,
 * the /connections list, notifications — already understands it; the
 * recipient sees the normal "wants to connect" affordance, just triggered
 * by a message instead of an explicit Connect tap. The conversation itself
 * is created immediately (unlike the normal Connect flow, where it's only
 * created on accept in respondToConnection) so the message has somewhere
 * to land while the connection is still pending.
 */
export async function startDirectMessage(targetId: string) {
  const user = await requireVerifiedUser();

  if (targetId === user.id) {
    return { error: "invalid" as const };
  }

  const allowed = await checkRateLimit("connectionRequest", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.status !== "ACTIVE") {
    return { error: "not_found" as const };
  }
  if (await isBlockedEitherWay(user.id, targetId)) {
    return { error: "not_found" as const };
  }

  // Already talking — the existing thread is the answer regardless of
  // connection status (e.g. a still-pending request from a previous call
  // to this same action).
  const existingConversation = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [{ members: { some: { userId: user.id } } }, { members: { some: { userId: targetId } } }],
    },
    select: { id: true },
  });
  if (existingConversation) {
    return { error: null, conversationId: existingConversation.id };
  }

  const existingConnection = await prisma.connection.findFirst({
    where: {
      OR: [
        { requesterId: user.id, targetId },
        { requesterId: targetId, targetId: user.id },
      ],
    },
  });

  if (!existingConnection) {
    const intentTag = target.openToIntents[0] ?? "FRIENDSHIP";
    const connection = await prisma.connection.create({
      data: { requesterId: user.id, targetId, intentTag },
    });
    await prisma.notification.create({
      data: {
        recipientId: targetId,
        actorId: user.id,
        type: "CONNECTION_REQUEST",
        connectionId: connection.id,
      },
    });
  } else if (existingConnection.status === "DECLINED") {
    // A previously-declined request shouldn't stay declined forever just
    // because someone reconsiders and messages instead — re-open it as a
    // fresh pending request from whoever is messaging now.
    await prisma.connection.update({
      where: { id: existingConnection.id },
      data: { requesterId: user.id, targetId, status: "PENDING", respondedAt: null },
    });
    await prisma.notification.create({
      data: {
        recipientId: targetId,
        actorId: user.id,
        type: "CONNECTION_REQUEST",
        connectionId: existingConnection.id,
      },
    });
  }
  // PENDING or ACCEPTED: left as-is — either already awaiting a response,
  // or (this shouldn't normally happen, since an accepted connection
  // already gets a conversation in respondToConnection) already mutual.

  const conversation = await prisma.conversation.create({
    data: { members: { create: [{ userId: user.id }, { userId: targetId }] } },
  });
  await track("CONNECTION_REQUESTED", user.id, { targetId, via: "message" });

  revalidatePath(`/messages/${conversation.id}`);
  revalidatePath("/connections");
  return { error: null, conversationId: conversation.id };
}

/**
 * Auto-load-more for the "Incoming requests" list on /connections — called
 * from the client via useInfiniteScroll (src/lib/use-infinite-scroll.ts)
 * once the sentinel at the bottom of the list scrolls into view. Same
 * cursor pagination the page itself uses for its initial SSR page.
 */
export async function loadMoreIncomingConnections(cursor: string) {
  const user = await requireUser();
  const rows = await prisma.connection.findMany({
    where: { targetId: user.id, status: "PENDING" },
    include: { requester: { select: connectionUserSelect } },
    orderBy: { createdAt: "desc" },
    take: CONNECTIONS_PAGE_SIZE,
    cursor: { id: cursor },
    skip: 1,
  });
  return {
    items: rows.map((c) => ({ id: c.id, requester: c.requester, intentTag: c.intentTag })),
    hasMore: rows.length === CONNECTIONS_PAGE_SIZE,
  };
}

/** Same as loadMoreIncomingConnections, for the "Sent requests" list. */
export async function loadMoreSentConnections(cursor: string) {
  const user = await requireUser();
  const rows = await prisma.connection.findMany({
    where: { requesterId: user.id, status: "PENDING" },
    include: { target: { select: connectionUserSelect } },
    orderBy: { createdAt: "desc" },
    take: CONNECTIONS_PAGE_SIZE,
    cursor: { id: cursor },
    skip: 1,
  });
  return {
    items: rows.map((c) => ({ id: c.id, target: c.target, intentTag: c.intentTag })),
    hasMore: rows.length === CONNECTIONS_PAGE_SIZE,
  };
}

/**
 * Full ordering of the caller's accepted connections by most recent DM
 * activity (the shared conversation's latest message, same "sort by
 * activity, not thread-creation time" idea as /messages/page.tsx), falling
 * back to when the connection was accepted for a pair that's never
 * actually messaged. Only ids come back — this exists purely to establish
 * page order; per-page connection/user details are fetched separately by
 * the two callers below once they know which ids belong on their page.
 *
 * Recomputed on every call rather than backed by a denormalized column —
 * the two lightweight queries here (connection rows, then just the id +
 * latest-message-timestamp of each shared conversation) are cheap even for
 * a user with hundreds of connections, and this avoids adding a
 * lastMessageAt column that every message send would need to keep in sync.
 */
async function getAcceptedConnectionIdsByActivity(userId: string): Promise<string[]> {
  const rows = await prisma.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { targetId: userId }] },
    select: { id: true, requesterId: true, targetId: true, respondedAt: true, createdAt: true },
  });
  if (rows.length === 0) return [];

  const otherIds = rows.map((c) => (c.requesterId === userId ? c.targetId : c.requesterId));
  const conversations = await prisma.conversation.findMany({
    where: {
      isGroup: false,
      AND: [{ members: { some: { userId } } }, { members: { some: { userId: { in: otherIds } } } }],
    },
    include: {
      members: { select: { userId: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const lastActivityByOtherId = new Map<string, Date>();
  for (const conv of conversations) {
    const other = conv.members.find((m) => m.userId !== userId);
    const lastMessageAt = conv.messages[0]?.createdAt;
    if (other && lastMessageAt) lastActivityByOtherId.set(other.userId, lastMessageAt);
  }

  return rows
    .map((c) => {
      const otherId = c.requesterId === userId ? c.targetId : c.requesterId;
      const activityAt = lastActivityByOtherId.get(otherId) ?? c.respondedAt ?? c.createdAt;
      return { id: c.id, activityAt };
    })
    .sort((a, b) => b.activityAt.getTime() - a.activityAt.getTime())
    .map((c) => c.id);
}

/** Fetches full connection details for a specific set of ids, reordered to match `orderedIds` (Prisma's `in` filter doesn't preserve array order). Shared by the initial page load (connections/page.tsx) and loadMoreAcceptedConnections below. */
async function getAcceptedConnectionsByIds(userId: string, orderedIds: string[]) {
  if (orderedIds.length === 0) return [];
  const rows = await prisma.connection.findMany({
    where: { id: { in: orderedIds } },
    include: {
      requester: { select: connectionUserSelect },
      target: { select: connectionUserSelect },
    },
  });
  const byId = new Map(rows.map((c) => [c.id, c]));

  const otherIds = rows.map((c) => (c.requesterId === userId ? c.target.id : c.requester.id));
  const myConversations = otherIds.length
    ? await prisma.conversation.findMany({
        where: {
          AND: [
            { members: { some: { userId } } },
            { members: { some: { userId: { in: otherIds } } } },
          ],
        },
        include: { members: { select: { userId: true } } },
      })
    : [];
  const conversationIdByUserId = new Map<string, string>();
  for (const c of myConversations) {
    const other = c.members.find((m) => m.userId !== userId);
    if (other) conversationIdByUserId.set(other.userId, c.id);
  }

  return orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => {
      const other = c.requesterId === userId ? c.target : c.requester;
      return {
        id: c.id,
        other,
        intentTag: c.intentTag,
        conversationId: conversationIdByUserId.get(other.id) ?? null,
      };
    });
}

/** Same as loadMoreIncomingConnections, for the "Connected" list — ordered by DM activity (see getAcceptedConnectionIdsByActivity), not respondedAt. */
export async function loadMoreAcceptedConnections(cursor: string) {
  const user = await requireUser();
  const sortedIds = await getAcceptedConnectionIdsByActivity(user.id);
  const cursorIndex = sortedIds.indexOf(cursor);
  const startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1;
  const pageIds = sortedIds.slice(startIndex, startIndex + CONNECTIONS_PAGE_SIZE);

  return {
    items: await getAcceptedConnectionsByIds(user.id, pageIds),
    hasMore: startIndex + CONNECTIONS_PAGE_SIZE < sortedIds.length,
  };
}

/** First page (items + hasMore) of the "Connected" list, ordered by DM activity — used by connections/page.tsx's initial SSR render, alongside the same-shaped incoming/sent queries it already runs directly. */
export async function getInitialAcceptedConnections(userId: string) {
  const sortedIds = await getAcceptedConnectionIdsByActivity(userId);
  const pageIds = sortedIds.slice(0, CONNECTIONS_PAGE_SIZE);
  return {
    items: await getAcceptedConnectionsByIds(userId, pageIds),
    hasMore: sortedIds.length > CONNECTIONS_PAGE_SIZE,
  };
}
