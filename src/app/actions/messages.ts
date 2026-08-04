"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { messageSchema, groupChatSchema, groupNameSchema, correctionSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText, moderateMedia } from "@/lib/moderation";
import { recordActivity } from "@/lib/trust";
import { isEmojiOnly } from "@/lib/emoji";
import { MEDIA_LIMITS, verifyUploadedSize, deleteObject, keyFromPublicUrl } from "@/lib/storage";
import { isBlockedEitherWay } from "@/lib/blocks";
import { sendPushToUser } from "@/lib/push";
import { track } from "@/lib/analytics";

const REACTION_SELECT = { emoji: true, userId: true } as const;
const CORRECTION_INCLUDE = { author: { select: { id: true, name: true } } } as const;

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
    discoverable: formData.get("discoverable") === "on",
  });
  if (!parsed.success) {
    redirect("/messages/new?error=invalid");
  }
  const { name, memberIds, discoverable } = parsed.data;

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
      discoverable,
      createdById: user.id,
      members: {
        create: [{ userId: user.id }, ...memberIds.map((id) => ({ userId: id }))],
      },
    },
  });

  revalidatePath("/messages");
  redirect(`/messages/${conversation.id}`);
}

/** Creator-only: renames a group after creation. */
export async function renameGroupChat(conversationId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.isGroup) {
    return { error: "not_found" as const };
  }
  if (conversation.createdById !== user.id) {
    return { error: "forbidden" as const };
  }

  const parsed = groupNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { name } = parsed.data;

  const modResult = await moderateText(name);
  if (!modResult.allowed) {
    return { error: "moderation" as const };
  }

  await prisma.conversation.update({ where: { id: conversationId }, data: { name } });

  revalidatePath(`/messages/${conversationId}`);
  revalidatePath("/messages");
  return { error: null, name };
}

/** Creator-only: toggles whether a group appears in the public /messages/discover directory. */
export async function setGroupDiscoverable(conversationId: string, discoverable: boolean) {
  const user = await requireVerifiedUser();

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.isGroup) {
    return { error: "not_found" as const };
  }
  if (conversation.createdById !== user.id) {
    return { error: "forbidden" as const };
  }

  await prisma.conversation.update({ where: { id: conversationId }, data: { discoverable } });

  revalidatePath(`/messages/${conversationId}`);
  revalidatePath("/messages/discover");
  return { error: null, discoverable };
}

/** Removes the caller from a group; deletes the conversation entirely once nobody is left in it. */
export async function leaveGroup(conversationId: string) {
  const user = await requireVerifiedUser();

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.isGroup) {
    return { error: "not_found" as const };
  }

  await prisma.conversationMember.deleteMany({
    where: { conversationId, userId: user.id },
  });

  const remainingMembers = await prisma.conversationMember.findMany({
    where: { conversationId },
    orderBy: { joinedAt: "asc" },
    select: { userId: true },
  });

  if (remainingMembers.length === 0) {
    await prisma.conversation.delete({ where: { id: conversationId } });
  } else if (conversation.createdById === user.id) {
    // Creator-only actions (rename, discoverability, join-request approval)
    // all gate on createdById — leaving it pointed at someone no longer in
    // the group would permanently lock those out for everyone remaining.
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { createdById: remainingMembers[0].userId },
    });
  }

  revalidatePath("/messages");
  redirect("/messages");
}

/** Requests to join a group via its shared thread link — the creator approves/declines it. */
export async function requestToJoinGroup(conversationId: string) {
  const user = await requireVerifiedUser();

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.isGroup) {
    return { error: "not_found" as const };
  }

  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (membership) {
    return { error: "already_member" as const };
  }

  const existing = await prisma.groupJoinRequest.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!existing) {
    await prisma.groupJoinRequest.create({
      data: { conversationId, userId: user.id },
    });
  } else if (existing.status === "DECLINED") {
    await prisma.groupJoinRequest.update({
      where: { id: existing.id },
      data: { status: "PENDING", respondedAt: null },
    });
  }

  revalidatePath(`/messages/${conversationId}`);
  return { error: null };
}

