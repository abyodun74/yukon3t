import { beforeEach, describe, expect, it, vi } from "vitest";

// Reposting a Story to Feed, Muse or a Circle (actions/story-reshare.ts, rules in src/lib/story-reshare.ts), against a
// mocked database: who may (view gate, blocks, the author's opt-out), what is copied, how a video is routed for the
// scan, the Feed audience, the Circle checks, idempotency and the author's notification.

const ME = "cme00000000001";
const AUTHOR = "cauthor0000001";
const STORY = "cstory00000001";
const CIRCLE = "ccircle0000001";

let user: { id: string; name: string | null; isAdmin: boolean; postsVisibility: string };
type StoryRow = {
  id: string;
  authorId: string;
  mediaType: "IMAGE" | "VIDEO" | "EMBED";
  mediaUrl: string | null;
  mediaThumbnailUrl: string | null;
  audioUrl?: string | null;
  videoDurationSeconds: number | null;
  embedProvider: string | null;
  embedId: string | null;
  caption: string | null;
  sharedPostId?: string | null;
  sharedMuseId?: string | null;
  isReshare?: boolean;
  author: { name: string | null; username: string | null; postsVisibility: string; allowStoryReposts: boolean };
};
let story: StoryRow | null;
let viewable: boolean;
let blocked: boolean;
// Users blocked either way with the caller beyond the Story's author (e.g. the author of the Muse a Story came from).
let blockedWith: Set<string>;

const postCreate = vi.fn();
const postFindUnique = vi.fn();
const museCreate = vi.fn();
const museFindUnique = vi.fn();
const notificationCreate = vi.fn();
const circleFindUnique = vi.fn();
const membershipFindUnique = vi.fn();
const channelFindMany = vi.fn();
const canAccessChannel = vi.fn();
const canViewPost = vi.fn();
const afterPostCreated = vi.fn();
const notifySubscribers = vi.fn();
const pushActivityNotification = vi.fn();
const createStreamCopy = vi.fn();
const checkRateLimit = vi.fn();
const isMembersOnlyPost = vi.fn();
// The server-side length read from the stored file (video-duration-server.ts) and the Story write that saves it.
const probeStoredVideoSeconds = vi.fn();
const storyUpdateMany = vi.fn();
// The post a shareToStory Story was made from (Story.sharedPostId), looked up by id.
let sharedPost: {
  id: string;
  authorId: string;
  visibility: string;
  moderationStatus: string;
  circleId: string | null;
  channelId: string | null;
} | null;
// The Muse a shareMuseToStory Story was made from (Story.sharedMuseId), looked up by id.
let sharedMuse: { id: string; authorId: string; moderationStatus: string } | null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (_a: string, b: string) => blocked || blockedWith.has(b),
  getBlockedEitherWayIds: async () => [],
}));
vi.mock("@/lib/profile-access-server", () => ({
  loadViewableStory: async (_viewer: string, id: string) =>
    viewable && story && id === story.id ? { id: story.id, authorId: story.authorId, expiresAt: new Date() } : null,
}));
vi.mock("@/lib/channel-permissions", () => ({ canAccessChannel: (...a: unknown[]) => canAccessChannel(...a) }));
vi.mock("@/lib/post-visibility", () => ({
  canViewPost: (...a: unknown[]) => canViewPost(...a),
  isMembersOnlyPost: (...a: unknown[]) => isMembersOnlyPost(...a),
}));
vi.mock("@/lib/post-created", () => ({ afterPostCreated: (...a: unknown[]) => afterPostCreated(...a) }));
vi.mock("@/lib/feed-category", () => ({
  classifyPostCategory: async () => ({ category: "GENERAL", embedding: null }),
}));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: (...a: unknown[]) => notifySubscribers(...a) }));
vi.mock("@/lib/notify-push", () => ({
  pushActivityNotification: (...a: unknown[]) => pushActivityNotification(...a),
}));
vi.mock("@/lib/cloudflare-stream", () => ({
  isStreamConfigured: () => true,
  createStreamCopy: (...a: unknown[]) => createStreamCopy(...a),
}));
vi.mock("@/lib/video-duration-server", () => ({
  probeStoredVideoSeconds: (...a: unknown[]) => probeStoredVideoSeconds(...a),
}));
vi.mock("@/lib/storage", () => ({
  HIVE_VIDEO_MODERATION_MAX_SECONDS: 59,
  MAX_MUSE_VIDEO_DURATION_SECONDS: 300,
  VIDEO_INSTANT_PUBLISH_MAX_SECONDS: 600,
}));
vi.mock("@/lib/prisma-errors", () => ({
  isUniqueConstraintError: (err: unknown) => (err as { code?: string } | null)?.code === "P2002",
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    story: {
      findUnique: async ({ where }: { where: { id: string } }) => (story && where.id === story.id ? story : null),
      updateMany: (a: unknown) => storyUpdateMany(a),
    },
    post: {
      create: (a: unknown) => postCreate(a),
      findUnique: (a: { where: { id?: string } }) =>
        a.where.id !== undefined ? (sharedPost && a.where.id === sharedPost.id ? sharedPost : null) : postFindUnique(a),
    },
    muse: {
      create: (a: unknown) => museCreate(a),
      findUnique: (a: { where: { id?: string } }) =>
        a.where.id !== undefined ? (sharedMuse && a.where.id === sharedMuse.id ? sharedMuse : null) : museFindUnique(a),
    },
    notification: { create: (a: unknown) => notificationCreate(a) },
    circle: { findUnique: (a: unknown) => circleFindUnique(a) },
    circleMembership: { findUnique: (a: unknown) => membershipFindUnique(a) },
    channel: { findMany: (a: unknown) => channelFindMany(a) },
  },
}));

