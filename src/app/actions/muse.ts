"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { museSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateMedia, moderateText } from "@/lib/moderation";
import {
  MEDIA_LIMITS,
  HIVE_VIDEO_MODERATION_MAX_SECONDS,
  verifyUploadedSize,
  deleteObject,
  deleteOwnedObject,
  keyFromPublicUrl,
} from "@/lib/storage";
import { isStreamConfigured, createStreamCopy } from "@/lib/cloudflare-stream";
import { isEmojiOnly } from "@/lib/emoji";
import { getBlockedEitherWayIds, isBlockedEitherWay } from "@/lib/blocks";
import { pushActivityNotification } from "@/lib/notify-push";
import { notifySubscribers } from "@/lib/notify-subscribers";
import type { ReactionSummary } from "@/lib/reactions";

/**
 * Creates a new short-form public Muse video. Modeled closely on createStory
 * (src/app/actions/stories.ts) rather than createPost — no device step-up
 * gate and no Circle/channel checks, since a Muse is always public and
 * outside the Circle system. Every Muse is capped at
 * MAX_MUSE_VIDEO_DURATION_SECONDS (3 minutes), which is well past Hive's own
 * HIVE_VIDEO_MODERATION_MAX_SECONDS scan limit — a Muse over that limit
 * takes the same long-form-review fork as createPost (see
 * videoNeedsManualReview below), publishing FLAGGED and pending until the
 * moderate-long-videos cron clears it. A Muse at or under the Hive limit is
 * unaffected: still picked up by moderate-videos' short-form Hive scan alone.
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
    audioUrl: formData.get("audioUrl") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  // museSchema's own .max(MAX_MUSE_VIDEO_DURATION_SECONDS) already rejects
  // (as "invalid") anything longer before this point is reached.
  const { caption, videoUrl, videoThumbnailUrl, videoDurationSeconds, audioUrl } = parsed.data;

  const uploadedUrls = [
    videoUrl,
    ...(videoThumbnailUrl ? [videoThumbnailUrl] : []),
    ...(audioUrl ? [audioUrl] : []),
  ];
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
  if (audioUrl) {
    const audioKey = keyFromPublicUrl(audioUrl);
    const audioSizeOk = audioKey && (await verifyUploadedSize({
      key: audioKey,
      maxBytes: MEDIA_LIMITS["muse-audio"],
      ownerId: user.id,
    }));
    if (!audioSizeOk) {
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

  // Same reasoning as createPost's own videoNeedsManualReview — Hive's
  // Visual Moderation API can't scan past HIVE_VIDEO_MODERATION_MAX_SECONDS,
  // so a longer Muse publishes hidden pending a human/automated long-form
  // look instead of going out immediately.
  const videoNeedsManualReview = videoDurationSeconds > HIVE_VIDEO_MODERATION_MAX_SECONDS;

  // Kicks off the Cloudflare Stream copy now rather than leaving it to the
  // moderate-long-videos cron's own discovery — same eager-start reasoning
  // as createPost's streamUidPromise. Best-effort: createStreamCopy fails
  // closed to null, and advanceLongVideoReview creates its own copy on the
  // cron's first pass if this one never lands.
  const streamUid =
    videoNeedsManualReview && isStreamConfigured() ? await createStreamCopy(videoUrl) : null;

  let muse;
  try {
    muse = await prisma.muse.create({
      data: {
        authorId: user.id,
        caption: caption || undefined,
        videoUrl,
        videoThumbnailUrl,
        videoDurationSeconds,
        audioUrl,
        moderationStatus: videoNeedsManualReview ? "FLAGGED" : "PUBLISHED",
        // Pre-claimed so moderate-videos' `videoModeratedAt IS NULL` scan
        // never picks this up and wastes/fails a Hive call it was never
        // going to handle — same reasoning as Post's own videoModeratedAt.
        videoModeratedAt: videoNeedsManualReview ? new Date() : undefined,
        videoStreamUid: streamUid ?? undefined,
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

  // A Muse is always public (see this function's own doc comment) — no
  // CONNECTIONS_ONLY-style split needed the way createPost's does, and this
  // already reaches every accepted connection too, not just declared
  // subscribers (accepting a connection request auto-subscribes both
  // sides — see respondToConnectionRequest in actions/connections.ts).
  // Skipped for a Muse held for manual review (see videoNeedsManualReview
  // above), same "don't point people at something not visible yet"
  // reasoning as createPost/createStory's own gates.
  if (muse.moderationStatus === "PUBLISHED") {
    await notifySubscribers(user.id, "SUBSCRIPTION_MUSE", { museId: muse.id });
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
      reposts: { where: { userId: user.id }, select: { id: true } },
    },
  });

  const authorIds = [...new Set(items.map((m) => m.authorId).filter((id) => id !== user.id))];
  const followingIds = authorIds.length
    ? new Set(
        (
          await prisma.subscription.findMany({
            where: { subscriberId: user.id, subscribedToId: { in: authorIds } },
            select: { subscribedToId: true },
          })
        ).map((s) => s.subscribedToId),
      )
    : new Set<string>();

  const nextCursor = items.length === MUSE_FEED_PAGE_SIZE ? items[items.length - 1].id : null;
  return {
    items: items.map((m) => ({
      id: m.id,
      caption: m.caption,
      videoUrl: m.videoUrl,
      videoThumbnailUrl: m.videoThumbnailUrl,
      audioUrl: m.audioUrl,
      createdAt: m.createdAt,
      likeCount: m.likeCount,
      commentCount: m.commentCount,
      shareCount: m.shareCount,
      repostCount: m.repostCount,
      viewCount: m.viewCount,
      author: m.author,
      myReaction: m.reactions[0]?.emoji ?? null,
      isReposted: m.reposts.length > 0,
      isFollowingAuthor: followingIds.has(m.authorId),
      sharedPostId: m.sharedPostId,
    })),
    nextCursor,
  };
}

/** Single Muse fetch backing the /muse/[id] permalink page (shared/deep links) — same shape as one getMuseFeed item. */
export async function getMuseById(id: string) {
  const user = await requireVerifiedUser();

  const m = await prisma.muse.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
      reactions: { where: { userId: user.id }, select: { emoji: true } },
      reposts: { where: { userId: user.id }, select: { id: true } },
    },
  });
  if (!m || m.moderationStatus !== "PUBLISHED" || (await isBlockedEitherWay(user.id, m.authorId))) {
    return { error: "not_found" as const, item: null };
  }

  const isFollowingAuthor =
    m.authorId === user.id
      ? false
      : Boolean(
          await prisma.subscription.findUnique({
            where: { subscriberId_subscribedToId: { subscriberId: user.id, subscribedToId: m.authorId } },
          }),
        );

  return {
    error: null,
    item: {
      id: m.id,
      caption: m.caption,
      videoUrl: m.videoUrl,
      videoThumbnailUrl: m.videoThumbnailUrl,
      audioUrl: m.audioUrl,
      createdAt: m.createdAt,
      likeCount: m.likeCount,
      commentCount: m.commentCount,
      shareCount: m.shareCount,
      repostCount: m.repostCount,
      viewCount: m.viewCount,
      author: m.author,
      myReaction: m.reactions[0]?.emoji ?? null,
      isReposted: m.reposts.length > 0,
      isFollowingAuthor,
      sharedPostId: m.sharedPostId,
    },
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
    [muse.videoUrl, muse.videoThumbnailUrl, muse.audioUrl]
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

/**
 * Logs one "share" event (native device share sheet, copy-link, etc.) and
 * bumps Muse.shareCount — mirrors recordShare (actions/shares.ts) for Post.
 * Fire-and-forget from the client immediately after the native share sheet
 * is invoked, same as recordShare's own callers.
 */
export async function recordMuseShare(museId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("museShare", user.id);
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

  const [, updated] = await prisma.$transaction([
    prisma.museShare.create({ data: { userId: user.id, museId } }),
    prisma.muse.update({ where: { id: museId }, data: { shareCount: { increment: 1 } } }),
  ]);

  if (muse.authorId !== user.id) {
    await prisma.notification.create({
      data: { recipientId: muse.authorId, actorId: user.id, type: "MUSE_SHARE", museId },
    });
    await pushActivityNotification(muse.authorId, "MUSE_SHARE", user.name ?? "Someone", "/muse");
  }

  revalidatePath("/muse");
  return { error: null, shareCount: updated.shareCount };
}

/**
 * Toggles the caller's "reshare" of a Muse — a lightweight boost (bumps
 * repostCount, notifies the author) rather than Post's repost(), which
 * creates a whole new quotable Post row: /muse is already one global feed
 * visible to everyone, so a reshare has no separate feed placement to create
 * the way a Post repost does for followers' Home feeds. See MuseRepost in
 * schema.prisma.
 */
export async function toggleMuseRepost(museId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("museRepost", user.id);
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

  const existing = await prisma.museRepost.findUnique({
    where: { userId_museId: { userId: user.id, museId } },
  });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.museRepost.delete({ where: { id: existing.id } }),
      prisma.muse.update({ where: { id: museId }, data: { repostCount: { decrement: 1 } } }),
    ]);
    revalidatePath("/muse");
    return { error: null, reposted: false, repostCount: updated.repostCount };
  }

  const [, updated] = await prisma.$transaction([
    prisma.museRepost.create({ data: { userId: user.id, museId } }),
    prisma.muse.update({ where: { id: museId }, data: { repostCount: { increment: 1 } } }),
  ]);

  if (muse.authorId !== user.id) {
    await prisma.notification.create({
      data: { recipientId: muse.authorId, actorId: user.id, type: "MUSE_REPOST", museId },
    });
    await pushActivityNotification(muse.authorId, "MUSE_REPOST", user.name ?? "Someone", "/muse");
  }

  revalidatePath("/muse");
  return { error: null, reposted: true, repostCount: updated.repostCount };
}

/**
 * Bumps Muse.viewCount by one — called once per card-visible event from
 * MuseFeed's own IntersectionObserver, debounced client-side to fire at most
 * once per card per mount. Deliberately a raw counter with no per-viewer
 * StoryView-style dedup row: unlike a 24h-ephemeral story, a Muse never
 * expires, so a unique-per-viewer log here would be an unbounded table for a
 * permanent, potentially-viral feed. Best-effort — swallows a rate-limit hit
 * silently rather than surfacing an error to the viewer, since a missed view
 * tick is inconsequential.
 */
export async function recordMuseView(museId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("museView", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  try {
    await prisma.muse.update({ where: { id: museId }, data: { viewCount: { increment: 1 } } });
  } catch {
    // Muse already deleted out from under this view tick — nothing to do.
    return { error: "not_found" as const };
  }
  return { error: null };
}
