"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { latestMessageAtByConversation } from "@/lib/latest-messages";
import { deleteTranslationsOf } from "@/lib/translation-server";
import {
  messageSchema,
  groupChatSchema,
  groupNameSchema,
  addGroupMembersSchema,
  correctionSchema,
  forwardMessageSchema,
} from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText, moderateMedia } from "@/lib/moderation";
import { isEmojiOnly } from "@/lib/emoji";
import { MEDIA_LIMITS, verifyUploadedSize, deleteOwnedObject, keyFromPublicUrl } from "@/lib/storage";
import { checkVideoThumbnail } from "@/lib/video-thumbnail-check";
import { deleteMediaIfUnreferenced } from "@/lib/media-cleanup";
import { getBlockedEitherWayIds, isBlockedEitherWay } from "@/lib/blocks";
import { isSecretChat, checkSecretSend, textForModeration } from "@/lib/e2ee/secret-chat";
import { isEncryptedContent } from "@/lib/e2ee/constants";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { updateConversationEmbedding } from "@/lib/embeddings";
import { isGiphyUrl } from "@/lib/giphy";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { afterMessageSent } from "@/lib/after-message-sent";
import { destroyViewOnceMedia } from "@/lib/view-once-media";
import { isConversationLocked, isMembershipLocked } from "@/lib/hidden-chats";
import {
  forwardSourceRefusal,
  forwardTargetRefusal,
  forwardTargetsFor,
  forwardedMessageData,
  uniqueForwardTargets,
} from "@/lib/message-forward";

const REACTION_SELECT = { emoji: true, userId: true } as const;
const CORRECTION_INCLUDE = { author: { select: { id: true, name: true } } } as const;
// Only meaningful for messages sent via replyToStory — story stays populated
// as long as the Story row itself hasn't expired/been swept by the cron
// (Message.storyId is onDelete: SetNull, so it just quietly goes back to
// null afterward and the message renders as a normal text message).
const STORY_SELECT = {
  select: {
    id: true,
    mediaType: true,
    mediaUrl: true,
    mediaThumbnailUrl: true,
    embedProvider: true,
    embedId: true,
    caption: true,
  },
} as const;
// Enough to render a quoted preview above the reply bubble — content is
// already blanked by deleteMessageForEveryone if the original was deleted,
// so no separate "deleted" flag is needed here.
const REPLY_TO_SELECT = {
  select: {
    id: true,
    content: true,
    mediaType: true,
    deletedForEveryoneAt: true,
    sender: { select: { id: true, name: true } },
  },
} as const;

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
  await updateConversationEmbedding(conversation.id, { name });

  // Same GROUP_ADDED type addGroupMembers below sends for someone added to
  // an *existing* group — creating a brand new one with members already
  // picked is functionally the same event for them, and used to notify no
  // one at all.
  await prisma.notification.createMany({
    data: memberIds.map((id) => ({
      recipientId: id,
      actorId: user.id,
      type: "GROUP_ADDED" as const,
      conversationId: conversation.id,
    })),
  });

  revalidatePath("/messages");
  redirect(`/messages/${conversation.id}`);
}

