"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

/** A ping within this long of the last recorded one changes nothing anyone can see (online lasts ONLINE_WINDOW_MS). */
const PRESENCE_WRITE_MIN_INTERVAL_MS = 30_000;

/**
 * Called every ~45s by presence-heartbeat.tsx while the app is open and the
 * tab is visible. Bumps lastSeenAt only — no streak/trust scoring here (that
 * stays in recordActivity, gated to real content-creation actions).
 */
export async function pingPresence() {
  const user = await requireUser();

  // requireUser already read the row: a lastSeenAt this fresh is still well inside ONLINE_WINDOW_MS (src/lib/presence.ts)
  // after the next heartbeat, so skip the write (and the limiter call). A visibilitychange ping right after an
  // interval ping is the common case.
  const now = new Date();
  if (user.lastSeenAt && now.getTime() - user.lastSeenAt.getTime() < PRESENCE_WRITE_MIN_INTERVAL_MS) {
    return { error: null };
  }

  const allowed = await checkRateLimit("presenceHeartbeat", user.id);
  if (!allowed) return { error: null };

  // updateMany: no RETURNING of the whole User row.
  await prisma.user.updateMany({
    where: { id: user.id },
    data: { lastSeenAt: now },
  });

  return { error: null };
}
