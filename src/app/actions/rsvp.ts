"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { canViewPost, isMembersOnlyPost } from "@/lib/post-visibility";
import { filterCircleContentViewers } from "@/lib/circle-permissions";
import { rsvpSetSchema } from "@/lib/validations";
import { rsvpNotifiesAuthor, type RsvpStatus } from "@/lib/rsvp";

function revalidatePostViews(post: { id: string; authorId: string; circle: { slug: string } | null }) {
  revalidatePath(`/post/${post.id}`);
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath("/home");
  if (post.circle) {
    revalidatePath(`/circles/${post.circle.slug}`);
  }
}

type RsvpResult =
  | { error: "rate_limited" | "invalid" | "not_found" | "cancelled" }
  | { error: null; status: RsvpStatus | null; rsvpCount: number; maybeCount: number };

/**
 * Sets the caller's reply to an event post: "GOING", "MAYBE", or null to take it back. Any event post the caller can
 * see (Circle or not); a cancelled one takes no replies. The reply row is written and both counts recounted under a row
 * lock on the post, so two quick taps (or two people) can't leave the counts wrong. Only becoming Going notifies the
 * author (EVENT_RSVP) and the caller's subscribers (SUBSCRIPTION_RSVP), as before; Maybe and taking a reply back tell
 * nobody. Answers the caller's reply and the fresh counts.
 */
export async function setRsvp(postId: unknown, input: unknown): Promise<RsvpResult> {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("rsvp", user.id))) return { error: "rate_limited" };
  const parsed = rsvpSetSchema.safeParse({ postId, ...(input as object) });
  if (!parsed.success) return { error: "invalid" };
  const { status } = parsed.data;

  const post = await prisma.post.findUnique({
    where: { id: parsed.data.postId },
    select: {
      id: true,
      authorId: true,
      circleId: true,
      channelId: true,
      eventAt: true,
      eventCancelledAt: true,
      moderationStatus: true,
      circle: { select: { slug: true } },
    },
  });
  if (!post || post.moderationStatus !== "PUBLISHED" || !post.eventAt) return { error: "not_found" };
  // A cancelled event (cancelCircleEvent) takes no more replies, either way.
  if (post.eventCancelledAt) return { error: "cancelled" };
  if (!(await canViewPost(post.id, user.id))) return { error: "not_found" };

  const { previous, counts } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = ${post.id} FOR UPDATE`;
    const existing = await tx.postRsvp.findUnique({
      where: { userId_postId: { userId: user.id, postId: post.id } },
      select: { status: true },
    });
    if (status === null) {
      if (existing) await tx.postRsvp.delete({ where: { userId_postId: { userId: user.id, postId: post.id } } });
    } else if (!existing) {
      await tx.postRsvp.create({ data: { userId: user.id, postId: post.id, status } });
    } else if (existing.status !== status) {
      await tx.postRsvp.update({ where: { userId_postId: { userId: user.id, postId: post.id } }, data: { status } });
    }
    const grouped = await tx.postRsvp.groupBy({ by: ["status"], where: { postId: post.id }, _count: { _all: true } });
    const going = grouped.find((g) => g.status === "GOING")?._count._all ?? 0;
    const maybe = grouped.find((g) => g.status === "MAYBE")?._count._all ?? 0;
    await tx.post.update({ where: { id: post.id }, data: { rsvpCount: going, maybeCount: maybe } });
    return { previous: (existing?.status ?? null) as RsvpStatus | null, counts: { going, maybe } };
  });

  if (rsvpNotifiesAuthor(previous, status)) {
    // An author who has left the event's PRIVATE Circle no longer sees it (lib/circle-visibility.ts).
    if (
      post.authorId !== user.id &&
      (!post.circleId || (await filterCircleContentViewers(post.circleId, [post.authorId])).length > 0)
    ) {
      await prisma.notification.create({
        data: { recipientId: post.authorId, actorId: user.id, type: "EVENT_RSVP", postId: post.id },
      });
    }
    // A members-only event (a PRIVATE Circle's, or a private channel's) isn't announced to the RSVPer's subscribers, who
    // need not be members: to them it doesn't exist (lib/circle-visibility.ts).
    if (!(await isMembersOnlyPost(post))) {
      await notifySubscribers(user.id, "SUBSCRIPTION_RSVP", { postId: post.id });
    }
  }

  revalidatePostViews(post);
  return { error: null, status, rsvpCount: counts.going, maybeCount: counts.maybe };
}
