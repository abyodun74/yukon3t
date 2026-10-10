"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { isConversationLocked, isMembershipLocked } from "@/lib/hidden-chats";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateImage } from "@/lib/moderation";
import { isBlockedEitherWay } from "@/lib/blocks";
import { isSecretChat } from "@/lib/e2ee/secret-chat";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { afterMessageSent } from "@/lib/after-message-sent";
import { destroyViewOnceMedia } from "@/lib/view-once-media";
import { viewOnceUploadSchema, viewOnceSendSchema, viewOnceMessageIdSchema } from "@/lib/validations";
import {
  isViewOnceConfigured,
  isPrivateKeyOwnedBy,
  createPrivateUploadUrl,
  createPrivateDownloadUrl,
  headPrivateObject,
  copyPrivateObject,
  deletePrivateObject,
  viewOnceFinalKey,
} from "@/lib/storage";
import {
  VIEW_ONCE_DOWNLOAD_URL_TTL_SECONDS,
  VIEW_ONCE_FRAME_CONTENT_TYPE,
  VIEW_ONCE_LIFETIME_MS,
  VIEW_ONCE_MAX_FRAME_BYTES,
  VIEW_ONCE_MODERATION_URL_TTL_SECONDS,
  viewOnceContentType,
  viewOnceMaxBytes,
  viewOnceMediaIsDue,
  viewOnceOpenDecision,
} from "@/lib/view-once";

// "For your eyes only" photo/video messages, 1:1 chats only. The file goes to the private bucket and its key is
// stored only in ViewOnceMedia; the Message row carries no URL. The recipient gets a short-lived download link once,
// and the file is deleted as soon as their app has shown it (or by the sweep-view-once cron). See CLAUDE.md.

// A photo PUT is small; a video (64MB at most) on slow mobile data can take several minutes, plus retries.
const UPLOAD_URL_TTL_SECONDS = { IMAGE: 300, VIDEO: 1800 } as const;

/** The same gates sendMessage applies, plus "1:1 only". Run again at send time: a block can land between upload and send. */
async function loadDirectConversation(userId: string, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true, members: { select: { userId: true, e2eeEnabledAt: true } } },
  });
  if (!conversation || !conversation.members.some((m) => m.userId === userId)) {
    return { error: "not_a_member" as const };
  }
  // A chat the sender has hidden takes messages only while their PIN unlock is live (same as sendMessage).
  if (await isConversationLocked(userId, conversationId)) {
    return { error: "hidden_locked" as const };
  }
  const others = conversation.members.filter((m) => m.userId !== userId);
  if (conversation.isGroup || others.length !== 1) {
    return { error: "not_supported" as const };
  }
  if (await isBlockedEitherWay(userId, others[0].userId)) {
    return { error: "blocked" as const };
  }
  return { error: null, conversation };
}

/** Presigned PUT(s) into the private bucket for one view-once photo or video. A video also gets one for its still frame. */
export async function requestViewOnceUpload(input: { conversationId: string; contentType: string; size: number }) {
  const user = await requireVerifiedUser();

  if (!isViewOnceConfigured()) {
    return { error: "unavailable" as const };
  }
  if (!(await checkRateLimit("mediaUpload", user.id))) {
    return { error: "rate_limited" as const };
  }

  const parsed = viewOnceUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { conversationId, contentType, size } = parsed.data;

  const type = viewOnceContentType(contentType);
  if (!type) {
    return { error: "invalid_type" as const };
  }
  if (size > viewOnceMaxBytes(type.mediaType)) {
    return { error: "too_large" as const };
  }

  const gate = await loadDirectConversation(user.id, conversationId);
  if (gate.error) {
    return { error: gate.error };
  }

  const expiresIn = UPLOAD_URL_TTL_SECONDS[type.mediaType];
  const media = await createPrivateUploadUrl({ purpose: "view-once", userId: user.id, contentType, ext: type.ext, expiresIn });
  const frame =
    type.mediaType === "VIDEO"
      ? await createPrivateUploadUrl({
          purpose: "view-once-frame",
          userId: user.id,
          contentType: VIEW_ONCE_FRAME_CONTENT_TYPE,
          ext: "jpg",
          expiresIn,
        })
      : null;

  return {
    error: null,
    mediaType: type.mediaType,
    uploadUrl: media.uploadUrl,
    objectKey: media.key,
    frameUploadUrl: frame?.uploadUrl ?? null,
    frameKey: frame?.key ?? null,
  };
}

