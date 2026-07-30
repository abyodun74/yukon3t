"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

export async function recordShare(postId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("share", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }

  const [, updated] = await prisma.$transaction([
    prisma.share.create({ data: { userId: user.id, postId } }),
    prisma.post.update({
      where: { id: postId },
      data: { shareCount: { increment: 1 } },
    }),
  ]);

  if (post.authorId !== user.id) {
    await prisma.notification.create({
      data: {
        recipientId: post.authorId,
        actorId: user.id,
        type: "POST_SHARE",
        postId: post.id,
      },
    });
  }

  revalidatePath(`/post/${postId}`);
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath("/home");
  return { error: null, shareCount: updated.shareCount };
}