/** Creator-only: adds more of the caller's accepted connections to an existing group. */
export async function addGroupMembers(conversationId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { members: { select: { userId: true } } },
  });
  if (!conversation || !conversation.isGroup) {
    return { error: "not_found" as const };
  }
  if (conversation.createdById !== user.id) {
    return { error: "forbidden" as const };
  }

  const parsed = addGroupMembersSchema.safeParse({ memberIds: formData.getAll("memberIds") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  const existingIds = new Set(conversation.members.map((m) => m.userId));
  const newIds = parsed.data.memberIds.filter((id) => !existingIds.has(id));
  if (newIds.length === 0) {
    return { error: "invalid" as const };
  }

  // Same requirement as group creation — never trust client-supplied ids,
  // only accepted connections of the person adding them can be added.
  const acceptedCount = await prisma.connection.count({
    where: {
      status: "ACCEPTED",
      OR: newIds.map((id) => ({
        OR: [
          { requesterId: user.id, targetId: id },
          { requesterId: id, targetId: user.id },
        ],
      })),
    },
  });
  if (acceptedCount !== newIds.length) {
    return { error: "invalid" as const };
  }

  await prisma.conversationMember.createMany({
    data: newIds.map((id) => ({ conversationId, userId: id })),
  });
  await prisma.notification.createMany({
    data: newIds.map((id) => ({
      recipientId: id,
      actorId: user.id,
      type: "GROUP_ADDED" as const,
      conversationId,
    })),
  });

  revalidatePath(`/messages/${conversationId}`);
  return { error: null };
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
  await updateConversationEmbedding(conversationId, { name });

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

/**
 * Creator or site admin: deletes a group entirely for every member, not
 * just the caller — see leaveGroup above for removing just yourself (which
 * only deletes the conversation as a side effect of the last member
 * leaving). Same cascade as the admin-only deleteConversation below;
 * unlike that one this also covers a non-admin creator's own group, and is
 * reachable both from inside the group itself (creator) and from
 * /admin/groups (any admin, for policy violations/spam — same
 * isAdminOverride pattern as deleteCircle in actions/circles.ts).
 */
export async function deleteGroupChat(conversationId: string) {
  const user = await requireVerifiedUser();

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.isGroup) {
    return { error: "not_found" as const };
  }
  if (conversation.createdById !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  await prisma.conversation.delete({ where: { id: conversationId } });

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
    try {
      await prisma.groupJoinRequest.create({
        data: { conversationId, userId: user.id },
      });
    } catch (err) {
      // A fast double-click can race past the !existing check above —
      // @@unique([conversationId, userId]) then rejects the second create.
      // The request already exists either way, so this is a success, not
      // an error.
      if (!isUniqueConstraintError(err)) throw err;
    }
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
    // No group-size cap — membership is unlimited.
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

/**
 * Admin-only: deletes a conversation outright, cascading to its members and
 * messages (see onDelete: Cascade on ConversationMember/Message in schema.prisma).
 * Used by the admin moderation "Duplicates" tool to clean up a redundant DM
 * thread between the same two people (see respondToConnection's find-before-
 * create fix in actions/connections.ts, which stops new ones forming).
 */
export async function deleteConversation(conversationId: string) {
  const user = await requireVerifiedUser();
  if (!user.isAdmin) {
    return { error: "forbidden" as const };
  }

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) {
    return { error: "not_found" as const };
  }

  await prisma.conversation.delete({ where: { id: conversationId } });

  revalidatePath("/messages");
  revalidatePath("/admin/moderation");
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
    replyToMessageId: formData.get("replyToMessageId") || undefined,
  });
  if (!parsed.success || !parsed.data.conversationId) {
    return { error: "invalid" as const };
  }
  const { conversationId, content, mediaType, mediaUrl, mediaThumbnailUrl, replyToMessageId } = parsed.data;

  // Ownership check: the sender must actually be a member of this
  // conversation — never trust a client-supplied conversationId alone.
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!membership) {
    return { error: "not_a_member" as const };
  }
  // A chat the sender has hidden takes messages only while their PIN unlock is live. When it runs out mid-thread the
  // client sends them to the PIN prompt and back (chat-thread.tsx), keeping what they typed.
  if (await isMembershipLocked(membership, user.id)) {
    return { error: "hidden_locked" as const };
  }

  // Blocking only applies to direct (1:1) conversations — a block silently
  // stops new messages between just those two people without pulling every
  // other member of a group into block-state logic.
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true, members: { select: { userId: true, e2eeEnabledAt: true } } },
  });
  if (conversation && !conversation.isGroup) {
    const other = conversation.members.find((m) => m.userId !== user.id);
    if (other && (await isBlockedEitherWay(user.id, other.userId))) {
      return { error: "blocked" as const };
    }
  }
  // A secret chat (both people opted in — see src/lib/e2ee/secret-chat.ts):
  // the text is end-to-end encrypted, so the server can't read it, scan it or
  // preview it. Everything below that touches `content` goes through `secret`.
  const secret = conversation ? isSecretChat(conversation) : false;

  // A client-supplied replyToMessageId must belong to this same
  // conversation — otherwise someone could quote-reply to a message from a
  // conversation they're not even in, leaking its content into this thread.
  if (replyToMessageId) {
    const target = await prisma.message.findUnique({
      where: { id: replyToMessageId },
      select: { conversationId: true },
    });
    if (!target || target.conversationId !== conversationId) {
      return { error: "invalid" as const };
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
        return key ? deleteOwnedObject(key, user.id) : Promise.resolve();
      }),
    );
  }

  // Refuse plaintext text in a secret chat rather than store it: a client that
  // forgot to encrypt, or one caught by secret mode switching on mid-send,
  // must not be able to put readable text into a thread both people believe is
  // encrypted. The client re-checks the chat's state and re-sends encrypted.
  const secretGate = checkSecretSend({ secret, content });
  if (secretGate) {
    await cleanupUploads();
    return { error: secretGate };
  }
  const scanText = textForModeration({ secret, content });

  if (mediaType === "AUDIO" || mediaType === "VIDEO" || mediaType === "IMAGE") {
    const key = mediaUrl ? keyFromPublicUrl(mediaUrl) : null;
    const maxBytes =
      mediaType === "AUDIO"
        ? MEDIA_LIMITS["message-audio"]
        : mediaType === "VIDEO"
          ? MEDIA_LIMITS["message-video"]
          : MEDIA_LIMITS["message-image"];
    const ok = key && (await verifyUploadedSize({ key, maxBytes, ownerId: user.id }));
    if (!ok) {
      await cleanupUploads();
      return { error: "too_large" as const };
    }
    // A video's still frame: required, the sender's own upload, size-capped (see video-thumbnail-check.ts).
    if (mediaType === "VIDEO") {
      const thumb = await checkVideoThumbnail(mediaThumbnailUrl, user.id);
      if (thumb === "required") return { error: "frame_required" as const };
      if (thumb !== "ok") {
        await cleanupUploads();
        return { error: thumb === "too_large" ? ("too_large" as const) : ("invalid" as const) };
      }
    }
  } else if (mediaType === "GIF") {
    // Never uploaded to this app's R2 bucket (picked straight from Giphy
    // search), so there's no ownership/size check to run — the Giphy host
    // check is the only gate. Also skips this app's own moderation pipeline
    // below, trusting Giphy's own pre-moderated catalog instead.
    if (!mediaUrl || !isGiphyUrl(mediaUrl)) {
      return { error: "invalid" as const };
    }
  }

  let moderationStatus: "PUBLISHED" | "FLAGGED" = "PUBLISHED";

  if (mediaType === "VIDEO") {
    // Same strict, reject-outright policy as post videos: the thumbnail
    // frame is the only inspectable signal, held to the zero-tolerance
    // media policy. A voice note has no equivalent frame to check — see the
    // NONE/AUDIO branch below, same accepted gap already documented for
    // video content generally (SECURITY.md).
    const modResult = await moderateMedia({ text: scanText, thumbnailUrl: mediaThumbnailUrl });
    if (!modResult.allowed) {
      await cleanupUploads();
      return { error: "moderation" as const, categories: modResult.flaggedCategories };
    }
  } else if (mediaType === "IMAGE") {
    // Unlike video, the full attached image itself is inspectable directly —
    // no thumbnail proxy needed.
    const modResult = await moderateMedia({ text: scanText, imageUrls: mediaUrl ? [mediaUrl] : [] });
    if (!modResult.allowed) {
      await cleanupUploads();
      return { error: "moderation" as const, categories: modResult.flaggedCategories };
    }
  } else if (scanText) {
    // A voice note with no caption has no text to check — skip the call
    // rather than sending an empty string to the moderation endpoint. (In a
    // secret chat there's never text to check: scanText is "".)
    const modResult = await moderateText(scanText);
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
      replyToMessageId,
    },
    include: {
      reactions: { select: REACTION_SELECT },
      corrections: { include: CORRECTION_INCLUDE },
      story: STORY_SELECT,
      replyTo: REPLY_TO_SELECT,
    },
  });
  await afterMessageSent({
    user,
    conversationId,
    memberIds: conversation?.members.map((m) => m.userId) ?? [],
    secret,
    content,
    mediaType,
  });
  revalidatePath(`/messages/${conversationId}`);
  return { error: null, message };
}

