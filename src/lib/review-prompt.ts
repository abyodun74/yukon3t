// The "How's the yukon3t app?" gate (review-prompt-gate.tsx) — decides
// *whether* to ask, never *what* to do with the answer (that's
// actions/review-prompt.ts, which is also the only place a native store
// review popup ever gets triggered). Kept pure/DB-free here so the
// thresholds are easy to read and adjust without hunting through a Server
// Action.

/** Minimum account age before the prompt is eligible at all — long enough to have formed a real opinion, not just finished onboarding. */
export const REVIEW_PROMPT_MIN_ACCOUNT_AGE_DAYS = 5;

/** How long a "maybe later" snoozes the next ask. */
export const REVIEW_PROMPT_SNOOZE_DAYS = 14;

/** Total "maybe later" asks before giving up for good (never nags indefinitely) — a 4th eligible moment just never shows it again. */
export const REVIEW_PROMPT_MAX_ASKS = 3;

export type ReviewPromptGateInput = {
  accountCreatedAt: Date;
  reviewPromptStatus: "PENDING" | "LOVED" | "DECLINED";
  reviewPromptAskCount: number;
  reviewPromptLastAskedAt: Date | null;
  /** Whether this account has done at least one real thing with the app (post, message, Circle) — see actions/review-prompt.ts for how this is actually computed. */
  hasMeaningfulActivity: boolean;
};

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
}

/** True if this is a moment the gate should show the prompt. */
export function isEligibleForReviewPrompt(input: ReviewPromptGateInput): boolean {
  // LOVED/DECLINED are both terminal — the whole point of this gate is to
  // never re-ask someone who already told us where they stand.
  if (input.reviewPromptStatus !== "PENDING") return false;
  if (input.reviewPromptAskCount >= REVIEW_PROMPT_MAX_ASKS) return false;
  if (daysSince(input.accountCreatedAt) < REVIEW_PROMPT_MIN_ACCOUNT_AGE_DAYS) return false;
  if (!input.hasMeaningfulActivity) return false;
  if (input.reviewPromptLastAskedAt && daysSince(input.reviewPromptLastAskedAt) < REVIEW_PROMPT_SNOOZE_DAYS) {
    return false;
  }
  return true;
}
