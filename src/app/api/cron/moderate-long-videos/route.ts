import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { advanceLongVideoReview, type VideoReviewResult } from "@/lib/video-review";
import { removeModeratedContent, cleanUpModeratedMedia } from "@/lib/content-moderation";
import { notifyVideoModerationFailed } from "@/lib/video-moderation-notice";
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
// same post back up — long enough that a normal in-progress review (now
// polled every POLL_INTERVAL_MS within reviewOnePost's own loop, backstopped
// by the scheduled trigger re-running every minute) is never mistaken for
// abandoned, short enough that a tick killed by a platform timeout doesn't
// stall that post's review for long.
const CLAIM_STALE_MS = 10 * 60 * 1000;

// How many long-video posts one tick works on at once. Each post's review
// is an independent, mostly-network-bound poll loop (reviewOnePost below),
// not CPU-bound, so running several concurrently costs roughly the same
// wall-clock time as running one — it just means a burst of long-video
// uploads makes progress in parallel instead of queuing strictly one post
// behind whichever happens to be oldest.
const BATCH_SIZE = 3;

// Ceiling on how long this tick actively polls Cloudflare for a single
// post's progress before giving up and leaving it for the next tick — kept
// safely under maxDuration above so the platform never kills the function
// mid-write. Real Cloudflare processing (copy/encode, then caption
// generation) is what actually gates a verdict; this budget just controls
// how long *this invocation* sticks around to catch it landing, rather than
// finding out up to a whole cron interval later the way a single
// advanceLongVideoReview call per tick used to.
const POLL_BUDGET_MS = 260_000;
const POLL_INTERVAL_MS = 4_000;

type Candidate = { id: string; videoUrl: string; videoDurationSeconds: number; videoStreamUid: string | null };

/**
 * Drives one post's (or comment's — see reviewOneComment below, an identical
 * copy against a different model) review from wherever it currently stands
 * through to a terminal verdict (or this tick's time budget, whichever comes
 * first), looping advanceLongVideoReview internally instead of returning
 * after a single step — most of the artificial multi-tick delay this
 * pipeline used to have wasn't Cloudflare's own processing time, it was this
 * app only checking back once every 5 minutes. Persists progress after every
 * step so a budget cutoff or a crash mid-loop loses at most one
 * POLL_INTERVAL_MS's worth of work, same recovery story the single-step
 * version had.
 */
async function reviewOnePost(candidate: Candidate): Promise<VideoReviewResult["kind"]> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  let streamUid = candidate.videoStreamUid;

  for (;;) {
    let result: VideoReviewResult;
    try {
      result = await advanceLongVideoReview({
        videoUrl: candidate.videoUrl,
        videoDurationSeconds: candidate.videoDurationSeconds,
        streamUid,
      });
    } catch (err) {
      console.error(`[moderate-long-videos] unhandled error reviewing post ${candidate.id}`, err);
      await prisma.post.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
      return "error";
    }

    if (result.kind === "in_progress") {
      streamUid = result.streamUid;
      await prisma.post.update({ where: { id: candidate.id }, data: { videoStreamUid: streamUid } });
      if (Date.now() >= deadline) {
        // Ran out of this tick's budget still waiting on Cloudflare —
        // release the claim (keeping the uid) so the next tick resumes
        // right where this one left off.
        await prisma.post.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
        return "in_progress";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    if (result.kind === "error") {
      // Leave videoStreamUid as-is (if a Stream copy already exists, the
      // next attempt should resume against it, not re-copy) — only the
      // claim is released so a later tick retries.
      await prisma.post.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
      return "error";
    }

    if (result.kind === "clean") {
      await prisma.post.update({
        where: { id: candidate.id },
        data: { moderationStatus: "PUBLISHED", videoLongReviewClaimedAt: null, videoStreamUid: null },
      });
      revalidatePath("/circles", "layout");
      revalidatePath("/home");
      revalidatePath(`/post/${candidate.id}`);
      return "clean";
    }

    // result.kind === "flagged"
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
      // Tells the uploader why, with the specific violation type(s) — the
      // synchronous rejection path (createPost in actions/circles.ts)
      // already surfaces this to the uploader directly in-request; this is
      // the async pipeline's equivalent since nothing else would ever tell
      // them their post got silently removed.
      await notifyVideoModerationFailed(removed.authorId, result.reasons);
    }
    return "flagged";
  }
}

/**
 * Identical to reviewOnePost, against Comment instead of Post — Comment has
 * no equivalent of the feed-cache revalidations reviewOnePost does on
 * "clean" (a comment isn't its own route), just the one post page it lives
 * under. Kept as a separate function rather than a generic
 * model-parameterized one so each stays a plain, readable sequence of
 * concrete Prisma calls — matching how the rest of this codebase treats
 * Post/Comment as similar but genuinely distinct models, not a shared
 * abstraction forced over both.
 */