/**
 * Turns an uploaded private object into a view-once message. The upload is re-checked from R2 itself (it exists, it
 * is mine, real size and type), copied to a key the sender has no URL for, and moderated from that copy before any
 * message exists; anything refused is deleted on the spot.
 */
export async function sendViewOnceMessage(input: {
  conversationId: string;
  objectKey: string;
  frameKey?: string;
  mediaType: "IMAGE" | "VIDEO";
  replyToMessageId?: string;
}) {
  const user = await requireVerifiedUser();

  if (!isViewOnceConfigured()) {
    return { error: "unavailable" as const };
  }
  if (!(await checkRateLimit("messageSend", user.id))) {
    return { error: "rate_limited" as const };
  }

  const parsed = viewOnceSendSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { conversationId, objectKey, frameKey, mediaType, replyToMessageId } = parsed.data;

  // Ownership before any R2 call: these keys came from the browser.
  if (!isPrivateKeyOwnedBy(objectKey, "view-once", user.id)) {
    return { error: "invalid" as const };
  }
  if (frameKey && !isPrivateKeyOwnedBy(frameKey, "view-once-frame", user.id)) {
    return { error: "invalid" as const };
  }

  // Everything a refusal throws away is this request's own: the two upload keys (checked above to be this sender's
  // upload namespace) and the copy made below. A file that has been sent lives under a view-once-final/ key no
  // request can name, so no refusal path — re-submitting an already-sent key included — can delete a live one.
  let finalKey: string | null = null;
  async function discard() {
    await Promise.all([
      deletePrivateObject(objectKey),
      frameKey ? deletePrivateObject(frameKey) : null,
      finalKey ? deletePrivateObject(finalKey) : null,
    ]);
  }

  const gate = await loadDirectConversation(user.id, conversationId);
  if (gate.error) {
    await discard();
    return { error: gate.error };
  }
  const { conversation } = gate;

  if (replyToMessageId) {
    const target = await prisma.message.findUnique({
      where: { id: replyToMessageId },
      select: { conversationId: true },
    });
    if (!target || target.conversationId !== conversationId) {
      await discard();
      return { error: "invalid" as const };
    }
  }

  let head: Awaited<ReturnType<typeof headPrivateObject>>;
  let frameHead: Awaited<ReturnType<typeof headPrivateObject>> = null;
  try {
    head = await headPrivateObject(objectKey);
    if (frameKey) frameHead = await headPrivateObject(frameKey);
  } catch (err) {
    console.error("[view-once] could not verify the uploaded object", err);
    return { error: "unavailable" as const };
  }
  const type = head ? viewOnceContentType(head.contentType) : null;
  if (!head || !type || type.mediaType !== mediaType) {
    await discard();
    return { error: "invalid" as const };
  }
  if (head.size === 0 || head.size > viewOnceMaxBytes(mediaType)) {
    await discard();
    return { error: "too_large" as const };
  }

  if (mediaType === "VIDEO") {
    const frameOk =
      frameKey &&
      frameHead &&
      frameHead.contentType === VIEW_ONCE_FRAME_CONTENT_TYPE &&
      frameHead.size > 0 &&
      frameHead.size <= VIEW_ONCE_MAX_FRAME_BYTES;
    if (!frameOk) {
      await discard();
      return { error: "frame_required" as const };
    }
  }

  // The sender's presigned PUT for objectKey is still valid, so that object could be replaced at any moment. From
  // here on only a server-side copy is used, under a key no browser has ever been given a URL for: it is what gets
  // checked, moderated and sent, and the upload key is deleted.
  const storedKey = viewOnceFinalKey(conversationId, type.ext);
  finalKey = storedKey;
  let stored: Awaited<ReturnType<typeof headPrivateObject>>;
  try {
    await copyPrivateObject(objectKey, storedKey);
    stored = await headPrivateObject(storedKey);
  } catch (err) {
    console.error("[view-once] could not copy the uploaded object", err);
    await deletePrivateObject(storedKey);
    return { error: "unavailable" as const };
  }
  // The copy must be the object that was just checked (same ETag and size — a difference means it was overwritten
  // in between), and the type and size cap are enforced again on the copy itself.
  if (
    !stored ||
    stored.etag !== head.etag ||
    stored.size !== head.size ||
    viewOnceContentType(stored.contentType)?.mediaType !== mediaType
  ) {
    await discard();
    return { error: "invalid" as const };
  }
  if (stored.size === 0 || stored.size > viewOnceMaxBytes(mediaType)) {
    await discard();
    return { error: "too_large" as const };
  }
  await deletePrivateObject(objectKey);

  // What gets checked: a photo itself (the copy); for a video, one still frame captured by the sender's app — the
  // same stand-in ordinary video messages are checked by. A view-once video without a usable frame is refused rather
  // than sent unchecked, because once viewed there is nothing left for anyone to review.
  const moderationKey = mediaType === "VIDEO" && frameKey ? frameKey : storedKey;
  const modResult = await moderateImage(
    await createPrivateDownloadUrl(moderationKey, VIEW_ONCE_MODERATION_URL_TTL_SECONDS),
  );
  // The frame has done its job either way.
  if (frameKey) await deletePrivateObject(frameKey);
  if (!modResult.allowed) {
    await deletePrivateObject(storedKey);
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }
  // Everywhere else a moderation outage publishes and flags the content for human review. Here there will be
  // nothing to review, so an unchecked file is not sent.
  if (modResult.flaggedCategories.includes("moderation_api_error")) {
    await deletePrivateObject(storedKey);
    return { error: "moderation_unavailable" as const };
  }

  // The message and the only record of its file are created together.
  try {
    await prisma.message.create({
      data: {
        conversationId,
        senderId: user.id,
        content: "",
        mediaType,
        moderationStatus: "PUBLISHED",
        replyToMessageId,
        viewOnce: true,
        viewOnceExpiresAt: new Date(Date.now() + VIEW_ONCE_LIFETIME_MS),
        viewOnceMedia: { create: { objectKey: storedKey, contentType: stored.contentType } },
      },
      select: { id: true },
    });
  } catch (err) {
    // No row will ever point at the copy now.
    await deletePrivateObject(storedKey);
    throw err;
  }

  // Same notification as any photo/video message ("Sent a photo") — nothing in it says view-once.
  await afterMessageSent({
    user,
    conversationId,
    memberIds: conversation.members.map((m) => m.userId),
    secret: isSecretChat(conversation),
    content: "",
    mediaType,
  });
  return { error: null };
}

