import { describe, expect, it } from "vitest";
import { textStoryExcerpt, textStoryNeedsCaption } from "./story-text";

describe("textStoryExcerpt", () => {
  it("returns short text unchanged", () => {
    expect(textStoryExcerpt("hello world", 20)).toBe("hello world");
    expect(textStoryNeedsCaption("hello world", 20)).toBe(false);
  });
  it("cuts at a word boundary with an ellipsis", () => {
    const out = textStoryExcerpt("aaaa bbbb cccc dddd eeee", 12);
    expect(out).toBe("aaaa bbbb…");
    expect(textStoryNeedsCaption("aaaa bbbb cccc dddd eeee", 12)).toBe(true);
  });
  it("hard-cuts an unbroken run", () => {
    expect(textStoryExcerpt("x".repeat(50), 10)).toBe("x".repeat(10) + "…");
  });
  it("does not split emoji", () => {
    const out = textStoryExcerpt("\u{1F600}".repeat(30), 10);
    expect(out).toBe("\u{1F600}".repeat(10) + "…");
  });
  it("keeps newlines-as-whitespace boundaries", () => {
    expect(textStoryExcerpt("one two\nthree four five", 14)).toBe("one two\nthree…");
  });
});
