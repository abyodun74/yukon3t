import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureError } from "@/lib/error-tracking";
import { selfOccasionRetentionCutoff } from "@/lib/gift-occasions";

/** At most this many rows deleted per run (oldest first); a backlog clears over the following days. */
const PRUNE_GIFT_OCCASIONS_BATCH = 1000;

/**
 * Deletes self-declared gift occasions (GiftSelfOccasion: "I graduated", "new job"...) declared more than 30 days ago
 * (selfOccasionRetentionCutoff, the same 30 days as SELF_OCCASION_COOLDOWN_MS in src/lib/gift-occasions.ts), removed or
 * not: past that they no longer affect anything. Once a day via netlify/functions/prune-gift-occasions.mts (on Vercel
 * nothing schedules it, like every cron here). Idempotent: the oldest PRUNE_GIFT_OCCASIONS_BATCH ids past the cutoff
 * are read through the declaredAt index, then deleted by id with the cutoff re-checked, so a repeated or overlapping
 * run deletes nothing twice and never a recent row.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const cutoff = selfOccasionRetentionCutoff(new Date());
    const due = await prisma.giftSelfOccasion.findMany({
      where: { declaredAt: { lt: cutoff } },
      orderBy: { declaredAt: "asc" },
      take: PRUNE_GIFT_OCCASIONS_BATCH,
      select: { id: true },
    });
    if (due.length === 0) {
      return NextResponse.json({ error: null, due: 0, deleted: 0 });
    }
    const { count } = await prisma.giftSelfOccasion.deleteMany({
      where: { id: { in: due.map((row) => row.id) }, declaredAt: { lt: cutoff } },
    });
    return NextResponse.json({ error: null, due: due.length, deleted: count });
  } catch (err) {
    console.error("[prune-gift-occasions] run failed", err);
    await captureError(err, { action: "prune-gift-occasions cron" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
