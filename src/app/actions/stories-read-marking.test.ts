import { beforeEach, describe, expect, it, vi } from "vitest";

// viewStory clears the viewer's "<name> added a new story" bell rows (SUBSCRIPTION_STORY, one per story) for the story
// just viewed, however it was reached. Regression (2026-11): rows were only cleared by tapping them or by visiting their
// exact /u/<author>?story=<id> URL (markReadByTarget), so stories watched from the Home tray, or swiped on to inside
// the viewer after the first one, left their rows (and the bell badge) unread for good.

const ME = "cme00000000001";
const OTHER_VIEWER = "cother00000001";
const AUTHOR = "cauthor0000001";
const AUTHOR_B = "cauthorb000001";
const user = { id: ME, name: "Me", isAdmin: false };

type Row = { id: string; recipientId: string; type: string; storyId: string | null; readAt: Date | null };
let rows: Row[] = [];
const stories: Record<string, { id: string; authorId: string }> = {
  s1: { id: "s1", authorId: AUTHOR },
  s2: { id: "s2", authorId: AUTHOR },
  s3: { id: "s3", authorId: AUTHOR },
  s9: { id: "s9", authorId: AUTHOR_B },
  mine: { id: "mine", authorId: ME },
  mine2: { id: "mine2", authorId: ME },
};
const notifyBadgeChange = vi.fn();
const storyViewUpsert = vi.fn();

function matches(row: Row, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (value && typeof value === "object" && "in" in value) return (value as { in: unknown[] }).in.includes(actual);
    return actual === value;
  });
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user, requireVerifiedViewer: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({ moderateText: vi.fn(), moderateMedia: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: {},
  STORY_LIFETIME_MS: 86_400_000,
  verifyUploadedSize: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({
  notifyBadgeChange: (id: string) => notifyBadgeChange(id),
  publishEvent: vi.fn(),
  publishEvents: vi.fn(),
}));
vi.mock("@/lib/profile-access-server", () => ({
  loadViewableStory: async (_viewerId: string, storyId: string) => stories[storyId] ?? null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    storyView: { upsert: async (args: unknown) => storyViewUpsert(args) },
    notification: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { readAt: Date } }) => {
        let count = 0;
        for (const row of rows) {
          if (matches(row, where)) {
            row.readAt = data.readAt;
            count += 1;
          }
        }
        return { count };
      },
    },
  },
}));

const { viewStory } = await import("@/app/actions/stories");

const unread = (recipientId: string) => rows.filter((r) => r.recipientId === recipientId && !r.readAt).map((r) => r.id);

beforeEach(() => {
  vi.clearAllMocks();
  rows = [
    // AUTHOR posted three stories in a row: three rows for me.
    { id: "n1", recipientId: ME, type: "SUBSCRIPTION_STORY", storyId: "s1", readAt: null },
    { id: "n2", recipientId: ME, type: "SUBSCRIPTION_STORY", storyId: "s2", readAt: null },
    { id: "n3", recipientId: ME, type: "SUBSCRIPTION_STORY", storyId: "s3", readAt: null },
    // Someone else's story, someone else's row for the same story, and an unrelated row about s1 that isn't mine.
    { id: "n9", recipientId: ME, type: "SUBSCRIPTION_STORY", storyId: "s9", readAt: null },
    { id: "nx", recipientId: OTHER_VIEWER, type: "SUBSCRIPTION_STORY", storyId: "s1", readAt: null },
    { id: "nc", recipientId: AUTHOR, type: "STORY_COMMENT", storyId: "s1", readAt: null },
    // My own story "mine": likes, a comment and a screenshot notice on it, one like on another of my stories, and a
    // row of someone else's about it.
    { id: "ml", recipientId: ME, type: "STORY_LIKE", storyId: "mine", readAt: null },
    { id: "mc", recipientId: ME, type: "STORY_COMMENT", storyId: "mine", readAt: null },
    { id: "ms", recipientId: ME, type: "SCREENSHOT_TAKEN", storyId: "mine", readAt: null },
    { id: "mo", recipientId: ME, type: "STORY_LIKE", storyId: "mine2", readAt: null },
    { id: "mx", recipientId: OTHER_VIEWER, type: "SUBSCRIPTION_STORY", storyId: "mine", readAt: null },
  ];
});

describe("viewStory clears the story's bell rows", () => {
  it("viewing only some of an author's stories leaves the rest unread", async () => {
    expect((await viewStory("s1")).error).toBeNull();
    expect((await viewStory("s2")).error).toBeNull();
    expect(unread(ME)).toEqual(["n3", "n9", "ml", "mc", "ms", "mo"]);
    expect(storyViewUpsert).toHaveBeenCalledTimes(2);
  });

  it("viewing the last unviewed one clears the whole set, and nothing of anyone else's", async () => {
    await viewStory("s1");
    await viewStory("s2");
    await viewStory("s3");
    expect(unread(ME)).toEqual(["n9", "ml", "mc", "ms", "mo"]);
    expect(unread(OTHER_VIEWER)).toEqual(["nx", "mx"]);
    expect(unread(AUTHOR)).toEqual(["nc"]);
  });

  it("signals the viewer's badges when a row cleared, and stays quiet on a re-view", async () => {
    await viewStory("s1");
    expect(notifyBadgeChange).toHaveBeenCalledTimes(1);
    expect(notifyBadgeChange).toHaveBeenCalledWith(ME);
    await viewStory("s1");
    expect(notifyBadgeChange).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a story the caller can't see", async () => {
    expect((await viewStory("gone")).error).toBe("not_found");
    expect(storyViewUpsert).not.toHaveBeenCalled();
    expect(unread(ME)).toHaveLength(8);
    expect(notifyBadgeChange).not.toHaveBeenCalled();
  });

  it("the author opening their own story clears its like, comment and screenshot rows only, with no view row", async () => {
    expect((await viewStory("mine")).error).toBeNull();
    expect(storyViewUpsert).not.toHaveBeenCalled();
    expect(unread(ME)).toEqual(["n1", "n2", "n3", "n9", "mo"]);
    expect(unread(OTHER_VIEWER)).toEqual(["nx", "mx"]);
    expect(notifyBadgeChange).toHaveBeenCalledTimes(1);
    expect(notifyBadgeChange).toHaveBeenCalledWith(ME);
    await viewStory("mine");
    expect(notifyBadgeChange).toHaveBeenCalledTimes(1);
  });
});
