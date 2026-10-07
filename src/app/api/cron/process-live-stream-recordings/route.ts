import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  advanceRecordingPost,
  type RecordingPostResult,
  type RecordingPostRow,
} from "@/lib/live-stream-recording-post";
import { captureError } from "@/lib/error-tracking";

// A tick can span a Daily download + an R2 copy of a full stream recording,
// plus (once it reaches the review step) the same Cloudflare/OpenAI work
// moderate-long-videos does — generous, but the real ceiling is whatever the
// deploy platform allows a Next.js route to run for; a tick killed mid-way
// is not lost work, see claimedAt's staleness window below.
export const maxDuration = 300;

// How long a claim is honored before another tick may pick the same row back
// up — long enough that a normal in-progress pipeline (polled every
// POLL_INTERVAL_MS inside processOneRecording's own loop, backstopped by the
// scheduled trigger re-running every minute) is never mistaken for
// abandoned, short enough that a tick killed by a platform timeout doesn't
// stall that recording for long. Same value and reasoning as
// moderate-long-videos' own CLAIM_STALE_MS.
const CLAIM_STALE_MS = 10 * 60 * 1000;

// How many recordings one tick works on at once. Each one is an independent,
// almost entirely network-bound poll loop, not CPU-bound, so several
// concurrently cost roughly the same wall-clock time as one — it just means
// a burst of "Record & Post" recordings makes progress in parallel instead
// of queuing strictly behind whichever is oldest. Matches
// moderate-long-videos' BATCH_SIZE.
const BATCH_SIZE = 3;

// Ceiling on how long this tick actively polls a single recording's progress
// before leaving it for the next one — kept safely under maxDuration above
// so the platform never kills the function mid-write. Daily's own recording
// finalization and Cloudflare's copy/encode/caption processing are what
// actually gate the outcome; this budget only controls how long *this
// invocation* sticks around to catch it landing.
const POLL_BUDGET_MS = 260_000;
const POLL_INTERVAL_MS = 4_000;

const ROW_SELECT = {
  id: true,
  liveStreamId: true,
  recordingId: true,
  hostId: true,
  circleId: true,
  r2VideoUrl: true,
  videoDurationSeconds: true,
  thumbnailUrl: true,
  streamUid: true,
  createdAt: true,
} as const;

/**
 * Drives one recording from wherever it currently stands through to a
 * terminal outcome (or this tick's time budget, whichever comes first),
 * looping advanceRecordingPost internally instead of returning after a
 * single step — same reasoning as reviewOnePost in moderate-long-videos:
 * most of the latency in a pipeline like this isn't the external processing,
 * it's only checking back once per cron interval.
 *
 * The row is re-read each iteration rather than tracked in local state:
 * advanceRecordingPost persists each step itself (unlike
 * advanceLongVideoReview, whose caller owns persistence), so re-reading is
 * both simpler and exactly what a fresh tick resuming this row would see.
 */
async function processOneRecording(initial: RecordingPostRow): Promise<RecordingPostResult["kind"]> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  let row = initial;

  for (;;) {
    let result: RecordingPostResult;
    try {
      result = await advanceRecordingPost(row);
    } catch (err) {
      console.error(`[process-live-stream-recordings] unhandled error on ${row.id}`, err);
      await captureError(err, {
        route: "cron/process-live-stream-recordings",
        recordingPostId: row.id,
      });
      await prisma.liveStreamRecordingPost.updateMany({ where: { id: row.id }, data: { claimedAt: null } });
      return "error";
    }

    if (result.kind !== "in_progress") {
      // done/flagged, and terminal errors, have all already written their
      // own final status (and released the claim) inside
      // advanceRecordingPost. A non-terminal error only needs the claim
      // released so a later tick retries from exactly where this stopped —
      // every piece of progress is already persisted.
      if (result.kind === "error" && !result.terminal) {
        await prisma.liveStreamRecordingPost.updateMany({ where: { id: row.id }, data: { claimedAt: null } });
      }
      return result.kind;
    }

    if (Date.now() >= deadline) {
      // Out of this tick's budget while still waiting — release the claim
      // (keeping every persisted step) so the next tick resumes here.
      await prisma.liveStreamRecordingPost.updateMany({ where: { id: row.id }, data: { claimedAt: null } });
      return "in_progress";
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const fresh = await prisma.liveStreamRecordingPost.findFirst({
      where: { id: row.id, status: "PENDING" },
      select: ROW_SELECT,
    });
    // Gone or already finalized out from under us (a concurrent tick, or
    // the stream itself was deleted and cascaded this away) — nothing left
    // for this loop to do either way.
    if (!fresh) return "in_progress";
    row = fresh;
  }
}

/** Claims up to BATCH_SIZE unclaimed-or-stale PENDING rows, one at a time so one lost race doesn't cost the whole batch. */
async function claimCandidates(claimable: object): Promise<RecordingPostRow[]> {
  const candidates = await prisma.liveStreamRecordingPost.findMany({
    where: { status: "PENDING", ...claimable },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: ROW_SELECT,
  });

  const claimed: RecordingPostRow[] = [];
  for (const candidate of candidates) {
    const result = await prisma.liveStreamRecordingPost.updateMany({
      where: { id: candidate.id, status: "PENDING", ...claimable },
      data: { claimedAt: new Date() },
    });
    if (result.count > 0) claimed.push(candidate);
  }
  return claimed;
}

/**
 * Triggered every minute (Netlify Scheduled Function), same thin-trigger
 * pattern as moderate-long-videos. Each claimed row is driven through
 * processOneRecording's internal poll loop concurrently — see
 * live-stream-recording-post.ts for why a single recording's pipeline can
 * still legitimately span more than one tick (Daily finalizing a long
 * recording, then Cloudflare's own copy/encode/caption work, can outlast
 * even this tick's POLL_BUDGET_MS).
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS);
  const claimable = { OR: [{ claimedAt: null }, { claimedAt: { lt: staleCutoff } }] };

  const claimed = await claimCandidates(claimable);
  if (claimed.length === 0) {
    return NextResponse.json({ error: null, processed: false });
  }

  const outcomes = await Promise.all(claimed.map((row) => processOneRecording(row)));
  return NextResponse.json({ error: null, processed: true, outcomes });
}
