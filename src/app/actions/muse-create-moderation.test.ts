import { beforeEach, describe, expect, it, vi } from "vitest";

// createMuse's automated screen against a mocked database (owner decision 2026-11-22): only a must-delete category
// (sexual content involving minors) rejects a Muse and deletes its upload; anything else flagged in the caption or the
// still frame is stored FLAGGED with its media and a CONTENT_FLAGGED_FOR_REVIEW row, for an admin to decide.

const ME = "cme00000000001";
const user = { id: ME, name: "Me", isAdmin: false };
const moderateMediaChecks = vi.fn();
const moderateText = vi.fn();
const museCreate = vi.fn();
const auditCreate = vi.fn();
const deleteOwnedUploads = vi.fn();
const notifySubscribers = vi.fn();
const createStreamCopy = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user, requireVerifiedViewer: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({
  moderateMediaChecks: (a: unknown) => moderateMediaChecks(a),
  moderateText: (t: string) => moderateText(t),
}));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: { "muse-video": 1, "video-thumb": 1, "muse-audio": 1 },
  HIVE_VIDEO_MODERATION_MAX_SECONDS: 60,
  MAX_STORY_VIDEO_SECONDS: 60,
  STORY_LIFETIME_MS: 86_400_000,
  verifyUploadedSize: async () => true,
  keyFromPublicUrl: (url: string) => url.split("/").pop(),
}));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: (...a: unknown[]) => deleteOwnedUploads(...a) }));
vi.mock("@/lib/cloudflare-stream", () => ({
  isStreamConfigured: () => true,
  createStreamCopy: (...a: unknown[]) => createStreamCopy(...a),
}));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: (...a: unknown[]) => notifySubscribers(...a) }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    muse: { create: (...a: unknown[]) => museCreate(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

const { createMuse } = await import("./muse");

const VIDEO = "https://media.example/u/m.mp4";
const FRAME = "https://media.example/u/m.jpg";

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("videoUrl", VIDEO);
  fd.set("videoThumbnailUrl", FRAME);
  fd.set("videoDurationSeconds", "20");
  fd.set("caption", "my clip");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ok = (source: string) => ({ source, result: { allowed: true, flaggedCategories: [] } });
const flagged = (source: string, ...categories: string[]) => ({ source, result: { allowed: false, flaggedCategories: categories } });

beforeEach(() => {
  vi.clearAllMocks();
  museCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "cmuse1", ...data }));
  auditCreate.mockResolvedValue({});
  moderateText.mockResolvedValue({ allowed: true, flaggedCategories: [] });
});

describe("createMuse: automated screen", () => {
  it("publishes a clean Muse", async () => {
    moderateMediaChecks.mockResolvedValue([ok("caption"), ok("video frame")]);
    expect(await createMuse(form())).toEqual({ error: null, museId: "cmuse1" });
    expect(museCreate.mock.calls[0][0].data.moderationStatus).toBe("PUBLISHED");
    expect(deleteOwnedUploads).not.toHaveBeenCalled();
    expect(notifySubscribers).toHaveBeenCalled();
  });

  it("holds a flagged frame for an admin: stored FLAGGED with its media, audit row, never deleted", async () => {
    moderateMediaChecks.mockResolvedValue([ok("caption"), flagged("video frame", "violence/graphic")]);
    expect(await createMuse(form())).toEqual({ error: null, museId: "cmuse1", held: true });
    const data = museCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ moderationStatus: "FLAGGED", videoUrl: VIDEO, videoLongReviewNeeded: false });
    expect(data.videoModeratedAt).toBeInstanceOf(Date);
    expect(deleteOwnedUploads).not.toHaveBeenCalled();
    expect(notifySubscribers).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CONTENT_FLAGGED_FOR_REVIEW",
        performedBy: "system:media-moderation-hold",
        reason: expect.stringContaining("(muse:cmuse1, VIDEO): video frame: violence/graphic"),
      }),
    });
  });

  it("holds a long Muse whose frame was flagged without starting the long-video review", async () => {
    moderateMediaChecks.mockResolvedValue([flagged("caption", "hate")]);
    await createMuse(form({ videoDurationSeconds: "200" }));
    expect(museCreate.mock.calls[0][0].data).toMatchObject({ moderationStatus: "FLAGGED", videoLongReviewNeeded: false });
    expect(createStreamCopy).not.toHaveBeenCalled();
  });

  it("rejects sexual content involving minors at once and deletes the upload (the one automatic deletion)", async () => {
    moderateMediaChecks.mockResolvedValue([ok("caption"), flagged("video frame", "sexual", "sexual/minors")]);
    expect(await createMuse(form())).toEqual({ error: "moderation" });
    expect(museCreate).not.toHaveBeenCalled();
    expect(deleteOwnedUploads).toHaveBeenCalledWith([VIDEO, FRAME], ME);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CONTENT_REMOVED", performedBy: "system:media-moderation-reject" }),
    });
  });

  it("an embed Muse with a flagged caption is held, not refused", async () => {
    moderateText.mockResolvedValue({ allowed: false, flaggedCategories: ["hate"] });
    const fd = new FormData();
    fd.set("mediaType", "EMBED");
    fd.set("embedUrl", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    fd.set("caption", "caption");
    expect(await createMuse(fd)).toEqual({ error: null, museId: "cmuse1", held: true });
    expect(museCreate.mock.calls[0][0].data.moderationStatus).toBe("FLAGGED");
    expect(notifySubscribers).not.toHaveBeenCalled();
  });

  it("accepts an embed Muse with no duration (share-target-gate sends none)", async () => {
    const fd = new FormData();
    fd.set("mediaType", "EMBED");
    fd.set("embedUrl", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(await createMuse(fd)).toEqual({ error: null, museId: "cmuse1" });
    expect(museCreate.mock.calls[0][0].data).toMatchObject({ mediaType: "EMBED", moderationStatus: "PUBLISHED" });
  });

  it("still refuses a video Muse with no duration", async () => {
    const fd = form();
    fd.delete("videoDurationSeconds");
    expect(await createMuse(fd)).toEqual({ error: "invalid" });
    expect(museCreate).not.toHaveBeenCalled();
  });
});
