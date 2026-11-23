// What the moderate-videos cron (src/app/api/cron/moderate-videos/route.ts) does after a Hive scan of one video
// fails for a reason of its own (src/lib/hive.ts: isProviderWideFailure false). Pure, unit-tested.
//
// Before this, a failed video went straight back into the candidate set unchanged. The candidate query takes 20 per
// run, so 20 videos that always fail were picked again every 5 minutes forever and every newer video waited behind
// them, unscanned. Now each failure pushes that video's next try back (VIDEO_SCAN_BACKOFF_MS), and after
// VIDEO_SCAN_MAX_ATTEMPTS Hive is given up on for it.
//
// Giving up never deletes the video and never leaves it public and unscanned: it is held for an admin (hidden,
// moderationStatus FLAGGED, media kept, a CONTENT_FLAGGED_FOR_REVIEW audit row saying the automatic scan couldn't
// process the file), and /admin/moderation's Publish / Remove decides. Owner decision 2026-11-16: it used to hand a
// video with a known length to the Cloudflare Stream review instead (moderate-long-videos), which deletes a video it
// flags outright, so a file Hive merely couldn't read could end up deleted with no human look. That review is still
// what every video over Hive's 60s limit gets (videoLongReviewNeeded, set at creation); this path doesn't touch it.
// Nothing deletes these unreviewed (no hold is ever deleted automatically): they wait for an admin.

// Wait before attempt n+1, indexed by failures so far (1 → 5 min, …). Six failures span about 16 hours.
export const VIDEO_SCAN_BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 12 * 60 * 60_000];
export const VIDEO_SCAN_MAX_ATTEMPTS = VIDEO_SCAN_BACKOFF_MS.length + 1;

export type VideoScanNext =
  // Try Hive again at `retryAt`.
  | { kind: "retry"; retryAt: Date }
  // Stop trying Hive and hold the video for an admin: hidden (FLAGGED) if it was public, kept as it is if it was
  // already held, with an audit row giving the reason either way.
  | { kind: "hold_for_admin" }
  // Stop trying Hive; the video was already removed, there is nothing left to review.
  | { kind: "stop" };

export function nextAfterVideoScanFailure({
  failuresSoFar,
  now,
  moderationStatus,
}: {
  /** Failures recorded before this one (the row's videoScanAttempts). */
  failuresSoFar: number;
  now: Date;
  /** The row's moderationStatus when it was picked. */
  moderationStatus: "PUBLISHED" | "FLAGGED" | "REMOVED";
}): VideoScanNext {
  const failures = failuresSoFar + 1;
  if (failures < VIDEO_SCAN_MAX_ATTEMPTS) {
    const wait = VIDEO_SCAN_BACKOFF_MS[Math.min(failures, VIDEO_SCAN_BACKOFF_MS.length) - 1];
    return { kind: "retry", retryAt: new Date(now.getTime() + wait) };
  }
  if (moderationStatus === "REMOVED") return { kind: "stop" };
  return { kind: "hold_for_admin" };
}
