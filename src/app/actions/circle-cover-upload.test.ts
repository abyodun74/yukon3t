import { beforeEach, describe, expect, it, vi } from "vitest";

// confirmCircleCoverUpload (actions/circles.ts): the key must be the caller's own `circle-cover/` upload, the stored
// URL is derived from the key (a client URL is ignored), the stored object is what gets moderated, and the previous
// cover is deleted only when it is a `circle-cover/` object no other Circle uses. Audit H1 (2026-10-29).

const ME = "cme00000000001";
const OTHER = "cother00000001";
const CIRCLE = "ccircle0000001";
const R2 = "https://media.example.com";

const user = { id: ME, email: "me@example.com", isAdmin: false };
const verifyUploadedSize = vi.fn();
const deleteObject = vi.fn();
const moderateImage = vi.fn();
const circleFindUnique = vi.fn();
const circleUpdate = vi.fn();
const circleCount = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user, requireUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/device-id", () => ({ getDeviceId: async () => null, getDeviceLabel: async () => "test" }));
vi.mock("@/lib/device-trust", () => ({ evaluateDevice: vi.fn(), trustDevice: vi.fn(), touchKnownDevice: vi.fn() }));
vi.mock("@/lib/device-challenge", () => ({ createDeviceChallenge: vi.fn(), verifyDeviceChallenge: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  moderateText: vi.fn(),
  moderateImage: (url: string) => moderateImage(url),
  moderateMediaChecks: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: { "circle-cover": 1 },
  HIVE_VIDEO_MODERATION_MAX_SECONDS: 60,
  VIDEO_INSTANT_PUBLISH_MAX_SECONDS: 600,
  verifyUploadedSize: (i: unknown) => verifyUploadedSize(i),
  checkUploadedSize: vi.fn(),
  worstUploadedSizeCheck: vi.fn(),
  deleteObject: (k: string) => deleteObject(k),
  deleteOwnedObject: vi.fn(),
  keyFromPublicUrl: (url: string) => (url.startsWith(R2) ? url.slice(R2.length + 1) : null),
  publicUrlForKey: (key: string) => `${R2}/${key}`,
}));
vi.mock("@/lib/circle-permissions", () => ({
  isCircleAdmin: () => true,
  getCircleMembership: async () => ({ role: "OWNER" }),
}));
vi.mock("@/lib/cloudflare-stream", () => ({ isStreamConfigured: () => false, createStreamCopy: vi.fn() }));
vi.mock("@/lib/feed-category", () => ({ classifyPostCategory: vi.fn() }));
vi.mock("@/lib/post-created", () => ({ afterPostCreated: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateCircleEmbedding: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(), notifyBadgeChange: vi.fn() }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: vi.fn() }));
vi.mock("@/lib/blocks", () => ({ isBlockedWithAny: async () => false }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    circle: {
      findUnique: (a: unknown) => circleFindUnique(a),
      update: (a: unknown) => circleUpdate(a),
      count: (a: unknown) => circleCount(a),
    },
  },
}));

const { confirmCircleCoverUpload } = await import("@/app/actions/circles");

function form(key: string, publicUrl?: string) {
  const fd = new FormData();
  fd.set("circleId", CIRCLE);
  fd.set("key", key);
  if (publicUrl) fd.set("publicUrl", publicUrl);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyUploadedSize.mockResolvedValue(true);
  moderateImage.mockResolvedValue({ allowed: true, flaggedCategories: [] });
  circleFindUnique.mockResolvedValue({ id: CIRCLE, slug: "c", createdById: ME, coverImageUrl: null });
  circleUpdate.mockResolvedValue({});
  circleCount.mockResolvedValue(0);
});

describe("confirmCircleCoverUpload", () => {
  it("stores the URL derived from the caller's own key and moderates that object, ignoring a client URL", async () => {
    const key = `circle-cover/${ME}/a.jpg`;
    const victim = `${R2}/post-image/${OTHER}/victim.jpg`;
    const result = await confirmCircleCoverUpload(form(key, victim));
    expect(result).toEqual({ error: null });
    expect(moderateImage).toHaveBeenCalledWith(`${R2}/${key}`);
    expect(circleUpdate).toHaveBeenCalledWith({ where: { id: CIRCLE }, data: { coverImageUrl: `${R2}/${key}` } });
  });

  it("refuses someone else's key, and a key of another kind, before touching R2", async () => {
    for (const key of [`circle-cover/${OTHER}/a.jpg`, `post-image/${ME}/a.jpg`, `circle-cover/${ME}/../x/a.jpg`]) {
      expect(await confirmCircleCoverUpload(form(key))).toEqual({ error: "invalid" });
    }
    expect(verifyUploadedSize).not.toHaveBeenCalled();
    expect(circleUpdate).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("never deletes a previous cover that isn't a circle-cover object (e.g. a victim URL set before the fix)", async () => {
    circleFindUnique.mockResolvedValue({
      id: CIRCLE,
      slug: "c",
      createdById: ME,
      coverImageUrl: `${R2}/post-image/${OTHER}/victim.jpg`,
    });
    await confirmCircleCoverUpload(form(`circle-cover/${ME}/new.jpg`));
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("keeps a previous cover another Circle still uses", async () => {
    circleFindUnique.mockResolvedValue({
      id: CIRCLE,
      slug: "c",
      createdById: ME,
      coverImageUrl: `${R2}/circle-cover/${OTHER}/theirs.jpg`,
    });
    circleCount.mockResolvedValue(1);
    await confirmCircleCoverUpload(form(`circle-cover/${ME}/new.jpg`));
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes this Circle's own previous cover once nothing else uses it", async () => {
    circleFindUnique.mockResolvedValue({
      id: CIRCLE,
      slug: "c",
      createdById: ME,
      coverImageUrl: `${R2}/circle-cover/${ME}/old.jpg`,
    });
    await confirmCircleCoverUpload(form(`circle-cover/${ME}/new.jpg`));
    expect(deleteObject).toHaveBeenCalledWith(`circle-cover/${ME}/old.jpg`);
  });

  it("a flagged cover is deleted (own key) and nothing is stored", async () => {
    moderateImage.mockResolvedValue({ allowed: false, flaggedCategories: ["sexual"] });
    const result = await confirmCircleCoverUpload(form(`circle-cover/${ME}/a.jpg`));
    expect(result).toEqual({ error: "moderation", categories: ["sexual"] });
    expect(deleteObject).toHaveBeenCalledWith(`circle-cover/${ME}/a.jpg`);
    expect(circleUpdate).not.toHaveBeenCalled();
  });
});