const { getStoryReshareOptions, shareStoryToCircle, shareStoryToFeed, shareStoryToMuse } = await import(
  "@/app/actions/story-reshare"
);

function makeStory(over: Partial<StoryRow> = {}, author: Partial<StoryRow["author"]> = {}): StoryRow {
  return {
    id: STORY,
    authorId: AUTHOR,
    mediaType: "IMAGE",
    mediaUrl: "https://media.example.com/story-image/cauthor0000001/a.jpg",
    mediaThumbnailUrl: null,
    videoDurationSeconds: null,
    embedProvider: null,
    embedId: null,
    caption: "Sunset",
    ...over,
    author: { name: "Ada", username: "ada", postsVisibility: "PUBLIC", allowStoryReposts: true, ...author },
  };
}
const video = (seconds: number | null) =>
  makeStory({
    mediaType: "VIDEO",
    mediaUrl: "https://media.example.com/story-video/cauthor0000001/v.mp4",
    mediaThumbnailUrl: "https://media.example.com/video-thumb/cauthor0000001/v.jpg",
    videoDurationSeconds: seconds,
  });
const embed = () =>
  makeStory({ mediaType: "EMBED", mediaUrl: null, embedProvider: "YOUTUBE", embedId: "dQw4w9WgXcQ" });

/** The `data` of the one post.create / muse.create call. */
const postData = () => postCreate.mock.calls[0][0].data;
const museData = () => museCreate.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: ME, name: "Me", isAdmin: false, postsVisibility: "PUBLIC" };
  story = makeStory();
  viewable = true;
  blocked = false;
  checkRateLimit.mockResolvedValue(true);
  postFindUnique.mockResolvedValue(null);
  museFindUnique.mockResolvedValue(null);
  postCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "cpostcopy00001",
    authorId: data.authorId,
    circleId: data.circleId,
    channelId: data.channelId,
    visibility: data.visibility,
  }));
  museCreate.mockResolvedValue({ id: "cmusecopy00001" });
  canViewPost.mockResolvedValue(true);
  createStreamCopy.mockResolvedValue("stream-uid-1");
  isMembersOnlyPost.mockResolvedValue(false);
  sharedPost = null;
  sharedMuse = null;
  blockedWith = new Set();
  probeStoredVideoSeconds.mockResolvedValue(null);
  storyUpdateMany.mockResolvedValue({ count: 1 });
});

