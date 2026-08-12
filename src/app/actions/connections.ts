"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { connectionRequestSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { track } from "@/lib/analytics";

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

    await prisma.notification.create({
      data: {
        recipientId: updated.requesterId,
        actorId: user.id,
        type: "CONNECTION_ACCEPTED",
        connectionId: updated.id,
      },
    });
    await track("CONNECTION_ACCEPTED", user.id, { requesterId: updated.requesterId });

    revalidatePath("/messages");
    revalidatePath("/connections");
    return { error: null, conversationId: conversation.id };
  }

  revalidatePath("/connections");
  return { error: null };
}
