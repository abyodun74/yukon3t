"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { messageSchema, shareToChatsSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText, moderateMedia } from "@/lib/moderation";
import { MEDIA_LIMITS, verifyUploadedSize, deleteOwnedObject, keyFromPublicUrl } from "@/lib/storage";
import { checkVideoThumbnail } from "@/lib/video-thumbnail-check";
import { isBlockedEitherWay } from "@/lib/blocks";
import { isSecretChat, checkSecretSend } from "@/lib/e2ee/secret-chat";
import { isGiphyUrl } from "@/lib/giphy";
import { afterMessageSent } from "@/lib/after-message-sent";
import { sendToEachChat } from "@/lib/share-to-chats-server";
import { shareToChatsResult, uniqueShareTargets } from "@/lib/share-to-chats";

/**
 * "Send to a friend" from the post share sheet (the post's link) and from sharing in from another app (its text and/or
 * the photo/video just uploaded), to 1-SHARE_MAX_RECIPIENTS of the caller's chats at once. The same message goes to
 * each: the same checks as sendMessage run once on the content (upload ownership and size, the Giphy host, media
 * moderation that refuses, text moderation that holds it as FLAGGED), then every destination is checked on its own
 * (sendToEachChat: member, hidden-chat lock, blocks either way, active peer, `messageSend` limit). Plaintext never goes
 * into a secret chat (checkSecretSend's rule): a share with text counts a secret chat as failed, a media-only share
 * may go in. Each copy is a normal message of the caller and gets the usual notifications (afterMessageSent).
 *
 * FormData: `conversationIds` (repeated), `content`, `mediaType`, `mediaUrl`, `mediaThumbnailUrl`. Answers counts
 * only (`sent`/`failed`), never which chat failed or why; nothing sent is "unavailable" or "rate_limited".
 */
export async function sendToConversations(formData: FormData) {
  const user = await requireVerifiedUser();

  const ids = shareToChatsSchema.safeParse(formData.getAll("conversationIds"));
  const parsed = messageSchema.safeParse({
    content: formData.get("content") ?? "",
    mediaType: formData.get("mediaType") || "NONE",
    mediaUrl: formData.get("mediaUrl") || undefined,
    mediaThumbnailUrl: formData.get("mediaThumbnailUrl") || undefined,
  });
  if (!ids.success || !parsed.success) {
    return { error: "invalid" as const };
  }
  const targetIds = uniqueShareTargets(ids.data);
  const { content, mediaType, mediaUrl, mediaThumbnailUrl } = parsed.data;

  if (!(await checkRateLimit("shareToChats", user.id))) {
    return { error: "rate_limited" as const };
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

  // Ciphertext-looking text is refused outright: these destinations are written by the server, never encrypted on a
  // device, so it could only be an attempt to dodge text moderation (see checkSecretSend).
  if (checkSecretSend({ secret: false, content })) {
    await cleanupUploads();
    return { error: "invalid" as const };
  }

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
    if (!mediaUrl || !isGiphyUrl(mediaUrl)) {
      return { error: "invalid" as const };
    }
  }

  let moderationStatus: "PUBLISHED" | "FLAGGED" = "PUBLISHED";
  if (mediaType === "VIDEO" || mediaType === "IMAGE") {
    const modResult = await moderateMedia(
      mediaType === "VIDEO"
        ? { text: content, thumbnailUrl: mediaThumbnailUrl }
        : { text: content, imageUrls: mediaUrl ? [mediaUrl] : [] },
    );
    if (!modResult.allowed) {
      await cleanupUploads();
      return { error: "moderation" as const };
    }
  } else if (content) {
    const modResult = await moderateText(content);
    moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";
  }

  const tally = await sendToEachChat({
    userId: user.id,
    targetIds,
    allowSecret: content === "",
    send: async (target) => {
      await prisma.message.create({
        data: {
          conversationId: target.id,
          senderId: user.id,
          content,
          mediaType,
          mediaUrl: mediaType !== "NONE" ? mediaUrl : undefined,
          mediaThumbnailUrl: mediaType === "VIDEO" ? mediaThumbnailUrl : undefined,
          moderationStatus,
        },
      });
      await afterMessageSent({
        user,
        conversationId: target.id,
        memberIds: target.members.map((m) => m.userId),
        secret: isSecretChat(target),
        content,
        mediaType,
      });
    },
  });

  // Nothing points at a fresh upload that went nowhere: delete it, as sendMessage does on a refusal.
  if (tally.sent === 0) await cleanupUploads();
  return shareToChatsResult(tally);
}

/**
 * Sends a Muse to 1-SHARE_MAX_RECIPIENTS of the caller's chats as the actual VIDEO (a video message that plays in the
 * chat), not a link. Reuses the Muse's already-moderated file, so there is no upload or size check, and no ownership
 * check either, which sendMessage rightly demands of a fresh upload (the file belongs to the Muse's author). The Muse is
 * checked once (published, not an embed, author not blocked either way), every destination on its own (sendToEachChat;
 * a secret chat may take it, since the message has no text). One share is counted, and the author notified once, per
 * send that reached at least one chat, however many chats it reached.
 */
export async function shareMuseToConversations(museId: string, conversationIds: string[]) {
  const user = await requireVerifiedUser();

  const ids = shareToChatsSchema.safeParse(conversationIds);
  if (!ids.success || typeof museId !== "string") {
    return { error: "invalid" as const };
  }
  const targetIds = uniqueShareTargets(ids.data);

  if (!(await checkRateLimit("shareToChats", user.id))) {
    return { error: "rate_limited" as const };
  }

  const muse = await prisma.muse.findUnique({
    where: { id: museId },
    select: {
      authorId: true,
      moderationStatus: true,
      mediaType: true,
      videoUrl: true,
      videoThumbnailUrl: true,
    },
  });
  if (!muse || muse.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }
  // Chat messages have no EMBED media type of their own (see MessageMediaType): a message's mediaUrl always has to be a
  // real file this app hosts, which an EMBED Muse doesn't have.
  if (muse.mediaType === "EMBED" || !muse.videoUrl) {
    return { error: "not_found" as const };
  }
  if (await isBlockedEitherWay(user.id, muse.authorId)) {
    return { error: "not_found" as const };
  }

  const tally = await sendToEachChat({
    userId: user.id,
    targetIds,
    allowSecret: true,
    send: async (target) => {
      await prisma.message.create({
        data: {
          conversationId: target.id,
          senderId: user.id,
          // Empty text is what a plain video message carries (in a secret chat too: nothing to encrypt).
          content: "",
          mediaType: "VIDEO",
          mediaUrl: muse.videoUrl,
          mediaThumbnailUrl: muse.videoThumbnailUrl,
          moderationStatus: "PUBLISHED",
        },
      });
      await afterMessageSent({
        user,
        conversationId: target.id,
        memberIds: target.members.map((m) => m.userId),
        secret: isSecretChat(target),
        content: "",
        mediaType: "VIDEO",
      });
    },
  });

  const result = shareToChatsResult(tally);
  if (result.error) return result;

  const [, updated] = await prisma.$transaction([
    prisma.museShare.create({ data: { userId: user.id, museId } }),
    prisma.muse.update({ where: { id: museId }, data: { shareCount: { increment: 1 } } }),
  ]);
  if (muse.authorId !== user.id) {
    await prisma.notification.create({
      data: { recipientId: muse.authorId, actorId: user.id, type: "MUSE_SHARE", museId },
    });
  }
  return { ...result, shareCount: updated.shareCount };
}
