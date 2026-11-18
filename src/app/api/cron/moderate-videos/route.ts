import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  moderateVideo,
  isProviderWideFailure,
  MODERATION_TIMEOUT_MS,
  vlmFrameEstimate,
  vlmSamplingFps,
  type HiveFailure,
  type HiveScan,
  type HiveVerdict,
} from "@/lib/hive";
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
  VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY,
  videoScanFailedHoldAuditReason,
  videoScanFlaggedHoldAuditReason,
  videoScanUnsureHoldAuditReason,
} from "@/lib/media-moderation-hold";
import {
  budgetRemainingMs,
  emptyKindSummary,
  formatVideoScanRunSummary,
  hiveCallTimeoutMs,
  hiveCooldownActive,
  hiveCooldownAfter,
  nextCallStart,
  roundRobin,
  runRotation,
  sleepMs,
  timeoutCountsAgainstVideo,
  VIDEO_SCAN_CONCURRENCY,
  VIDEO_SCAN_PER_KIND_CAP,
  VIDEO_SCAN_RUN_BUDGET_MS,
  type KindRunSummary,
  type VideoScanRunSummary,
  type VideoScanStop,
} from "@/lib/video-scan-budget";
import { readHiveCooldown, writeHiveCooldown } from "@/lib/hive-cooldown-store";

/**
 * Triggered on a schedule (Netlify Scheduled Function, every 5 minutes), same pattern as the other cron routes — this
 * is the only place video-body moderation runs (see src/lib/hive.ts: Hive's Vision Language Model, a synchronous call,
 * so calling it here rather than inline at post creation keeps a potentially slow third-party call out of the
 * user-facing publish request).
 *
 * One run (src/lib/video-scan-budget.ts):
 *  - skips Hive entirely while a cooldown from an earlier rate-limit / credit / key failure is active;
 *  - reads at most VIDEO_SCAN_PER_KIND_CAP candidates per kind (Post, Comment, Muse), oldest first, skipping any still
 *    waiting out its retry time, takes the kinds in turn (roundRobin, the first kind rotating per tick) so none
 *    starves, and scans them with VIDEO_SCAN_CONCURRENCY (3) workers, call starts at least
 *    VIDEO_SCAN_MIN_START_GAP_MS apart (under Hive's 5 requests per second);
 *  - inside VIDEO_SCAN_RUN_BUDGET_MS (20s): no claim and no Hive call is started that can't finish before the budget
 *    ends (each call's timeout is min(30s, what is left)), so a run stays well under Netlify's ~30s limit. A call that
 *    times out after being given less than VIDEO_SCAN_FAIR_TIMEOUT_MS (15s) was cut short by the budget, not the
 *    video: the video is handed back (un-claimed) without counting an attempt;
 *  - always logs one summary line (counts per kind, why it stopped, budget used, cooldown), early stops included, and
 *    one `[moderate-videos] verdict:` line per complete verdict (kind, id, outcome, categories, frames, time, tokens;
 *    never the URL or the model's reason text).
 *
 * A complete verdict (src/lib/hive.ts vlmVerdictFromContent) is one of:
 *  - clean (every category false and unsure false, nothing else ever is): stays as it is;
 *  - flagged (any category true): FLAGGED (hidden, media kept, a live comment leaves commentCount), plus a
 *    CONTENT_FLAGGED_FOR_REVIEW row (VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY) naming the categories and the model's reason;
 *  - unsure (no category, unsure true): held for an admin at once, exactly like a give-up hold below (FLAGGED, media
 *    kept, audit row "automatic video scan was unsure (<kind>:<id>, VIDEO): <reason>"), without counting an attempt.
 * Neither hold is deleted unreviewed (sweepExpiredMediaHolds skips both performedBy values).
 *
 * Claims each item (sets videoModeratedAt) BEFORE calling Hive, not after — this call is the real (billable)
 * moderation work, so an overlapping cron run must not redo it. On failure, un-claims the item so a later run retries
 * instead of silently leaving it unmoderated forever. The claim is guarded on the retry wait being over too
 * (retryDue), not only on videoModeratedAt being null: a run that read its candidates just before another run
 * un-claimed a video for backoff must not pick it straight up. Two overlapping invocations therefore never scan the
 * same video; they only share the budget of Hive calls (there is no run lock: that needs a table or a Redis lock).
 *
 * The claim's timestamp doubles as a token: the FLAGGED write and the un-claim are both guarded on videoModeratedAt
 * still being exactly the value this run wrote. An admin publishing the row from /admin/moderation
 * (approveFlaggedContent) re-stamps videoModeratedAt, so a Hive call that was in flight at that moment matches nothing
 * afterwards — it can neither flag what the admin just approved nor hand the row back for another scan.
 *
 * A scan that fails splits two ways (src/lib/hive.ts):
 *  - provider-wide (missing, refused or out-of-credit key, rate limit, Hive down or unreachable): nothing to do with
 *    the video. The video is un-claimed untouched (videoScanAttempts is never incremented), the run stops, the reason
 *    with Hive's own error text is logged, reported to Sentry and returned in the response, and for rate_limited /
 *    out_of_credit / unauthorized a cooldown is stored (src/lib/hive-cooldown-store.ts) so the next runs don't call
 *    Hive until it ends (15 min doubling per 429 in a row, or Hive's Retry-After; 60 min for credit/key; never more
 *    than 60 min).
 *  - about this video: recorded on the row (videoScanAttempts / videoScanRetryAt) with a growing wait, and after the
 *    last attempt the video is held for an admin (src/lib/video-scan-retry.ts): hidden (FLAGGED), media kept, a
 *    CONTENT_FLAGGED_FOR_REVIEW audit row with the reason, never deleted unreviewed.
 * Every failed scan is logged with a diagnostic (src/lib/video-scan-diagnostics.ts: attempt, Hive's status / code /
 * message, the file's extension, host, size, type and duration, from one HEAD of the public file done only on a
 * failure), listed in the response's `failures` (first 10), and attached to the Sentry report of a give-up or a
 * provider-wide stop.
 */