describe("who may repost", () => {
  it("refuses a Story the caller can't see (missing, expired or behind the author's profile rule)", async () => {
    viewable = false;
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_found" });
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "not_found" });
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_found" });
    expect(postCreate).not.toHaveBeenCalled();
    expect(museCreate).not.toHaveBeenCalled();
  });

  it("refuses an expired Story (loadViewableStory drops it) and an unknown id", async () => {
    viewable = false;
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_found" });
    viewable = true;
    expect(await shareStoryToFeed("cnope000000001")).toEqual({ error: "not_found" });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("answers blocked for a block either way with the author", async () => {
    blocked = true;
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "blocked" });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("refuses someone else's Story when its author turned reposting off", async () => {
    story = makeStory({}, { allowStoryReposts: false });
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "opted_out" });
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "opted_out" });
    story = { ...video(20), author: { ...video(20).author, allowStoryReposts: false } };
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "opted_out" });
    expect(postCreate).not.toHaveBeenCalled();
    expect(museCreate).not.toHaveBeenCalled();
  });

  it("always lets the author repost their own Story, opted out or not, with just their caption", async () => {
    story = { ...makeStory({ authorId: ME }, { allowStoryReposts: false }) };
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
    expect(postData().content).toBe("Sunset");
  });

  it("checks the rate limit (postCreate for Feed and Muse, shareToCircle for a Circle)", async () => {
    checkRateLimit.mockResolvedValue(false);
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "rate_limited" });
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith("postCreate", ME);
    expect(checkRateLimit).toHaveBeenCalledWith("shareToCircle", ME);
  });
});

describe("a Story made from someone's post (shareToStory)", () => {
  const POST = "csharedpost001";
  const OTHER = "cother00000001";
  const original = (over: Partial<NonNullable<typeof sharedPost>> = {}) => ({
    id: POST,
    authorId: OTHER,
    visibility: "PUBLIC",
    moderationStatus: "PUBLISHED",
    circleId: null,
    channelId: null,
    ...over,
  });

  it("reposts it when the reposter could reshare the original post themselves", async () => {
    story = makeStory({ sharedPostId: POST });
    sharedPost = original();
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
    expect(canViewPost).toHaveBeenCalledWith(POST, ME);
  });

  it("refuses it when the original's author and the reposter are blocked either way (canViewPost)", async () => {
    story = makeStory({ sharedPostId: POST });
    sharedPost = original();
    canViewPost.mockImplementation(async (postId: string) => postId !== POST);
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_shareable" });
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_shareable" });
    expect((await getStoryReshareOptions(STORY)).feed).toBe(false);
    expect(postCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["deleted", null],
    ["no longer published", original({ moderationStatus: "FLAGGED" })],
    ["narrowed to Friends-only", original({ visibility: "CONNECTIONS_ONLY" })],
  ])("refuses it when the original post is %s", async (_label, row) => {
    story = { ...video(20), sharedPostId: POST };
    sharedPost = row;
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_shareable" });
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "not_shareable" });
    expect(postCreate).not.toHaveBeenCalled();
    expect(museCreate).not.toHaveBeenCalled();
  });

  it("refuses it when the original is now members-only (its Circle went private)", async () => {
    story = makeStory({ sharedPostId: POST });
    sharedPost = original({ circleId: "ccirc", channelId: "cchan" });
    isMembersOnlyPost.mockResolvedValue(true);
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_shareable" });
  });

  it("always lets the reposter copy a Story made from their own post", async () => {
    story = makeStory({ sharedPostId: POST, isReshare: true });
    sharedPost = original({ authorId: ME, visibility: "CONNECTIONS_ONLY" });
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
  });
});

