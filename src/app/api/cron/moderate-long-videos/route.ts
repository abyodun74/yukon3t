import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { advanceLongVideoReview, type VideoReviewResult } from "@/lib/video-review";
import { notifyVideoFlaggedForReview } from "@/lib/video-review-notice";
import { revalidatePath } from "next/cache";
import { captureError } from "@/lib/error-tracking";

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
      await captureError(err, { route: "cron/moderate-long-videos", kind: "post", postId: candidate.id });
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
      // Guarded on videoLongReviewNeeded, like every verdict write in this
      // file: a review runs for minutes, and an admin can publish or remove
      // this post from /admin/moderation (approveFlaggedContent clears the
      // flag) while it does. A 0-count result means that decision — or
      // another tick's verdict — already landed, and this one must not
      // overwrite it or repeat its side effects.
      const written = await prisma.post.updateMany({
        where: { id: candidate.id, videoLongReviewNeeded: true },
        data: {
          moderationStatus: "PUBLISHED",
          videoLongReviewClaimedAt: null,
          videoStreamUid: null,
          videoLongReviewNeeded: false,
        },
      });
      if (written.count === 0) return "clean";
      revalidatePath("/circles", "layout");
      revalidatePath("/home");
      revalidatePath(`/post/${candidate.id}`);
      return "clean";
    }

    // result.kind === "flagged" — held for a human to decide, not
    // auto-deleted: OpenAI's moderation categories (harassment in
    // particular) have a real false-positive rate on ordinary spoken audio,
    // and an automated "flagged" verdict used to delete the video outright
    // with no review step at all — unlike every other flagged-content path
    // in this app (createPost/createComment's own synchronous text-flag,
    // same as this), which holds for /admin/moderation instead of
    // discarding. videoLongReviewNeeded: false stops claimPostCandidates
    // from claiming this again now that a verdict has landed. Same
    // videoLongReviewNeeded guard as the "clean" write above — without it
    // this is the write that put a post back in the queue after an admin
    // had published it. The audit row shares the transaction so a flag is
    // never recorded for a write that didn't happen.
    const post = await prisma.$transaction(async (tx) => {
      const written = await tx.post.updateMany({
        where: { id: candidate.id, videoLongReviewNeeded: true },
        data: {
          moderationStatus: "FLAGGED",
          videoLongReviewClaimedAt: null,
          videoStreamUid: null,
          videoLongReviewNeeded: false,
        },
      });
      if (written.count === 0) return null;
      const updated = await tx.post.findUnique({
        where: { id: candidate.id },
        select: { id: true, authorId: true },
      });
      if (!updated) return null;
      await tx.auditLog.create({
        data: {
          targetId: updated.authorId,
          action: "CONTENT_FLAGGED_FOR_REVIEW",
          // Not FK'd to any User (see AuditLog.performedBy comment in
          // schema.prisma) — a plain sentinel identifying this as an
          // automated verdict rather than an admin's own action.
          performedBy: "system:openai-video-review",
          reason: `Long-video automated review flagged for admin review: ${result.reasons.join("; ")}`,
        },
      });
      return updated;
    });
    // Already decided by an admin or another tick — no notification, no
    // revalidation; that decision did its own.
    if (!post) return "flagged";
    // A post in the instant-publish window (HIVE_VIDEO_MODERATION_MAX_SECONDS
    // up to VIDEO_INSTANT_PUBLISH_MAX_SECONDS) was already live — this just
    // took it back down, so the same caches that would show it need
    // invalidating, same set the "clean" branch above already revalidates.
    revalidatePath("/circles", "layout");
    revalidatePath("/home");
    revalidatePath(`/post/${post.id}`);
    revalidatePath("/admin/moderation");
    await notifyVideoFlaggedForReview(post.authorId, result.reasons, { postId: post.id });
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
      await captureError(err, { route: "cron/moderate-long-videos", kind: "comment", commentId: candidate.id });
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
      // Guarded on videoLongReviewNeeded — see reviewOnePost's "clean"
      // branch for why a 0-count result means "already decided, do nothing".
      // A long-video comment is held FLAGGED from creation and was never
      // counted (createComment only increments commentCount when it
      // publishes immediately), so the write that publishes it adds it to
      // the post's count, in the same transaction.
      const published = await prisma.$transaction(async (tx) => {
        const written = await tx.comment.updateMany({
          where: { id: candidate.id, videoLongReviewNeeded: true },
          data: {
            moderationStatus: "PUBLISHED",
            videoLongReviewClaimedAt: null,
            videoStreamUid: null,
            videoLongReviewNeeded: false,
          },
        });
        if (written.count === 0) return false;
        await tx.post.update({
          where: { id: candidate.postId },
          data: { commentCount: { increment: 1 } },
        });
        return true;
      });
      if (!published) return "clean";
      revalidatePath(`/post/${candidate.postId}`);
      return "clean";
    }

    // result.kind === "flagged" — held for review, same reasoning as
    // reviewOnePost's own "flagged" branch above (see its comment). A
    // long-video comment is stored FLAGGED from creation time (see
    // createComment), so this is not a visibility change: what ends the
    // review is videoLongReviewNeeded going false, which is the only thing
    // that stops claimCommentCandidates from claiming it again. Guarded on
    // that same flag, so an admin's approval made while this review was
    // running is left alone.
    const comment = await prisma.$transaction(async (tx) => {
      const written = await tx.comment.updateMany({
        where: { id: candidate.id, videoLongReviewNeeded: true },
        data: {
          moderationStatus: "FLAGGED",
          videoLongReviewClaimedAt: null,
          videoStreamUid: null,
          videoLongReviewNeeded: false,
        },
      });
      if (written.count === 0) return null;
      const updated = await tx.comment.findUnique({
        where: { id: candidate.id },
        select: { id: true, authorId: true, postId: true },
      });
      if (!updated) return null;
      await tx.auditLog.create({
        data: {
          targetId: updated.authorId,
          action: "CONTENT_FLAGGED_FOR_REVIEW",
          performedBy: "system:openai-video-review",
          reason: `Long-video automated review flagged for admin review: ${result.reasons.join("; ")}`,
        },
      });
      return updated;
    });
    if (!comment) return "flagged";
    revalidatePath(`/post/${comment.postId}`);
    revalidatePath("/admin/moderation");
    // Links to the parent post, not the comment itself — a FLAGGED comment
    // is excluded from that post's own comment list even for its author
    // (see comments-data.ts's commentWhere), so landing there won't show it
    // highlighted, just the right post; Notification.message still says
    // plainly it was their comment.
    await notifyVideoFlaggedForReview(comment.authorId, result.reasons, {
      postId: comment.postId,
      commentId: comment.id,
    });
    return "flagged";
  }
}

