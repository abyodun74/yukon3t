// What the moderate-videos cron (src/app/api/cron/moderate-videos/route.ts) does after a Hive scan of one video
// fails for a reason of its own (src/lib/hive.ts: isProviderWideFailure false). Pure, unit-tested.
//
// Before this, a failed video went straight back into the candidate set unchanged. The candidate query takes 20 per
// run, so 20 videos that always fail were picked again every 5 minutes forever and every newer video waited behind
// them, unscanned. Now each failure pushes that video's next try back (VIDEO_SCAN_BACKOFF_MS), and after
// VIDEO_SCAN_MAX_ATTEMPTS Hive is given up on for it: the video goes to the second automated check that already
// exists for videos Hive can't take (the Cloudflare Stream review in src/lib/video-review.ts, driven by the
// moderate-long-videos cron), or to an admin, so no video is left both visible and never checked.

// Wait before attempt n+1, indexed by failures so far (1 → 5 min, …). Six failures span about 16 hours.
export const VIDEO_SCAN_BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 12 * 60 * 60_000];
export const VIDEO_SCAN_MAX_ATTEMPTS = VIDEO_SCAN_BACKOFF_MS.length + 1;

export type VideoScanNext =
  // Try Hive again at `retryAt`.
  | { kind: "retry"; retryAt: Date }
  // Stop trying Hive and hand the video to the Stream review (which needs its length). It stays as it is meanwhile:
  // a short video is published at upload ("publish now, react if flagged", CLAUDE.md "Moderation gate"), and the
  // review removes it if it finds anything.
  | { kind: "long_review" }
  // Stop trying Hive and hide the video for an admin: it is published and the Stream review can't take it (no length).
  | { kind: "hold_for_admin" }
  // Stop trying Hive; the video is already not public (held, flagged or removed), so it is already with an admin.
  | { kind: "stop" };

export function nextAfterVideoScanFailure({
  failuresSoFar,
  now,
  published,
  durationSeconds,
}: {
  /** Failures recorded before this one (the row's videoScanAttempts). */
  failuresSoFar: number;
  now: Date;
  /** moderationStatus is PUBLISHED. */
  published: boolean;
  durationSeconds: number | null;
}): VideoScanNext {
  const failures = failuresSoFar + 1;
  if (failures < VIDEO_SCAN_MAX_ATTEMPTS) {
    const wait = VIDEO_SCAN_BACKOFF_MS[Math.min(failures, VIDEO_SCAN_BACKOFF_MS.length) - 1];
    return { kind: "retry", retryAt: new Date(now.getTime() + wait) };
  }
  if (!published) return { kind: "stop" };
  if (durationSeconds && durationSeconds > 0) return { kind: "long_review" };
  return { kind: "hold_for_admin" };
}
