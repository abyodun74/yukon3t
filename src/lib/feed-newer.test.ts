import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { newerPostsAfter, prependNewer } from "@/lib/feed-newer";

// PostFeedSection.refetchNewer: with Home in rotated order the top card isn't the newest, so "newer posts" are asked
// for after the newest post shown or the time the rotated first page was served, whichever is later; they are only
// ever put on top, and the rotated list underneath never moves.

const at = (iso: string) => new Date(iso);

describe("newerPostsAfter", () => {
  it("uses the newest post shown, not the first card", () => {
    const posts = [
      { id: "old-on-top", createdAt: at("2026-11-14T10:00:00Z") },
      { id: "newest", createdAt: at("2026-11-17T11:59:00Z") },
      { id: "middle", createdAt: at("2026-11-16T09:00:00Z") },
    ];
    expect(newerPostsAfter(posts, null)).toEqual(at("2026-11-17T11:59:00Z"));
  });

  it("uses the served-at time when it is later than every post shown (the rest of the mix is still to come)", () => {
    const posts = [{ id: "a", createdAt: at("2026-11-15T10:00:00Z") }];
    expect(newerPostsAfter(posts, "2026-11-17T12:05:00.000Z")).toEqual(at("2026-11-17T12:05:00Z"));
  });

  it("uses a post newer than the served-at time once one has been prepended", () => {
    const posts = [
      { id: "new", createdAt: "2026-11-17T12:07:00.000Z" },
      { id: "a", createdAt: at("2026-11-15T10:00:00Z") },
    ];
    expect(newerPostsAfter(posts, "2026-11-17T12:05:00.000Z")).toEqual(at("2026-11-17T12:07:00Z"));
  });

  it("works from the served-at time alone on an empty list, and gives nothing with neither", () => {
    expect(newerPostsAfter([], "2026-11-17T12:05:00.000Z")).toEqual(at("2026-11-17T12:05:00Z"));
    expect(newerPostsAfter([], null)).toBeNull();
  });

  it("is the newest post in the Latest order too (where that is the first card)", () => {
    const posts = [
      { id: "b", createdAt: at("2026-11-17T11:00:00Z") },
      { id: "a", createdAt: at("2026-11-17T10:00:00Z") },
    ];
    expect(newerPostsAfter(posts, null)).toEqual(at("2026-11-17T11:00:00Z"));
  });
});

describe("prependNewer", () => {
  it("puts only new posts on top and leaves the rest of the list exactly as it was", () => {
    const prev = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const next = prependNewer(prev, [{ id: "n2" }, { id: "n1" }, { id: "y" }]);
    expect(next.map((p) => p.id)).toEqual(["n2", "n1", "x", "y", "z"]);
    expect(next.slice(2)).toEqual(prev);
  });

  it("returns the same list when nothing is new", () => {
    const prev = [{ id: "x" }];
    expect(prependNewer(prev, [{ id: "x" }])).toBe(prev);
  });
});

describe("PostFeedSection wiring", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../components/post-feed-section.tsx"), "utf8");
  const home = readFileSync(path.resolve(import.meta.dirname, "../app/home/page.tsx"), "utf8");

  it("asks for newer posts after newerPostsAfter's time, never the first card's, and only prepends them", () => {
    expect(source).toContain("newerPostsAfter(posts, servedAtMark)");
    expect(source).not.toMatch(/posts\[0\]\??\.createdAt/);
    expect(source).toContain("setPosts((prev) => prependNewer(prev, fresh))");
  });

  it("pages the rotated order by its cursor", () => {
    expect(source).toMatch(/cursor=\$\{encodeURIComponent\(rotationCursor\)\}/);
  });

  it("never remounts Home's list for a new rotation bucket (no reshuffle mid-scroll)", () => {
    const key = home.match(/key=\{`([^`]*)`\}/)?.[1] ?? "";
    expect(key).toContain("feedOrder");
    expect(key).not.toMatch(/bucket|servedAt|cursor/i);
  });
});
