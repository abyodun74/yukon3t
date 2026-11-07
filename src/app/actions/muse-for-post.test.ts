import { beforeEach, describe, expect, it, vi } from "vitest";

// getMuseForPost (actions/muse.ts): opening a Home video in the Muse viewer swaps the post for its Muse only when the
// post is that Muse's reshare, the viewer can see the post (getVisiblePostsWhere) and the Muse (published, or their
// own; nobody blocked either way). Anything else answers item: null and the viewer keeps showing the post.

const ME = "cme00000000001";
const RESHARER = "cresharer00001";
const MUSE_AUTHOR = "cmuseauthor001";
const POST = "cpost000000001";
const MUSE = "cmuse000000001";
const user = { id: ME, isAdmin: false };
const VISIBLE = { moderationStatus: "PUBLISHED", OR: [{ visibility: "PUBLIC" }] };

const postFindFirst = vi.fn();
const museRepostFindFirst = vi.fn();
const museFindUnique = vi.fn();
const isBlockedEitherWay = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedViewer: async () => user, requireVerifiedUser: async () => user }));
vi.mock("@/lib/post-visibility", () => ({ getVisiblePostsWhere: async () => VISIBLE }));
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
vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findFirst: (a: unknown) => postFindFirst(a) },
    museRepost: { findFirst: (a: unknown) => museRepostFindFirst(a) },
    muse: { findUnique: (a: unknown) => museFindUnique(a) },
    subscription: { findUnique: async () => null },
  },
}));

const { getMuseForPost } = await import("@/app/actions/muse");

function muse(overrides: Record<string, unknown> = {}) {
  return {
    id: MUSE,
    authorId: MUSE_AUTHOR,
    caption: "clip",
    mediaType: "VIDEO",
    videoUrl: "https://media.example/clip.mp4",
    videoThumbnailUrl: null,
    videoDurationSeconds: 20,
    embedProvider: null,
    embedId: null,
    audioUrl: null,
    moderationStatus: "PUBLISHED",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    likeCount: 3,
    commentCount: 1,
    shareCount: 0,
    repostCount: 1,
    viewCount: 9,
    sharedPostId: null,
    author: { id: MUSE_AUTHOR, name: "Ada", avatarUrl: null },
    reactions: [],
    reposts: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isBlockedEitherWay.mockResolvedValue(false);
  postFindFirst.mockResolvedValue({ authorId: RESHARER });
  museRepostFindFirst.mockResolvedValue({ museId: MUSE });
  museFindUnique.mockResolvedValue(muse());
});

describe("getMuseForPost", () => {
  it("returns the Muse a visible reshare post plays", async () => {
    const result = await getMuseForPost(POST);
    expect(result.error).toBeNull();
    expect(result.item).toMatchObject({ id: MUSE, videoUrl: "https://media.example/clip.mp4", likeCount: 3 });
    expect(postFindFirst).toHaveBeenCalledWith({ where: { id: POST, ...VISIBLE }, select: { authorId: true } });
    // Keyed on the resharer as well as the post: MuseRepost's (userId, museId) index.
    expect(museRepostFindFirst).toHaveBeenCalledWith({ where: { userId: RESHARER, postId: POST }, select: { museId: true } });
  });

  it("looks nothing else up for a post the viewer can't see", async () => {
    postFindFirst.mockResolvedValue(null);
    expect(await getMuseForPost(POST)).toEqual({ error: "not_found", item: null });
    expect(museRepostFindFirst).not.toHaveBeenCalled();
    expect(museFindUnique).not.toHaveBeenCalled();
  });

  it("answers no Muse for an ordinary video post", async () => {
    museRepostFindFirst.mockResolvedValue(null);
    expect(await getMuseForPost(POST)).toEqual({ error: null, item: null });
    expect(museFindUnique).not.toHaveBeenCalled();
  });

  it("hides a Muse no longer published from anyone but its author", async () => {
    museFindUnique.mockResolvedValue(muse({ moderationStatus: "FLAGGED" }));
    expect((await getMuseForPost(POST)).item).toBeNull();
  });

  it("hides a Muse whose author is blocked either way", async () => {
    isBlockedEitherWay.mockResolvedValue(true);
    expect((await getMuseForPost(POST)).item).toBeNull();
    expect(isBlockedEitherWay).toHaveBeenCalledWith(ME, MUSE_AUTHOR);
  });

  it("answers no Muse when the reshared Muse is gone", async () => {
    museFindUnique.mockResolvedValue(null);
    expect((await getMuseForPost(POST)).item).toBeNull();
  });
});
