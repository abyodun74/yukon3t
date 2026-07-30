"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { commentSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";

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
    parentComment = await prisma.comment.findUnique({ where: { id: parentId } });
    // Only one level of nesting: you can reply to a top-level comment,
    // never to a reply.
    if (!parentComment || parentComment.postId !== postId || parentComment.parentId) {
      return { error: "invalid" };
    }
  }

  const modResult = await moderateText(content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  const comment = await prisma.comment.create({
    data: { postId, authorId: user.id, parentId, content, moderationStatus },
  });

  if (moderationStatus === "PUBLISHED") {
    await prisma.post.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });

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

export async function deleteComment(commentId: string) {
  const user = await requireVerifiedUser();

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { post: true, replies: true },
  });
  if (!comment) {
    return { error: "not_found" };
  }

  const canDelete =
    comment.authorId === user.id ||
    comment.post.authorId === user.id ||
    user.isAdmin;
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
