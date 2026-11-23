import type { MediaModerationCheck } from "@/lib/moderation";

/**
 * What createPost does with a photo/video post the automated screen (OpenAI moderation of the caption, each photo,
 * and a video's still frame) didn't pass. Pure rules, shared by createPost, createMuse and the admin
 * moderation page.
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
 *    queue with the reasons, where an admin publishes it or removes it. It is never deleted automatically
 *    (owner decision 2026-11-22: the 14-day expiry sweep is gone); it waits for an admin however long that takes.
 *  - reject: flagged in a category in MUST_DELETE_MODERATION_CATEGORIES (sexual content involving minors). The upload
 *    is deleted at once and never kept for review; only an audit record without the media remains, which the admin
 *    page lists under "Rejected automatically".
 */

/** Categories whose media is never kept, not even hidden for review: deleted immediately, as before. */
export const MUST_DELETE_MODERATION_CATEGORIES: ReadonlySet<string> = new Set(["sexual/minors"]);

/** AuditLog.performedBy sentinels (that column isn't a foreign key; see the long-video review's own). */
export const MEDIA_HOLD_PERFORMED_BY = "system:media-moderation-hold";
export const MEDIA_REJECT_PERFORMED_BY = "system:media-moderation-reject";
/** Written by the removed 14-day expiry sweep; only read now, so the admin page can still list those older rows. */
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

/** A Muse held at posting (createMuse): the same prefix, naming the Muse instead of a post. */
export function museMediaHoldAuditReason(museId: string, reasons: string[]): string {
  return `${HOLD_PREFIX} (muse:${museId}, VIDEO): ${reasons.join("; ")}`;
}

/** The held Muse's id out of a museMediaHoldAuditReason string, or null. */
export function museIdFromMediaAuditReason(reason: string): string | null {
  if (!reason.startsWith(HOLD_PREFIX)) return null;
  const match = /\(muse:([A-Za-z0-9_-]+), VIDEO\)/.exec(reason);
  return match ? match[1] : null;
}

export function mediaRejectAuditReason(mediaType: string, reasons: string[]): string {
  return `${REJECT_PREFIX} (${mediaType}, must-delete category, media not kept): ${reasons.join("; ")}`;
}

/** The held post's id out of a mediaHoldAuditReason string, or null. */
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

// --- Video scan failure holds ----------------------------------------------
// The moderate-videos cron gives up on a video Hive couldn't scan after VIDEO_SCAN_MAX_ATTEMPTS
// (src/lib/video-scan-retry.ts) and holds it for an admin: FLAGGED, media kept, one CONTENT_FLAGGED_FOR_REVIEW audit
// row with its own performedBy: an unscannable file isn't a finding against anyone, so it waits for an admin's Publish
// or Remove however long that takes, like every other hold. Post, Comment and Muse alike.

export const VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY = "system:video-scan-failed-hold";

/** The plain-language reason an admin sees first. */
export const VIDEO_SCAN_FAILED_REASON = "automatic video scan could not process this file";

const SCAN_FAILED_PREFIX = `Video held for admin review: ${VIDEO_SCAN_FAILED_REASON}`;

export type VideoScanHoldKind = "post" | "comment" | "muse";

/** e.g. "Video held for admin review: automatic video scan could not process this file (muse:c1, VIDEO): Hive …" */
export function videoScanFailedHoldAuditReason(kind: VideoScanHoldKind, id: string, detail: string): string {
  return `${SCAN_FAILED_PREFIX} (${kind}:${id}, VIDEO): ${detail}`;
}

// --- Video scan verdict holds -----------------------------------------------
// The VLM scan (src/lib/hive.ts) answers "unsure" when it can't confidently call a video clean, and names categories
// when it flags one. Both hide the item (FLAGGED, media kept) and write one CONTENT_FLAGGED_FOR_REVIEW row under
// VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY with the model's reason, so /admin/moderation can show why. Like every hold, it
// is never deleted unreviewed: neither is a confirmed violation.

