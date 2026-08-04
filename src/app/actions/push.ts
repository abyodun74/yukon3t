"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

type SubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function subscribeToPush(subscription: SubscriptionInput) {
  const user = await requireUser();

  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return { error: "invalid" as const };
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    // The same endpoint re-subscribing to a different account (e.g. shared
    // device, new sign-in) should move to the new owner, not stay stuck.
    update: {
      userId: user.id,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  });

  return { error: null };
}

export async function unsubscribeFromPush(endpoint: string) {
  await requireUser();
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return { error: null };
}
