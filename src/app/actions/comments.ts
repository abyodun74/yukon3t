"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { commentSchema, editCommentSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText, moderateMedia } from "@/lib/moderation";
import { isEmojiOnly } from "@/lib/emoji";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";
import { canViewPost } from "@/lib/post-visibility";
import { pushActivityNotification } from "@/lib/notify-push";
import { isGiphyUrl } from "@/lib/giphy";
import {
  verifyUploadedSize,
  keyFromPublicUrl,
  deleteOwnedObject,
  deleteObject,
  MEDIA_LIMITS,
  HIVE_VIDEO_MODERATION_MAX_SECONDS,
} from "@/lib/storage";
import { isStreamConfigured, createStreamCopy } from "@/lib/cloudflare-stream";

const REACTION_SELECT = { emoji: true, userId: true } as const;

export async function createComment(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("comment", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const parsed = commentSchema.safeParse({
    postId: formData.get("postId"),
    parentId: formData.get("parentId") || undefined,
    content: formData.get("content"),
    gifUrl: formData.get("gifUrl") || undefined,
    audioUrl: formData.get("audioUrl") || undefined,
    videoUrl: formData.get("videoUrl") || undefined,
    videoThumbnailUrl: formData.get("videoThumbnailUrl") || undefined,
    videoDurationSeconds: formData.get("videoDurationSeconds") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { postId, parentId, content, gifUrl, audioUrl, videoUrl, videoThumbnailUrl, videoDurationSeconds } =
    parsed.data;
  // Never uploaded to this app — the Giphy host check is the only gate,
  // same reasoning as sendMessage's/createPost's GIF handling.
  if (gifUrl && !isGiphyUrl(gifUrl)) {
    return { error: "invalid" };
  }

  // Uploaded objects for this attempt — cleaned up on any rejection below so
  // nothing rejected lingers in storage, same pattern createPost uses.
  const uploadedUrls = [audioUrl, videoUrl, videoThumbnailUrl].filter((url): url is string => Boolean(url));
  async function cleanupUploads() {
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteOwnedObject(key, user.id) : Promise.resolve();
      }),
    );
  }

  // audioUrl IS a real upload to this app's own bucket (unlike gifUrl) —
  // verify ownership + the actual object size server-side, same pattern
  // sendMessage uses for message-audio. Cleans up the orphaned object on
  // failure so a rejected comment doesn't leave a dangling upload behind.
  if (audioUrl) {
    const key = keyFromPublicUrl(audioUrl);
    const ok = key && (await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["comment-audio"], ownerId: user.id }));
    if (!ok) {
      await cleanupUploads();
      return { error: "too_large" };
    }
  }

  // Video and its thumbnail are unrelated objects — verified concurrently,
  // same reasoning as createPost's own videoOk/thumbOk check.
  if (videoUrl) {
    const [videoOk, thumbOk] = await Promise.all([
      (async () => {
        const key = keyFromPublicUrl(videoUrl);
        return key && (await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["comment-video"], ownerId: user.id }));
      })(),
      (async () => {
        if (!videoThumbnailUrl) return true;
        const key = keyFromPublicUrl(videoThumbnailUrl);
        return key && (await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["video-thumb"], ownerId: user.id }));
      })(),
    ]);
    if (!videoOk || !thumbOk) {
      await cleanupUploads();
      return { error: "too_large" };
    }
  }

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.moderationStatus !== "PUBLISHED") {
    await cleanupUploads();
    return { error: "not_found" };
  }
  if (!(await canViewPost(postId, user.id))) {
    await cleanupUploads();
    return { error: "not_found" };
  }

  let parentComment = null;
  if (parentId) {
    // Chain comments: a reply can itself be replied to, at any depth — the
    // only requirement is that the parent is a real, published comment on
    // this same post.
    parentComment = await prisma.comment.findUnique({ where: { id: parentId } });
    if (!parentComment || parentComment.postId !== postId || parentComment.moderationStatus !== "PUBLISHED") {
      await cleanupUploads();
      return { error: "invalid" };
    }
  }

  // Hive's Visual Moderation API can't scan past 60s of content — same
  // routing rule createPost uses for post video (see storage.ts's
  // HIVE_VIDEO_MODERATION_MAX_SECONDS).
  const videoNeedsManualReview =
    Boolean(videoUrl) && videoDurationSeconds !== undefined && videoDurationSeconds > HIVE_VIDEO_MODERATION_MAX_SECONDS;

  let moderationStatus: "PUBLISHED" | "FLAGGED";
  if (videoUrl) {
    // Video is held to the same strict no-sexual-content policy as post
    // video: any violation rejects the comment outright (uploads deleted),
    // rather than the lenient soft-FLAGGED path text/gif/audio comments get
    // below — a visual frame is inspectable the way raw audio isn't, so
    // there's no equivalent accepted gap to fall back on here.
    const modResult = await moderateMedia({ text: content, thumbnailUrl: videoThumbnailUrl });
    if (!modResult.allowed) {
      await cleanupUploads();
      return { error: "moderation" };
    }
    moderationStatus = videoNeedsManualReview ? "FLAGGED" : "PUBLISHED";
  } else {
    // A GIF-only or voice-only comment (no typed text) has no text of this
    // app's own to check — Giphy's catalog is pre-moderated, and a voice
    // clip has the same accepted no-content-scan gap as message-audio.
    moderationStatus = content ? ((await moderateText(content)).allowed ? "PUBLISHED" : "FLAGGED") : "PUBLISHED";
  }

  // Starts the long-video review's own slow part (Cloudflare copying and
  // encoding) right now instead of waiting for the moderate-long-videos
  // cron to discover this comment — same reasoning/timing win as
  // createPost's streamUidPromise. Best-effort: createStreamCopy already
  // fails closed to null on any error, and advanceLongVideoReview creates
  // its own copy on the cron's first pass if this one never lands.
  const streamUid =
    videoNeedsManualReview && videoUrl && isStreamConfigured() ? await createStreamCopy(videoUrl) : null;

  // Comment creation and the post's commentCount must land together —
  // a crash or a race between the two here would otherwise leave the
  // count permanently out of sync with the actual published comments,
  // the same failure mode deleteComment already guards against below.
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        postId,
        authorId: user.id,
        parentId,
        content,
        gifUrl,
        audioUrl,
        videoUrl,
        videoThumbnailUrl,
        videoDurationSeconds,
        moderationStatus,
        // Long videos never reach the moderate-videos cron (Hive can't scan
        // past 60s anyway) — pre-claiming here keeps its own
        // `videoUrl IS NOT NULL, videoModeratedAt IS NULL` scan from
        // picking this up and wasting/failing a Hive call on it.
        videoModeratedAt: videoNeedsManualReview ? new Date() : undefined,
        videoStreamUid: streamUid ?? undefined,
      },
    });
    if (moderationStatus === "PUBLISHED") {
      await tx.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      });
    }
    return created;
  });

  if (moderationStatus === "PUBLISHED") {
    if (post.authorId !== user.id) {
      await prisma.notification.create({
        data: {
          recipientId: post.authorId,
          actorId: user.id,
          type: "POST_COMMENT",
          postId,
          commentId: comment.id,
        },
      });
      await pushActivityNotification(post.authorId, "POST_COMMENT", user.name ?? "Someone", `/post/${postId}`);
    }

    if (parentComment && parentComment.authorId !== user.id && parentComment.authorId !== post.authorId) {
      await prisma.notification.create({
        data: {
          recipientId: parentComment.authorId,
          actorId: user.id,
          type: "COMMENT_REPLY",
          postId,
          commentId: comment.id,
        },
      });
      await pushActivityNotification(parentComment.authorId, "COMMENT_REPLY", user.name ?? "Someone", `/post/${postId}`);
    }
  }

  revalidatePath(`/post/${postId}`);
  return { error: null, moderationStatus };
}

