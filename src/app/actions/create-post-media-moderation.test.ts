import { beforeEach, describe, expect, it, vi } from "vitest";

// createPost (actions/circles.ts) for photo/video posts against a mocked database and storage: what the automated
// screen and the upload check do to a post (publish / hold for an admin / reject), and that a failure on our side is
// never reported as a content-guidelines rejection.

const ME = "cme00000000001";
const R2 = "https://media.example.com";
const VIDEO_URL = `${R2}/post-video/${ME}/v1.mp4`;
const THUMB_URL = `${R2}/video-thumb/${ME}/t1.jpg`;

type Check = { source: string; result: { allowed: boolean; flaggedCategories: string[]; apiError?: string } };

const user = { id: ME, email: "me@example.com", isAdmin: false };
const moderateMediaChecks = vi.fn<(input: unknown) => Promise<Check[]>>();
const moderateText = vi.fn();
const checkUploadedSize = vi.fn<(input: { key: string }) => Promise<string>>();
const deleteOwnedObject = vi.fn();
const postCreate = vi.fn();
const auditLogCreate = vi.fn();
const afterPostCreated = vi.fn();
const createStreamCopy = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user, requireUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/device-id", () => ({ getDeviceId: async () => null, getDeviceLabel: async () => "test" }));
vi.mock("@/lib/device-trust", () => ({
  evaluateDevice: async () => ({ status: "known" }),
  trustDevice: vi.fn(),
  touchKnownDevice: vi.fn(),
}));
vi.mock("@/lib/device-challenge", () => ({ createDeviceChallenge: vi.fn(), verifyDeviceChallenge: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  moderateText: (t: string) => moderateText(t),
  moderateImage: vi.fn(),
  moderateMediaChecks: (input: unknown) => moderateMediaChecks(input),
}));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    MEDIA_LIMITS: { "post-image": 1, "post-video": 1, "video-thumb": 1, "circle-cover": 1 },
    HIVE_VIDEO_MODERATION_MAX_SECONDS: 60,
    VIDEO_INSTANT_PUBLISH_MAX_SECONDS: 600,
    verifyUploadedSize: vi.fn(),
    checkUploadedSize: (input: { key: string }) => checkUploadedSize(input),
    worstUploadedSizeCheck: actual.worstUploadedSizeCheck,
    deleteObject: vi.fn(),
    deleteOwnedObject: (...a: unknown[]) => deleteOwnedObject(...a),
    keyFromPublicUrl: (url: string) => (url.startsWith(R2) ? url.slice(R2.length + 1) : null),
  };
});
vi.mock("@/lib/cloudflare-stream", () => ({
  isStreamConfigured: () => true,
  createStreamCopy: (url: string) => createStreamCopy(url),
}));
vi.mock("@/lib/feed-category", () => ({
  classifyPostCategory: async () => ({ category: "GENERAL", embedding: null }),
}));
vi.mock("@/lib/post-created", () => ({ afterPostCreated: (a: unknown) => afterPostCreated(a) }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateCircleEmbedding: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(), notifyBadgeChange: vi.fn() }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: vi.fn() }));
vi.mock("@/lib/blocks", () => ({ isBlockedWithAny: async () => false }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: {
      findUnique: async () => null,
      create: (args: { data: Record<string, unknown> }) => postCreate(args),
    },
    auditLog: { create: (args: unknown) => auditLogCreate(args) },
    $transaction: async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
  },
}));

const { createPost } = await import("@/app/actions/circles");

