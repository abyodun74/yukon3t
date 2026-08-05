"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

/**
 * Registers a native Android device's FCM token against the signed-in user.
 * Called by fcm-token-bridge.tsx after the native app hands its token to the
 * web page (via a one-time ?fcm_token= launch param — see that component
 * for the full handoff, since a TWA's native code can't call an
 * authenticated API directly; it has to go through the page's own session).
 */
export async function registerFcmToken(token: string) {
  const user = await requireUser();

  if (!token || token.length > 4096) {
    return { error: "invalid" as const };
  }

  await prisma.fcmToken.upsert({
    where: { token },
    create: { userId: user.id, token },
    // The same token re-registering under a different account (shared
    // device, new sign-in) should move to the new owner, not stay stuck.
    update: { userId: user.id },
  });

  return { error: null };
}

export async function unregisterFcmToken(token: string) {
  await requireUser();
  await prisma.fcmToken.deleteMany({ where: { token } });
  return { error: null };
}
