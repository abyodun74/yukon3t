import { revalidatePath } from "next/cache";
import type { IntentTag } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyBadgeChange } from "@/lib/realtime-server";
import { track } from "@/lib/analytics";

// The 1:1 chat between two people, and the "message request" that opening one with someone you're not connected to
// is: shared by startDirectMessage (actions/connections.ts) and sendBirthdayWish (src/lib/birthday-wish-server.ts). In a
// lib file, not a "use server" one: it trusts its arguments, so the caller has already checked the target (ACTIVE, not
// an admin or the guest identity, no block either way) and applied its rate limits.

/** The existing 1:1 chat between the two, whatever their connection status. */
export async function findDirectConversationId(userId: string, otherId: string): Promise<string | null> {
  const existing = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherId } } }],
    },
    select: { id: true },
  });
  return existing?.id ?? null;
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