/** How far before a member's lastReadAt getConversationMessages still looks for unmarked messages (see there). */
const READ_MARK_MARGIN_MS = 10 * 60 * 1000;

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
  // Before anything is marked read or returned: a hidden chat that isn't unlocked gives up nothing.
  if (await isMembershipLocked(membership, user.id)) {
    return { error: "hidden_locked" as const, messages: [], conversation: null };
  }

  const now = new Date();
  // Only messages from READ_MARK_MARGIN_MS before the caller's own lastReadAt onwards can still be undelivered or
  // unread: lastReadAt is written only here, in the same transaction as the two updates, so every earlier run already
  // marked everything older than it. The margin covers a message whose createdAt (set when its insert was built) lies
  // before a lastReadAt written while that insert was still in flight, and clock skew between server instances. With
  // no lastReadAt yet (never opened) the whole conversation is scanned once. This keeps both updates on the
  // (conversationId, createdAt) index instead of reading every message of the chat on each refetch.
  const markFrom = new Date((membership.lastReadAt?.getTime() ?? 0) - READ_MARK_MARGIN_MS);
  const unmarkedScope = { conversationId, senderId: { not: user.id }, createdAt: { gte: markFrom } };
  const [deliveredResult, readResult] = await prisma.$transaction([
    prisma.message.updateMany({
      where: { ...unmarkedScope, deliveredAt: null },
      data: { deliveredAt: now },
    }),
    prisma.message.updateMany({
      where: { ...unmarkedScope, readAt: null },
      data: { readAt: now },
    }),
    // Member-level "I've seen up to here" marker — drives read-receipt
    // display and unread detection for groups, where a single shared
    // readAt on the message can't represent partial read status across
    // N people. Written only when someone else's message is newer than it
    // (or it was never set while there is one): every reader compares it
    // with other members' messages only (unread dots and the badge with
    // messages not sent by this member, "Seen by" with the other side's
    // own messages), so leaving it where it is when nothing newer from
    // anyone else exists changes no answer and saves a write per refetch.
    prisma.$executeRaw`
      UPDATE "ConversationMember" cm
      SET "lastReadAt" = ${now}
      WHERE cm."conversationId" = ${conversationId}
        AND cm."userId" = ${user.id}
        AND EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."conversationId" = cm."conversationId"
            AND m."senderId" <> cm."userId"
            AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
        )`,
  ]);
  // Tells the other member(s)' already-open thread to refetch so their
  // checkmarks update live — gated on something actually changing so
  // viewing a conversation with nothing new to mark doesn't publish at all
  // (which also means this can't ping-pong: the other side's resulting
  // refetch finds its own messages already delivered/read and publishes
  // nothing further).
  if (deliveredResult.count > 0 || readResult.count > 0) {
    await publishEvent(REALTIME_CHANNELS.conversation(conversationId), "changed");
  }

  const [conversation, recentMessages] = await Promise.all([
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
    // Newest 200 first (not oldest) then reversed for display — otherwise a
    // conversation past 200 messages would be permanently stuck showing the
    // same oldest slice forever, with every new message (including ones the
    // caller just sent) invisible since it'd never fall inside the take.
    prisma.message.findMany({
      where: {
        conversationId,
        moderationStatus: { not: "REMOVED" },
        NOT: { deletedForUserIds: { has: user.id } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        reactions: { select: REACTION_SELECT },
        corrections: { include: CORRECTION_INCLUDE },
        story: STORY_SELECT,
        replyTo: REPLY_TO_SELECT,
      },
    }),
  ]);

  return { error: null, messages: recentMessages.reverse(), conversation };
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
  if (await isMembershipLocked(membership, user.id)) {
    return { error: "hidden_locked" as const };
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
  // A view-once message is its media and nothing else: it is sent without text and stays that way.
  if (message.viewOnce) {
    return { error: "invalid" as const };
  }
  if (await isConversationLocked(user.id, message.conversationId)) {
    return { error: "hidden_locked" as const };
  }

  // Same rule as sendMessage: an edit in a secret chat must be ciphertext, and
  // is never scanned.
  const editedConversation = await prisma.conversation.findUnique({
    where: { id: message.conversationId },
    select: { isGroup: true, members: { select: { e2eeEnabledAt: true } } },
  });
  const secret = editedConversation ? isSecretChat(editedConversation) : false;
  const secretGate = checkSecretSend({ secret, content });
  if (secretGate) {
    return { error: secretGate };
  }
  const scanText = textForModeration({ secret, content });
  const moderationStatus =
    scanText && !(await moderateText(scanText)).allowed ? "FLAGGED" : "PUBLISHED";

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { content, moderationStatus, editedAt: new Date() },
    include: {
      reactions: { select: REACTION_SELECT },
      corrections: { include: CORRECTION_INCLUDE },
      story: STORY_SELECT,
      replyTo: REPLY_TO_SELECT,
    },
  });
  await deleteTranslationsOf("message", messageId);

  await publishEvent(REALTIME_CHANNELS.conversation(message.conversationId), "changed");
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
  if (await isMembershipLocked(membership, user.id)) {
    return { error: "hidden_locked" as const };
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

  await publishEvent(REALTIME_CHANNELS.conversation(message.conversationId), "changed");
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
  if (await isMembershipLocked(membership, user.id)) {
    return { error: "hidden_locked" as const };
  }
  // Corrections are stored, scanned and shown by the server as plain text, which
  // can't happen for an encrypted message — and a correction typed into a secret
  // chat would put readable text in it. Not offered there.
  const correctedConversation = await prisma.conversation.findUnique({
    where: { id: message.conversationId },
    select: { isGroup: true, members: { select: { e2eeEnabledAt: true } } },
  });
  if ((correctedConversation && isSecretChat(correctedConversation)) || isEncryptedContent(message.content)) {
    return { error: "not_supported_in_secret_chat" as const };
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

  await publishEvent(REALTIME_CHANNELS.conversation(message.conversationId), "changed");
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
  if (message && (await isConversationLocked(user.id, message.conversationId))) {
    return { error: "hidden_locked" as const };
  }
  await prisma.messageCorrection.delete({ where: { id: correctionId } });

  const corrections = await prisma.messageCorrection.findMany({
    where: { messageId: correction.messageId },
    include: CORRECTION_INCLUDE,
  });

  if (message) {
    await publishEvent(REALTIME_CHANNELS.conversation(message.conversationId), "changed");
    revalidatePath(`/messages/${message.conversationId}`);
  }
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
  if (await isConversationLocked(user.id, message.conversationId)) {
    return { error: "hidden_locked" as const };
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
    // Its translations are its text in other words: gone with it.
    prisma.contentTranslation.deleteMany({ where: { messageId } }),
  ]);

  // A voice/video note's actual file otherwise keeps sitting in R2 forever,
  // unreferenced — same cleanup discipline as deletePost's media handling.
  await deleteMediaIfUnreferenced([message.mediaUrl, message.mediaThumbnailUrl]);
  // A view-once file is in the private bucket, with its key in ViewOnceMedia rather than on the row. If this delete
  // fails the sweep-view-once cron picks it up (it takes anything whose message was deleted for everyone).
  if (message.viewOnce) {
    await destroyViewOnceMedia(messageId);
  }

  await publishEvent(REALTIME_CHANNELS.conversation(message.conversationId), "changed");
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

/** Lightweight conversation list backing the post Share modal's "Send to a friend" picker — only threads the caller is already a member of. */
export async function getMyConversationsForShare() {
  const user = await requireVerifiedUser();

  const conversations = await prisma.conversation.findMany({
    // A hidden chat is never offered as a share target, unlocked or not: this picker opens on top of public pages.
    where: { members: { some: { userId: user.id, hiddenAt: null } } },
    select: {
      id: true,
      isGroup: true,
      name: true,
      members: { select: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } } },
    },
  });

  return {
    conversations: conversations.map((c) => {
      const other = c.members.find((m) => m.user.id !== user.id)?.user;
      return {
        id: c.id,
        label: c.isGroup ? (c.name ?? "Group") : (other?.name ?? "Unknown"),
        avatarUrl: c.isGroup ? null : (other?.avatarUrl ?? null),
        // The @handle shown on their profile, so the picker's search can find a friend by it too.
        username: c.isGroup ? null : (other?.username ?? null),
      };
    }),
  };
}


