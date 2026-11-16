import { revalidatePath } from "next/cache";
import type { IntentTag } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { collabChatVisibleWhere } from "@/lib/collab-visibility";
import { notifyBadgeChange } from "@/lib/realtime-server";
import { track } from "@/lib/analytics";

// The 1:1 chat between two people, and the "message request" that opening one with someone you're not connected to
// is: shared by startDirectMessage (actions/connections.ts) and sendBirthdayWish (src/lib/birthday-wish-server.ts). In a
// lib file, not a "use server" one: it trusts its arguments, so the caller has already checked the target (ACTIVE, not
// an admin or the guest identity, no block either way) and applied its rate limits.

/**
 * "The DM with each of these people": the ONLY place that maps a person to their 1:1 chat with `viewerId` (Discover,
 * People you may know, Discover search, Connections, the profile's Message button, the Connect popover, story replies,
 * message requests, birthday wishes). `direct-conversation-lookup-guard.test.ts` fails if anything else builds such a
 * map or queries a member pair.
 *
 * A chat counts only when it is a genuine 1:1: `isGroup: false` AND its members are exactly the viewer and that one
 * person. A group chat (an ordinary group or a collab's chat, which is always a group) the two happen to share is never
 * returned, even when it is the only chat they share: the person then has no DM and the Message button starts one. A
 * secret (E2EE) 1:1 is still a 1:1 and is returned. `collabChatVisibleWhere` is applied in the query too (a no-op for
 * a 1:1, kept so this list obeys the collab-chat rule like every other conversation list). Hidden (PIN) chats are not
 * filtered here, as before: the lists that must leave out a hidden peer (Connections) drop the peer itself, and the
 * thread page sends a locked viewer to the PIN prompt.
 *
 * Duplicates: two 1:1 rows for one pair can exist (callers find-then-create without a lock, so two racing requests can
 * each create one; the moderation Duplicates tool lists them). The oldest (createdAt, then id) always wins, so every
 * surface opens the same thread.
 *
 * One query for any number of people (no N+1). Returns otherId -> conversationId for those that have a 1:1.
 */
export async function findDirectConversationIds(viewerId: string, otherIds: readonly string[]): Promise<Map<string, string>> {
  const others = [...new Set(otherIds)].filter((id) => id && id !== viewerId);
  const result = new Map<string, string>();
  if (others.length === 0) return result;

  const rows = await prisma.conversation.findMany({
    where: {
      isGroup: false,
      AND: [
        { members: { some: { userId: viewerId } } },
        { members: { some: { userId: { in: others } } } },
        { members: { every: { userId: { in: [viewerId, ...others] } } } },
        collabChatVisibleWhere(viewerId),
      ],
    },
    select: { id: true, members: { select: { userId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const wanted = new Set(others);
  for (const row of rows) {
    const otherId = directPeerOf(viewerId, row.members);
    if (otherId && wanted.has(otherId) && !result.has(otherId)) result.set(otherId, row.id);
  }
  return result;
}

/** The one other member of a two-person chat that includes `viewerId`, or null for anything else. */
function directPeerOf(viewerId: string, members: { userId: string }[]): string | null {
  if (members.length !== 2) return null;
  const [a, b] = members;
  if (a.userId === b.userId) return null;
  if (a.userId === viewerId) return b.userId;
  if (b.userId === viewerId) return a.userId;
  return null;
}

/** The existing 1:1 chat between the two, whatever their connection status (findDirectConversationIds for one person). */
export async function findDirectConversationId(userId: string, otherId: string): Promise<string | null> {
  return (await findDirectConversationIds(userId, [otherId])).get(otherId) ?? null;
}

/**
 * Starts a 1:1 chat with someone the caller has none with yet — Instagram/Messenger's "message request" pattern.
 * Reuses the Connection model as the backing "do you want to talk to this person" state (rather than adding a
 * parallel request concept) so the rest of the app — posts visibility, the /connections list, notifications — already
 * understands it; the recipient sees the normal "wants to connect" affordance, just triggered by a message instead of
 * an explicit Connect tap. The conversation itself is created immediately (unlike the normal Connect flow, where it's
 * only created on accept in respondToConnection) so the message has somewhere to land while the connection is still
 * pending. `via` is recorded with the CONNECTION_REQUESTED analytics event.
 */
export async function startDirectConversation(
  userId: string,
  target: { id: string; openToIntents: IntentTag[] },
  via: string,
): Promise<string> {
  const targetId = target.id;
  const existingConnection = await prisma.connection.findFirst({
    where: {
      OR: [
        { requesterId: userId, targetId },
        { requesterId: targetId, targetId: userId },
      ],
    },
  });

  if (!existingConnection) {
    const intentTag = target.openToIntents[0] ?? "FRIENDSHIP";
    const connection = await prisma.connection.create({
      data: { requesterId: userId, targetId, intentTag },
    });
    await prisma.notification.create({
      data: {
        recipientId: targetId,
        actorId: userId,
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
      data: { requesterId: userId, targetId, status: "PENDING", respondedAt: null },
    });
    await prisma.notification.create({
      data: {
        recipientId: targetId,
        actorId: userId,
        type: "CONNECTION_REQUEST",
        connectionId: existingConnection.id,
      },
    });
  }
  // PENDING or ACCEPTED: left as-is — either already awaiting a response,
  // or (this shouldn't normally happen, since an accepted connection
  // already gets a conversation in respondToConnection) already mutual.

  const conversation = await prisma.conversation.create({
    data: { members: { create: [{ userId }, { userId: targetId }] } },
  });
  await notifyBadgeChange(targetId);
  await track("CONNECTION_REQUESTED", userId, { targetId, via });

  revalidatePath(`/messages/${conversation.id}`);
  revalidatePath("/connections");
  return conversation.id;
}
