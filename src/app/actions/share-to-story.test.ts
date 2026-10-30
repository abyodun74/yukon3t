import { beforeEach, describe, expect, it, vi } from "vitest";

// shareToStory (actions/shares.ts), audit M3 (2026-10-29): someone else's Friends-only or Private post can't be put on
// your Story (your connections aren't its audience); a PUBLIC post can, and an author can share their own.

const ME = "cme00000000001";
const AUTHOR = "cauthor0000001";
const user = { id: ME, email: "me@example.com", isAdmin: false };
const postFindUnique = vi.fn();
const storyCreate = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({ moderateText: vi.fn() }));
vi.mock("@/lib/channel-permissions", () => ({ canAccessChannel: vi.fn() }));
vi.mock("@/lib/post-visibility", () => ({ canViewPost: async () => true, isMembersOnlyPost: async () => false }));
vi.mock("@/lib/cloudflare-stream", () => ({ isStreamConfigured: () => false, createStreamCopy: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  STORY_LIFETIME_MS: 86_400_000,
  HIVE_VIDEO_MODERATION_MAX_SECONDS: 60,
  MAX_MUSE_VIDEO_DURATION_SECONDS: 300,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    story: { create: (a: unknown) => storyCreate(a) },
    share: { create: async () => ({}) },
    post: { update: async () => ({ shareCount: 1 }) },
    notification: { create: async () => ({}) },
  };
  return {
    prisma: {
      post: { findUnique: (a: unknown) => postFindUnique(a) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

const { shareToStory } = await import("@/app/actions/shares");

function post(visibility: string, authorId = AUTHOR) {
  return {
    id: "cpost000000001",
    authorId,
    visibility,
    moderationStatus: "PUBLISHED",
    repostOfId: null,
    mediaType: "IMAGE",
    mediaUrls: ["https://media.example.com/post-image/x/p.jpg"],
    content: "hi",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storyCreate.mockResolvedValue({ id: "cstory00000001" });
});

describe("shareToStory visibility", () => {
  it.each(["CONNECTIONS_ONLY", "PRIVATE"])("refuses someone else's %s post", async (visibility) => {
    postFindUnique.mockResolvedValue(post(visibility));
    expect(await shareToStory("cpost000000001")).toEqual({ error: "not_shareable" });
    expect(storyCreate).not.toHaveBeenCalled();
  });

  it("shares a PUBLIC post", async () => {
    postFindUnique.mockResolvedValue(post("PUBLIC"));
    expect((await shareToStory("cpost000000001")).error).toBeNull();
    expect(storyCreate).toHaveBeenCalled();
  });

  it("lets the author share their own Friends-only post", async () => {
    postFindUnique.mockResolvedValue(post("CONNECTIONS_ONLY", ME));
    expect((await shareToStory("cpost000000001")).error).toBeNull();
  });
});
