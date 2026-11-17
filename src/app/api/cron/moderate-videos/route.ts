import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { moderateVideo, isProviderWideFailure, type HiveFailure, type HiveScan } from "@/lib/hive";
import { nextAfterVideoScanFailure, VIDEO_SCAN_MAX_ATTEMPTS, type VideoScanNext } from "@/lib/video-scan-retry";
import { isCronAuthorized } from "@/lib/cron-auth";
import { HIVE_VIDEO_MODERATION_MAX_SECONDS } from "@/lib/storage";
import { captureError } from "@/lib/error-tracking";
import { headVideoForDiagnostics } from "@/lib/video-scan-head";
import {
  buildVideoScanFailureDiagnostic,
  formatVideoScanFailureLog,
  pushFailureSummary,
  scrubDiagnosticText,
  videoScanFailedHoldDetail,
  videoScanFailureContext,
  type VideoScanFailureDiagnostic,
  type VideoScanFailureSummary,
  type VideoScanItemKind,
} from "@/lib/video-scan-diagnostics";
import {
  VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY,
  videoScanFailedHoldAuditReason,
} from "@/lib/media-moderation-hold";

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
 * The claim is guarded on the retry wait being over too (retryDue), not only
 * on videoModeratedAt being null: a run that read its candidates just before
 * another run un-claimed a video for backoff must not pick it straight up.
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
 *    video is held for an admin (src/lib/video-scan-retry.ts): hidden
 *    (FLAGGED), media kept, a CONTENT_FLAGGED_FOR_REVIEW audit row with the
 *    reason, never deleted unreviewed. It used to go straight back into the
 *    candidate set every run, so 20 such videos starved every newer one.
 * Every failed scan is logged with a diagnostic (src/lib/video-scan-
 * diagnostics.ts: attempt, Hive's status / code / message, the file's
 * extension, host, size, type and duration, from one HEAD of the public file
 * done only on a failure), listed in the response's `failures` (first 10),
 * and attached to the Sentry report of a give-up or a provider-wide stop.
 * Candidates are taken oldest first and skip a video still waiting out its
 * retry time.
 */
type RunState = {
  providerFailure: { failure: HiveFailure; detail?: string; diagnostic?: VideoScanFailureDiagnostic } | null;
  videoFailures: Partial<Record<HiveFailure, number>>;
  failures: VideoScanFailureSummary[];
};

type ScanFailure = Extract<HiveScan, { ok: false }>;
type ModerationStatusValue = "PUBLISHED" | "FLAGGED" | "REMOVED";

/** Hive's answer, or a failure for an exception (none is expected: moderateVideo catches its own). */
async function scan(videoUrl: string, context: Record<string, unknown>): Promise<HiveScan> {
  try {
    return await moderateVideo(videoUrl);
  } catch (err) {
    await captureError(err, { route: "cron/moderate-videos", ...context });
    return { ok: false, failure: "bad_response", detail: err instanceof Error ? err.message : String(err) };
  }
}

type FailedItem = {
  kind: VideoScanItemKind;
  id: string;
  videoUrl: string | null;
  videoScanAttempts: number;
  videoDurationSeconds: number | null;
  moderationStatus: ModerationStatusValue;
};

/**
 * Works out what a failed scan means for the item, logs it with its diagnostic (one HEAD of the file, only here, so
 * at most once per item per run) and notes it on the run. `next` is null for a provider-wide failure: the caller
 * un-claims the item and stops the run.
 */
async function noteFailure(
  state: RunState,
  item: FailedItem,
  result: ScanFailure,
): Promise<{ next: VideoScanNext | null; diagnostic: VideoScanFailureDiagnostic }> {
  const providerWide = isProviderWideFailure(result.failure);
  const next = providerWide
    ? null
    : nextAfterVideoScanFailure({
        failuresSoFar: item.videoScanAttempts,
        now: new Date(),
        moderationStatus: item.moderationStatus,
      });
  const head = await headVideoForDiagnostics(item.videoUrl);
  const diagnostic = buildVideoScanFailureDiagnostic({
    kind: item.kind,
    id: item.id,
    failuresSoFar: item.videoScanAttempts,
    maxAttempts: VIDEO_SCAN_MAX_ATTEMPTS,
    failure: result.failure,
    detail: result.detail,
    videoUrl: item.videoUrl,
    durationSeconds: item.videoDurationSeconds,
    head,
    outcome: next ? next.kind : "run_stopped",
  });
  console.error(formatVideoScanFailureLog(diagnostic));
  pushFailureSummary(state.failures, diagnostic);
  if (providerWide) {
    state.providerFailure ??= { failure: result.failure, detail: result.detail, diagnostic };
  } else {
    state.videoFailures[result.failure] = (state.videoFailures[result.failure] ?? 0) + 1;
  }
  return { next, diagnostic };
}