// What a forward reads about each chat: enough to apply forwardTargetRefusal and the hidden-chat rule, and to label
// the picker's rows. Never returned as is (forwardTargetsFor picks the fields the picker shows).
const FORWARD_TARGET_SELECT = {
  id: true,
  isGroup: true,
  name: true,
  members: {
    select: {
      userId: true,
      e2eeEnabledAt: true,
      hiddenAt: true,
      user: { select: { id: true, name: true, username: true, avatarUrl: true, status: true } },
    },
  },
} as const;

/**
 * The forward sheet's list of chats: the caller's conversations that can take a forward (forwardTargetRefusal: not a
 * secret chat, not a 1:1 with someone blocked either way or inactive), most recently active first. Like every share
 * picker, a hidden chat is never offered, unlocked or not.
 */
export async function getForwardTargets() {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("messageForwardTargets", user.id))) {
    return { error: "rate_limited" as const, targets: [] };
  }

  const [rows, blockedIds] = await Promise.all([
    prisma.conversation.findMany({
      where: { members: { some: { userId: user.id, hiddenAt: null } } },
      select: FORWARD_TARGET_SELECT,
    }),
    getBlockedEitherWayIds(user.id),
  ]);
  // Newest message per chat, one index probe each (src/lib/latest-messages.ts).
  const lastMessageAt = await latestMessageAtByConversation(rows.map((r) => r.id));
  const lastActive = (r: (typeof rows)[number]) => lastMessageAt.get(r.id)?.getTime() ?? 0;
  const sorted = [...rows].sort((a, b) => lastActive(b) - lastActive(a));
  return { error: null, targets: forwardTargetsFor(sorted, user.id, blockedIds) };
}