/** Author-only: updates a comment's text and stamps editedAt — unlike deleteComment/hideComment, moderators can't edit someone else's words. */
export async function editComment(commentId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = editCommentSchema.safeParse({ content: formData.get("content") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { content } = parsed.data;

  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) {
    return { error: "not_found" as const };
  }
  if (comment.authorId !== user.id) {
    return { error: "forbidden" as const };
  }
  if (comment.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }

  const modResult = await moderateText(content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { content, moderationStatus, editedAt: new Date() },
    include: { reactions: { select: REACTION_SELECT } },
  });

  revalidatePath(`/post/${comment.postId}`);
  return { error: null, comment: updated };
}

/** Comment author (their own comment), the post's author, a co-admin/owner of the post's Circle, or a site admin. */
async function canModerateComment(
  user: { id: string; isAdmin: boolean },
  comment: { authorId: string },
  post: { authorId: string; circleId: string | null },
) {
  if (comment.authorId === user.id || post.authorId === user.id || user.isAdmin) {
    return true;
  }
  if (!post.circleId) {
    return false;
  }
  const circle = await prisma.circle.findUnique({ where: { id: post.circleId } });
  if (!circle) {
    return false;
  }
  const membership = await getCircleMembership(post.circleId, user.id);
  return isCircleAdmin(circle, membership, user);
}

