import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { moderateVideo, isProviderWideFailure, type HiveFailure, type HiveScan } from "@/lib/hive";
import { nextAfterVideoScanFailure, type VideoScanNext } from "@/lib/video-scan-retry";
import { isCronAuthorized } from "@/lib/cron-auth";
import { HIVE_VIDEO_MODERATION_MAX_SECONDS } from "@/lib/storage";
import { captureError } from "@/lib/error-tracking";

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
 *
 * The claim's timestamp doubles as a token: the FLAGGED write and the
 * un-claim are both guarded on videoModeratedAt still being exactly the
 * value this run wrote. An admin publishing the row from /admin/moderation
 * (approveFlaggedContent) re-stamps videoModeratedAt, so a Hive call that
 * was in flight at that moment matches nothing afterwards — it can neither
 * flag what the admin just approved nor hand the row back for another scan.
 * Same in moderateCommentVideos and moderateMuseVideos below.
 *
 * A scan that fails splits two ways (src/lib/hive.ts):
 *  - provider-wide (missing, refused or out-of-credit key, rate limit, Hive
 *    down or unreachable): nothing to do with the video. The video is
 *    un-claimed untouched, the whole run stops (RunState.providerFailure, so
 *    the other two batches stop too instead of failing 40 more calls the
 *    same way), and the reason with Hive's own error text is logged,
 *    reported to Sentry and returned in the response. This used to be a
 *    silent "failed" count, for days.
 *  - about this video: recorded on the row (videoScanAttempts /
 *    videoScanRetryAt) with a growing wait, and after the last attempt the
 *    video leaves Hive's queue for the Stream review or an admin
 *    (src/lib/video-scan-retry.ts). It used to go straight back into the
 *    candidate set every run, so 20 such videos starved every newer one.
 * Candidates are taken oldest first and skip a video still waiting out its
 * retry time.
 */
type RunState = {
  providerFailure: { failure: HiveFailure; detail?: string } | null;
  videoFailures: Partial<Record<HiveFailure, number>>;
};

type ScanFailure = Extract<HiveScan, { ok: false }>;