describe("a Story whose source was deleted (Story.isReshare, sharedPostId / sharedMuseId cleared by SetNull)", () => {
  it("refuses it everywhere instead of treating it as an original upload", async () => {
    story = { ...video(20), isReshare: true, sharedPostId: null, sharedMuseId: null };
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_shareable" });
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "not_shareable" });
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_shareable" });
    expect((await getStoryReshareOptions(STORY)).error).toBe("not_shareable");
    expect(postCreate).not.toHaveBeenCalled();
    expect(museCreate).not.toHaveBeenCalled();
  });

  it("refuses it for the Story's own author too (the source they reshared is gone)", async () => {
    story = makeStory({ authorId: ME, isReshare: true });
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_shareable" });
  });

  it("still lets an original upload (isReshare false) be reposted", async () => {
    story = makeStory({ isReshare: false, sharedPostId: null, sharedMuseId: null });
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
  });
});

describe("a Story made from a Muse (shareMuseToStory)", () => {
  const MUSE = "csharedmuse001";
  const MUSE_AUTHOR = "cmuseauthor001";
  const fromMuse = () => ({ ...video(20), isReshare: true, sharedMuseId: MUSE });

  it("reposts it while the Muse is live and its author isn't blocked with the reposter", async () => {
    story = fromMuse();
    sharedMuse = { id: MUSE, authorId: MUSE_AUTHOR, moderationStatus: "PUBLISHED" };
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
    expect((await shareStoryToMuse(STORY)).error).toBeNull();
  });

  it.each([
    ["deleted", null],
    ["held for review (FLAGGED)", { id: MUSE, authorId: MUSE_AUTHOR, moderationStatus: "FLAGGED" }],
    ["removed by moderation", { id: MUSE, authorId: MUSE_AUTHOR, moderationStatus: "REMOVED" }],
  ])("refuses it when the Muse is %s", async (_label, row) => {
    story = fromMuse();
    sharedMuse = row;
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_shareable" });
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "not_shareable" });
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_shareable" });
    expect(postCreate).not.toHaveBeenCalled();
    expect(museCreate).not.toHaveBeenCalled();
  });

  it("refuses it when the Muse's author and the reposter are blocked either way", async () => {
    story = fromMuse();
    sharedMuse = { id: MUSE, authorId: MUSE_AUTHOR, moderationStatus: "PUBLISHED" };
    blockedWith.add(MUSE_AUTHOR);
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_shareable" });
    expect((await getStoryReshareOptions(STORY)).feed).toBe(false);
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("refuses it when the Muse was deleted (sharedMuseId cleared, isReshare kept)", async () => {
    story = { ...fromMuse(), sharedMuseId: null };
    expect(await shareStoryToFeed(STORY)).toEqual({ error: "not_shareable" });
  });
});

