"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { commentSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { isEmojiOnly } from "@/lib/emoji";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";

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
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { postId, parentId, content } = parsed.data;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }

  let parentComment = null;
  if (parentId) {
    // Chain comments: a reply can itself be replied to, at any depth — the
    // only requirement is that the parent is a real, published comment on
    // this same post.
    parentComment = await prisma.comment.findUnique({ where: { id: parentId } });
    if (!parentComment || parentComment.postId !== postId || parentComment.moderationStatus !== "PUBLISHED") {
      return { error: "invalid" };
    }
  }

  const modResult = await moderateText(content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  // Comment creation and the post's commentCount must land together —
  // a crash or a race between the two here would otherwise leave the
  // count permanently out of sync with the actual published comments,
  // the same failure mode deleteComment already guards against below.
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { postId, authorId: user.id, parentId, content, moderationStatus },
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
    }

    if (parentComment && parentComment.authorId !== user.id && parentComment.authorId !== post.authorId) {
      await prisma.notification.create({
        data: {
          recipientId: parentComment.authorId,
          actorId: user.id,
          type: "POST_COMMENT",
          postId,
          commentId: comment.id,
        },
      });
    }
  }

  revalidatePath(`/post/${postId}`);
  return { error: null, moderationStatus };
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

  await prisma.$transaction([
    prisma.comment.update({ where: { id: commentId }, data: { moderationStatus: "REMOVED" } }),
    prisma.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } }),
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