/** Hive's answer, or a failure for an exception (none is expected: moderateVideo catches its own). */
async function scan(videoUrl: string, context: Record<string, unknown>): Promise<HiveScan> {
  try {
    return await moderateVideo(videoUrl);
  } catch (err) {
    await captureError(err, { route: "cron/moderate-videos", ...context });
    return { ok: false, failure: "bad_response", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Notes a failed scan on the run, and says whether the run must stop (provider-wide). */
function noteFailure(state: RunState, result: ScanFailure, label: string): boolean {
  if (isProviderWideFailure(result.failure)) {
    state.providerFailure ??= { failure: result.failure, detail: result.detail };
    return true;
  }
  state.videoFailures[result.failure] = (state.videoFailures[result.failure] ?? 0) + 1;
  console.error(
    `[moderate-videos] Hive could not scan ${label}: ${result.failure}${result.detail ? ` (${result.detail})` : ""}`,
  );
  return false;
}

/** Reports a video Hive was given up on (rare: it failed VIDEO_SCAN_MAX_ATTEMPTS times for reasons of its own). */
async function reportGiveUp(next: VideoScanNext, result: ScanFailure, context: Record<string, unknown>) {
  if (next.kind === "retry") return;
  await captureError(new Error(`Hive gave up on a video (${result.failure}), next: ${next.kind}`), {
    route: "cron/moderate-videos",
    detail: result.detail,
    ...context,
  });
}

/** A video whose retry wait (if any) is over. */
function retryDue() {
  return { OR: [{ videoScanRetryAt: null }, { videoScanRetryAt: { lte: new Date() } }] };
}

const COUNT_FAILURE = { videoScanAttempts: { increment: 1 } };

async function moderatePostVideos(state: RunState) {
  const pending = await prisma.post.findMany({
    where: { mediaType: "VIDEO", videoModeratedAt: null, videoUrl: { not: null }, ...retryDue() },
    orderBy: { createdAt: "asc" },
    select: { id: true, videoUrl: true, videoScanAttempts: true, moderationStatus: true, videoDurationSeconds: true },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;

  for (const post of pending) {
    if (state.providerFailure) break;
    const claimedAt = new Date();
    const claimed = await prisma.post.updateMany({
      where: { id: post.id, videoModeratedAt: null },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue; // another run already claimed it
    const mine = { id: post.id, videoModeratedAt: claimedAt };

    try {
      const result = await scan(post.videoUrl!, { kind: "post", postId: post.id });
      if (!result.ok) {
        failed += 1;
        if (noteFailure(state, result, `post ${post.id}`)) {
          await prisma.post.updateMany({ where: mine, data: { videoModeratedAt: null } });
          break;
        }
        const next = nextAfterVideoScanFailure({
          failuresSoFar: post.videoScanAttempts,
          now: new Date(),
          published: post.moderationStatus === "PUBLISHED",
          durationSeconds: post.videoDurationSeconds,
        });
        if (next.kind === "retry") {
          await prisma.post.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoModeratedAt: null, videoScanRetryAt: next.retryAt },
          });
        } else if (next.kind === "long_review") {
          // videoModeratedAt stays set, so it is out of Hive's queue; moderate-long-videos picks it up from
          // videoLongReviewNeeded.
          await prisma.post.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoScanRetryAt: null, videoLongReviewNeeded: true },
          });
        } else if (next.kind === "hold_for_admin") {
          const held = await prisma.post.updateMany({
            where: { ...mine, moderationStatus: "PUBLISHED" },
            data: { ...COUNT_FAILURE, videoScanRetryAt: null, moderationStatus: "FLAGGED" },
          });
          if (held.count === 0) {
            await prisma.post.updateMany({ where: mine, data: { ...COUNT_FAILURE, videoScanRetryAt: null } });
          }
        } else {
          await prisma.post.updateMany({ where: mine, data: { ...COUNT_FAILURE, videoScanRetryAt: null } });
        }
        await reportGiveUp(next, result, { kind: "post", postId: post.id });
        continue;
      }
      if (result.flagged) {
        const written = await prisma.post.updateMany({
          where: mine,
          data: { moderationStatus: "FLAGGED" },
        });
        if (written.count > 0) flagged += 1;
      } else {
        cleared += 1;
      }
    } catch (err) {
      await prisma.post.updateMany({ where: mine, data: { videoModeratedAt: null } });
      failed += 1;
      console.error(`[moderate-videos] failed to moderate video for post ${post.id}`, err);
      await captureError(err, { route: "cron/moderate-videos", kind: "post", postId: post.id });
    }
  }

  return { checked: pending.length, flagged, cleared, failed };
}

// Same logic as moderatePostVideos, applied to Comment instead of Post —
// Comment has no mediaType column (a comment can carry video alongside
// text/gif/audio independently, see schema.prisma), so the query is just
// "has a video, not yet moderated" with no extra discriminant needed.
async function moderateCommentVideos(state: RunState) {
  const pending = await prisma.comment.findMany({
    where: { videoModeratedAt: null, videoUrl: { not: null }, ...retryDue() },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      videoUrl: true,
      postId: true,
      videoScanAttempts: true,
      moderationStatus: true,
      videoDurationSeconds: true,
    },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;

  for (const comment of pending) {
    if (state.providerFailure) break;
    const claimedAt = new Date();
    const claimed = await prisma.comment.updateMany({
      where: { id: comment.id, videoModeratedAt: null },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue;
    const mine = { id: comment.id, videoModeratedAt: claimedAt };

    try {
      const result = await scan(comment.videoUrl!, { kind: "comment", commentId: comment.id });
      if (!result.ok) {
        failed += 1;
        if (noteFailure(state, result, `comment ${comment.id}`)) {
          await prisma.comment.updateMany({ where: mine, data: { videoModeratedAt: null } });
          break;
        }
        const next = nextAfterVideoScanFailure({
          failuresSoFar: comment.videoScanAttempts,
          now: new Date(),
          published: comment.moderationStatus === "PUBLISHED",
          durationSeconds: comment.videoDurationSeconds,
        });
        if (next.kind === "retry") {
          await prisma.comment.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoModeratedAt: null, videoScanRetryAt: next.retryAt },
          });
        } else if (next.kind === "long_review") {
          await prisma.comment.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoScanRetryAt: null, videoLongReviewNeeded: true },
          });
        } else if (next.kind === "hold_for_admin") {
          // Hiding a live comment takes it out of the post's commentCount in the same transaction, as the flag write
          // below does.
          await prisma.$transaction(async (tx) => {
            const held = await tx.comment.updateMany({
              where: { ...mine, moderationStatus: "PUBLISHED" },
              data: { ...COUNT_FAILURE, videoScanRetryAt: null, moderationStatus: "FLAGGED" },
            });
            if (held.count > 0) {
              await tx.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
            } else {
              await tx.comment.updateMany({ where: mine, data: { ...COUNT_FAILURE, videoScanRetryAt: null } });
            }
          });
        } else {
          await prisma.comment.updateMany({ where: mine, data: { ...COUNT_FAILURE, videoScanRetryAt: null } });
        }
        await reportGiveUp(next, result, { kind: "comment", commentId: comment.id });
        continue;
      }
      if (result.flagged) {
        // Flagging a comment that is live takes it out of the post's
        // commentCount (PUBLISHED comments only) in the same transaction.
        // The first write only matches a PUBLISHED row, so its count says
        // whether there is anything to decrement; the second covers a row
        // that wasn't PUBLISHED (hidden by a moderator meanwhile), which is
        // flagged as before.
        const written = await prisma.$transaction(async (tx) => {
          const unpublished = await tx.comment.updateMany({
            where: { ...mine, moderationStatus: "PUBLISHED" },
            data: { moderationStatus: "FLAGGED" },
          });
          if (unpublished.count > 0) {
            await tx.post.update({
              where: { id: comment.postId },
              data: { commentCount: { decrement: 1 } },
            });
            return unpublished.count;
          }
          const other = await tx.comment.updateMany({
            where: mine,
            data: { moderationStatus: "FLAGGED" },
          });
          return other.count;
        });
        if (written > 0) flagged += 1;
      } else {
        cleared += 1;
      }
    } catch (err) {
      await prisma.comment.updateMany({ where: mine, data: { videoModeratedAt: null } });
      failed += 1;
      console.error(`[moderate-videos] failed to moderate video for comment ${comment.id}`, err);
      await captureError(err, { route: "cron/moderate-videos", kind: "comment", commentId: comment.id });
    }
  }

  return { checked: pending.length, flagged, cleared, failed };
}

