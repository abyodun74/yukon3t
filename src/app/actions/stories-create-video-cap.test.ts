import { beforeEach, describe, expect, it, vi } from "vitest";

// createStory's server-side length cap for a video Story (MAX_STORY_VIDEO_SECONDS): the length measured from the
// stored file decides, the phone's value is used only when the file can't be measured, and a video whose length
// nothing could read is still accepted (documented on createStory). A refused video's uploads are removed.

const ME = "cme00000000001";
const user = { id: ME, name: "Me", isAdmin: false };
const VIDEO = "https://media.example/story-video/cme00000000001/v.mp4";
const THUMB = "https://media.example/video-thumb/cme00000000001/v.jpg";

const probeStoredVideoSeconds = vi.fn();
const storyCreate = vi.fn();
const deleteOwnedUploads = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user, requireVerifiedViewer: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({
  moderateText: async () => ({ allowed: true }),
  moderateMedia: async () => ({ allowed: true }),
}));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    MEDIA_LIMITS: { "story-image": 1, "story-video": 1 },
    STORY_LIFETIME_MS: 86_400_000,
    MAX_STORY_VIDEO_SECONDS: actual.MAX_STORY_VIDEO_SECONDS,
    storyVideoOverCap: actual.storyVideoOverCap,
    verifyUploadedSize: async () => true,
    keyFromPublicUrl: (url: string) => url.replace("https://media.example/", ""),
  };
});
vi.mock("@/lib/video-thumbnail-check", () => ({ checkVideoThumbnail: async () => "ok" }));
vi.mock("@/lib/video-duration-server", () => ({ probeStoredVideoSeconds: (url: string) => probeStoredVideoSeconds(url) }));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: (...a: unknown[]) => deleteOwnedUploads(...a) }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ notifyBadgeChange: vi.fn(), publishEvent: vi.fn(), publishEvents: vi.fn() }));
vi.mock("@/lib/profile-access-server", () => ({ loadViewableStory: async () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: { story: { create: (a: unknown) => storyCreate(a) } } }));

const { createStory } = await import("@/app/actions/stories");

function videoForm(phoneSeconds?: number) {
  const fd = new FormData();
  fd.set("mediaType", "VIDEO");
  fd.set("mediaUrl", VIDEO);
  fd.set("mediaThumbnailUrl", THUMB);
  if (phoneSeconds !== undefined) fd.set("videoDurationSeconds", String(phoneSeconds));
  return fd;
}

const storedSeconds = () => storyCreate.mock.calls[0][0].data.videoDurationSeconds;

beforeEach(() => {
  vi.clearAllMocks();
  storyCreate.mockResolvedValue({ id: "cstory00000001" });
});

describe("createStory: the 2-minute video cap, server-side", () => {
  it("refuses a video measured over the cap when the phone couldn't read its length, and removes the upload", async () => {
    probeStoredVideoSeconds.mockResolvedValue(300);
    expect(await createStory(videoForm())).toEqual({ error: "videoTooLong" });
    expect(storyCreate).not.toHaveBeenCalled();
    expect(deleteOwnedUploads).toHaveBeenCalledWith([VIDEO, THUMB], ME);
  });

  it("trusts the measured length over a (lower) length the phone sent", async () => {
    probeStoredVideoSeconds.mockResolvedValue(200);
    expect(await createStory(videoForm(30))).toEqual({ error: "videoTooLong" });
    expect(storyCreate).not.toHaveBeenCalled();
  });

  it("keeps a measured length within the cap (one second of rounding grace) on the Story", async () => {
    probeStoredVideoSeconds.mockResolvedValue(121);
    expect(await createStory(videoForm())).toEqual({ error: null });
    expect(storedSeconds()).toBe(121);
    expect(deleteOwnedUploads).not.toHaveBeenCalled();
  });

  it("falls back to the phone's length when the file can't be measured", async () => {
    probeStoredVideoSeconds.mockResolvedValue(null);
    expect(await createStory(videoForm(45))).toEqual({ error: null });
    expect(storedSeconds()).toBe(45);
    expect(await createStory(videoForm(150))).toEqual({ error: "videoTooLong" });
  });

  it("accepts a video whose length nothing could read (no length stored)", async () => {
    probeStoredVideoSeconds.mockResolvedValue(null);
    expect(await createStory(videoForm())).toEqual({ error: null });
    expect(storedSeconds()).toBeUndefined();
  });
});
