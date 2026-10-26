import type { MediaModerationCheck } from "@/lib/moderation";

/**
 * What createPost does with a photo/video post the automated screen (OpenAI moderation of the caption, each photo,
 * and a video's still frame) didn't pass. Pure rules, shared by createPost, the admin moderation page and the
 * expiry sweep in the resolve-stale-reports cron.
 *
 * Before this, any flag at all — a caption the text model didn't like, or one ordinary video frame — rejected the
 * post and deleted the upload on the spot. Nothing was kept and nothing reached /admin/moderation, so a false
 * positive (an ordinary clip or screen recording) couldn't be looked at, approved or even found by an admin, and the
 * person just got the same refusal on every retry (the client captures the same frame each time). Now:
 *  - publish: nothing flagged. A moderation API failure (outage, timeout, a refused input) is not a verdict about the
 *    content and is not treated as one: it fails open exactly as moderation.ts always has, and short videos are still
 *    scanned in full afterwards by the moderate-videos cron.
 *  - hold: flagged, but not in a must-delete category. The post is stored hidden (moderationStatus FLAGGED, so only
 *    the author and admins can open it), its media is kept, and it shows up in /admin/moderation's flagged-content
 *    queue with the reasons, where an admin publishes it or removes it. If nobody reviews it within
 *    MEDIA_HOLD_REVIEW_WINDOW_MS it is deleted, media included, by the sweep.
 *  - reject: flagged in a category in MUST_DELETE_MODERATION_CATEGORIES (sexual content involving minors). The upload
 *    is deleted at once and never kept for review; only an audit record without the media remains, which the admin
 *    page lists under "Rejected automatically".
 */

/** Categories whose media is never kept, not even hidden for review: deleted immediately, as before. */
export const MUST_DELETE_MODERATION_CATEGORIES: ReadonlySet<string> = new Set(["sexual/minors"]);

/**
 * How long a held post waits for an admin before the sweep deletes it. Same 14 days as the longest existing
 * keep-then-purge rule for user media (an unopened view-once photo/video, VIEW_ONCE_LIFETIME_MS in src/lib/view-once.ts).
 */
export const MEDIA_HOLD_REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** How far back past the review window the sweep looks for holds it hasn't dealt with (e.g. after a cron outage). */
export const MEDIA_HOLD_SWEEP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** AuditLog.performedBy sentinels (that column isn't a foreign key; see the long-video review's own). */
export const MEDIA_HOLD_PERFORMED_BY = "system:media-moderation-hold";
export const MEDIA_REJECT_PERFORMED_BY = "system:media-moderation-reject";
export const MEDIA_HOLD_EXPIRED_PERFORMED_BY = "system:media-hold-expired";

export type MediaModerationDecision =
  | { kind: "publish"; reasons: string[] }
  | { kind: "hold"; reasons: string[] }
  | { kind: "reject"; reasons: string[] };

/**
 * One line per flagged part, e.g. "video frame: violence" or "caption: harassment,harassment/threatening" — the same
 * "<where>: <categories>" shape the long-video review writes, so violationKeysFromReasons/violationLabelsFromReasons
 * (src/lib/moderation-labels.ts) read both.
 */
export function decideMediaModeration(checks: MediaModerationCheck[]): MediaModerationDecision {
  // A failed check says nothing about the content: never a hold, never a rejection.
  const flagged = checks.filter((check) => !check.result.allowed && !check.result.apiError);
  if (flagged.length === 0) return { kind: "publish", reasons: [] };

  const reasons = flagged.map((check) => {
    const categories = check.result.flaggedCategories.filter((c) => c !== "moderation_api_error");
    return `${check.source}: ${categories.length > 0 ? categories.join(",") : "flagged"}`;
  });
  const mustDelete = flagged.some((check) =>
    check.result.flaggedCategories.some((category) => MUST_DELETE_MODERATION_CATEGORIES.has(category)),
  );
  return { kind: mustDelete ? "reject" : "hold", reasons };
}

// --- AuditLog reason strings -------------------------------------------------
// AuditLog rows point at a user, not at a post, so the held post's id travels in the reason text. These helpers are
// the only writers and readers of that format.

const HOLD_PREFIX = "Media post held for admin review at posting";
const REJECT_PREFIX = "Media upload rejected and deleted at posting";

export function mediaHoldAuditReason(postId: string, mediaType: string, reasons: string[]): string {
  return `${HOLD_PREFIX} (post:${postId}, ${mediaType}): ${reasons.join("; ")}`;
}

export function mediaRejectAuditReason(mediaType: string, reasons: string[]): string {
  return `${REJECT_PREFIX} (${mediaType}, must-delete category, media not kept): ${reasons.join("; ")}`;
}

export function mediaHoldExpiredAuditReason(postId: string): string {
  return `Held media post (post:${postId}) was not reviewed within ${Math.round(
    MEDIA_HOLD_REVIEW_WINDOW_MS / (24 * 60 * 60 * 1000),
  )} days and was deleted with its media. Not a confirmed violation.`;
}

/** The held post's id out of a mediaHoldAuditReason / mediaHoldExpiredAuditReason string, or null. */
export function postIdFromMediaAuditReason(reason: string): string | null {
  const match = /\(post:([A-Za-z0-9_-]+)[,)]/.exec(reason);
  return match ? match[1] : null;
}

/** The "<where>: <categories>" lines back out of a hold or rejection reason string. */
export function reasonsFromMediaAuditReason(reason: string): string[] {
  const start = reason.indexOf("): ");
  if (start === -1) return [];
  return reason
    .slice(start + 3)
    .split("; ")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The media type out of either reason string ("VIDEO", "IMAGE"), or null. */
export function mediaTypeFromMediaAuditReason(reason: string): string | null {
  const match = /\((?:post:[A-Za-z0-9_-]+, )?([A-Z]+)[,)]/.exec(reason);
  return match ? match[1] : null;
}

/** When a hold that started at `heldAt` is deleted if nobody has reviewed it. */
export function mediaHoldExpiresAt(heldAt: Date): Date {
  return new Date(heldAt.getTime() + MEDIA_HOLD_REVIEW_WINDOW_MS);
}

/** The createdAt range of hold audit rows the sweep should act on at `now`. */
export function expiredMediaHoldWindow(now: Date): { gte: Date; lt: Date } {
  const lt = new Date(now.getTime() - MEDIA_HOLD_REVIEW_WINDOW_MS);
  return { gte: new Date(lt.getTime() - MEDIA_HOLD_SWEEP_LOOKBACK_MS), lt };
}