/** A view-once message as its RECIPIENT may act on it — never the sender, and only while still in the conversation. */
async function loadForRecipient(userId: string, messageId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      mediaType: true,
      moderationStatus: true,
      deletedForEveryoneAt: true,
      viewOnce: true,
      viewOnceOpenedAt: true,
      viewOnceExpiresAt: true,
      viewOnceMedia: { select: { objectKey: true, contentType: true } },
    },
  });
  if (!message || !message.viewOnce) {
    return { error: "not_found" as const };
  }
  if (message.senderId === userId) {
    return { error: "forbidden" as const };
  }
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: message.conversationId, userId } },
    select: { id: true, hiddenAt: true },
  });
  if (!membership) {
    return { error: "not_a_member" as const };
  }
  return { error: null, message, membership };
}

/**
 * What kind of file a view-once message holds, for its recipient, WITHOUT opening it: the viewer asks this first so
 * a video this device can't play is refused before the one view is used. Gated like opening; gives away no key.
 */
export async function getViewOnceContentType(messageId: string) {
  const user = await requireVerifiedUser();

  const parsedId = viewOnceMessageIdSchema.safeParse(messageId);
  if (!parsedId.success) {
    return { error: "not_found" as const };
  }
  const loaded = await loadForRecipient(user.id, parsedId.data);
  if (loaded.error) {
    return { error: loaded.error };
  }
  if (await isMembershipLocked(loaded.membership, user.id)) {
    return { error: "hidden_locked" as const };
  }
  const { message } = loaded;
  if (message.deletedForEveryoneAt || message.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }
  // No file left: openViewOnceMessage is what says whether that means "already viewed" or "expired".
  return { error: null, contentType: message.viewOnceMedia?.contentType ?? null };
}

