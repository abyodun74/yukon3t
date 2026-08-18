"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";
import { postSchema } from "@/lib/validations";
import { moderateText } from "@/lib/moderation";

/** Author-only: updates a post's text content and stamps editedAt. Media/type/event fields are immutable after posting. */
export async function editPost(postId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = postSchema.safeParse({ content: formData.get("content") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { content } = parsed.data;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return { error: "not_found" as const };
  }
  if (post.authorId !== user.id) {
    return { error: "forbidden" as const };
  }

  const modResult = await moderateText(content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  const updated = await prisma.post.update({
    where: { id: postId },
    data: { content, moderationStatus, editedAt: new Date() },
  });

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath(`/post/${postId}`);
  return { error: null, post: updated };
}

export async function deletePost(postId: string) {
  const user = await requireVerifiedUser();

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return { error: "not_found" };
  }

  const canDelete = post.authorId === user.id || user.isAdmin;
  if (!canDelete) {
    return { error: "forbidden" };
  }

  // Cascades (onDelete: Cascade on Post.repostOf/sharedPost) remove any
  // reposts/shares of this post along with it — a post is always public, so
  // there's no separate "delete for me" state to track the way there is for
  // a private message. Deleting a post that is itself a repost or a share
  // (repostOfId/sharedPostId set) doesn't cascade anywhere, but must still
  // decrement the original's repostCount/shareCount — those were bumped
  // when the repost/share row was created (see repost()/shareToCircle() in
  // reposts.ts/shares.ts) and would otherwise stay permanently inflated.
  await prisma.$transaction([
    prisma.post.delete({ where: { id: postId } }),
    ...(post.repostOfId
      ? [prisma.post.update({ where: { id: post.repostOfId }, data: { repostCount: { decrement: 1 } } })]
      : []),
    ...(post.sharedPostId
      ? [prisma.post.update({ where: { id: post.sharedPostId }, data: { shareCount: { decrement: 1 } } })]
      : []),
  ]);

  const mediaUrls = [
    ...post.mediaUrls,
    ...(post.videoUrl ? [post.videoUrl] : []),
    ...(post.videoThumbnailUrl ? [post.videoThumbnailUrl] : []),
  ];
  for (const url of mediaUrls) {
    const key = keyFromPublicUrl(url);
    if (key) await deleteObject(key);
  }

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath(`/post/${postId}`);
  if (post.repostOfId) revalidatePath(`/post/${post.repostOfId}`);
  if (post.sharedPostId) revalidatePath(`/post/${post.sharedPostId}`);
  return { error: null };
}