export const VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY = "system:video-scan-review-hold";

/** Every performedBy a moderate-videos hold row is written under (the admin page reads all of them). */
export const VIDEO_SCAN_HOLD_PERFORMED_BY_ALL: readonly string[] = [
  VIDEO_SCAN_FAILED_HOLD_PERFORMED_BY,
  VIDEO_SCAN_REVIEW_HOLD_PERFORMED_BY,
];

export const VIDEO_SCAN_UNSURE_REASON = "automatic video scan was unsure";
export const VIDEO_SCAN_FLAGGED_REASON = "automatic video scan flagged this video";

const UNSURE_PREFIX = `Video held for admin review: ${VIDEO_SCAN_UNSURE_REASON}`;
const FLAGGED_PREFIX = `Video held for admin review: ${VIDEO_SCAN_FLAGGED_REASON}`;

/** Collapses whitespace and strips "; " so the reason stays one line and one reasonsFromMediaAuditReason entry. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").replace(/;\s*/g, ", ").trim();
}

/** e.g. "Video held for admin review: automatic video scan was unsure (post:c1, VIDEO): too dark to tell" */
export function videoScanUnsureHoldAuditReason(kind: VideoScanHoldKind, id: string, modelReason: string): string {
  return `${UNSURE_PREFIX} (${kind}:${id}, VIDEO): ${oneLine(modelReason) || "no reason given"}`;
}

/** e.g. "... automatic video scan flagged this video (muse:c1, VIDEO): sexual_explicit,violence; <reason>" */
export function videoScanFlaggedHoldAuditReason(
  kind: VideoScanHoldKind,
  id: string,
  categories: readonly string[],
  modelReason: string,
): string {
  const reason = oneLine(modelReason);
  return `${FLAGGED_PREFIX} (${kind}:${id}, VIDEO): ${categories.join(",") || "flagged"}${reason ? `; ${reason}` : ""}`;
}

export type VideoScanHoldType = "scan_failed" | "unsure" | "flagged";

/** Which kind of moderate-videos hold a reason string records, or null for any other string. */
export function videoScanHoldTypeFromAuditReason(reason: string): VideoScanHoldType | null {
  if (reason.startsWith(SCAN_FAILED_PREFIX)) return "scan_failed";
  if (reason.startsWith(UNSURE_PREFIX)) return "unsure";
  if (reason.startsWith(FLAGGED_PREFIX)) return "flagged";
  return null;
}

/**
 * The line /admin/moderation shows first for a moderate-videos hold, from its audit reason, e.g. "Held for review:
 * automatic video scan was unsure — too dark to tell". The detail is the part after "(kind:id, VIDEO): ".
 */
export function videoScanHoldHeadline(reason: string): string {
  const detail = reasonsFromMediaAuditReason(reason).join("; ");
  switch (videoScanHoldTypeFromAuditReason(reason)) {
    case "unsure":
      return `Held for review: ${VIDEO_SCAN_UNSURE_REASON} — ${detail || "no reason given"}`;
    case "flagged":
      return `Hidden: ${VIDEO_SCAN_FLAGGED_REASON} — ${detail || "flagged"}`;
    default:
      return `Held for review: ${VIDEO_SCAN_FAILED_REASON}`;
  }
}

/** The held item out of a moderate-videos hold reason string (any of the three kinds), or null. */
export function videoScanHoldTargetFromAuditReason(reason: string): { kind: VideoScanHoldKind; id: string } | null {
  const match = /\((post|comment|muse):([A-Za-z0-9_-]+), VIDEO\)/.exec(reason);
  return match ? { kind: match[1] as VideoScanHoldKind, id: match[2] } : null;
}

/** Map key for a held item: "post:<id>", "comment:<id>", "muse:<id>". */
export function videoScanHoldKey(kind: VideoScanHoldKind, id: string): string {
  return `${kind}:${id}`;
}
