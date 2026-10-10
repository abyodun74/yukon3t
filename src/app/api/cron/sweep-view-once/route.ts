import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { isViewOnceConfigured } from "@/lib/storage";
import { destroyViewOnceMedia } from "@/lib/view-once-media";
import { VIEW_ONCE_SWEEP_AFTER_OPEN_MS } from "@/lib/view-once";

const BATCH_SIZE = 100;
const CONCURRENCY = 10;

/**
 * Triggered every minute (netlify/functions/sweep-view-once.mts). Deletes the private file and ViewOnceMedia row
 * of every view-once message that no longer needs one:
 * - opened more than VIEW_ONCE_SWEEP_AFTER_OPEN_MS (4 minutes) ago: the recipient's app never confirmed it had
 *   shown the file — closed, crashed, offline — or its own delete failed. That cutoff is the 2-minute retry window
 *   plus the 60-second life of a download link issued at its last moment plus a margin, so a file is never deleted
 *   while a valid link still points at it. With this running every minute, the worst case is about 5 minutes;
 * - never opened and past viewOnceExpiresAt;
 * - deleted for everyone or removed by moderation, where the first delete attempt didn't go through.
 * The Message row stays, as the record that a view-once message was sent and (if so) opened.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // View-once is simply switched off here (no private bucket): nothing to sweep, and not an error to report every minute.
  if (!isViewOnceConfigured()) {
    return NextResponse.json({ error: null, skipped: true });
  }

  const now = new Date();
  // Same rule as viewOnceMediaIsDue in src/lib/view-once.ts, as a query.
  const due = await prisma.viewOnceMedia.findMany({
    where: {
      message: {
        OR: [
          { viewOnceOpenedAt: { lt: new Date(now.getTime() - VIEW_ONCE_SWEEP_AFTER_OPEN_MS) } },
          { viewOnceOpenedAt: null, viewOnceExpiresAt: { lte: now } },
          { deletedForEveryoneAt: { not: null } },
          { moderationStatus: "REMOVED" },
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { messageId: true },
  });

  let deleted = 0;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const results = await Promise.all(
      due.slice(i, i + CONCURRENCY).map((row) =>
        destroyViewOnceMedia(row.messageId).catch((err) => {
          console.error(`[sweep-view-once] failed for message ${row.messageId}`, err);
          return false;
        }),
      ),
    );
    deleted += results.filter(Boolean).length;
  }

  return NextResponse.json({ error: null, due: due.length, deleted, failed: due.length - deleted });
}