describe("what is copied", () => {
  it("copies a photo into a Feed post crediting the author, never a reference to the Story", async () => {
    const result = await shareStoryToFeed(STORY);
    expect(result).toEqual({ error: null, postId: "cpostcopy00001", already: false });
    const data = postData();
    expect(data).toMatchObject({
      authorId: ME,
      mediaType: "IMAGE",
      mediaUrls: [story!.mediaUrl],
      content: "📸 Story by Ada\nSunset",
      moderationStatus: "PUBLISHED",
      circleId: null,
      channelId: null,
    });
    expect(data).not.toHaveProperty("storyId");
    expect(data).not.toHaveProperty("sharedStoryId");
    expect(afterPostCreated).toHaveBeenCalledWith(expect.objectContaining({ moderationStatus: "PUBLISHED" }));
  });

  it("refuses a photo for Muse", async () => {
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "unsupported_media" });
    expect(museCreate).not.toHaveBeenCalled();
  });

  it("measures a video Story with no stored length from its file, saves it, and routes the copy on it", async () => {
    story = video(null);
    probeStoredVideoSeconds.mockResolvedValue(90);
    await shareStoryToFeed(STORY);
    expect(probeStoredVideoSeconds).toHaveBeenCalledWith(story.mediaUrl);
    expect(storyUpdateMany).toHaveBeenCalledWith({
      where: { id: STORY, videoDurationSeconds: null },
      data: { videoDurationSeconds: 90 },
    });
    expect(postData()).toMatchObject({ videoDurationSeconds: 90, videoLongReviewNeeded: true, moderationStatus: "PUBLISHED" });
    const muse = await shareStoryToMuse(STORY);
    expect(muse).toMatchObject({ error: null, held: true });
    expect(museData()).toMatchObject({ videoDurationSeconds: 90, videoLongReviewNeeded: true, moderationStatus: "FLAGGED" });
  });

  it("never fails a repost because saving the measured length failed", async () => {
    story = video(null);
    probeStoredVideoSeconds.mockResolvedValue(30);
    storyUpdateMany.mockRejectedValue(new Error("db down"));
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
    expect(postData()).toMatchObject({ videoDurationSeconds: 30, videoModeratedAt: null });
  });

  it("copies a video whose length nothing could read to Feed and Circles for the moderate-videos cron, never to the long review", async () => {
    story = video(null);
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
    expect(postData()).toMatchObject({
      mediaType: "VIDEO",
      videoUrl: story.mediaUrl,
      videoDurationSeconds: null,
      // Left for the moderate-videos cron, which samples an unknown length conservatively and holds what it can't scan.
      videoModeratedAt: null,
      videoLongReviewNeeded: false,
      videoStreamUid: null,
      moderationStatus: "PUBLISHED",
    });
    expect(createStreamCopy).not.toHaveBeenCalled();
    expect(storyUpdateMany).not.toHaveBeenCalled();

    circleFindUnique.mockResolvedValue({ id: CIRCLE, slug: "runners", visibility: "PUBLIC", createdById: "cowner00000001" });
    membershipFindUnique.mockResolvedValue({ id: "m1" });
    channelFindMany.mockResolvedValue([{ id: "chGeneral", circleId: CIRCLE, visibility: "PUBLIC" }]);
    canAccessChannel.mockResolvedValue(true);
    expect((await shareStoryToCircle(STORY, CIRCLE)).error).toBeNull();
    expect(postCreate.mock.calls[1][0].data).toMatchObject({ videoDurationSeconds: null, videoModeratedAt: null });
  });

  it("keeps a video whose length nothing could read off Muse (createMuse and the Muse scans need a length)", async () => {
    story = video(null);
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "unsupported_media" });
    expect(museCreate).not.toHaveBeenCalled();
  });

  it("refuses a measured video longer than a Muse may be (too_long), still taking it on Feed", async () => {
    story = video(null);
    probeStoredVideoSeconds.mockResolvedValue(400);
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "too_long" });
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
    expect(postData()).toMatchObject({ videoDurationSeconds: 400, videoLongReviewNeeded: true, moderationStatus: "PUBLISHED" });
  });

  it("doesn't re-measure a video that already has its length, nor a photo or an embed", async () => {
    story = video(20);
    await shareStoryToFeed(STORY);
    story = makeStory();
    await shareStoryToFeed(STORY);
    story = embed();
    await shareStoryToFeed(STORY);
    expect(probeStoredVideoSeconds).not.toHaveBeenCalled();
  });

  it("leaves a video of 59s or less for the moderate-videos cron (videoModeratedAt null, no long review)", async () => {
    story = video(59);
    await shareStoryToFeed(STORY);
    expect(postData()).toMatchObject({
      mediaType: "VIDEO",
      videoUrl: story.mediaUrl,
      videoThumbnailUrl: story.mediaThumbnailUrl,
      videoDurationSeconds: 59,
      videoModeratedAt: null,
      videoLongReviewNeeded: false,
      moderationStatus: "PUBLISHED",
    });
    await shareStoryToMuse(STORY);
    expect(museData()).toMatchObject({ videoModeratedAt: null, videoLongReviewNeeded: false, moderationStatus: "PUBLISHED" });
    expect(createStreamCopy).not.toHaveBeenCalled();
  });

  it("sends a longer video to the long review: a Post publishes, a Muse waits FLAGGED, both get a Stream copy", async () => {
    story = video(90);
    await shareStoryToFeed(STORY);
    expect(postData()).toMatchObject({
      videoLongReviewNeeded: true,
      videoStreamUid: "stream-uid-1",
      moderationStatus: "PUBLISHED",
    });
    expect(postData().videoModeratedAt).toBeInstanceOf(Date);

    const muse = await shareStoryToMuse(STORY);
    expect(muse).toMatchObject({ error: null, held: true });
    expect(museData()).toMatchObject({
      mediaType: "VIDEO",
      videoLongReviewNeeded: true,
      videoStreamUid: "stream-uid-1",
      moderationStatus: "FLAGGED",
    });
    expect(museData().videoModeratedAt).toBeInstanceOf(Date);
    expect(createStreamCopy).toHaveBeenCalledTimes(2);
    expect(createStreamCopy).toHaveBeenCalledWith(story.mediaUrl);
    // A held Muse isn't announced to anyone yet.
    expect(notifySubscribers).not.toHaveBeenCalled();
  });

  it("copies an embed's provider and id to Feed and Muse", async () => {
    story = embed();
    await shareStoryToFeed(STORY);
    expect(postData()).toMatchObject({ mediaType: "EMBED", embedProvider: "YOUTUBE", embedId: "dQw4w9WgXcQ" });
    await shareStoryToMuse(STORY);
    expect(museData()).toMatchObject({
      mediaType: "EMBED",
      embedProvider: "YOUTUBE",
      embedId: "dQw4w9WgXcQ",
      moderationStatus: "PUBLISHED",
      caption: "📸 Story by Ada\nSunset",
    });
    expect(createStreamCopy).not.toHaveBeenCalled();
  });
});