/** Reports a video Hive was given up on (rare: it failed VIDEO_SCAN_MAX_ATTEMPTS times for reasons of its own). */
async function reportGiveUp(next: VideoScanNext, diagnostic: VideoScanFailureDiagnostic) {
  if (next.kind === "retry") return;
  await captureError(new Error(`Hive gave up on a video (${diagnostic.failure}), next: ${next.kind}`), {
    route: "cron/moderate-videos",
    ...videoScanFailureContext(diagnostic),
  });
}

/** The audit row an admin hold writes: what /admin/moderation shows as the reason. Never swept (see the sweep). */
function holdAuditRow(kind: VideoScanItemKind, id: string, authorId: string, diagnostic: VideoScanFailureDiagnostic) {
  return {
    targetId: authorId,
    action: "CONTENT_FLAGGED_FOR_REVIEW" as const,
    performedBy: VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY,
    reason: videoScanFailedHoldAuditReason(kind, id, videoScanFailedHoldDetail(diagnostic)),
  };
}

/** A video whose retry wait (if any) is over. */
function retryDue() {
  return { OR: [{ videoScanRetryAt: null }, { videoScanRetryAt: { lte: new Date() } }] };
}

const COUNT_FAILURE = { videoScanAttempts: { increment: 1 } };
const GIVE_UP = { ...COUNT_FAILURE, videoScanRetryAt: null };
const HOLDABLE: ModerationStatusValue[] = ["PUBLISHED", "FLAGGED"];

