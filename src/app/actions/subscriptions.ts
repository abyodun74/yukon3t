"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { track } from "@/lib/analytics";

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
