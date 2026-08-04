import { describe, it, expect } from "vitest";
import { isEmojiOnly } from "@/lib/emoji";

describe("isEmojiOnly", () => {
  it("accepts a single emoji", () => {
    expect(isEmojiOnly("🔥")).toBe(true);
  });

  it("accepts a handful of emoji up to the max cluster count", () => {
    expect(isEmojiOnly("🔥🔥🔥", 6)).toBe(true);
    expect(isEmojiOnly("🔥🔥🔥🔥🔥🔥🔥", 6)).toBe(false);
  });

  it("counts a skin-tone-modified emoji as one cluster, not several codepoints", () => {
    expect(isEmojiOnly("👍🏽", 1)).toBe(true);
  });

  it("rejects plain text", () => {
    expect(isEmojiOnly("hello")).toBe(false);
  });

  it("rejects mixed text and emoji", () => {
    expect(isEmojiOnly("hi 🔥")).toBe(false);
  });

  it("rejects empty or whitespace-only input", () => {
    expect(isEmojiOnly("")).toBe(false);
    expect(isEmojiOnly("   ")).toBe(false);
  });
});