/** Creator-only: approves or declines a pending join request. */
export async function respondToJoinRequest(requestId: string, approve: boolean) {
  const user = await requireVerifiedUser();

  const request = await prisma.groupJoinRequest.findUnique({
    where: { id: requestId },
    include: { conversation: true },
  });
  if (!request) {
    return { error: "not_found" as const };
  }
  if (request.conversation.createdById !== user.id) {
    return { error: "forbidden" as const };
  }

  if (approve) {
    const memberCount = await prisma.conversationMember.count({
      where: { conversationId: request.conversationId },
    });
    if (memberCount >= 20) {
      return { error: "full" as const };
    }
    await prisma.conversationMember.upsert({
      where: {
        conversationId_userId: { conversationId: request.conversationId, userId: request.userId },
      },
      create: { conversationId: request.conversationId, userId: request.userId },
      update: {},
    });
  }

  await prisma.groupJoinRequest.update({
    where: { id: requestId },
    data: { status: approve ? "APPROVED" : "DECLINED", respondedAt: new Date() },
  });

  revalidatePath(`/messages/${request.conversationId}`);
  return { error: null };
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
    mediaType: formData.get("mediaType") || "NONE",
    mediaUrl: formData.get("mediaUrl") || undefined,
    mediaThumbnailUrl: formData.get("mediaThumbnailUrl") || undefined,
  });
  if (!parsed.success || !parsed.data.conversationId) {
    return { error: "invalid" as const };
  }
  const { conversationId, content, mediaType, mediaUrl, mediaThumbnailUrl } = parsed.data;

  // Ownership check: the sender must actually be a member of this
  // conversation — never trust a client-supplied conversationId alone.
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!membership) {
    return { error: "not_a_member" as const };
  }

  // Blocking only applies to direct (1:1) conversations — a block silently
  // stops new messages between just those two people without pulling every
  // other member of a group into block-state logic.
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true, members: { select: { userId: true } } },
  });
  if (conversation && !conversation.isGroup) {
    const other = conversation.members.find((m) => m.userId !== user.id);
    if (other && (await isBlockedEitherWay(user.id, other.userId))) {
      return { error: "blocked" as const };
    }
  }

  const uploadedUrls = [
    ...(mediaType !== "NONE" && mediaUrl ? [mediaUrl] : []),
    ...(mediaType === "VIDEO" && mediaThumbnailUrl ? [mediaThumbnailUrl] : []),
  ];
  async function cleanupUploads() {
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteObject(key) : Promise.resolve();
      }),
    );
  }

  if (mediaType === "AUDIO" || mediaType === "VIDEO" || mediaType === "IMAGE") {
    const key = mediaUrl ? keyFromPublicUrl(mediaUrl) : null;
    const maxBytes =
      mediaType === "AUDIO"
        ? MEDIA_LIMITS["message-audio"]
        : mediaType === "VIDEO"
          ? MEDIA_LIMITS["message-video"]
          : MEDIA_LIMITS["message-image"];
    const ok = key && (await verifyUploadedSize({ key, maxBytes }));
    if (!ok) {
      await cleanupUploads();
      return { error: "too_large" as const };
    }
  }

  let moderationStatus: "PUBLISHED" | "FLAGGED" = "PUBLISHED";

  if (mediaType === "VIDEO") {
    // Same strict, reject-outright policy as post videos: the thumbnail
    // frame is the only inspectable signal, held to the zero-tolerance
    // media policy. A voice note has no equivalent frame to check — see the
    // NONE/AUDIO branch below, same accepted gap already documented for
    // video content generally (SECURITY.md).
    const modResult = await moderateMedia({ text: content, thumbnailUrl: mediaThumbnailUrl });
    if (!modResult.allowed) {
      await cleanupUploads();
      return { error: "moderation" as const, categories: modResult.flaggedCategories };
    }
  } else if (mediaType === "IMAGE") {
    // Unlike video, the full attached image itself is inspectable directly —
    // no thumbnail proxy needed.
    const modResult = await moderateMedia({ text: content, imageUrls: mediaUrl ? [mediaUrl] : [] });
    if (!modResult.allowed) {
      await cleanupUploads();
      return { error: "moderation" as const, categories: modResult.flaggedCategories };
    }
  } else if (content) {
    // A voice note with no caption has no text to check — skip the call
    // rather than sending an empty string to the moderation endpoint.
    const modResult = await moderateText(content);
    moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: user.id,
      content,
      mediaType,
      mediaUrl: mediaType !== "NONE" ? mediaUrl : undefined,
      mediaThumbnailUrl: mediaType === "VIDEO" ? mediaThumbnailUrl : undefined,
      moderationStatus,
    },
    include: { reactions: { select: REACTION_SELECT }, corrections: { include: CORRECTION_INCLUDE } },
  });
  await recordActivity(user.id);
  await track("MESSAGE_SENT", user.id, { conversationId, mediaType });

  const recipientIds =
    conversation?.members.map((m) => m.userId).filter((id) => id !== user.id) ?? [];
  const preview =
    mediaType === "NONE"
      ? content
      : mediaType === "IMAGE"
        ? "Sent a photo"
        : mediaType === "VIDEO"
          ? "Sent a video"
          : "Sent a voice note";
  await Promise.all(
    recipientIds.map((recipientId) =>
      sendPushToUser(recipientId, {
        title: user.name ?? "New message",
        body: preview.slice(0, 120),
        url: `/messages/${conversationId}`,
      }),
    ),
  );

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
  await Promise.all([
    prisma.message.updateMany({
      where: { conversationId, senderId: { not: user.id }, deliveredAt: null },
      data: { deliveredAt: now },
    }),
    prisma.message.updateMany({
      where: { conversationId, senderId: { not: user.id }, readAt: null },
      data: { readAt: now },
    }),
    // Member-level "I've seen up to here" marker — drives read-receipt
    // display and unread detection for groups, where a single shared
    // readAt on the message can't represent partial read status across
    // N people. Independent of the two updates above, so it runs alongside
    // them instead of after — this fires on every chat poll tick.
    prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { lastReadAt: now },
    }),
  ]);

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
      include: { reactions: { select: REACTION_SELECT }, corrections: { include: CORRECTION_INCLUDE } },
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
    include: { reactions: { select: REACTION_SELECT }, corrections: { include: CORRECTION_INCLUDE } },
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