type RunState = {
  providerFailure: {
    failure: HiveFailure;
    detail?: string;
    retryAfterSeconds?: number;
    diagnostic?: VideoScanFailureDiagnostic;
  } | null;
  videoFailures: Partial<Record<HiveFailure, number>>;
  failures: VideoScanFailureSummary[];
  startedAtMs: number;
  /** The last reserved call start (nextCallStart), shared by the workers. */
  lastStartMs: number | null;
  /** The budget ran out (no more claims). */
  budgetSpent: boolean;
  /** Claimed, then handed back unscanned (or cut short) because of the budget. */
  unclaimed: number;
  kinds: Record<VideoScanItemKind, KindRunSummary>;
};

type ScanFailure = Extract<HiveScan, { ok: false }>;
type ModerationStatusValue = "PUBLISHED" | "FLAGGED" | "REMOVED";

type Candidate = {
  kind: VideoScanItemKind;
  id: string;
  authorId: string;
  videoUrl: string | null;
  videoScanAttempts: number;
  moderationStatus: ModerationStatusValue;
  videoDurationSeconds: number | null;
  /** Comments only: the post whose commentCount a hidden comment leaves. */
  postId?: string;
};

type Mine = { id: string; videoModeratedAt: Date };

/** Hive's answer, or a failure for an exception (none is expected: moderateVideo catches its own). */
async function scan(
  videoUrl: string,
  durationSeconds: number | null,
  timeoutMs: number,
  context: Record<string, unknown>,
): Promise<HiveScan> {
  try {
    return await moderateVideo(videoUrl, { timeoutMs, durationSeconds });
  } catch (err) {
    await captureError(err, { route: "cron/moderate-videos", ...context });
    return { ok: false, failure: "bad_response", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Works out what a failed scan means for the item, logs it with its diagnostic (one HEAD of the file, only here, so
 * at most once per item per run) and notes it on the run. `next` is null for a provider-wide failure: the caller
 * un-claims the item and stops the run.
 */
async function noteFailure(
  state: RunState,
  item: Candidate,
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
    state.providerFailure ??= {
      failure: result.failure,
      detail: result.detail,
      retryAfterSeconds: result.retryAfterSeconds,
      diagnostic,
    };
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

type HoldAuditRow = {
  targetId: string;
  action: "CONTENT_FLAGGED_FOR_REVIEW";
  performedBy: string;
  reason: string;
};

/** The audit row a give-up hold writes: what /admin/moderation shows as the reason. Never swept (see the sweep). */
function giveUpAuditRow(item: Candidate, diagnostic: VideoScanFailureDiagnostic): HoldAuditRow {
  return {
    targetId: item.authorId,
    action: "CONTENT_FLAGGED_FOR_REVIEW",
    performedBy: VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY,
    reason: videoScanFailedHoldAuditReason(item.kind, item.id, videoScanFailedHoldDetail(diagnostic)),
  };
}

/** The audit row an unsure verdict writes ("automatic video scan was unsure ... : <model reason>"). Never swept. */
function unsureAuditRow(item: Candidate, modelReason: string): HoldAuditRow {
  return {
    targetId: item.authorId,
    action: "CONTENT_FLAGGED_FOR_REVIEW",
    performedBy: VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY,
    reason: videoScanUnsureHoldAuditReason(item.kind, item.id, modelReason),
  };
}

/** The audit row a flagged verdict writes (categories + model reason), so the admin sees why. Never swept. */
function flaggedAuditRow(item: Candidate, categories: readonly string[], modelReason: string): HoldAuditRow {
  return {
    targetId: item.authorId,
    action: "CONTENT_FLAGGED_FOR_REVIEW",
    performedBy: VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY,
    reason: videoScanFlaggedHoldAuditReason(item.kind, item.id, categories, modelReason),
  };
}

/** A video whose retry wait (if any) is over. */
function retryDue() {
  return { OR: [{ videoScanRetryAt: null }, { videoScanRetryAt: { lte: new Date() } }] };
}

const COUNT_FAILURE = { videoScanAttempts: { increment: 1 } };
const GIVE_UP = { ...COUNT_FAILURE, videoScanRetryAt: null };
/** An unsure hold: a complete verdict, so nothing is counted against the video. */
const KEEP_ATTEMPTS = { videoScanRetryAt: null };
const UNCLAIM = { videoModeratedAt: null };
const HOLDABLE: ModerationStatusValue[] = ["PUBLISHED", "FLAGGED"];

const CANDIDATE_SELECT = {
  id: true,
  authorId: true,
  videoUrl: true,
  videoScanAttempts: true,
  moderationStatus: true,
  videoDurationSeconds: true,
} as const;

// Candidates, oldest first, at most VIDEO_SCAN_PER_KIND_CAP per kind. Comment has no mediaType column (a comment can
// carry video alongside text/gif/audio independently, see schema.prisma), so its query is just "has a video, not yet
// moderated". For Muse, mediaType "VIDEO" excludes EMBED rows (no video body of ours to scan), and a Muse over
// HIVE_VIDEO_MODERATION_MAX_SECONDS is excluded (pre-claimed at creation, see createMuse; it goes through
// moderate-long-videos' Cloudflare Stream review instead, same as an over-the-cap Post/Comment).
async function findCandidates(kind: VideoScanItemKind): Promise<Candidate[]> {
  if (kind === "post") {
    const rows = await prisma.post.findMany({
      where: { mediaType: "VIDEO", videoModeratedAt: null, videoUrl: { not: null }, ...retryDue() },
      orderBy: { createdAt: "asc" },
      select: CANDIDATE_SELECT,
      take: VIDEO_SCAN_PER_KIND_CAP,
    });
    return rows.map((r) => ({ kind, ...r }));
  }
  if (kind === "comment") {
    const rows = await prisma.comment.findMany({
      where: { videoModeratedAt: null, videoUrl: { not: null }, ...retryDue() },
      orderBy: { createdAt: "asc" },
      select: { ...CANDIDATE_SELECT, postId: true },
      take: VIDEO_SCAN_PER_KIND_CAP,
    });
    return rows.map((r) => ({ kind, ...r }));
  }
  const rows = await prisma.muse.findMany({
    where: {
      mediaType: "VIDEO",
      videoModeratedAt: null,
      videoDurationSeconds: { lte: HIVE_VIDEO_MODERATION_MAX_SECONDS },
      ...retryDue(),
    },
    orderBy: { createdAt: "asc" },
    select: CANDIDATE_SELECT,
    take: VIDEO_SCAN_PER_KIND_CAP,
  });
  return rows.map((r) => ({ kind, ...r }));
}

/** The claim: only an unclaimed row whose retry wait is over. Returns how many rows it took (0 or 1). */
async function claim(kind: VideoScanItemKind, id: string, claimedAt: Date): Promise<number> {
  const where = { id, videoModeratedAt: null, ...retryDue() };
  const data = { videoModeratedAt: claimedAt };
  const res =
    kind === "post"
      ? await prisma.post.updateMany({ where, data })
      : kind === "comment"
        ? await prisma.comment.updateMany({ where, data })
        : await prisma.muse.updateMany({ where, data });
  return res.count;
}

type RowUpdate = {
  videoModeratedAt?: null;
  videoScanAttempts?: { increment: number };
  videoScanRetryAt?: Date | null;
};

/** A write to this run's own claim (guarded on the claim token, so it matches nothing once an admin re-stamped it). */
async function updateMine(kind: VideoScanItemKind, mine: Mine, data: RowUpdate) {
  if (kind === "post") await prisma.post.updateMany({ where: mine, data });
  else if (kind === "comment") await prisma.comment.updateMany({ where: mine, data });
  else await prisma.muse.updateMany({ where: mine, data });
}

/**
 * Hold for an admin: hidden (FLAGGED), media kept, audit row. Used for a give-up (rowData GIVE_UP: the failed attempt
 * is counted) and for an unsure verdict (rowData KEEP_ATTEMPTS: a verdict isn't a failure). False when the claim was
 * superseded or the row is no longer PUBLISHED/FLAGGED (then only rowData is written, no audit row).
 */
async function holdForAdmin(item: Candidate, mine: Mine, audit: HoldAuditRow, rowData: RowUpdate): Promise<boolean> {
  // videoModeratedAt stays set, so it is out of Hive's queue; an admin's Publish re-stamps it.
  if (item.kind === "comment") {
    // Hiding a live comment takes it out of the post's commentCount in the same transaction, as the flag write does;
    // one already hidden just gets the audit row (an admin's Publish counts it back in).
    return prisma.$transaction(async (tx) => {
      const fromLive = await tx.comment.updateMany({
        where: { ...mine, moderationStatus: "PUBLISHED" },
        data: { ...rowData, moderationStatus: "FLAGGED" },
      });
      if (fromLive.count > 0) {
        await tx.post.update({ where: { id: item.postId! }, data: { commentCount: { decrement: 1 } } });
      } else {
        const alreadyHidden = await tx.comment.updateMany({
          where: { ...mine, moderationStatus: "FLAGGED" },
          data: rowData,
        });
        if (alreadyHidden.count === 0) {
          await tx.comment.updateMany({ where: mine, data: rowData });
          return false;
        }
      }
      await tx.auditLog.create({ data: audit });
      return true;
    });
  }
  return prisma.$transaction(async (tx) => {
    const where = { ...mine, moderationStatus: { in: HOLDABLE } };
    const data = { ...rowData, moderationStatus: "FLAGGED" as const };
    const write =
      item.kind === "post"
        ? await tx.post.updateMany({ where, data })
        : await tx.muse.updateMany({ where, data });
    if (write.count === 0) {
      if (item.kind === "post") await tx.post.updateMany({ where: mine, data: rowData });
      else await tx.muse.updateMany({ where: mine, data: rowData });
      return false;
    }
    await tx.auditLog.create({ data: audit });
    return true;
  });
}

/** The scan flagged it: FLAGGED, guarded on the claim, with an audit row naming why. True when written. */
async function flag(item: Candidate, mine: Mine, audit: HoldAuditRow): Promise<boolean> {
  if (item.kind === "post" || item.kind === "muse") {
    return prisma.$transaction(async (tx) => {
      const data = { moderationStatus: "FLAGGED" as const };
      const write =
        item.kind === "post"
          ? await tx.post.updateMany({ where: mine, data })
          : await tx.muse.updateMany({ where: mine, data });
      if (write.count === 0) return false;
      await tx.auditLog.create({ data: audit });
      return true;
    });
  }
  // Flagging a comment that is live takes it out of the post's commentCount (PUBLISHED comments only) in the same
  // transaction. The first write only matches a PUBLISHED row, so its count says whether there is anything to
  // decrement; the second covers a row that wasn't PUBLISHED (hidden by a moderator meanwhile), flagged as before.
  return prisma.$transaction(async (tx) => {
    const unpublished = await tx.comment.updateMany({
      where: { ...mine, moderationStatus: "PUBLISHED" },
      data: { moderationStatus: "FLAGGED" },
    });
    if (unpublished.count > 0) {
      await tx.post.update({ where: { id: item.postId! }, data: { commentCount: { decrement: 1 } } });
    } else {
      const other = await tx.comment.updateMany({ where: mine, data: { moderationStatus: "FLAGGED" } });
      if (other.count === 0) return false;
    }
    await tx.auditLog.create({ data: audit });
    return true;
  });
}

/** One log line per complete verdict: no URL, no model reason text (that is in the audit row for an admin). */
function logVerdict(item: Candidate, result: HiveVerdict, elapsedMs: number) {
  const outcome = result.flagged ? "flagged" : result.review ? "unsure" : "clean";
  const frames = vlmFrameEstimate(item.videoDurationSeconds);
  const tokens = result.usage ? `${result.usage.inputTokens ?? "?"}/${result.usage.outputTokens ?? "?"}` : "?";
  console.log(
    `[moderate-videos] verdict: ${item.kind} ${item.id} ${outcome}` +
      `${result.flagged ? ` (${result.categories.join(",")})` : ""}` +
      ` fps=${vlmSamplingFps(item.videoDurationSeconds)} frames=${frames ?? "?"}` +
      ` durationS=${item.videoDurationSeconds ?? "?"} ms=${elapsedMs} tokens=${tokens}`,
  );
}

function timeLeft(state: RunState) {
  return budgetRemainingMs(state.startedAtMs, Date.now(), VIDEO_SCAN_RUN_BUDGET_MS);
}

/** True once the run must not start anything new (budget spent or a provider-wide failure seen by any worker). */
function stopping(state: RunState) {
  return state.budgetSpent || state.providerFailure !== null;
}

/** Claims, scans and records one item. "stop" ends the run (budget spent or a provider-wide failure). */
async function moderateOne(state: RunState, item: Candidate): Promise<"next" | "stop"> {
  const counts = state.kinds[item.kind];
  // Calls start at least VIDEO_SCAN_MIN_START_GAP_MS apart across the workers (Hive allows 5 requests per second).
  const slot = nextCallStart(state.lastStartMs, Date.now());
  state.lastStartMs = slot.startMs;
  if (slot.waitMs > 0) await sleepMs(slot.waitMs);
  if (stopping(state)) return "stop";
  // No claim that the budget can't follow with a Hive call.
  if (hiveCallTimeoutMs(timeLeft(state), { maxMs: MODERATION_TIMEOUT_MS }) === null) {
    state.budgetSpent = true;
    return "stop";
  }
  const claimedAt = new Date();
  if ((await claim(item.kind, item.id, claimedAt)) === 0) return "next"; // another run already claimed it
  const mine: Mine = { id: item.id, videoModeratedAt: claimedAt };
  const context = { kind: item.kind, [`${item.kind}Id`]: item.id };

  try {
    // Re-checked after the claim's round trip: the call must still end before the budget does.
    const timeoutMs = hiveCallTimeoutMs(timeLeft(state), { maxMs: MODERATION_TIMEOUT_MS });
    if (timeoutMs === null) {
      await updateMine(item.kind, mine, UNCLAIM);
      state.unclaimed += 1;
      state.budgetSpent = true;
      return "stop";
    }
    counts.checked += 1;
    const callStartedMs = Date.now();
    const result = await scan(item.videoUrl!, item.videoDurationSeconds, timeoutMs, context);
    if (!result.ok && result.failure === "timeout" && !timeoutCountsAgainstVideo(timeoutMs)) {
      // Cut short by this run's budget (it had less than VIDEO_SCAN_FAIR_TIMEOUT_MS): not the video's fault, nothing
      // counted against it.
      await updateMine(item.kind, mine, UNCLAIM);
      state.unclaimed += 1;
      state.budgetSpent = true;
      return "stop";
    }
    if (!result.ok) {
      counts.failed += 1;
      const { next, diagnostic } = await noteFailure(state, item, result);
      if (!next) {
        // Provider-wide: hand it back untouched. videoScanAttempts is NOT incremented, so it never counts toward the
        // give-up.
        await updateMine(item.kind, mine, UNCLAIM);
        return "stop";
      }
      if (next.kind === "retry") {
        await updateMine(item.kind, mine, { ...COUNT_FAILURE, videoModeratedAt: null, videoScanRetryAt: next.retryAt });
      } else if (next.kind === "hold_for_admin") {
        if (await holdForAdmin(item, mine, giveUpAuditRow(item, diagnostic), GIVE_UP)) counts.heldForAdmin += 1;
      } else {
        await updateMine(item.kind, mine, GIVE_UP);
      }
      await reportGiveUp(next, diagnostic);
      return "next";
    }
    logVerdict(item, result, Date.now() - callStartedMs);
    if (result.flagged) {
      counts.flagged += 1;
      await flag(item, mine, flaggedAuditRow(item, result.categories, result.reason));
    } else if (result.review) {
      // Unsure is never clean: held for an admin straight away, with the model's reason.
      counts.unsure += 1;
      if (await holdForAdmin(item, mine, unsureAuditRow(item, result.reason), KEEP_ATTEMPTS)) {
        counts.heldForAdmin += 1;
      }
    } else {
      counts.cleared += 1;
    }
    return "next";
  } catch (err) {
    await updateMine(item.kind, mine, UNCLAIM);
    counts.failed += 1;
    console.error(`[moderate-videos] failed to moderate video for ${item.kind} ${item.id}`, err);
    await captureError(err, { route: "cron/moderate-videos", ...context });
    return "next";
  }
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const state: RunState = {
    providerFailure: null,
    videoFailures: {},
    failures: [],
    startedAtMs: Date.now(),
    lastStartMs: null,
    budgetSpent: false,
    unclaimed: 0,
    kinds: { post: emptyKindSummary(), comment: emptyKindSummary(), muse: emptyKindSummary() },
  };
  let stoppedBy: VideoScanStop = "done";
  let cooldownInfo: VideoScanRunSummary["cooldown"] = { action: "none" };

  try {
    const stored = await readHiveCooldown();
    if (stored.cooldown && hiveCooldownActive(stored.cooldown, Date.now())) {
      // Hive refused us recently (rate limit, credit, key): don't call it, don't claim anything.
      stoppedBy = "cooldown";
      cooldownInfo = {
        action: "skipped",
        failure: stored.cooldown.failure,
        untilMs: stored.cooldown.untilMs,
        store: stored.store,
      };
      return NextResponse.json({
        error: null,
        skipped: "hive_cooldown",
        hive: { failure: stored.cooldown.failure, cooldownUntil: new Date(stored.cooldown.untilMs).toISOString() },
        videoFailures: {},
        failures: [],
        stoppedBy,
        posts: state.kinds.post,
        comments: state.kinds.comment,
        muses: state.kinds.muse,
      });
    }

    // One DB query at a time, then VIDEO_SCAN_CONCURRENCY workers taking the round-robin queue in order. A worker that
    // sees "stop" (or a stop another worker set) starts nothing new; calls already in flight finish and are recorded.
    const lists: Candidate[][] = [];
    for (const kind of ["post", "comment", "muse"] as const) lists.push(await findCandidates(kind));
    const queue = roundRobin(lists, runRotation(state.startedAtMs));
    let nextIndex = 0;
    const worker = async () => {
      while (!stopping(state) && nextIndex < queue.length) {
        const item = queue[nextIndex++];
        if ((await moderateOne(state, item)) === "stop") return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(VIDEO_SCAN_CONCURRENCY, queue.length) }, worker));

    if (state.providerFailure) {
      const { failure, diagnostic, retryAfterSeconds } = state.providerFailure;
      stoppedBy = failure;
      const cooldown = hiveCooldownAfter({ failure, retryAfterSeconds, nowMs: Date.now(), previous: stored.cooldown });
      if (cooldown) {
        const store = await writeHiveCooldown(cooldown);
        cooldownInfo = { action: "set", failure, untilMs: cooldown.untilMs, store };
      }
      // Once per run (or per cooldown, for the failures that set one); Sentry groups these into one issue. Nothing
      // was counted against any video, so every one is scanned once Hive works again.
      const detail = state.providerFailure.detail ? scrubDiagnosticText(state.providerFailure.detail, 400) : undefined;
      console.error(`[moderate-videos] Hive unavailable, run stopped: ${failure}${detail ? ` (${detail})` : ""}`);
      await captureError(new Error(`Hive video moderation unavailable: ${failure}`), {
        route: "cron/moderate-videos",
        detail,
        ...(diagnostic ? videoScanFailureContext(diagnostic) : {}),
      });
    } else if (state.budgetSpent) {
      stoppedBy = "budget";
    }

    return NextResponse.json({
      error: null,
      hive: state.providerFailure
        ? {
            failure: state.providerFailure.failure,
            detail: state.providerFailure.detail ? scrubDiagnosticText(state.providerFailure.detail, 400) : undefined,
            cooldownUntil:
              cooldownInfo.action === "set" && cooldownInfo.untilMs !== undefined
                ? new Date(cooldownInfo.untilMs).toISOString()
                : undefined,
          }
        : null,
      videoFailures: state.videoFailures,
      failures: state.failures,
      stoppedBy,
      posts: state.kinds.post,
      comments: state.kinds.comment,
      muses: state.kinds.muse,
    });
  } catch (err) {
    stoppedBy = "error";
    throw err;
  } finally {
    const nowMs = Date.now();
    console.log(
      formatVideoScanRunSummary(
        {
          kinds: state.kinds,
          stoppedBy,
          budgetUsedMs: nowMs - state.startedAtMs,
          budgetMs: VIDEO_SCAN_RUN_BUDGET_MS,
          unclaimed: state.unclaimed,
          cooldown: cooldownInfo,
        },
        nowMs,
      ),
    );
  }
}