async function moderatePostVideos(state: RunState) {
  const pending = await prisma.post.findMany({
    where: { mediaType: "VIDEO", videoModeratedAt: null, videoUrl: { not: null }, ...retryDue() },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      authorId: true,
      videoUrl: true,
      videoScanAttempts: true,
      moderationStatus: true,
      videoDurationSeconds: true,
    },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;
  let held = 0;

  for (const post of pending) {
    if (state.providerFailure) break;
    const claimedAt = new Date();
    const claimed = await prisma.post.updateMany({
      where: { id: post.id, videoModeratedAt: null, ...retryDue() },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue; // another run already claimed it
    const mine = { id: post.id, videoModeratedAt: claimedAt };

    try {
      const result = await scan(post.videoUrl!, { kind: "post", postId: post.id });
      if (!result.ok) {
        failed += 1;
        const { next, diagnostic } = await noteFailure(state, { kind: "post", ...post }, result);
        if (!next) {
          await prisma.post.updateMany({ where: mine, data: { videoModeratedAt: null } });
          break;
        }
        if (next.kind === "retry") {
          await prisma.post.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoModeratedAt: null, videoScanRetryAt: next.retryAt },
          });
        } else if (next.kind === "hold_for_admin") {
          // videoModeratedAt stays set, so it is out of Hive's queue; an admin's Publish re-stamps it.
          const didHold = await prisma.$transaction(async (tx) => {
            const write = await tx.post.updateMany({
              where: { ...mine, moderationStatus: { in: HOLDABLE } },
              data: { ...GIVE_UP, moderationStatus: "FLAGGED" },
            });
            if (write.count === 0) {
              await tx.post.updateMany({ where: mine, data: GIVE_UP });
              return false;
            }
            await tx.auditLog.create({ data: holdAuditRow("post", post.id, post.authorId, diagnostic) });
            return true;
          });
          if (didHold) held += 1;
        } else {
          await prisma.post.updateMany({ where: mine, data: GIVE_UP });
        }
        await reportGiveUp(next, diagnostic);
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

  return { checked: pending.length, flagged, cleared, failed, heldForAdmin: held };
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
      authorId: true,
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
  let held = 0;

  for (const comment of pending) {
    if (state.providerFailure) break;
    const claimedAt = new Date();
    const claimed = await prisma.comment.updateMany({
      where: { id: comment.id, videoModeratedAt: null, ...retryDue() },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue;
    const mine = { id: comment.id, videoModeratedAt: claimedAt };

    try {
      const result = await scan(comment.videoUrl!, { kind: "comment", commentId: comment.id });
      if (!result.ok) {
        failed += 1;
        const { next, diagnostic } = await noteFailure(state, { kind: "comment", ...comment }, result);
        if (!next) {
          await prisma.comment.updateMany({ where: mine, data: { videoModeratedAt: null } });
          break;
        }
        if (next.kind === "retry") {
          await prisma.comment.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoModeratedAt: null, videoScanRetryAt: next.retryAt },
          });
        } else if (next.kind === "hold_for_admin") {
          // Hiding a live comment takes it out of the post's commentCount in the same transaction, as the flag write
          // below does; one already hidden just gets the audit row (an admin's Publish counts it back in).
          const didHold = await prisma.$transaction(async (tx) => {
            const fromLive = await tx.comment.updateMany({
              where: { ...mine, moderationStatus: "PUBLISHED" },
              data: { ...GIVE_UP, moderationStatus: "FLAGGED" },
            });
            if (fromLive.count > 0) {
              await tx.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
            } else {
              const alreadyHidden = await tx.comment.updateMany({
                where: { ...mine, moderationStatus: "FLAGGED" },
                data: GIVE_UP,
              });
              if (alreadyHidden.count === 0) {
                await tx.comment.updateMany({ where: mine, data: GIVE_UP });
                return false;
              }
            }
            await tx.auditLog.create({ data: holdAuditRow("comment", comment.id, comment.authorId, diagnostic) });
            return true;
          });
          if (didHold) held += 1;
        } else {
          await prisma.comment.updateMany({ where: mine, data: GIVE_UP });
        }
        await reportGiveUp(next, diagnostic);
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

  return { checked: pending.length, flagged, cleared, failed, heldForAdmin: held };
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
    select: {
      id: true,
      authorId: true,
      videoUrl: true,
      videoScanAttempts: true,
      moderationStatus: true,
      videoDurationSeconds: true,
    },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;
  let held = 0;

  for (const muse of pending) {
    if (state.providerFailure) break;
    const claimedAt = new Date();
    const claimed = await prisma.muse.updateMany({
      where: { id: muse.id, videoModeratedAt: null, ...retryDue() },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue;
    const mine = { id: muse.id, videoModeratedAt: claimedAt };

    try {
      const result = await scan(muse.videoUrl!, { kind: "muse", museId: muse.id });
      if (!result.ok) {
        failed += 1;
        const { next, diagnostic } = await noteFailure(state, { kind: "muse", ...muse }, result);
        if (!next) {
          await prisma.muse.updateMany({ where: mine, data: { videoModeratedAt: null } });
          break;
        }
        if (next.kind === "retry") {
          await prisma.muse.updateMany({
            where: mine,
            data: { ...COUNT_FAILURE, videoModeratedAt: null, videoScanRetryAt: next.retryAt },
          });
        } else if (next.kind === "hold_for_admin") {
          const didHold = await prisma.$transaction(async (tx) => {
            const write = await tx.muse.updateMany({
              where: { ...mine, moderationStatus: { in: HOLDABLE } },
              data: { ...GIVE_UP, moderationStatus: "FLAGGED" },
            });
            if (write.count === 0) {
              await tx.muse.updateMany({ where: mine, data: GIVE_UP });
              return false;
            }
            await tx.auditLog.create({ data: holdAuditRow("muse", muse.id, muse.authorId, diagnostic) });
            return true;
          });
          if (didHold) held += 1;
        } else {
          await prisma.muse.updateMany({ where: mine, data: GIVE_UP });
        }
        await reportGiveUp(next, diagnostic);
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

  return { checked: pending.length, flagged, cleared, failed, heldForAdmin: held };
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const state: RunState = { providerFailure: null, videoFailures: {}, failures: [] };
  const [posts, comments, muses] = await Promise.all([
    moderatePostVideos(state),
    moderateCommentVideos(state),
    moderateMuseVideos(state),
  ]);

  if (state.providerFailure) {
    // Once per run (every 5 minutes) while it lasts; Sentry groups these into one issue. Nothing was counted against
    // any video, so every one is scanned once Hive works again.
    const { failure, diagnostic } = state.providerFailure;
    const detail = state.providerFailure.detail ? scrubDiagnosticText(state.providerFailure.detail, 400) : undefined;
    console.error(`[moderate-videos] Hive unavailable, run stopped: ${failure}${detail ? ` (${detail})` : ""}`);
    await captureError(new Error(`Hive video moderation unavailable: ${failure}`), {
      route: "cron/moderate-videos",
      detail,
      ...(diagnostic ? videoScanFailureContext(diagnostic) : {}),
    });
  }

  return NextResponse.json({
    error: null,
    hive: state.providerFailure
      ? {
          failure: state.providerFailure.failure,
          detail: state.providerFailure.detail ? scrubDiagnosticText(state.providerFailure.detail, 400) : undefined,
        }
      : null,
    videoFailures: state.videoFailures,
    failures: state.failures,
    posts,
    comments,
    muses,
  });
}