describe("the Feed audience mirrors the profiles, never wider", () => {
  it.each([
    ["PUBLIC", "PUBLIC", "PUBLIC"],
    ["CONNECTIONS_ONLY", "PUBLIC", "CONNECTIONS_ONLY"],
    ["PUBLIC", "CONNECTIONS_ONLY", "CONNECTIONS_ONLY"],
    ["PUBLIC", "HIDDEN", "PRIVATE"],
  ])("author %s + reposter %s -> %s", async (authorVisibility, reposterVisibility, expected) => {
    story = makeStory({}, { postsVisibility: authorVisibility });
    user.postsVisibility = reposterVisibility;
    await shareStoryToFeed(STORY);
    expect(postData().visibility).toBe(expected);
  });

  it("uses only the reposter's own setting for their own Story", async () => {
    story = makeStory({ authorId: ME }, { postsVisibility: "CONNECTIONS_ONLY" });
    user.postsVisibility = "CONNECTIONS_ONLY";
    await shareStoryToFeed(STORY);
    expect(postData().visibility).toBe("CONNECTIONS_ONLY");
  });

  it("keeps someone else's Friends-only Story off Muse and out of Circles", async () => {
    story = { ...video(20), author: { ...video(20).author, postsVisibility: "CONNECTIONS_ONLY" } };
    expect(await shareStoryToMuse(STORY)).toEqual({ error: "not_shareable" });
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_shareable" });
    expect(museCreate).not.toHaveBeenCalled();
  });
});

