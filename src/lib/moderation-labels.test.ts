import { describe, it, expect } from "vitest";
import { violationLabelsFromReasons, videoPendingReviewNoticeText } from "@/lib/moderation-labels";

describe("violationLabelsFromReasons", () => {
  it("extracts and dedupes categories from frame reasons", () => {
    expect(
      violationLabelsFromReasons(["frame@30s: sexual,violence", "frame@60s: sexual"]),
    ).toEqual(["sexually explicit content", "violent content"]);
  });

  it("extracts categories from an audio transcript reason", () => {
    expect(violationLabelsFromReasons(["audio: hate"])).toEqual(["hateful content"]);
  });

  it("strips the parenthetical word list off a profanity reason", () => {
    expect(violationLabelsFromReasons(["audio: profanity (word1,word2)"])).toEqual(["profanity"]);
  });

  it("falls back to a readable form of an unmapped category", () => {
    expect(violationLabelsFromReasons(["frame@0s: some_new/category"])).toEqual([
      "some new category",
    ]);
  });

  it("returns an empty list for no reasons", () => {
    expect(violationLabelsFromReasons([])).toEqual([]);
  });
});

describe("videoPendingReviewNoticeText", () => {
  it("names the specific violation(s) found", () => {
    expect(videoPendingReviewNoticeText(["frame@30s: sexual"])).toBe(
      "A video you posted was flagged by our automated review (sexually explicit content) and is on hold pending a closer look.",
    );
  });

  it("falls back to a generic notice when no categories are present", () => {
    expect(videoPendingReviewNoticeText([])).toBe(
      "A video you posted was flagged by our automated review and is on hold pending a closer look.",
    );
  });
});
