"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { canViewPost, isMembersOnlyPost } from "@/lib/post-visibility";
import { filterCircleContentViewers } from "@/lib/circle-permissions";

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
  // A cancelled event (cancelCircleEvent) takes no more RSVPs, either way.
  if (post.eventCancelledAt) {
    return { error: "cancelled" };
  }
  if (!(await canViewPost(postId, user.id))) {
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

  // An author who has left the event's PRIVATE Circle no longer sees it (lib/circle-visibility.ts).
  if (
    post.authorId !== user.id &&
    (!post.circleId || (await filterCircleContentViewers(post.circleId, [post.authorId])).length > 0)
  ) {
    await prisma.notification.create({
      data: {
        recipientId: post.authorId,
        actorId: user.id,
        type: "EVENT_RSVP",
        postId: post.id,
      },
    });
  }
  // A members-only event (a PRIVATE Circle's, or a private channel's) isn't announced to the RSVPer's subscribers, who
  // need not be members: to them it doesn't exist (lib/circle-visibility.ts).
  if (!(await isMembersOnlyPost(post))) {
    await notifySubscribers(user.id, "SUBSCRIPTION_RSVP", { postId: post.id });
  }

  revalidatePostViews(post);
  return { error: null, going: true, rsvpCount: updated.rsvpCount };
}
