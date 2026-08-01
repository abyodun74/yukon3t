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

export async function toggleRsvp(postId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("rsvp", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { circle: { select: { slug: true } } },
  });
  if (!post || post.moderationStatus !== "PUBLISHED" || !post.eventAt) {
    return { error: "not_found" };
  }

  const existing = await prisma.postRsvp.findUnique({
    where: { userId_postId: { userId: user.id, postId } },
  });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.postRsvp.delete({ where: { id: existing.id } }),
      prisma.post.update({
        where: { id: postId },
        data: { rsvpCount: { decrement: 1 } },
      }),
    ]);
    revalidatePostViews(post);
    return { error: null, going: false, rsvpCount: updated.rsvpCount };
  }

  const [, updated] = await prisma.$transaction([
    prisma.postRsvp.create({ data: { userId: user.id, postId } }),
    prisma.post.update({
      where: { id: postId },
      data: { rsvpCount: { increment: 1 } },
    }),
  ]);

  if (post.authorId !== user.id) {
    await prisma.notification.create({
      data: {
        recipientId: post.authorId,
        actorId: user.id,
        type: "EVENT_RSVP",
        postId: post.id,
      },
    });
  }

  revalidatePostViews(post);
  return { error: null, going: true, rsvpCount: updated.rsvpCount };
}