describe("Post to a Circle", () => {
  const circle = (visibility: string) => ({ id: CIRCLE, slug: "runners", visibility, createdById: "cowner00000001" });

  it("refuses a non-member: not_a_member in a PUBLIC Circle, not_found in a PRIVATE one (it doesn't exist for them)", async () => {
    membershipFindUnique.mockResolvedValue(null);
    circleFindUnique.mockResolvedValue(circle("PUBLIC"));
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_a_member" });
    circleFindUnique.mockResolvedValue(circle("PRIVATE"));
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_found" });
    circleFindUnique.mockResolvedValue(null);
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_found" });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("posts into the first text channel the member may post in (canAccessChannel), stored PUBLIC", async () => {
    circleFindUnique.mockResolvedValue(circle("PRIVATE"));
    membershipFindUnique.mockResolvedValue({ id: "m1" });
    channelFindMany.mockResolvedValue([
      { id: "chPrivate", circleId: CIRCLE, visibility: "PRIVATE" },
      { id: "chGeneral", circleId: CIRCLE, visibility: "PUBLIC" },
    ]);
    canAccessChannel.mockImplementation(async (channel: { id: string }) => channel.id === "chGeneral");
    const result = await shareStoryToCircle(STORY, CIRCLE);
    expect(result).toEqual({ error: null, postId: "cpostcopy00001", already: false });
    expect(postData()).toMatchObject({
      circleId: CIRCLE,
      channelId: "chGeneral",
      visibility: "PUBLIC",
      clientRequestId: `story:${STORY}:circle:${CIRCLE}`,
    });
    expect(channelFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { circleId: CIRCLE, type: "TEXT" } }));
  });

  it("refuses a member with no channel they may post in", async () => {
    circleFindUnique.mockResolvedValue(circle("PUBLIC"));
    membershipFindUnique.mockResolvedValue({ id: "m1" });
    channelFindMany.mockResolvedValue([{ id: "chPrivate", circleId: CIRCLE, visibility: "PRIVATE" }]);
    canAccessChannel.mockResolvedValue(false);
    expect(await shareStoryToCircle(STORY, CIRCLE)).toEqual({ error: "not_a_member" });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("refuses a malformed Circle id", async () => {
    expect(await shareStoryToCircle(STORY, "")).toEqual({ error: "invalid" });
  });
});

describe("idempotency", () => {
  it("answers the copy already made for this reposter and destination, without a second one", async () => {
    postFindUnique.mockResolvedValue({ id: "cpostold000001" });
    expect(await shareStoryToFeed(STORY)).toEqual({ error: null, postId: "cpostold000001", already: true });
    expect(postFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorId_clientRequestId: { authorId: ME, clientRequestId: `story:${STORY}:feed` } } }),
    );
    museFindUnique.mockResolvedValue({ id: "cmuseold000001" });
    story = video(20);
    expect(await shareStoryToMuse(STORY)).toEqual({ error: null, museId: "cmuseold000001", already: true });
    expect(postCreate).not.toHaveBeenCalled();
    expect(museCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("resolves a raced duplicate (unique violation) to the copy that won", async () => {
    postFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "cpostwon000001" });
    postCreate.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await shareStoryToFeed(STORY)).toEqual({ error: null, postId: "cpostwon000001", already: true });
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("keys the copy on the reposter (each person gets their own) and the destination", async () => {
    await shareStoryToFeed(STORY);
    expect(postData()).toMatchObject({ authorId: ME, clientRequestId: `story:${STORY}:feed` });
    story = video(20);
    await shareStoryToMuse(STORY);
    expect(museData()).toMatchObject({ authorId: ME, clientRequestId: `story:${STORY}:muse` });
  });
});

