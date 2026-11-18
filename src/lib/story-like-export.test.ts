import { beforeEach, describe, expect, it, vi } from "vitest";

// The "Story likes" part of "Export my data": likes given (whose story) and received (who liked mine), the other person
// named only by display name and username while ACTIVE and not blocked either way / a hidden peer, nothing else of
// theirs and nothing of the story beyond its id and time, likes involving a hidden peer left out of both queries, each
// list capped.
const ME = "me";
const SECRETS = { email: "leak@example.com", phone: "+15550100", birthDate: new Date("1990-01-01"), passwordHash: "x" };
const person = (id: string, status = "ACTIVE") => ({ id, name: `Name ${id}`, username: `${id}_u`, status, ...SECRETS });
const T = new Date("2026-11-18T10:00:00Z");

let blocks: { blockerId: string; blockedId: string }[] = [];
let given: unknown[] = [];
let received: unknown[] = [];
const calls: { where: Record<string, unknown>; select: Record<string, unknown>; take: number }[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    block: { findMany: async () => blocks },
    storyLike: {
      findMany: async (args: { where: Record<string, unknown>; select: Record<string, unknown>; take: number }) => {
        calls.push(args);
        return ("userId" in args.where && args.where.userId === ME ? given : received).slice(0, args.take);
      },
    },
  },
}));

const { loadStoryLikeExport, STORY_LIKE_EXPORT_LIMIT } = await import("@/lib/story-like-export");

const story = (id: string, author?: ReturnType<typeof person>) => ({
  id,
  createdAt: T,
  caption: "secret caption",
  mediaUrl: "https://media.example/secret.jpg",
  ...(author ? { author } : {}),
});

beforeEach(() => {
  blocks = [];
  given = [];
  received = [];
  calls.length = 0;
});

describe("loadStoryLikeExport", () => {
  it("lists likes given and received with the other person's public name only", async () => {
    given = [{ createdAt: T, story: story("s1", person("amy")) }];
    received = [{ createdAt: T, story: story("s2"), user: person("ben") }];
    const out = await loadStoryLikeExport(ME, { conversationIds: [], peerIds: [] });
    expect(out.given.items).toEqual([
      { story: { id: "s1", postedAt: T }, storyBy: { name: "Name amy", username: "amy_u" }, likedAt: T },
    ]);
    expect(out.received.items).toEqual([
      { story: { id: "s2", postedAt: T }, likedBy: { name: "Name ben", username: "ben_u" }, likedAt: T },
    ]);
    const text = JSON.stringify(out);
    for (const secret of ["leak@example.com", "+15550100", "secret caption", "secret.jpg", "passwordHash"]) {
      expect(text).not.toContain(secret);
    }
    // Exact selects: never a User row, never the story's media or caption.
    const personSelect = { select: { id: true, name: true, username: true, status: true } };
    expect(calls[0]!.select).toEqual({ createdAt: true, story: { select: { id: true, createdAt: true, author: personSelect } } });
    expect(calls[1]!.select).toEqual({ createdAt: true, story: { select: { id: true, createdAt: true } }, user: personSelect });
  });

  it("never names someone blocked either way or no longer active", async () => {
    blocks = [{ blockerId: "amy", blockedId: ME }];
    received = [
      { createdAt: T, story: story("s2"), user: person("amy") },
      { createdAt: T, story: story("s2"), user: person("cara", "DEACTIVATED") },
    ];
    const out = await loadStoryLikeExport(ME, { conversationIds: [], peerIds: [] });
    expect(out.received.items.map((i) => i.likedBy)).toEqual(["not_shown", "not_shown"]);
  });

  it("leaves likes on a hidden peer's story, or by a hidden peer, out of both queries", async () => {
    await loadStoryLikeExport(ME, { conversationIds: [], peerIds: ["hp"] });
    expect(calls[0]!.where).toEqual({ userId: ME, story: { authorId: { notIn: ["hp"] } } });
    expect(calls[1]!.where).toEqual({ story: { authorId: ME }, userId: { notIn: ["hp"] } });
  });

  it("asks only for its own likes when nothing is hidden", async () => {
    await loadStoryLikeExport(ME, { conversationIds: [], peerIds: [] });
    expect(calls[0]!.where).toEqual({ userId: ME });
    expect(calls[1]!.where).toEqual({ story: { authorId: ME } });
  });

  it("caps each list and says so", async () => {
    given = Array.from({ length: STORY_LIKE_EXPORT_LIMIT + 5 }, (_, i) => ({ createdAt: T, story: story(`s${i}`, person("amy")) }));
    const out = await loadStoryLikeExport(ME, { conversationIds: [], peerIds: [] });
    expect(out.given.items).toHaveLength(STORY_LIKE_EXPORT_LIMIT);
    expect(out.given.truncated).toBe(true);
    expect(out.received).toEqual({ items: [], truncated: false, limit: STORY_LIKE_EXPORT_LIMIT });
  });
});
