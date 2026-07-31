"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { messageSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";

export async function sendMessage(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("messageSend", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = messageSchema.safeParse({
    conversationId: formData.get("conversationId") || undefined,
    content: formData.get("content"),
  });
  if (!parsed.success || !parsed.data.conversationId) {
    return { error: "invalid" as const };
  }
  const { conversationId, content } = parsed.data;

  // Ownership check: the sender must actually be a member of this
  // conversation — never trust a client-supplied conversationId alone.
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!membership) {
    return { error: "not_a_member" as const };
  }

  const modResult = await moderateText(content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  const message = await prisma.message.create({
    data: { conversationId, senderId: user.id, content, moderationStatus },
  });

  revalidatePath(`/messages/${conversationId}`);
  return { error: null, message };
}

/**
 * Polled every few seconds by the open conversation thread. Being here
 * means the user is actively viewing this conversation, so any of the
 * other person's messages count as both delivered and read. Two separate
 * updateMany calls (rather than one) so an earlier deliveredAt timestamp
 * — e.g. set when the /messages list loaded — isn't overwritten.
 */
export async function getConversationMessages(conversationId: string) {
  const user = await requireVerifiedUser();

  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!membership) {
    return { error: "not_a_member" as const, messages: [] };
  }

  const now = new Date();
  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: user.id }, deliveredAt: null },
    data: { deliveredAt: now },
  });
  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: user.id }, readAt: null },
    data: { readAt: now },
  });

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      moderationStatus: { not: "REMOVED" },
      NOT: { deletedForUserIds: { has: user.id } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return { error: null, messages };
}

/** Hides this message for the caller only — the other participant still sees it normally. */
export async function deleteMessageForMe(messageId: string) {
  const user = await requireVerifiedUser();

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) {
    return { error: "not_found" as const };
  }
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: message.conversationId, userId: user.id } },
  });
  if (!membership) {
    return { error: "not_a_member" as const };
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { deletedForUserIds: { push: user.id } },
  });

  revalidatePath(`/messages/${message.conversationId}`);
  return { error: null };
}

/** Sender-only: replaces the content with a tombstone visible to both participants. */
export async function deleteMessageForEveryone(messageId: string) {
  const user = await requireVerifiedUser();

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) {
    return { error: "not_found" as const };
  }
  if (message.senderId !== user.id) {
    return { error: "forbidden" as const };
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { deletedForEveryoneAt: new Date(), content: "" },
  });

  revalidatePath(`/messages/${message.conversationId}`);
  return { error: null };
}

/**
 * Called when the /messages list loads: marks every unread-by-me message
 * across all conversations as delivered (their client hasn't necessarily
 * opened the specific thread yet, so not read — just confirmed synced).
 */
export async function markMessagesDelivered() {
  const user = await requireVerifiedUser();

  const memberships = await prisma.conversationMember.findMany({
    where: { userId: user.id },
    select: { conversationId: true },
  });
  const conversationIds = memberships.map((m) => m.conversationId);
  if (conversationIds.length === 0) return;

  await prisma.message.updateMany({
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: user.id },
      deliveredAt: null,
    },
    data: { deliveredAt: new Date() },
  });
}
