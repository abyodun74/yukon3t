import { describe, it, expect } from "vitest";
import { normalizeLinkUrl } from "@/lib/link-url";

describe("normalizeLinkUrl", () => {
  it("accepts any http(s) URL, not just recognized video providers", () => {
    expect(normalizeLinkUrl("https://example.com/some/article")).toBe(
      "https://example.com/some/article",
    );
    expect(normalizeLinkUrl("http://news.ycombinator.com")).toBe(
      "http://news.ycombinator.com/",
    );
  });

  it("rejects non-http(s) protocols — the classic javascript: injection vector", () => {
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    expect(normalizeLinkUrl("not a url at all")).toBeNull();
    expect(normalizeLinkUrl("")).toBeNull();
  });
});
