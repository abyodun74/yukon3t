import { beforeEach, describe, expect, it, vi } from "vitest";

// shareMuseToStory (actions/muse.ts): the Story it makes records the Muse it came from (Story.sharedMuseId, used only by
// the repost access checks in actions/story-reshare.ts, never rendered) and the durable Story.isReshare marker, so a
// repost of that Story stays tied to the Muse's own rules, and is refused once the Muse is gone.

const ME = "cme00000000001";
const MUSE_AUTHOR = "cmuseauthor001";
const MUSE = "cmuse000000001";
const user = { id: ME, name: "Me", isAdmin: false };

const museFindUnique = vi.fn();
const storyCreate = vi.fn();
const isBlockedEitherWay = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedViewer: async () => user, requireVerifiedUser: async () => user }));
vi.mock("@/lib/post-visibility", () => ({ getVisiblePostsWhere: async () => ({}) }));
vi.mock("@/lib/blocks", () => ({
  getBlockedEitherWayIds: async () => new Set(),
  isBlockedEitherWay: (a: string, b: string) => isBlockedEitherWay(a, b),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({ moderateMedia: vi.fn(), moderateText: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: {},
  HIVE_VIDEO_MODERATION_MAX_SECONDS: 60,
  MAX_STORY_VIDEO_SECONDS: 120,
  STORY_LIFETIME_MS: 86_400_000,
  verifyUploadedSize: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: vi.fn() }));
vi.mock("@/lib/cloudflare-stream", () => ({ isStreamConfigured: () => false, createStreamCopy: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    story: { create: (a: unknown) => storyCreate(a) },
    museShare: { create: async () => ({}) },
    muse: { update: async () => ({ shareCount: 4 }) },
  };
  return {
    prisma: {
      muse: { findUnique: (a: unknown) => museFindUnique(a) },
      notification: { create: async () => ({}) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

const { shareMuseToStory } = await import("@/app/actions/muse");

function muse(overrides: Record<string, unknown> = {}) {
  return {
    id: MUSE,
    authorId: MUSE_AUTHOR,
    caption: "clip",
    mediaType: "VIDEO",
    videoUrl: "https://media.example/clip.mp4",
    videoThumbnailUrl: "https://media.example/clip.jpg",
    videoDurationSeconds: 20,
    embedProvider: null,
    embedId: null,
    audioUrl: null,
    moderationStatus: "PUBLISHED",
    ...overrides,
  };
}

const storyData = () => storyCreate.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  isBlockedEitherWay.mockResolvedValue(false);
  storyCreate.mockResolvedValue({ id: "cstory00000001" });
});

describe("shareMuseToStory records its source for repost checks", () => {
  it("links a video Story to the Muse and marks it a reshare", async () => {
    museFindUnique.mockResolvedValue(muse());
    expect((await shareMuseToStory(MUSE)).error).toBeNull();
    expect(storyData()).toMatchObject({
      authorId: ME,
      mediaType: "VIDEO",
      mediaUrl: "https://media.example/clip.mp4",
      sharedMuseId: MUSE,
      isReshare: true,
    });
    // A Muse is never recorded as a post source.
    expect(storyData()).not.toHaveProperty("sharedPostId");
  });

  it("keeps the Muse's sound track on the Story (the same file) and answers no 'left out' flag", async () => {
    museFindUnique.mockResolvedValue(muse({ audioUrl: "https://media.example/track.mp3" }));
    const result = await shareMuseToStory(MUSE);
    expect(result).toEqual({ error: null, shareCount: 4 });
    expect(storyData()).toMatchObject({ mediaType: "VIDEO", audioUrl: "https://media.example/track.mp3" });
  });

  it("links an embed Story the same way", async () => {
    museFindUnique.mockResolvedValue(
      muse({ mediaType: "EMBED", videoUrl: null, embedProvider: "YOUTUBE", embedId: "dQw4w9WgXcQ" }),
    );
    expect((await shareMuseToStory(MUSE)).error).toBeNull();
    expect(storyData()).toMatchObject({ mediaType: "EMBED", sharedMuseId: MUSE, isReshare: true });
  });

  it("makes no Story from a held Muse or one whose author is blocked either way", async () => {
    museFindUnique.mockResolvedValue(muse({ moderationStatus: "FLAGGED" }));
    expect(await shareMuseToStory(MUSE)).toEqual({ error: "not_found" });
    museFindUnique.mockResolvedValue(muse());
    isBlockedEitherWay.mockResolvedValue(true);
    expect(await shareMuseToStory(MUSE)).toEqual({ error: "not_found" });
    expect(storyCreate).not.toHaveBeenCalled();
  });
});
