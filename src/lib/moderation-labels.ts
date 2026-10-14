import { pagesEn } from "@/lib/i18n/en/pages";
import { categoryName, noticeText } from "@/lib/notification-notice";

// Turns the raw category tokens produced by moderation.ts/profanity-wordlist.ts
// (OpenAI's own moderation category names, e.g. "sexual", "sexual/minors",
// plus this app's own "profanity" and "moderation_api_error" sentinels)
// into keys and short human-readable phrases — see video-review.ts's
// VideoReviewResult "flagged" reasons, the shape these are derived from. The
// phrases themselves, in every language, are pages.notifications.notices in
// src/lib/i18n.

// Categories that read the same to the person told about them.
const SAME_AS: Record<string, string> = {
  "self-harm/intent": "self-harm",
  "self-harm/instructions": "self-harm",
};

/**
 * Extracts and dedupes violation-category keys out of video-review.ts's
 * free-form reason strings, e.g. "frame@30s: sexual,violence",
 * "audio: hate", "audio: profanity (word1,word2)". Order-preserving so the
 * most-frequently-flagged category tends to surface first. A key the
 * dictionary doesn't know is kept as found (lowercased).
 */
export function violationKeysFromReasons(reasons: string[]): string[] {
  const keys = new Set<string>();
  for (const reason of reasons) {
    const afterPrefix = reason.includes(":") ? reason.slice(reason.indexOf(":") + 1) : reason;
    const withoutDetail = afterPrefix.replace(/\([^)]*\)/g, "");
    for (const token of withoutDetail.split(",")) {
      const key = token.trim().toLowerCase();
      if (!key) continue;
      keys.add(SAME_AS[key] ?? key);
    }
  }
  return [...keys];
}

/** The same categories as English phrases. */
export function violationLabelsFromReasons(reasons: string[]): string[] {
  const notices = pagesEn.notifications.notices;
  return [...new Set(violationKeysFromReasons(reasons).map((key) => categoryName(key, notices)))];
}

/**
 * User-facing sentence for a long video held pending admin review (see
 * VIDEO_FLAGGED_FOR_REVIEW and moderate-long-videos' "flagged" branches),
 * naming the specific violation(s) found. Deliberately doesn't say
 * "removed" — unlike the old (now-legacy) VIDEO_MODERATION_FAILED notice
 * this replaces, the content isn't gone: an admin can still publish it.
 */
export function videoPendingReviewNoticeText(reasons: string[]): string {
  return noticeText(
    { kind: "video_flagged", categories: violationKeysFromReasons(reasons) },
    pagesEn.notifications.notices,
    ", ",
  );
}
