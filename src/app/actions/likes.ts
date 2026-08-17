"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

function revalidatePostViews(post: { id: string; authorId: string; circle: { slug: string } | null }) {
  revalidatePath(`/post/${post.id}`);
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath("/home");
  if (post.circle) {
    revalidatePath(`/circles/${post.circle.slug}`);
  }
}

export async function toggleLike(postId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("like", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { circle: { select: { slug: true } } },
  });
  if (!post || post.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }

  const existing = await prisma.like.findUnique({
    where: { userId_postId: { userId: user.id, postId } },
  });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.like.delete({ where: { id: existing.id } }),
      prisma.post.update({
        where: { id: postId },
        data: { likeCount: { decrement: 1 } },
      }),
    ]);
    revalidatePostViews(post);
    return { error: null, liked: false, likeCount: updated.likeCount };
  }

  const [, updated] = await prisma.$transaction([
    prisma.like.create({ data: { userId: user.id, postId } }),
    prisma.post.update({
      where: { id: postId },
      data: { likeCount: { increment: 1 } },
    }),
  ]);

  if (post.authorId !== user.id) {
    await prisma.notification.create({
      data: {
        recipientId: post.authorId,
        actorId: user.id,
        type: "POST_LIKE",
        postId: post.id,
      },
    });
  }

  revalidatePostViews(post);
  return { error: null, liked: true, likeCount: updated.likeCount };
}

const LIKERS_LIMIT = 100;

/**
 * Who-liked-this list — unlike getStoryViewers, this is visible to anyone
 * (the like count itself is already public on every post), not just the
 * post's author. Callers pass the same already-root-resolved postId they'd
 * pass to toggleLike (see interactionTargetId in post-card.tsx).
 */
export async function getPostLikers(postId: string) {
  await requireVerifiedUser();

  const likes = await prisma.like.findMany({
    where: { postId },
    orderBy: { createdAt: "desc" },
    take: LIKERS_LIMIT,
    include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
  });

  return { likers: likes.map((l) => l.user) };
}
