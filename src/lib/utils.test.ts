import { describe, it, expect } from "vitest";
import { slugify, cn } from "@/lib/utils";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Hiking & Camping")).toBe("hiking-camping");
  });

  it("collapses repeated separators into one hyphen", () => {
    expect(slugify("a   b---c")).toBe("a-b-c");
  });

  it("strips characters outside a-z0-9 and whitespace/hyphen", () => {
    expect(slugify("Café ☕ Lovers!")).toBe("caf-lovers");
  });

  it("truncates to 60 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long)).toHaveLength(60);
  });
});

describe("cn", () => {
  it("merges class strings and resolves conflicting Tailwind utilities", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });
});
