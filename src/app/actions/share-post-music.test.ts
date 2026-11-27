import { beforeEach, describe, expect, it, vi } from "vitest";

// Post music (src/lib/post-music.ts) on the share paths that copy a post's media file (actions/shares.ts): a video
// whose author replaced its sound with built-in music never goes to a Story or to Muse, which would play the file's
// original sound. A photo post with music still goes to a Story (as the photo).

const ME = "cme00000000001";
const user = { id: ME, email: "me@example.com", isAdmin: false };
const postFindUnique = vi.fn();
const storyCreate = vi.fn();
const museCreate = vi.fn();

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
vi.mock("@/lib/like-groups", () => ({
  likeGroupForNewMember: () => null,
  lockLikeGroup: vi.fn(),
  inheritGroupLikers: vi.fn(),
  recomputeLikeGroup: vi.fn(),
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    story: { create: (a: unknown) => storyCreate(a) },
    muse: { create: (a: unknown) => museCreate(a) },
    share: { create: async () => ({}) },
    post: { update: async () => ({ shareCount: 1 }), updateMany: async () => ({ count: 1 }) },
    notification: { create: async () => ({}) },
  };
  return {
    prisma: {
      post: { findUnique: (a: unknown) => postFindUnique(a) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

const { shareToStory, shareToMuse } = await import("@/app/actions/shares");

function video(musicTrack: string | null) {
  return {
    id: "cpost000000001",
    authorId: ME,
    visibility: "PUBLIC",
    moderationStatus: "PUBLISHED",
    repostOfId: null,
    likeGroupId: null,
    mediaType: "VIDEO",
    mediaUrls: [],
    videoUrl: "https://media.example.com/post-video/x/v.mp4",
    videoThumbnailUrl: "https://media.example.com/video-thumb/x/v.jpg",
    videoDurationSeconds: 20,
    content: "hi",
    musicTrack,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storyCreate.mockResolvedValue({ id: "cstory00000001" });
  museCreate.mockResolvedValue({ id: "cmuse000000001" });
});

describe("sharing a post with music", () => {
  it("keeps a music video out of Story and Muse", async () => {
    postFindUnique.mockResolvedValue(video("groove"));
    expect(await shareToStory("cpost000000001")).toEqual({ error: "music_video" });
    expect(await shareToMuse("cpost000000001")).toEqual({ error: "music_video" });
    expect(storyCreate).not.toHaveBeenCalled();
    expect(museCreate).not.toHaveBeenCalled();
  });

  it("still shares the same video without music, and one whose track was removed from the catalogue", async () => {
    for (const musicTrack of [null, "a-track-removed-later"]) {
      postFindUnique.mockResolvedValue(video(musicTrack));
      expect((await shareToStory("cpost000000001")).error).toBeNull();
      expect((await shareToMuse("cpost000000001")).error).toBeNull();
    }
  });

  it("shares a photo post with music to a Story as the photo", async () => {
    postFindUnique.mockResolvedValue({
      ...video("sunrise"),
      mediaType: "IMAGE",
      videoUrl: null,
      mediaUrls: ["https://media.example.com/post-image/x/p.jpg"],
    });
    expect((await shareToStory("cpost000000001")).error).toBeNull();
    expect(storyCreate.mock.calls[0][0].data).toMatchObject({ mediaType: "IMAGE" });
  });
});