// Same logic as moderateCommentVideos, applied to Muse. mediaType: "VIDEO"
// excludes EMBED rows (see Muse's own mediaType doc comment — no video body
// of ours exists for those to scan; Hive would just error on a null
// videoUrl). A Muse over HIVE_VIDEO_MODERATION_MAX_SECONDS is excluded here
// (its videoModeratedAt is already pre-claimed at creation — see createMuse)
// and instead goes through moderate-long-videos' Cloudflare Stream review
// fork, same as an over-the-cap Post/Comment.
async function moderateMuseVideos(state: RunState) {
  const pending = await prisma.muse.findMany({
    where: {
      mediaType: "VIDEO",
      videoModeratedAt: null,
      videoDurationSeconds: { lte: HIVE_VIDEO_MODERATION_MAX_SECONDS },
      ...retryDue(),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, videoUrl: true, videoScanAttempts: true, moderationStatus: true, videoDurationSeconds: true },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;

  for (const muse of pending) {
    if (state.providerFailure) break;
    const claimedAt = new Date();
    const claimed = await prisma.muse.updateMany({
      where: { id: muse.id, videoModeratedAt: null },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue;
    const mine = { id: muse.id, videoModeratedAt: claimedAt };

    try {
      const result = await scan(muse.videoUrl!, { kind: "muse", museId: muse.id });
      if (!result.ok) {
        failed += 1;
        if (noteFailure(state, result, `muse ${muse.id}`)) {
          await prisma.muse.updateMany({ where: mine, data: { videoModeratedAt: null } });
          break;
        }
        const next = nextAfterVideoScanFailure({
          failuresSoFar: muse.videoScanAttempts,
          now: new Date(),
          published: muse.moderationStatus === "PUBLISHED",
          durationSeconds: muse.videoDurationSeconds,
        });
        if (next.kind === "retry") {
          await prisma.muse.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoModeratedAt: null, videoScanRetryAt: next.retryAt },
          });
        } else if (next.kind === "long_review") {
          await prisma.muse.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoScanRetryAt: null, videoLongReviewNeeded: true },
          });
        } else if (next.kind === "hold_for_admin") {
          const held = await prisma.muse.updateMany({
            where: { ...mine, moderationStatus: "PUBLISHED" },
            data: { ...COUNT_FAILURE, videoScanRetryAt: null, moderationStatus: "FLAGGED" },
          });
          if (held.count === 0) {
            await prisma.muse.updateMany({ where: mine, data: { ...COUNT_FAILURE, videoScanRetryAt: null } });
          }
        } else {
          await prisma.muse.updateMany({ where: mine, data: { ...COUNT_FAILURE, videoScanRetryAt: null } });
        }
        await reportGiveUp(next, result, { kind: "muse", museId: muse.id });
        continue;
      }
      if (result.flagged) {
        const written = await prisma.muse.updateMany({
          where: mine,
          data: { moderationStatus: "FLAGGED" },
        });
        if (written.count > 0) flagged += 1;
      } else {
        cleared += 1;
      }
    } catch (err) {
      await prisma.muse.updateMany({ where: mine, data: { videoModeratedAt: null } });
      failed += 1;
      console.error(`[moderate-videos] failed to moderate video for muse ${muse.id}`, err);
      await captureError(err, { route: "cron/moderate-videos", kind: "muse", museId: muse.id });
    }
  }

  return { checked: pending.length, flagged, cleared, failed };
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const state: RunState = { providerFailure: null, videoFailures: {} };
  const [posts, comments, muses] = await Promise.all([
    moderatePostVideos(state),
    moderateCommentVideos(state),
    moderateMuseVideos(state),
  ]);

  if (state.providerFailure) {
    // Once per run (every 5 minutes) while it lasts; Sentry groups these into one issue. Nothing was counted against
    // any video, so every one is scanned once Hive works again.
    const { failure, detail } = state.providerFailure;
    console.error(`[moderate-videos] Hive unavailable, run stopped: ${failure}${detail ? ` (${detail})` : ""}`);
    await captureError(new Error(`Hive video moderation unavailable: ${failure}`), {
      route: "cron/moderate-videos",
      detail,
    });
  }

  return NextResponse.json({
    error: null,
    hive: state.providerFailure,
    videoFailures: state.videoFailures,
    posts,
    comments,
    muses,
  });
}
