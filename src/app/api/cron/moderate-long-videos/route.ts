import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { advanceLongVideoReview } from "@/lib/video-review";
import { removeModeratedContent, cleanUpModeratedMedia } from "@/lib/content-moderation";
import { recomputeTrustScore } from "@/lib/trust";
import { revalidatePath } from "next/cache";
import { HIVE_VIDEO_MODERATION_MAX_SECONDS } from "@/lib/storage";

// A tick can span a Cloudflare API call plus (once captions are ready) up to
// MAX_FRAMES OpenAI moderation calls batched at FRAME_MODERATION_CONCURRENCY
// (video-review.ts) — generous, but the actual ceiling is whatever the
// deploy platform allows a Next.js route to run for; a tick that gets killed
// mid-way is not lost work, see videoLongReviewClaimedAt's staleness window
// below.
export const maxDuration = 300;

// How long a claim is honored before another tick is allowed to pick the
// same post back up — long enough that a normal in-progress review (touched
// every ~5 minutes by the scheduled trigger) is never mistaken for
// abandoned, short enough that a tick killed by a platform timeout doesn't
// stall that post's review for long.
const CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Triggered on a schedule (Netlify Scheduled Function), same thin-trigger
 * pattern as moderate-videos. Processes exactly one long (over Hive's 60s
 * cap) FLAGGED video post per invocation — see video-review.ts for why this
 * is a multi-tick, resumable pipeline rather than one synchronous call.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS);
  const claimable = { OR: [{ videoLongReviewClaimedAt: null }, { videoLongReviewClaimedAt: { lt: staleCutoff } }] };

  const candidate = await prisma.post.findFirst({
    where: {
      mediaType: "VIDEO",
      moderationStatus: "FLAGGED",
      videoDurationSeconds: { gt: HIVE_VIDEO_MODERATION_MAX_SECONDS },
      ...claimable,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, videoUrl: true, videoDurationSeconds: true, videoStreamUid: true },
  });

  if (!candidate || !candidate.videoUrl || !candidate.videoDurationSeconds) {
    return NextResponse.json({ error: null, processed: false });
  }

  const claimed = await prisma.post.updateMany({
    where: { id: candidate.id, ...claimable },
    data: { videoLongReviewClaimedAt: new Date() },
  });
  if (claimed.count === 0) {
    // Another (still-live) run already holds this claim.
    return NextResponse.json({ error: null, processed: false });
  }

  let result;
  try {
    result = await advanceLongVideoReview({
      videoUrl: candidate.videoUrl,
      videoDurationSeconds: candidate.videoDurationSeconds,
      streamUid: candidate.videoStreamUid,
    });
  } catch (err) {
    console.error(`[moderate-long-videos] unhandled error reviewing post ${candidate.id}`, err);
    await prisma.post.updateMany({
      where: { id: candidate.id },
      data: { videoLongReviewClaimedAt: null },
    });
    return NextResponse.json({ error: null, processed: true, outcome: "error" });
  }

  switch (result.kind) {
    case "in_progress": {
      await prisma.post.update({
        where: { id: candidate.id },
        data: { videoStreamUid: result.streamUid },
      });
      break;
    }
    case "error": {
      // Leave videoStreamUid as-is (if a Stream copy already exists, the
      // next attempt should resume against it, not re-upload) — only the
      // claim is released so a later tick retries.
      await prisma.post.updateMany({
        where: { id: candidate.id },
        data: { videoLongReviewClaimedAt: null },
      });
      break;
    }
    case "clean": {
      await prisma.post.update({
        where: { id: candidate.id },
        data: { moderationStatus: "PUBLISHED", videoLongReviewClaimedAt: null, videoStreamUid: null },
      });
      revalidatePath("/circles", "layout");
      revalidatePath("/home");
      revalidatePath(`/post/${candidate.id}`);
      break;
    }
    case "flagged": {
      const removed = await prisma.$transaction(async (tx) => {
        const removal = await removeModeratedContent("POST", candidate.id, tx);
        if (removal) {
          await tx.auditLog.create({
            data: {
              targetId: removal.authorId,
              action: "CONTENT_REMOVED",
              // Not FK'd to any User (see AuditLog.performedBy comment in
              // schema.prisma) — a plain sentinel identifying this as an
              // automated verdict rather than an admin's own action.
              performedBy: "system:openai-video-review",
              reason: `Long-video automated review flagged: ${result.reasons.join("; ")}`,
            },
          });
        }
        return removal;
      });
      if (removed) {
        await cleanUpModeratedMedia(removed.mediaKeysToDelete);
        await recomputeTrustScore(removed.authorId);
      }
      break;
    }
  }

  return NextResponse.json({ error: null, processed: true, outcome: result.kind });
}