async function reviewOneComment(candidate: Candidate & { postId: string }): Promise<VideoReviewResult["kind"]> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  let streamUid = candidate.videoStreamUid;

  for (;;) {
    let result: VideoReviewResult;
    try {
      result = await advanceLongVideoReview({
        videoUrl: candidate.videoUrl,
        videoDurationSeconds: candidate.videoDurationSeconds,
        streamUid,
      });
    } catch (err) {
      console.error(`[moderate-long-videos] unhandled error reviewing comment ${candidate.id}`, err);
      await prisma.comment.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
      return "error";
    }

    if (result.kind === "in_progress") {
      streamUid = result.streamUid;
      await prisma.comment.update({ where: { id: candidate.id }, data: { videoStreamUid: streamUid } });
      if (Date.now() >= deadline) {
        await prisma.comment.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
        return "in_progress";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    if (result.kind === "error") {
      await prisma.comment.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
      return "error";
    }

    if (result.kind === "clean") {
      await prisma.comment.update({
        where: { id: candidate.id },
        data: { moderationStatus: "PUBLISHED", videoLongReviewClaimedAt: null, videoStreamUid: null },
      });
      revalidatePath(`/post/${candidate.postId}`);
      return "clean";
    }

    // result.kind === "flagged"
    const removed = await prisma.$transaction(async (tx) => {
      const removal = await removeModeratedContent("COMMENT", candidate.id, tx);
      if (removal) {
        await tx.auditLog.create({
          data: {
            targetId: removal.authorId,
            action: "CONTENT_REMOVED",
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
      await notifyVideoModerationFailed(removed.authorId, result.reasons);
    }
    return "flagged";
  }
}

/**
 * Triggered every minute (Netlify Scheduled Function), same thin-trigger
 * pattern as moderate-videos. Claims up to BATCH_SIZE long (over Hive's 60s
 * cap) FLAGGED video posts and drives each through reviewOnePost's own
 * internal poll loop concurrently — see that function and video-review.ts
 * for why a single post's review can still legitimately span more than one
 * tick (Cloudflare's own copy/encode/caption pipeline can outlast even this
 * tick's POLL_BUDGET_MS on a very long video), just far less often than
 * when this only advanced one post by one step every 5 minutes.
 */
async function claimPostCandidates(claimable: object) {
  const candidates = await prisma.post.findMany({
    where: {
      mediaType: "VIDEO",
      moderationStatus: "FLAGGED",
      videoDurationSeconds: { gt: HIVE_VIDEO_MODERATION_MAX_SECONDS },
      ...claimable,
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, videoUrl: true, videoDurationSeconds: true, videoStreamUid: true },
  });

  const claimed: Candidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.videoUrl || !candidate.videoDurationSeconds) continue;
    // Claimed one at a time (not a single updateMany across all ids) so a
    // candidate another still-live tick already grabbed is simply skipped
    // rather than losing the whole batch's claim to one race.
    const result = await prisma.post.updateMany({
      where: { id: candidate.id, ...claimable },
      data: { videoLongReviewClaimedAt: new Date() },
    });
    if (result.count > 0) {
      claimed.push({
        id: candidate.id,
        videoUrl: candidate.videoUrl,
        videoDurationSeconds: candidate.videoDurationSeconds,
        videoStreamUid: candidate.videoStreamUid,
      });
    }
  }
  return claimed;
}

// Same claiming logic as claimPostCandidates, against Comment instead of
// Post — no mediaType filter needed (see moderate-videos's own comment
// query for why), and postId is carried along so reviewOneComment can
// revalidate the right post page on a "clean" verdict.
async function claimCommentCandidates(claimable: object) {
  const candidates = await prisma.comment.findMany({
    where: {
      moderationStatus: "FLAGGED",
      videoDurationSeconds: { gt: HIVE_VIDEO_MODERATION_MAX_SECONDS },
      ...claimable,
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, postId: true, videoUrl: true, videoDurationSeconds: true, videoStreamUid: true },
  });

  const claimed: (Candidate & { postId: string })[] = [];
  for (const candidate of candidates) {
    if (!candidate.videoUrl || !candidate.videoDurationSeconds) continue;
    const result = await prisma.comment.updateMany({
      where: { id: candidate.id, ...claimable },
      data: { videoLongReviewClaimedAt: new Date() },
    });
    if (result.count > 0) {
      claimed.push({
        id: candidate.id,
        postId: candidate.postId,
        videoUrl: candidate.videoUrl,
        videoDurationSeconds: candidate.videoDurationSeconds,
        videoStreamUid: candidate.videoStreamUid,
      });
    }
  }
  return claimed;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS);
  const claimable = { OR: [{ videoLongReviewClaimedAt: null }, { videoLongReviewClaimedAt: { lt: staleCutoff } }] };

  const [claimedPosts, claimedComments] = await Promise.all([
    claimPostCandidates(claimable),
    claimCommentCandidates(claimable),
  ]);

  if (claimedPosts.length === 0 && claimedComments.length === 0) {
    return NextResponse.json({ error: null, processed: false });
  }

  const [postOutcomes, commentOutcomes] = await Promise.all([
    Promise.all(claimedPosts.map((candidate) => reviewOnePost(candidate))),
    Promise.all(claimedComments.map((candidate) => reviewOneComment(candidate))),
  ]);

  return NextResponse.json({ error: null, processed: true, postOutcomes, commentOutcomes });
}