describe("the original author's notification", () => {
  it("tells the author about someone else's copy (bell row + push to the copy)", async () => {
    await shareStoryToFeed(STORY);
    expect(notificationCreate).toHaveBeenCalledWith({
      data: { recipientId: AUTHOR, actorId: ME, type: "STORY_REPOST", postId: "cpostcopy00001" },
    });
    expect(pushActivityNotification).toHaveBeenCalledWith(AUTHOR, "STORY_REPOST", "Me", "/post/cpostcopy00001");

    vi.clearAllMocks();
    museCreate.mockResolvedValue({ id: "cmusecopy00001" });
    museFindUnique.mockResolvedValue(null);
    checkRateLimit.mockResolvedValue(true);
    story = video(20);
    await shareStoryToMuse(STORY);
    expect(notificationCreate).toHaveBeenCalledWith({
      data: { recipientId: AUTHOR, actorId: ME, type: "STORY_REPOST", museId: "cmusecopy00001" },
    });
    expect(pushActivityNotification).toHaveBeenCalledWith(AUTHOR, "STORY_REPOST", "Me", "/muse/cmusecopy00001");
    expect(notifySubscribers).toHaveBeenCalledWith(ME, "SUBSCRIPTION_MUSE", { museId: "cmusecopy00001" });
  });

  it("never notifies the author about their own repost", async () => {
    story = makeStory({ authorId: ME });
    await shareStoryToFeed(STORY);
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(pushActivityNotification).not.toHaveBeenCalled();
  });

  it("doesn't point the author at a copy they can't open", async () => {
    canViewPost.mockResolvedValue(false);
    await shareStoryToFeed(STORY);
    expect(canViewPost).toHaveBeenCalledWith("cpostcopy00001", AUTHOR);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("waits for a held Muse (nothing about a copy that isn't live)", async () => {
    story = video(90);
    await shareStoryToMuse(STORY);
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});

describe("a Story made from a Muse with a sound track (Story.audioUrl)", () => {
  const TRACK = "https://media.example.com/muse-audio/cmuseauthor001/t.mp3";
  const withTrack = () => ({ ...video(20), audioUrl: TRACK });

  it("keeps the track on a Muse copy (the same file)", async () => {
    story = withTrack();
    expect((await shareStoryToMuse(STORY)).error).toBeNull();
    expect(museData()).toMatchObject({ mediaType: "VIDEO", audioUrl: TRACK });
  });

  it("leaves it off a Feed or Circle copy (a Post has no audio field), and the sheet says so beforehand", async () => {
    story = withTrack();
    expect((await shareStoryToFeed(STORY)).error).toBeNull();
    expect(postData()).not.toHaveProperty("audioUrl");
    expect(await getStoryReshareOptions(STORY)).toMatchObject({ feed: true, muse: true, soundTrackNote: true });
  });

  it("a Muse copy of a Story without a track has none", async () => {
    story = video(20);
    await shareStoryToMuse(STORY);
    expect(museData().audioUrl ?? null).toBeNull();
  });
});

describe("getStoryReshareOptions", () => {
  it("offers Feed, Muse and a Circle for a public author's video, no Muse for a photo", async () => {
    story = video(20);
    expect(await getStoryReshareOptions(STORY)).toEqual({
      error: null,
      feed: true,
      muse: true,
      circle: true,
      reason: null,
      museBlocked: null,
      soundTrackNote: false,
    });
    story = makeStory();
    expect(await getStoryReshareOptions(STORY)).toEqual({
      error: null,
      feed: true,
      muse: false,
      circle: true,
      reason: null,
      museBlocked: null,
      soundTrackNote: false,
    });
  });

  it("offers Feed and Circles for a video of unknown length, with the Muse note; Muse once it is measured", async () => {
    story = video(null);
    expect(await getStoryReshareOptions(STORY)).toEqual({
      error: null,
      feed: true,
      muse: false,
      circle: true,
      reason: null,
      museBlocked: "length_unknown",
      soundTrackNote: false,
    });
    probeStoredVideoSeconds.mockResolvedValue(45);
    expect(await getStoryReshareOptions(STORY)).toMatchObject({ muse: true, museBlocked: null });
  });

  it("offers nothing when the author opted out, and passes a refusal through", async () => {
    story = makeStory({}, { allowStoryReposts: false });
    expect(await getStoryReshareOptions(STORY)).toEqual({
      error: null,
      feed: false,
      muse: false,
      circle: false,
      reason: "opted_out",
      museBlocked: null,
      soundTrackNote: false,
    });
    blocked = true;
    expect((await getStoryReshareOptions(STORY)).error).toBe("blocked");
  });
});
