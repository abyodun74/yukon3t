import { describe, expect, it } from "vitest";
import {
  isEligibleForReviewPrompt,
  REVIEW_PROMPT_MAX_ASKS,
  REVIEW_PROMPT_MIN_ACCOUNT_AGE_DAYS,
  REVIEW_PROMPT_SNOOZE_DAYS,
  type ReviewPromptGateInput,
} from "./review-prompt";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

function fresh(over: Partial<ReviewPromptGateInput> = {}): ReviewPromptGateInput {
  return {
    accountCreatedAt: daysAgo(REVIEW_PROMPT_MIN_ACCOUNT_AGE_DAYS + 1),
    reviewPromptStatus: "PENDING",
    reviewPromptAskCount: 0,
    reviewPromptLastAskedAt: null,
    hasMeaningfulActivity: true,
    ...over,
  };
}

describe("isEligibleForReviewPrompt", () => {
  it("is eligible once account age + activity thresholds are both met", () => {
    expect(isEligibleForReviewPrompt(fresh())).toBe(true);
  });

  it("is never eligible once LOVED or DECLINED — both are terminal", () => {
    expect(isEligibleForReviewPrompt(fresh({ reviewPromptStatus: "LOVED" }))).toBe(false);
    expect(isEligibleForReviewPrompt(fresh({ reviewPromptStatus: "DECLINED" }))).toBe(false);
  });

  it("is not eligible for a brand-new account, even with activity", () => {
    expect(isEligibleForReviewPrompt(fresh({ accountCreatedAt: new Date() }))).toBe(false);
    expect(
      isEligibleForReviewPrompt(
        fresh({ accountCreatedAt: daysAgo(REVIEW_PROMPT_MIN_ACCOUNT_AGE_DAYS - 0.5) }),
      ),
    ).toBe(false);
  });

  it("is not eligible without any real activity, no matter how old the account", () => {
    expect(
      isEligibleForReviewPrompt(fresh({ accountCreatedAt: daysAgo(365), hasMeaningfulActivity: false })),
    ).toBe(false);
  });

  it("respects the snooze window after a 'maybe later'", () => {
    expect(
      isEligibleForReviewPrompt(
        fresh({ reviewPromptAskCount: 1, reviewPromptLastAskedAt: daysAgo(REVIEW_PROMPT_SNOOZE_DAYS - 1) }),
      ),
    ).toBe(false);
    expect(
      isEligibleForReviewPrompt(
        fresh({ reviewPromptAskCount: 1, reviewPromptLastAskedAt: daysAgo(REVIEW_PROMPT_SNOOZE_DAYS + 1) }),
      ),
    ).toBe(true);
  });

  it("stops asking for good once the ask-count cap is reached", () => {
    expect(
      isEligibleForReviewPrompt(
        fresh({
          reviewPromptAskCount: REVIEW_PROMPT_MAX_ASKS,
          reviewPromptLastAskedAt: daysAgo(REVIEW_PROMPT_SNOOZE_DAYS + 100),
        }),
      ),
    ).toBe(false);
  });
});
