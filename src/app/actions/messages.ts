"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { messageSchema, groupChatSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { isEmojiOnly } from "@/lib/emoji";

const REACTION_SELECT = { emoji: true, userId: true } as const;

/** Creates a group conversation — caller must have an ACCEPTED connection with every selected member. */
export async function createGroupChat(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("groupChatCreate", user.id);
  if (!allowed) {
    redirect("/messages/new?error=rate_limited");
  }

  const parsed = groupChatSchema.safeParse({
    name: formData.get("name"),
    memberIds: formData.getAll("memberIds"),
  });
  if (!parsed.success) {
    redirect("/messages/new?error=invalid");
  }
  const { name, memberIds } = parsed.data;

  const acceptedCount = await prisma.connection.count({
    where: {
      status: "ACCEPTED",
      OR: memberIds.map((id) => ({
        OR: [
          { requesterId: user.id, targetId: id },
          { requesterId: id, targetId: user.id },
        ],
      })),
    },
  });
  if (acceptedCount !== memberIds.length) {
    redirect("/messages/new?error=invalid");
  }

  const modResult = await moderateText(name);
  if (!modResult.allowed) {
    redirect("/messages/new?error=moderation");
  }

  const conversation = await prisma.conversation.create({
    data: {
      isGroup: true,
      name,
      members: {
        create: [{ userId: user.id }, ...memberIds.map((id) => ({ userId: id }))],
      },
    },
  });

  revalidatePath("/messages");
  redirect(`/messages/${conversation.id}`);
}

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
    include: { reactions: { select: REACTION_SELECT } },
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
    return { error: "not_a_member" as const, messages: [], conversation: null };
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
  // Member-level "I've seen up to here" marker — drives read-receipt display
  // and unread detection for groups, where a single shared readAt on the
  // message can't represent partial read status across N people.
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    data: { lastReadAt: now },
  });

  const [conversation, messages] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        isGroup: true,
        name: true,
        members: {
          select: { userId: true, lastReadAt: true, user: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.message.findMany({
      where: {
        conversationId,
        moderationStatus: { not: "REMOVED" },
        NOT: { deletedForUserIds: { has: user.id } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { reactions: { select: REACTION_SELECT } },
    }),
  ]);

  return { error: null, messages, conversation };
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

/** Sender-only: updates the content of a still-live message and stamps editedAt. */
export async function editMessage(messageId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = messageSchema.safeParse({ content: formData.get("content") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { content } = parsed.data;

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) {
    return { error: "not_found" as const };
  }
  if (message.senderId !== user.id) {
    return { error: "forbidden" as const };
  }
  if (message.deletedForEveryoneAt) {
    return { error: "deleted" as const };
  }

  const modResult = await moderateText(content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content, moderationStatus, editedAt: new Date() },
    include: { reactions: { select: REACTION_SELECT } },
  });

  revalidatePath(`/messages/${message.conversationId}`);
  return { error: null, message: updated };
}

/**
 * Toggles the caller's reaction on a message: picking the emoji they
 * already reacted with removes it, picking a different one replaces it —
 * each user gets at most one active reaction per message.
 */
export async function toggleMessageReaction(messageId: string, emoji: string) {
  const user = await requireVerifiedUser();

  if (!isEmojiOnly(emoji, 1)) {
    return { error: "invalid" as const };
  }

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

  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_userId: { messageId, userId: user.id } },
  });

  if (existing?.emoji === emoji) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.messageReaction.upsert({
      where: { messageId_userId: { messageId, userId: user.id } },
      create: { messageId, userId: user.id, emoji },
      update: { emoji },
    });
  }

  const reactions = await prisma.messageReaction.findMany({
    where: { messageId },
    select: REACTION_SELECT,
  });

  revalidatePath(`/messages/${message.conversationId}`);
  return { error: null, reactions };
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