/**
 * Forwards one of the caller's visible messages into up to FORWARD_MAX_RECIPIENTS of their chats. The browser sends
 * the message id and the destination ids only: the server re-reads the message, checks the caller can see it (member
 * of its chat, not deleted for them, hidden chat unlocked) and that it can be forwarded at all (forwardSourceRefusal;
 * nothing from a secret chat), runs text moderation again, then writes one new message per destination as the
 * caller's own, marked `forwarded`, with no trace of the original sender or chat. A media message reuses the same
 * stored file (the shareMuseToConversation pattern): media-cleanup's reference check keeps the file while any copy
 * points at it. Each destination gets the normal new-message notifications through afterMessageSent.
 */
export async function forwardMessage(messageId: string, conversationIds: string[]) {
  const user = await requireVerifiedUser();

  const parsed = forwardMessageSchema.safeParse({ messageId, conversationIds });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const targetIds = uniqueForwardTargets(parsed.data.conversationIds);

  if (!(await checkRateLimit("messageForward", user.id))) {
    return { error: "rate_limited" as const };
  }

  const source = await prisma.message.findUnique({
    where: { id: parsed.data.messageId },
    select: {
      conversationId: true,
      senderId: true,
      content: true,
      mediaType: true,
      mediaUrl: true,
      mediaThumbnailUrl: true,
      moderationStatus: true,
      deletedForEveryoneAt: true,
      deletedForUserIds: true,
      viewOnce: true,
      storyId: true,
      conversation: { select: { isGroup: true, members: { select: { e2eeEnabledAt: true } } } },
    },
  });
  // Someone who isn't in the source chat learns nothing, not even that the message exists.
  if (!source || source.deletedForUserIds.includes(user.id)) {
    return { error: "not_found" as const };
  }
  const sourceMembership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: source.conversationId, userId: user.id } },
    select: { hiddenAt: true },
  });
  if (!sourceMembership) {
    return { error: "not_found" as const };
  }
  if (await isMembershipLocked(sourceMembership, user.id)) {
    return { error: "hidden_locked" as const };
  }
  // A secret chat's messages never leave it this way: the server can't read them and must not be handed their text.
  if (isSecretChat(source.conversation) || forwardSourceRefusal(source)) {
    return { error: "not_forwardable" as const };
  }
  if (source.senderId !== user.id && (await isBlockedEitherWay(user.id, source.senderId))) {
    return { error: "not_found" as const };
  }

  // Checked again here, not trusted from when it was first sent: forwarding is how a message spreads, so text that
  // fails moderation now is refused outright rather than copied in as "under review". Links are part of the text.
  // Media keeps its original verdict: the same file was checked when it was first sent (a GIF is Giphy's catalog).
  if (source.content) {
    const modResult = await moderateText(source.content);
    if (!modResult.allowed) {
      return { error: "moderation" as const };
    }
  }

  const [targets, blockedIds] = await Promise.all([
    prisma.conversation.findMany({ where: { id: { in: targetIds } }, select: FORWARD_TARGET_SELECT }),
    getBlockedEitherWayIds(user.id),
  ]);
  const targetById = new Map(targets.map((t) => [t.id, t]));

  let sent = 0;
  let failed = 0;
  let rateLimited = false;
  for (const conversationId of targetIds) {
    const target = targetById.get(conversationId);
    const membership = target?.members.find((m) => m.userId === user.id);
    if (!target || !membership || forwardTargetRefusal(target, user.id, blockedIds)) {
      failed++;
      continue;
    }
    if (await isMembershipLocked(membership, user.id)) {
      failed++;
      continue;
    }
    // Each copy is a message sent, and counts against the ordinary send limit too.
    if (rateLimited || !(await checkRateLimit("messageSend", user.id))) {
      rateLimited = true;
      failed++;
      continue;
    }

    await prisma.message.create({ data: forwardedMessageData(source, { conversationId, senderId: user.id }) });
    await afterMessageSent({
      user,
      conversationId,
      memberIds: target.members.map((m) => m.userId),
      secret: false,
      content: source.content,
      mediaType: source.mediaType,
    });
    sent++;
  }

  if (sent === 0) {
    return { error: rateLimited ? ("rate_limited" as const) : ("unavailable" as const) };
  }
  return { error: null, sent, failed };
}