/**
 * The recipient's one open. The first call wins an atomic claim (viewOnceOpenedAt null → now) and gets a 60-second
 * download link. A later call gets a fresh link only inside the retry window and only while the file still exists
 * (a download that failed); after that it is "already_viewed" for good.
 */
export async function openViewOnceMessage(messageId: string) {
  const user = await requireVerifiedUser();

  if (!isViewOnceConfigured()) {
    return { error: "unavailable" as const };
  }
  const parsedId = viewOnceMessageIdSchema.safeParse(messageId);
  if (!parsedId.success) {
    return { error: "not_found" as const };
  }

  const loaded = await loadForRecipient(user.id, parsedId.data);
  if (loaded.error) {
    return { error: loaded.error };
  }
  // Opening is gated on the PIN unlock like reading the thread is. finishViewOnceMessage deliberately is not: once a
  // file has been opened its deletion must go through even if the unlock ran out in between.
  if (await isMembershipLocked(loaded.membership, user.id)) {
    return { error: "hidden_locked" as const };
  }
  let { message } = loaded;
  if (message.deletedForEveryoneAt || message.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }

  const now = new Date();
  let decision = viewOnceOpenDecision({ ...message, hasMedia: Boolean(message.viewOnceMedia) }, now.getTime());

  if (decision === "claim") {
    const claimed = await prisma.message.updateMany({
      where: { id: message.id, viewOnceOpenedAt: null, viewOnceExpiresAt: { gt: now } },
      data: { viewOnceOpenedAt: now },
    });
    if (claimed.count === 1) {
      // Flips the sender's bubble to "Opened".
      await publishEvent(REALTIME_CHANNELS.conversation(message.conversationId), "changed");
    } else {
      // Lost the claim to another request (this person's other device, or a double tap): judge it again as the
      // already-opened message it now is.
      const again = await loadForRecipient(user.id, message.id);
      if (again.error) {
        return { error: again.error };
      }
      message = again.message;
      decision = viewOnceOpenDecision({ ...message, hasMedia: Boolean(message.viewOnceMedia) }, Date.now());
      if (decision === "claim") {
        return { error: "expired" as const };
      }
    }
  }

  const media = message.viewOnceMedia;
  if (decision === "already_viewed" || decision === "expired" || !media) {
    // Whatever is left has no further use; don't wait for the sweep. But not before the sweep itself would: just
    // past the retry window a link issued at its last moment can still be downloading this file.
    if (media && viewOnceMediaIsDue(message, Date.now())) await destroyViewOnceMedia(message.id);
    return { error: decision === "expired" ? ("expired" as const) : ("already_viewed" as const) };
  }

  if (decision === "reissue") {
    let exists: boolean;
    try {
      exists = (await headPrivateObject(media.objectKey)) !== null;
    } catch {
      return { error: "unavailable" as const };
    }
    if (!exists) {
      return { error: "already_viewed" as const };
    }
  }

  const url = await createPrivateDownloadUrl(media.objectKey, VIEW_ONCE_DOWNLOAD_URL_TTL_SECONDS);
  return { error: null, url, mediaType: message.mediaType, contentType: media.contentType };
}

/** The recipient's app has the file: delete it from storage, with its row. Safe to call again. */
export async function finishViewOnceMessage(messageId: string) {
  const user = await requireVerifiedUser();

  const parsedId = viewOnceMessageIdSchema.safeParse(messageId);
  if (!parsedId.success) {
    return { error: "not_found" as const };
  }
  const loaded = await loadForRecipient(user.id, parsedId.data);
  if (loaded.error) {
    return { error: loaded.error };
  }
  // Only an opened message can be finished — otherwise this would be a way to destroy one unseen.
  if (!loaded.message.viewOnceOpenedAt) {
    return { error: "invalid" as const };
  }

  const destroyed = await destroyViewOnceMedia(loaded.message.id);
  // On failure the row is still there, and the sweep retries.
  return { error: destroyed ? null : ("unavailable" as const) };
}
