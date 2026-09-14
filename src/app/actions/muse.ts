"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { museSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateMedia, moderateText } from "@/lib/moderation";
import {
  MEDIA_LIMITS,
  verifyUploadedSize,
  deleteObject,
  deleteOwnedObject,
  keyFromPublicUrl,
} from "@/lib/storage";
import { isEmojiOnly } from "@/lib/emoji";
import { getBlockedEitherWayIds, isBlockedEitherWay } from "@/lib/blocks";
import { pushActivityNotification } from "@/lib/notify-push";
import type { ReactionSummary } from "@/lib/reactions";

/**
 * Creates a new short-form public Muse video. Modeled closely on createStory
 * (src/app/actions/stories.ts) rather than createPost — no device step-up
 * gate and no Circle/channel checks, since a Muse is always public and
 * outside the Circle system. Every Muse is capped at
 * MAX_MUSE_VIDEO_DURATION_SECONDS (== HIVE_VIDEO_MODERATION_MAX_SECONDS), so
 * unlike createPost there is no long-form-review fork here at all — every
 * published Muse is picked up by moderate-videos' short-form Hive scan alone.
 */
export async function createMuse(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("postCreate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = museSchema.safeParse({
    caption: formData.get("caption") || undefined,
    videoUrl: formData.get("videoUrl"),
    videoThumbnailUrl: formData.get("videoThumbnailUrl") || undefined,
    videoDurationSeconds: formData.get("videoDurationSeconds"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  // museSchema's own .max(MAX_MUSE_VIDEO_DURATION_SECONDS) already rejects
  // (as "invalid") anything longer before this point is reached.
  const { caption, videoUrl, videoThumbnailUrl, videoDurationSeconds } = parsed.data;

  const uploadedUrls = [videoUrl, ...(videoThumbnailUrl ? [videoThumbnailUrl] : [])];
  async function cleanupUploads() {
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteOwnedObject(key, user.id) : Promise.resolve();
      }),
    );
  }

  const videoKey = keyFromPublicUrl(videoUrl);
  const videoSizeOk = videoKey && (await verifyUploadedSize({
    key: videoKey,
    maxBytes: MEDIA_LIMITS["muse-video"],
    ownerId: user.id,
  }));
  if (!videoSizeOk) {
    await cleanupUploads();
    return { error: "too_large" as const };
  }
  if (videoThumbnailUrl) {
    const thumbKey = keyFromPublicUrl(videoThumbnailUrl);
    const thumbSizeOk = thumbKey && (await verifyUploadedSize({
      key: thumbKey,
      maxBytes: MEDIA_LIMITS["video-thumb"],
      ownerId: user.id,
    }));
    if (!thumbSizeOk) {
      await cleanupUploads();
      return { error: "too_large" as const };
    }
  }

  const modResult = await moderateMedia({
    text: caption,
    imageUrls: [],
    thumbnailUrl: videoThumbnailUrl,
  });
  if (!modResult.allowed) {
    await cleanupUploads();
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }

  let muse;
  try {
    muse = await prisma.muse.create({
      data: {
        authorId: user.id,
        caption: caption || undefined,
        videoUrl,
        videoThumbnailUrl,
        videoDurationSeconds,
      },
    });
  } catch (err) {
    // Same reasoning as createStory's own try/catch: the upload already
    // succeeded by this point, so an uncaught DB failure here shouldn't
    // orphan the just-uploaded media or get misreported client-side as an
    // upload failure.
    console.error("[createMuse] failed to create muse row after successful upload", err);
    await cleanupUploads();
    return { error: "server_error" as const };
  }

  revalidatePath("/muse");
  revalidatePath(`/u/${user.id}`);
  return { error: null, museId: muse.id };
}

const MUSE_FEED_PAGE_SIZE = 10;

