// Turns the raw category tokens produced by moderation.ts/profanity-wordlist.ts
// (OpenAI's own moderation category names, e.g. "sexual", "sexual/minors",
// plus this app's own "profanity" and "moderation_api_error" sentinels)
// into short human-readable phrases for a user-facing violation notice —
// see video-review.ts's VideoReviewResult "flagged" reasons and
// notifyVideoModerationFailed in content-moderation.ts.
const CATEGORY_LABELS: Record<string, string> = {
  sexual: "sexually explicit content",
  "sexual/minors": "sexual content involving minors",
  harassment: "harassment",
  "harassment/threatening": "threatening harassment",
  hate: "hateful content",
  "hate/threatening": "threatening hateful content",
  illicit: "illicit activity",
  "illicit/violent": "violent illicit activity",
  "self-harm": "self-harm content",
  "self-harm/intent": "self-harm content",
  "self-harm/instructions": "self-harm content",
  violence: "violent content",
  "violence/graphic": "graphic violence",
  profanity: "profanity",
  moderation_api_error: "content our system couldn't fully verify",
};

/**
 * Extracts and dedupes violation-category labels out of video-review.ts's
 * free-form reason strings, e.g. "frame@30s: sexual,violence",
 * "audio: hate", "audio: profanity (word1,word2)". Order-preserving so the
 * most-frequently-flagged category tends to surface first.
 */
export function violationLabelsFromReasons(reasons: string[]): string[] {
  const labels = new Set<string>();
  for (const reason of reasons) {
    const afterPrefix = reason.includes(":") ? reason.slice(reason.indexOf(":") + 1) : reason;
    const withoutDetail = afterPrefix.replace(/\([^)]*\)/g, "");
    for (const token of withoutDetail.split(",")) {
      const key = token.trim().toLowerCase();
      if (!key) continue;
      labels.add(CATEGORY_LABELS[key] ?? key.replace(/[_/]/g, " "));
    }
  }
  return [...labels];
}

/** User-facing sentence for a removed video, naming the specific violation(s) found. */
export function videoViolationNoticeText(reasons: string[]): string {
  const labels = violationLabelsFromReasons(reasons);
  if (labels.length === 0) {
    return "The video you tried to post violated our content guidelines and was removed.";
  }
  return `The video you tried to post violates our prohibited content policy: ${labels.join(", ")}.`;
}