function videoPost(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("content", "my screen recording");
  fd.set("mediaType", "VIDEO");
  fd.set("videoUrl", VIDEO_URL);
  fd.set("videoThumbnailUrl", THUMB_URL);
  fd.set("videoDurationSeconds", "20");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

const clean = (): Check[] => [
  { source: "caption", result: { allowed: true, flaggedCategories: [] } },
  { source: "video frame", result: { allowed: true, flaggedCategories: [] } },
];

beforeEach(() => {
  vi.clearAllMocks();
  checkUploadedSize.mockResolvedValue("ok");
  moderateMediaChecks.mockResolvedValue(clean());
  postCreate.mockImplementation(async ({ data }) => ({ id: "cpost0000000001", ...data }));
  createStreamCopy.mockResolvedValue("stream-uid");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createPost: photo/video screening", () => {
  it("publishes a clean video", async () => {
    const result = await createPost(videoPost());
    expect(result).toEqual({ error: null });
    expect(postCreate.mock.calls[0][0].data.moderationStatus).toBe("PUBLISHED");
    expect(auditLogCreate).not.toHaveBeenCalled();
    expect(deleteOwnedObject).not.toHaveBeenCalled();
  });

  it("holds a video whose frame is flagged: stored hidden, media kept, audit row names the post", async () => {
    moderateMediaChecks.mockResolvedValue([
      { source: "caption", result: { allowed: true, flaggedCategories: [] } },
      { source: "video frame", result: { allowed: false, flaggedCategories: ["violence"] } },
    ]);
    const result = await createPost(videoPost());
    expect(result).toEqual({ error: null, held: true });
    const data = postCreate.mock.calls[0][0].data;
    expect(data.moderationStatus).toBe("FLAGGED");
    expect(data.videoUrl).toBe(VIDEO_URL);
    expect(deleteOwnedObject).not.toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetId: ME,
        action: "CONTENT_FLAGGED_FOR_REVIEW",
        performedBy: "system:media-moderation-hold",
        reason: expect.stringContaining("(post:cpost0000000001, VIDEO): video frame: violence"),
      }),
    });
    // Nothing fanned out for a hidden post beyond what afterPostCreated does for FLAGGED (it skips notifications).
    expect(afterPostCreated).toHaveBeenCalledWith(expect.objectContaining({ moderationStatus: "FLAGGED" }));
  });

  it("holds (does not reject) a video when only the caption is flagged", async () => {
    moderateMediaChecks.mockResolvedValue([
      { source: "caption", result: { allowed: false, flaggedCategories: ["harassment"] } },
      { source: "video frame", result: { allowed: true, flaggedCategories: [] } },
    ]);
    const result = await createPost(videoPost());
    expect(result).toEqual({ error: null, held: true });
    expect(deleteOwnedObject).not.toHaveBeenCalled();
  });

  it("a held long video waits for the admin: no long-video review that could publish it on its own", async () => {
    moderateMediaChecks.mockResolvedValue([
      { source: "caption", result: { allowed: true, flaggedCategories: [] } },
      { source: "video frame", result: { allowed: false, flaggedCategories: ["violence"] } },
    ]);
    await createPost(videoPost({ videoDurationSeconds: "120" }));
    const data = postCreate.mock.calls[0][0].data;
    expect(data.videoLongReviewNeeded).toBe(false);
    expect(data.videoModeratedAt).toBeInstanceOf(Date);
    expect(createStreamCopy).not.toHaveBeenCalled();
  });

  it("a clean long video still gets the long-video review", async () => {
    await createPost(videoPost({ videoDurationSeconds: "120" }));
    expect(postCreate.mock.calls[0][0].data.videoLongReviewNeeded).toBe(true);
    expect(createStreamCopy).toHaveBeenCalledWith(VIDEO_URL);
  });

  it("rejects and deletes at once anything in a must-delete category, keeping only a record without media", async () => {
    moderateMediaChecks.mockResolvedValue([
      { source: "caption", result: { allowed: true, flaggedCategories: [] } },
      { source: "video frame", result: { allowed: false, flaggedCategories: ["sexual", "sexual/minors"] } },
    ]);
    const result = await createPost(videoPost());
    expect(result).toEqual({ error: "moderation" });
    expect(postCreate).not.toHaveBeenCalled();
    expect(deleteOwnedObject).toHaveBeenCalledWith(`post-video/${ME}/v1.mp4`, ME);
    expect(deleteOwnedObject).toHaveBeenCalledWith(`video-thumb/${ME}/t1.jpg`, ME);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetId: ME,
        action: "CONTENT_REMOVED",
        performedBy: "system:media-moderation-reject",
        reason: expect.not.stringContaining("post:"),
      }),
    });
  });

  it("a moderation API failure is not a guidelines rejection: the post goes through (fails open, as before)", async () => {
    moderateMediaChecks.mockResolvedValue([
      { source: "caption", result: { allowed: true, flaggedCategories: ["moderation_api_error"], apiError: "unavailable" } },
      { source: "video frame", result: { allowed: true, flaggedCategories: ["moderation_api_error"], apiError: "rejected" } },
    ]);
    const result = await createPost(videoPost());
    expect(result).toEqual({ error: null });
    expect(postCreate.mock.calls[0][0].data.moderationStatus).toBe("PUBLISHED");
  });
});

describe("createPost: upload check", () => {
  it("R2 unreachable: a retry message, nothing deleted, no moderation verdict", async () => {
    checkUploadedSize.mockImplementation(async ({ key }) => (key.startsWith("post-video") ? "unavailable" : "ok"));
    const result = await createPost(videoPost());
    expect(result).toEqual({ error: "upload_check_failed" });
    expect(deleteOwnedObject).not.toHaveBeenCalled();
    expect(moderateMediaChecks).not.toHaveBeenCalled();
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("upload not found (never finished): the same retry message", async () => {
    checkUploadedSize.mockImplementation(async ({ key }) => (key.startsWith("video-thumb") ? "missing" : "ok"));
    expect(await createPost(videoPost())).toEqual({ error: "upload_check_failed" });
  });

  it("a real size problem is still too_large, and the uploads are cleaned up", async () => {
    checkUploadedSize.mockImplementation(async ({ key }) => (key.startsWith("post-video") ? "too_large" : "unavailable"));
    expect(await createPost(videoPost())).toEqual({ error: "too_large" });
    expect(deleteOwnedObject).toHaveBeenCalled();
  });
});