/**
 * The /muse public discovery feed — newest first, cursor-paginated (no
 * existing precedent for this in the codebase: Post/Story feeds are always
 * Circle/Connection-scoped, never a global cross-author stream). Excludes
 * authors the caller has blocked or been blocked by, same helper already
 * used to filter Discover.
 */
export async function getMuseFeed({ cursor }: { cursor?: string } = {}) {
  const user = await requireVerifiedUser();
  const blockedIds = await getBlockedEitherWayIds(user.id);

  const items = await prisma.muse.findMany({
    where: {
      moderationStatus: "PUBLISHED",
      authorId: { notIn: [...blockedIds] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MUSE_FEED_PAGE_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
      reactions: { where: { userId: user.id }, select: { emoji: true } },
    },
  });

  const nextCursor = items.length === MUSE_FEED_PAGE_SIZE ? items[items.length - 1].id : null;
  return {
    items: items.map((m) => ({
      id: m.id,
      caption: m.caption,
      videoUrl: m.videoUrl,
      videoThumbnailUrl: m.videoThumbnailUrl,
      createdAt: m.createdAt,
      likeCount: m.likeCount,
      commentCount: m.commentCount,
      author: m.author,
      myReaction: m.reactions[0]?.emoji ?? null,
    })),
    nextCursor,
  };
}

/** Author or admin: removes a Muse outside its natural lifetime (it has none — permanent until deleted). */
export async function deleteMuse(id: string) {
  const user = await requireVerifiedUser();

  const muse = await prisma.muse.findUnique({ where: { id } });
  if (!muse) {
    return { error: "not_found" as const };
  }
  if (muse.authorId !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  await prisma.muse.delete({ where: { id } });
  await Promise.all(
    [muse.videoUrl, muse.videoThumbnailUrl]
      .filter((url): url is string => Boolean(url))
      .map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteObject(key) : Promise.resolve();
      }),
  );

  revalidatePath("/muse");
  revalidatePath(`/u/${muse.authorId}`);
  return { error: null };
}

/**
 * Toggles the caller's emoji reaction on a Muse: picking the emoji they
 * already reacted with removes it, picking a different one replaces it —
 * same one-active-reaction-per-user shape as togglePostReaction/
 * toggleStoryReaction. Muse.likeCount is a denormalized *total* reaction
 * count (unaffected by an emoji swap, only by add/remove) so the feed list
 * can show a cheap per-item count without a groupBy per item; the full
 * per-emoji breakdown (for ReactionBar) is computed here via groupBy, same
 * scalable pattern as togglePostReaction.
 */
async function museReactionSummary(museId: string, viewerId: string): Promise<ReactionSummary[]> {
  const counts = await prisma.museReaction.groupBy({
    by: ["emoji"],
    where: { museId },
    _count: { emoji: true },
  });
  const mine = await prisma.museReaction.findUnique({
    where: { museId_userId: { museId, userId: viewerId } },
    select: { emoji: true },
  });
  return counts.map((c) => ({
    emoji: c.emoji,
    count: c._count.emoji,
    reactedByMe: c.emoji === mine?.emoji,
  }));
}

/** The full per-emoji breakdown for one Muse — fetched lazily, only for whichever item is currently on-screen in the feed (see MuseFeed), not for every item in a fetched page. */
export async function getMuseReactionSummary(museId: string) {
  const user = await requireVerifiedUser();
  const reactions = await museReactionSummary(museId, user.id);
  return { error: null, reactions };
}

