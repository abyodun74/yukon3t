"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";

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

  // Cascades (onDelete: Cascade on Post.repostOf) remove any reposts of this
  // post along with it — a post is always public, so there's no separate
  // "delete for me" state to track the way there is for a private message.
  await prisma.post.delete({ where: { id: postId } });

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
  return { error: null };
}
