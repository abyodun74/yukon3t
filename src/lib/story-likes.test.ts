import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mergeViewersWithLikers,
  optimisticStoryLike,
  settleStoryLike,
  shouldNotifyStoryLike,
  storyLikeNotifyLockKey,
  storyLikeStateFor,
} from "@/lib/story-likes";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("storyLikeStateFor: likes are the author's alone", () => {
  it("gives the author the count and no heart of their own", () => {
    expect(storyLikeStateFor({ isAuthor: true, likedByViewer: false, likeCount: 7 })).toEqual({ liked: false, likeCount: 7 });
  });

  it("gives anyone else only their own heart, never a count", () => {
    expect(storyLikeStateFor({ isAuthor: false, likedByViewer: true, likeCount: 7 })).toEqual({ liked: true, likeCount: null });
    expect(storyLikeStateFor({ isAuthor: false, likedByViewer: false, likeCount: 7 })).toEqual({ liked: false, likeCount: null });
  });
});

describe("shouldNotifyStoryLike", () => {
  const base = { likerId: "a", authorId: "b", newlyLiked: true, alreadyNotified: false, blockedEitherWay: false };
  it("notifies a first like from someone else", () => {
    expect(shouldNotifyStoryLike(base)).toBe(true);
  });
  it("never notifies twice for the same liker and story, a self-like, a repeat like or across a block", () => {
    expect(shouldNotifyStoryLike({ ...base, alreadyNotified: true })).toBe(false);
    expect(shouldNotifyStoryLike({ ...base, authorId: "a" })).toBe(false);
    expect(shouldNotifyStoryLike({ ...base, newlyLiked: false })).toBe(false);
    expect(shouldNotifyStoryLike({ ...base, blockedEitherWay: true })).toBe(false);
  });
  it("locks per story and liker", () => {
    expect(storyLikeNotifyLockKey("s1", "u1")).toBe("story-like-notify:s1:u1");
    expect(storyLikeNotifyLockKey("s1", "u1")).not.toBe(storyLikeNotifyLockKey("s1", "u2"));
  });
});

describe("mergeViewersWithLikers", () => {
  const t = (m: number) => new Date(Date.UTC(2026, 10, 18, 12, m));
  it("marks viewers who liked and adds a liker with no recorded view, newest first", () => {
    const merged = mergeViewersWithLikers(
      [
        { id: "v1", name: "One", viewedAt: t(1), reaction: null as string | null },
        { id: "v2", name: "Two", viewedAt: t(3), reaction: "🔥" },
      ],
      [
        { id: "v2", name: "Two", likedAt: t(4) },
        { id: "v3", name: "Three", likedAt: t(2) },
      ],
      (l) => ({ id: l.id, name: l.name, viewedAt: l.likedAt, reaction: null }),
    );
    expect(merged.map((v) => [v.id, v.liked])).toEqual([
      ["v2", true],
      ["v3", true],
      ["v1", false],
    ]);
    expect(merged[0]!.reaction).toBe("🔥");
  });
});

describe("optimistic heart", () => {
  it("flips at once, then takes the server's answer or goes back on failure", () => {
    expect(optimisticStoryLike({ liked: false })).toEqual({ liked: true });
    expect(settleStoryLike({ liked: false }, { error: null, liked: true })).toEqual({ liked: true });
    expect(settleStoryLike({ liked: false }, { error: "rate_limited" })).toEqual({ liked: false });
    expect(settleStoryLike({ liked: true }, { error: "failed" })).toEqual({ liked: true });
  });
});

describe("expired stories take their likes with them", () => {
  it("StoryLike cascades with the story and with the account, in the schema and the migration", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model StoryLike {"), schema.indexOf("}", schema.indexOf("model StoryLike {")));
    expect(model).toContain("story Story @relation(fields: [storyId], references: [id], onDelete: Cascade)");
    expect(model).toContain("user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)");
    expect(model).toContain("@@unique([storyId, userId])");

    const sql = read("prisma/migrations/20261125120100_story_likes/migration.sql");
    expect(sql).toContain(
      `ALTER TABLE "StoryLike" ADD CONSTRAINT "StoryLike_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE`,
    );
    expect(sql).toContain(
      `ALTER TABLE "StoryLike" ADD CONSTRAINT "StoryLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE`,
    );
    expect(sql).toContain(`CREATE UNIQUE INDEX "StoryLike_storyId_userId_key" ON "StoryLike"("storyId", "userId");`);
    // Additive only: no statement (comments aside) drops anything.
    const statements = sql
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/\bDROP\b/);
    // The enum value is added in a migration of its own (Postgres can't use it in the transaction that adds it).
    expect(read("prisma/migrations/20261125120000_story_like_type/migration.sql")).toContain(
      `ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STORY_LIKE';`,
    );
  });

  it("the expiry sweep deletes the story rows themselves (likes and their notifications follow by cascade)", () => {
    const route = read("src/app/api/cron/expire-stories/route.ts");
    expect(route).toContain("prisma.story.deleteMany");
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("story        Story?           @relation(fields: [storyId], references: [id], onDelete: Cascade)");
  });
});
