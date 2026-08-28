"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { track } from "@/lib/analytics";

// Matches /u/[userId]/subscribers and /subscribing's own PAGE_SIZE.
const SUBSCRIPTIONS_PAGE_SIZE = 20;

const subscriptionUserSelect = { id: true, name: true, username: true, avatarUrl: true, trustBand: true } as const;

async function subscribedByViewer(viewerId: string, listedIds: string[]) {
  const ids = listedIds.filter((id) => id !== viewerId);
  const rows = ids.length
    ? await prisma.subscription.findMany({
        where: { subscriberId: viewerId, subscribedToId: { in: ids } },
        select: { subscribedToId: true },
      })
    : [];
  return new Set(rows.map((s) => s.subscribedToId));
}

/**
 * One-directional "follow" toggle — unlike requestConnection/respondToConnection,
 * there's no approval step, so a single toggle (mirrors toggleLike) covers both
 * subscribe and unsubscribe.
 */
export async function toggleSubscription(targetId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("subscribe", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  if (typeof targetId !== "string" || !targetId || targetId === user.id) {
    return { error: "invalid" };
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.status !== "ACTIVE") {
    return { error: "not_found" };
  }
  // Deliberately indistinguishable from "not_found" — same reasoning as
  // requestConnection: a subscribe attempt shouldn't reveal a block.
  if (await isBlockedEitherWay(user.id, targetId)) {
    return { error: "not_found" };
  }

  const existing = await prisma.subscription.findUnique({
    where: { subscriberId_subscribedToId: { subscriberId: user.id, subscribedToId: targetId } },
  });

  if (existing) {
    await prisma.subscription.delete({ where: { id: existing.id } });
    revalidatePath(`/u/${targetId}`);
    revalidatePath(`/u/${targetId}/subscribers`);
    revalidatePath(`/u/${user.id}/subscribing`);
    return { error: null, subscribed: false };
  }

  await prisma.subscription.create({ data: { subscriberId: user.id, subscribedToId: targetId } });
  await track("SUBSCRIBED", user.id, { targetId });

  revalidatePath(`/u/${targetId}`);
  revalidatePath(`/u/${targetId}/subscribers`);
  revalidatePath(`/u/${user.id}/subscribing`);
  return { error: null, subscribed: true };
}

/** Auto-load-more for /u/[userId]/subscribers, called via useInfiniteScroll. */
export async function loadMoreSubscribers(profileUserId: string, cursor: string) {
  const viewer = await requireUser();
  const rows = await prisma.subscription.findMany({
    where: { subscribedToId: profileUserId },
    include: { subscriber: { select: subscriptionUserSelect } },
    orderBy: { createdAt: "desc" },
    take: SUBSCRIPTIONS_PAGE_SIZE,
    cursor: { id: cursor },
    skip: 1,
  });
  const subscribedByMeSet = await subscribedByViewer(viewer.id, rows.map((r) => r.subscriber.id));
  return {
    items: rows.map((r) => ({
      id: r.id,
      user: r.subscriber,
      subscribedByViewer: subscribedByMeSet.has(r.subscriber.id),
    })),
    hasMore: rows.length === SUBSCRIPTIONS_PAGE_SIZE,
  };
}

/** Auto-load-more for /u/[userId]/subscribing, called via useInfiniteScroll. */
export async function loadMoreSubscribing(profileUserId: string, cursor: string) {
  const viewer = await requireUser();
  const rows = await prisma.subscription.findMany({
    where: { subscriberId: profileUserId },
    include: { subscribedTo: { select: subscriptionUserSelect } },
    orderBy: { createdAt: "desc" },
    take: SUBSCRIPTIONS_PAGE_SIZE,
    cursor: { id: cursor },
    skip: 1,
  });
  const subscribedByMeSet = await subscribedByViewer(viewer.id, rows.map((r) => r.subscribedTo.id));
  return {
    items: rows.map((r) => ({
      id: r.id,
      user: r.subscribedTo,
      subscribedByViewer: subscribedByMeSet.has(r.subscribedTo.id),
    })),
    hasMore: rows.length === SUBSCRIPTIONS_PAGE_SIZE,
  };
}
