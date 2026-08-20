import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { moderateVideo } from "@/lib/hive";
import { isCronAuthorized } from "@/lib/cron-auth";

const BATCH_SIZE = 20;

/**
 * Triggered on a schedule (Netlify Scheduled Function), same pattern as the
 * other cron routes — this is the only place video-body moderation runs
 * (see src/lib/hive.ts; Hive's Visual Moderation API is synchronous, so
 * calling it here rather than inline at post creation keeps a potentially
 * slow third-party call out of the user-facing publish request).
 *
 * Claims each post (sets videoModeratedAt) BEFORE calling Hive, not after —
 * unlike the read-only polling this route originally did against a
 * different API, this call is the real (billable) moderation work, so an
 * overlapping cron run must not redo it. On failure, un-claims the post so
 * a later run retries instead of silently leaving it unmoderated forever.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pending = await prisma.post.findMany({
    where: { mediaType: "VIDEO", videoModeratedAt: null, videoUrl: { not: null } },
    select: { id: true, videoUrl: true },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;

  for (const post of pending) {
    const claimed = await prisma.post.updateMany({
      where: { id: post.id, videoModeratedAt: null },
      data: { videoModeratedAt: new Date() },
    });
    if (claimed.count === 0) continue; // another run already claimed it

    try {
      const result = await moderateVideo(post.videoUrl!);
      if (result === null) {
        await prisma.post.updateMany({ where: { id: post.id }, data: { videoModeratedAt: null } });
        failed += 1;
        continue;
      }
      if (result.flagged) {
        await prisma.post.update({ where: { id: post.id }, data: { moderationStatus: "FLAGGED" } });
        flagged += 1;
      } else {
        cleared += 1;
      }
    } catch (err) {
      await prisma.post.updateMany({ where: { id: post.id }, data: { videoModeratedAt: null } });
      failed += 1;
      console.error(`[moderate-videos] failed to moderate video for post ${post.id}`, err);
    }
  }

  return NextResponse.json({ error: null, postsChecked: pending.length, flagged, cleared, failed });
}
