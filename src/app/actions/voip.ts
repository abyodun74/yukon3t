"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

/**
 * Registers an iOS device's raw APNs PushKit token against the signed-in
 * user — the VoIP counterpart to registerFcmToken (actions/fcm.ts). See
 * src/lib/apns-voip.ts for why VoIP pushes need their own token/send path
 * instead of reusing FcmToken/Firebase.
 */
export async function registerVoipToken(token: string) {
  const user = await requireUser();

  if (!token || token.length > 512) {
    return { error: "invalid" as const };
  }

  await prisma.voipPushToken.upsert({
    where: { token },
    // The same token re-registering under a different account (shared
    // device, new sign-in) should move to the new owner, not stay stuck.
    create: { userId: user.id, token },
    update: { userId: user.id },
  });

  return { error: null };
}

/**
 * Unregisters this device's VoIP token — called from Nav's sign-out
 * handler alongside unregisterFcmToken, before the session actually ends.
 */
export async function unregisterVoipToken(token: string) {
  const user = await requireUser();
  if (!token) return { error: null };

  await prisma.voipPushToken.deleteMany({ where: { token, userId: user.id } });
  return { error: null };
}