export async function toggleMuseReaction(museId: string, emoji: string) {
  const user = await requireVerifiedUser();

  if (!isEmojiOnly(emoji, 1)) {
    return { error: "invalid" as const };
  }

  const muse = await prisma.muse.findUnique({ where: { id: museId } });
  if (!muse || muse.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }
  if (await isBlockedEitherWay(user.id, muse.authorId)) {
    return { error: "not_found" as const };
  }

  const existing = await prisma.museReaction.findUnique({
    where: { museId_userId: { museId, userId: user.id } },
  });

  const myNewEmoji = existing?.emoji === emoji ? null : emoji;
  if (existing?.emoji === emoji) {
    await prisma.$transaction([
      prisma.museReaction.delete({ where: { id: existing.id } }),
      prisma.muse.update({ where: { id: museId }, data: { likeCount: { decrement: 1 } } }),
    ]);
  } else if (existing) {
    await prisma.museReaction.update({ where: { id: existing.id }, data: { emoji } });
  } else {
    await prisma.$transaction([
      prisma.museReaction.create({ data: { museId, userId: user.id, emoji } }),
      prisma.muse.update({ where: { id: museId }, data: { likeCount: { increment: 1 } } }),
    ]);
  }

  if (myNewEmoji && muse.authorId !== user.id) {
    await prisma.notification.create({
      data: { recipientId: muse.authorId, actorId: user.id, type: "MUSE_LIKE", museId },
    });
    await pushActivityNotification(muse.authorId, "MUSE_LIKE", user.name ?? "Someone", "/muse");
  }

  const reactions = await museReactionSummary(museId, user.id);

  revalidatePath("/muse");
  return { error: null, reactions };
}

const MUSE_COMMENTS_LIMIT = 50;

/**
 * A Muse's public comment thread — flat, text-only, same minimal access
 * check as getStoryComments (not an accepted-connection gate, since a Muse
 * is public by design; blocked-either-way is still excluded).
 */
export async function getMuseComments(museId: string) {
  const user = await requireVerifiedUser();

  const muse = await prisma.muse.findUnique({ where: { id: museId }, select: { authorId: true, moderationStatus: true } });
  if (!muse || muse.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const, comments: [] };
  }
  if (await isBlockedEitherWay(user.id, muse.authorId)) {
    return { error: "not_found" as const, comments: [] };
  }

  const comments = await prisma.museComment.findMany({
    where: { museId, moderationStatus: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    take: MUSE_COMMENTS_LIMIT,
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return { error: null, comments };
}

export async function createMuseComment(museId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("comment", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const muse = await prisma.muse.findUnique({ where: { id: museId } });
  if (!muse || muse.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }
  if (await isBlockedEitherWay(user.id, muse.authorId)) {
    return { error: "not_found" as const };
  }

  const content = String(formData.get("content") ?? "").trim();
  if (!content || content.length > 1000) {
    return { error: "invalid" as const };
  }

  const modResult = await moderateText(content);
  const comment = await prisma.museComment.create({
    data: {
      museId,
      authorId: user.id,
      content,
      moderationStatus: modResult.allowed ? "PUBLISHED" : "FLAGGED",
    },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  if (modResult.allowed) {
    await prisma.muse.update({ where: { id: museId }, data: { commentCount: { increment: 1 } } });
    if (muse.authorId !== user.id) {
      await prisma.notification.create({
        data: { recipientId: muse.authorId, actorId: user.id, type: "MUSE_COMMENT", museId },
      });
      await pushActivityNotification(muse.authorId, "MUSE_COMMENT", user.name ?? "Someone", "/muse");
    }
  }

  revalidatePath("/muse");
  return { error: null, comment };
}

/** Author of the comment, the Muse's own author, or an admin can remove a Muse comment — same three-way authorization shape as deleteStoryComment. */
export async function deleteMuseComment(commentId: string) {
  const user = await requireVerifiedUser();

  const comment = await prisma.museComment.findUnique({
    where: { id: commentId },
    include: { muse: { select: { authorId: true } } },
  });
  if (!comment) {
    return { error: "not_found" as const };
  }
  if (comment.authorId !== user.id && comment.muse.authorId !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  await prisma.museComment.delete({ where: { id: commentId } });
  if (comment.moderationStatus === "PUBLISHED") {
    await prisma.muse.update({ where: { id: comment.museId }, data: { commentCount: { decrement: 1 } } });
  }
  revalidatePath("/muse");
  return { error: null };
}