export async function deleteComment(commentId: string) {
  const user = await requireVerifiedUser();

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { post: true, replies: true },
  });
  if (!comment) {
    return { error: "not_found" };
  }

  const canDelete = await canModerateComment(user, comment, comment.post);
  if (!canDelete) {
    return { error: "forbidden" };
  }

  const removedPublishedCount =
    (comment.moderationStatus === "PUBLISHED" ? 1 : 0) +
    comment.replies.filter((r) => r.moderationStatus === "PUBLISHED").length;

  await prisma.$transaction([
    prisma.comment.delete({ where: { id: commentId } }),
    ...(removedPublishedCount > 0
      ? [
          prisma.post.update({
            where: { id: comment.postId },
            data: { commentCount: { decrement: removedPublishedCount } },
          }),
        ]
      : []),
  ]);

  // A voice/video comment's actual file(s) otherwise keep sitting in R2
  // forever, unreferenced — same cleanup discipline as
  // deleteMessageForEveryone's media handling. Only this comment + its
  // direct replies (matching removedPublishedCount's own one-level scope
  // above) — a reply chain deeper than that is a pre-existing gap in this
  // scope, not one this feature introduces.
  const repliesMedia = comment.replies.flatMap((r) => [r.audioUrl, r.videoUrl, r.videoThumbnailUrl]);
  await Promise.all(
    [comment.audioUrl, comment.videoUrl, comment.videoThumbnailUrl, ...repliesMedia]
      .filter((url): url is string => Boolean(url))
      .map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteObject(key) : Promise.resolve();
      }),
  );

  revalidatePath(`/post/${comment.postId}`);
  return { error: null };
}

/**
 * Soft-removes a comment (moderationStatus -> REMOVED) instead of deleting
 * it outright, matching the same pattern already used for messages — a
 * thread's structure shouldn't vanish, just the offending content. Only
 * moderators (post author, the post's Circle owner/co-admin, or a site
 * admin) can hide a comment; a user removing their own comment should just
 * delete it.
 */
export async function hideComment(commentId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("circleModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { post: true },
  });
  if (!comment || comment.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }
  if (comment.authorId === user.id) {
    return { error: "forbidden" as const };
  }

  const canHide = await canModerateComment(user, comment, comment.post);
  if (!canHide) {
    return { error: "forbidden" as const };
  }

  // All three writes land together — a crash between them would otherwise
  // risk a hidden comment with no audit trail (or a count decrement with no
  // matching hide). Same accountability trail every other content-removal
  // action leaves (see reports.ts): a moderator hiding a comment isn't an
  // admin action, but it should be just as explainable/appealable and just
  // as visible to a site admin reviewing moderation activity.
  await prisma.$transaction([
    prisma.comment.update({ where: { id: commentId }, data: { moderationStatus: "REMOVED" } }),
    prisma.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } }),
    prisma.auditLog.create({
      data: {
        targetId: comment.authorId,
        action: "CONTENT_REMOVED",
        reason: "Comment hidden by a post author, Circle co-admin, or site admin.",
        performedBy: user.id,
      },
    }),
  ]);

  revalidatePath(`/post/${comment.postId}`);
  return { error: null };
}

/**
 * Toggles the caller's emoji reaction on a comment: picking the emoji they
 * already reacted with removes it, picking a different one replaces it —
 * one active reaction per user per comment, same as message reactions.
 */
export async function toggleCommentReaction(commentId: string, emoji: string) {
  const user = await requireVerifiedUser();

  if (!isEmojiOnly(emoji, 1)) {
    return { error: "invalid" as const };
  }

  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" as const };
  }

  const existing = await prisma.commentReaction.findUnique({
    where: { commentId_userId: { commentId, userId: user.id } },
  });

  if (existing?.emoji === emoji) {
    await prisma.commentReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.commentReaction.upsert({
      where: { commentId_userId: { commentId, userId: user.id } },
      create: { commentId, userId: user.id, emoji },
      update: { emoji },
    });
  }

  const reactions = await prisma.commentReaction.findMany({
    where: { commentId },
    select: REACTION_SELECT,
  });

  revalidatePath(`/post/${comment.postId}`);
  return { error: null, reactions };
}

/**
 * Client-fetch counterpart to the comment query src/app/post/[id]/page.tsx
 * runs server-side — lets a comment thread be loaded on demand (e.g.
 * PostCard's inline expand-in-place on Home/Circles, so commenting there
 * doesn't require navigating to the standalone post page) rather than only
 * ever being server-rendered as part of that one page. Reuses canViewPost,
 * the same visibility gate createComment itself already trusts, so a
 * private Circle post's comments can't be fetched by guessing its id any
 * more than the comment itself could be.
 */
export async function getPostComments(postId: string) {
  const user = await requireVerifiedUser();

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { authorId: true, circleId: true },
  });
  if (!post) {
    return { error: "not_found" as const };
  }
  if (!(await canViewPost(postId, user.id))) {
    return { error: "not_found" as const };
  }

  const comments = await prisma.comment.findMany({
    where: { postId, moderationStatus: { in: ["PUBLISHED", "REMOVED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
      reactions: { select: REACTION_SELECT },
    },
  });

  let canModerate = false;
  if (post.circleId) {
    const circle = await prisma.circle.findUnique({ where: { id: post.circleId } });
    if (circle) {
      const membership = await getCircleMembership(post.circleId, user.id);
      canModerate = isCircleAdmin(circle, membership, user);
    }
  }

  return { error: null, comments, postAuthorId: post.authorId, canModerate };
}
