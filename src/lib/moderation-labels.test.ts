import { describe, it, expect } from "vitest";
import { violationLabelsFromReasons, videoViolationNoticeText } from "@/lib/moderation-labels";

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

describe("videoViolationNoticeText", () => {
  it("names the specific violation(s) found", () => {
    expect(videoViolationNoticeText(["frame@30s: sexual"])).toBe(
      "The video you tried to post violates our prohibited content policy: sexually explicit content.",
    );
  });

  it("falls back to a generic notice when no categories are present", () => {
    expect(videoViolationNoticeText([])).toBe(
      "The video you tried to post violated our content guidelines and was removed.",
    );
  });
});