/**
 * Suggests (or updates your own previously-suggested) correction on someone
 * else's message — never your own. Each conversation member gets at most
 * one active correction per message, matching the reaction toggle's shape.
 */
export async function suggestCorrection(messageId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) {
    return { error: "not_found" as const };
  }
  if (message.senderId === user.id) {
    return { error: "forbidden" as const };
  }
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: message.conversationId, userId: user.id } },
  });
  if (!membership) {
    return { error: "not_a_member" as const };
  }

  const parsed = correctionSchema.safeParse({ correctedText: formData.get("correctedText") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { correctedText } = parsed.data;

  const modResult = await moderateText(correctedText);
  if (!modResult.allowed) {
    return { error: "moderation" as const };
  }

  await prisma.messageCorrection.upsert({
    where: { messageId_authorId: { messageId, authorId: user.id } },
    create: { messageId, authorId: user.id, correctedText },
    update: { correctedText },
  });

  const corrections = await prisma.messageCorrection.findMany({
    where: { messageId },
    include: CORRECTION_INCLUDE,
  });

  revalidatePath(`/messages/${message.conversationId}`);
  return { error: null, corrections };
}

/** Author-only: removes a correction you suggested. */
export async function removeCorrection(correctionId: string) {
  const user = await requireVerifiedUser();

  const correction = await prisma.messageCorrection.findUnique({ where: { id: correctionId } });
  if (!correction) {
    return { error: "not_found" as const };
  }
  if (correction.authorId !== user.id) {
    return { error: "forbidden" as const };
  }

  const message = await prisma.message.findUnique({ where: { id: correction.messageId } });
  await prisma.messageCorrection.delete({ where: { id: correctionId } });

  const corrections = await prisma.messageCorrection.findMany({
    where: { messageId: correction.messageId },
    include: CORRECTION_INCLUDE,
  });

  if (message) revalidatePath(`/messages/${message.conversationId}`);
  return { error: null, corrections };
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

  await prisma.$transaction([
    prisma.message.update({
      where: { id: messageId },
      data: {
        deletedForEveryoneAt: new Date(),
        content: "",
        mediaType: "NONE",
        mediaUrl: null,
        mediaThumbnailUrl: null,
      },
    }),
    // Reactions/corrections point at content that no longer exists — leaving
    // them would show emoji reactions and "suggested correction" text on a
    // tombstoned "This message was deleted" bubble.
    prisma.messageReaction.deleteMany({ where: { messageId } }),
    prisma.messageCorrection.deleteMany({ where: { messageId } }),
  ]);

  // A voice/video note's actual file otherwise keeps sitting in R2 forever,
  // unreferenced — same cleanup discipline as deletePost's media handling.
  await Promise.all(
    [message.mediaUrl, message.mediaThumbnailUrl].filter((url): url is string => Boolean(url)).map((url) => {
      const key = keyFromPublicUrl(url);
      return key ? deleteObject(key) : Promise.resolve();
    }),
  );

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
