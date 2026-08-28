"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Called every ~45s by presence-heartbeat.tsx while the app is open and the
 * tab is visible. Bumps lastSeenAt only — no streak/trust scoring here (that
 * stays in recordActivity, gated to real content-creation actions).
 */
export async function pingPresence() {
  const user = await requireUser();

  const allowed = await checkRateLimit("presenceHeartbeat", user.id);
  if (!allowed) return { error: null };

  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  return { error: null };
}