/**
 * Triggered every minute (Netlify Scheduled Function), same thin-trigger
 * pattern as moderate-videos. Claims up to BATCH_SIZE video posts still
 * awaiting a verdict (long ones over Hive's 60s cap, and short ones Hive
 * itself gave up on: see moderate-videos) and drives each through
 * reviewOnePost's own internal poll loop concurrently — see that function
 * and video-review.ts for why a single post's review can still legitimately
 * span more than one tick (Cloudflare's own copy/encode/caption pipeline
 * can outlast even this tick's POLL_BUDGET_MS on a very long video), just
 * far less often than when this only advanced one post by one step every 5
 * minutes.
 *
 * Filters on videoLongReviewNeeded rather than moderationStatus: FLAGGED —
 * a video from HIVE_VIDEO_MODERATION_MAX_SECONDS up to
 * VIDEO_INSTANT_PUBLISH_MAX_SECONDS is already PUBLISHED and still needs
 * this review in the background (see createPost), so gating on FLAGGED
 * alone would silently skip it forever.
 */
async function claimPostCandidates(claimable: object) {
  const candidates = await prisma.post.findMany({
    where: {
      mediaType: "VIDEO",
      videoLongReviewNeeded: true,
      // Any known length: mostly videos over Hive's 60s cap, plus short ones Hive gave up on (moderate-videos,
      // src/lib/video-scan-retry.ts). Without a length there are no frames to sample.
      videoDurationSeconds: { gt: 0 },
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
//
// Keys on videoLongReviewNeeded, same as Post. This used to select
// moderationStatus: FLAGGED, which is also the state a "flagged" verdict
// leaves a comment in — so a flagged comment matched again on the very next
// tick and was re-reviewed every minute from then on (a fresh Cloudflare
// copy, OpenAI calls, an AuditLog row and an author notification each
// time), and whichever pass was in flight overwrote an admin's approval.
async function claimCommentCandidates(claimable: object) {
  const candidates = await prisma.comment.findMany({
    where: {
      videoLongReviewNeeded: true,
      // Any known length: mostly videos over Hive's 60s cap, plus short ones Hive gave up on (moderate-videos,
      // src/lib/video-scan-retry.ts). Without a length there are no frames to sample.
      videoDurationSeconds: { gt: 0 },
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

// Same claiming logic as claimPostCandidates, against Muse instead of Post.
// mediaType: "VIDEO" excludes EMBED rows (see Muse's own mediaType doc
// comment) — they have no video body of ours to review at all, and their
// null videoDurationSeconds would never satisfy the gt filter below anyway
// (defensive, not load-bearing on its own). Keys on videoLongReviewNeeded
// rather than moderationStatus: FLAGGED for the reason given above
// claimCommentCandidates.
async function claimMuseCandidates(claimable: object) {
  const candidates = await prisma.muse.findMany({
    where: {
      mediaType: "VIDEO",
      videoLongReviewNeeded: true,
      // Any known length: mostly videos over Hive's 60s cap, plus short ones Hive gave up on (moderate-videos,
      // src/lib/video-scan-retry.ts). Without a length there are no frames to sample.
      videoDurationSeconds: { gt: 0 },
      ...claimable,
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, videoUrl: true, videoDurationSeconds: true, videoStreamUid: true },
  });

  const claimed: Candidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.videoUrl || !candidate.videoDurationSeconds) continue;
    const result = await prisma.muse.updateMany({
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

/**
 * Identical to reviewOnePost, against Muse instead of Post — Muse has no
 * feed-category/embedding cache to revalidate on "clean", just /muse itself
 * (its feed is the one and only place a Muse is ever shown).
 */
async function reviewOneMuse(candidate: Candidate): Promise<VideoReviewResult["kind"]> {
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
      console.error(`[moderate-long-videos] unhandled error reviewing muse ${candidate.id}`, err);
      await captureError(err, { route: "cron/moderate-long-videos", kind: "muse", museId: candidate.id });
      await prisma.muse.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
      return "error";
    }

    if (result.kind === "in_progress") {
      streamUid = result.streamUid;
      await prisma.muse.update({ where: { id: candidate.id }, data: { videoStreamUid: streamUid } });
      if (Date.now() >= deadline) {
        await prisma.muse.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
        return "in_progress";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    if (result.kind === "error") {
      await prisma.muse.updateMany({ where: { id: candidate.id }, data: { videoLongReviewClaimedAt: null } });
      return "error";
    }

    if (result.kind === "clean") {
      // Guarded on videoLongReviewNeeded — see reviewOnePost's "clean"
      // branch for why a 0-count result means "already decided, do nothing".
      const written = await prisma.muse.updateMany({
        where: { id: candidate.id, videoLongReviewNeeded: true },
        data: {
          moderationStatus: "PUBLISHED",
          videoLongReviewClaimedAt: null,
          videoStreamUid: null,
          videoLongReviewNeeded: false,
        },
      });
      if (written.count === 0) return "clean";
      revalidatePath("/muse");
      return "clean";
    }

    // result.kind === "flagged" — held for review, same reasoning as
    // reviewOnePost's own "flagged" branch above (see its comment); this is
    // the exact scenario that prompted adding Muse to /admin/moderation in
    // the first place. A long Muse is stored FLAGGED from creation time
    // (see createMuse), so this is not a visibility change: what ends the
    // review is videoLongReviewNeeded going false, which is the only thing
    // that stops claimMuseCandidates from claiming it again. Guarded on
    // that same flag, so an admin's approval made while this review was
    // running is left alone.
    const muse = await prisma.$transaction(async (tx) => {
      const written = await tx.muse.updateMany({
        where: { id: candidate.id, videoLongReviewNeeded: true },
        data: {
          moderationStatus: "FLAGGED",
          videoLongReviewClaimedAt: null,
          videoStreamUid: null,
          videoLongReviewNeeded: false,
        },
      });
      if (written.count === 0) return null;
      const updated = await tx.muse.findUnique({
        where: { id: candidate.id },
        select: { id: true, authorId: true },
      });
      if (!updated) return null;
      await tx.auditLog.create({
        data: {
          targetId: updated.authorId,
          action: "CONTENT_FLAGGED_FOR_REVIEW",
          performedBy: "system:openai-video-review",
          reason: `Long-video automated review flagged for admin review: ${result.reasons.join("; ")}`,
        },
      });
      return updated;
    });
    if (!muse) return "flagged";
    revalidatePath("/admin/moderation");
    // getMuseById now lets the author view their own FLAGGED Muse
    // specifically so this link resolves instead of 404ing for them.
    await notifyVideoFlaggedForReview(muse.authorId, result.reasons, { museId: muse.id });
    return "flagged";
  }
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

  const [claimedPosts, claimedComments, claimedMuses] = await Promise.all([
    claimPostCandidates(claimable),
    claimCommentCandidates(claimable),
    claimMuseCandidates(claimable),
  ]);

  if (claimedPosts.length === 0 && claimedComments.length === 0 && claimedMuses.length === 0) {
    return NextResponse.json({ error: null, processed: false });
  }

  const [postOutcomes, commentOutcomes, museOutcomes] = await Promise.all([
    Promise.all(claimedPosts.map((candidate) => reviewOnePost(candidate))),
    Promise.all(claimedComments.map((candidate) => reviewOneComment(candidate))),
    Promise.all(claimedMuses.map((candidate) => reviewOneMuse(candidate))),
  ]);

  return NextResponse.json({ error: null, processed: true, postOutcomes, commentOutcomes, museOutcomes });
}
