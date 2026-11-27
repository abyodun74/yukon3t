import { beforeEach, describe, expect, it, vi } from "vitest";
import { STYLED_POST_MAX_CHARS } from "@/lib/post-backgrounds";

// createPost (actions/circles.ts) with a colored background (src/lib/post-backgrounds.ts), against a mocked database:
// only an allow-listed key is stored, only on a text-only post within the length cap, the text goes through the same
// text moderation as any post, and a retried submission still answers with the post already made.

const ME = "cme00000000001";
const R2 = "https://media.example.com";
const user = { id: ME, email: "me@example.com", isAdmin: false };
const moderateText = vi.fn();
const moderateMediaChecks = vi.fn();
const postCreate = vi.fn();
const postFindUnique = vi.fn();
const afterPostCreated = vi.fn();

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
    checkUploadedSize: async () => "ok",
    worstUploadedSizeCheck: actual.worstUploadedSizeCheck,
    deleteObject: vi.fn(),
    deleteOwnedObject: vi.fn(),
    keyFromPublicUrl: (url: string) => (url.startsWith(R2) ? url.slice(R2.length + 1) : null),
  };
});
vi.mock("@/lib/cloudflare-stream", () => ({ isStreamConfigured: () => false, createStreamCopy: vi.fn() }));
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
      findUnique: (args: unknown) => postFindUnique(args),
      create: (args: { data: Record<string, unknown> }) => postCreate(args),
    },
    auditLog: { create: vi.fn() },
    $transaction: async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
  },
}));

const { createPost } = await import("@/app/actions/circles");

function textPost(fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("content", "Good morning, everyone!");
  fd.set("mediaType", "NONE");
  fd.set("mediaUrls", "[]");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function videoPost(fields: Record<string, string> = {}) {
  return textPost({
    mediaType: "VIDEO",
    videoUrl: `${R2}/post-video/${ME}/v.mp4`,
    videoThumbnailUrl: `${R2}/video-thumb/${ME}/v.jpg`,
    videoDurationSeconds: "12",
    ...fields,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  postFindUnique.mockResolvedValue(null);
  moderateText.mockResolvedValue({ allowed: true, flaggedCategories: [] });
  postCreate.mockImplementation(async ({ data }) => ({ id: "cpost0000000001", ...data }));
  moderateMediaChecks.mockResolvedValue([{ source: "caption", result: { allowed: true, flaggedCategories: [] } }]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createPost: colored backgrounds", () => {
  it("stores the preset key on a text-only post, through the same text moderation", async () => {
    const result = await createPost(textPost({ backgroundStyle: "sunset" }));
    expect(result).toEqual({ error: null });
    const data = postCreate.mock.calls[0][0].data;
    expect(data.backgroundStyle).toBe("sunset");
    expect(data.mediaType).toBe("NONE");
    expect(data.moderationStatus).toBe("PUBLISHED");
    expect(moderateText).toHaveBeenCalledWith("Good morning, everyone!");
  });

  it("holds flagged text on a styled post exactly like any text post", async () => {
    moderateText.mockResolvedValue({ allowed: false, flaggedCategories: ["harassment/threatening"] });
    await createPost(textPost({ backgroundStyle: "neon" }));
    expect(postCreate.mock.calls[0][0].data.moderationStatus).toBe("FLAGGED");
  });

  it("leaves an ordinary post without a background", async () => {
    await createPost(textPost());
    expect(postCreate.mock.calls[0][0].data.backgroundStyle).toBeNull();
  });

  it.each(["red", "#ff0000", "linear-gradient(red, blue)", "SUNSET", "__proto__"])(
    "refuses a key that isn't in the catalogue (%s) and stores nothing",
    async (backgroundStyle) => {
      expect(await createPost(textPost({ backgroundStyle }))).toEqual({ error: "invalid" });
      expect(postCreate).not.toHaveBeenCalled();
    },
  );

  it("refuses a background on a photo post", async () => {
    const result = await createPost(
      textPost({ backgroundStyle: "ocean", mediaType: "IMAGE", mediaUrls: JSON.stringify([`${R2}/post-image/${ME}/a.jpg`]) }),
    );
    expect(result).toEqual({ error: "background_not_allowed" });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("refuses a background on a link post and on a GIF", async () => {
    expect(
      await createPost(textPost({ backgroundStyle: "ocean", mediaType: "LINK", embedUrl: "https://example.com/a" })),
    ).toEqual({ error: "background_not_allowed" });
    expect(
      await createPost(
        textPost({
          backgroundStyle: "ocean",
          mediaType: "GIF",
          mediaUrls: JSON.stringify(["https://media.giphy.com/media/abc/giphy.gif"]),
        }),
      ),
    ).toEqual({ error: "background_not_allowed" });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("refuses a background on an event", async () => {
    const result = await createPost(
      textPost({
        backgroundStyle: "gold",
        eventAt: new Date(Date.now() + 86_400_000).toISOString(),
        eventLocation: "The park",
      }),
    );
    expect(result).toEqual({ error: "background_not_allowed" });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("refuses text longer than the styled-post cap, and accepts exactly the cap", async () => {
    expect(
      await createPost(textPost({ backgroundStyle: "mint", content: "x".repeat(STYLED_POST_MAX_CHARS + 1) })),
    ).toEqual({ error: "background_too_long" });
    expect(postCreate).not.toHaveBeenCalled();
    expect(await createPost(textPost({ backgroundStyle: "mint", content: "x".repeat(STYLED_POST_MAX_CHARS) }))).toEqual({
      error: null,
    });
  });

  it("stores a colored frame on the author's own uploaded video, with a caption of any length", async () => {
    const result = await createPost(videoPost({ backgroundStyle: "aurora", content: "v".repeat(800) }));
    expect(result).toEqual({ error: null });
    expect(postCreate.mock.calls[0][0].data).toMatchObject({ mediaType: "VIDEO", backgroundStyle: "aurora" });
  });

  it("refuses a frame on an embedded video", async () => {
    expect(
      await createPost(textPost({ backgroundStyle: "aurora", mediaType: "EMBED", embedUrl: "https://youtu.be/dQw4w9WgXcQ" })),
    ).toEqual({ error: "background_not_allowed" });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("a retried submission (same request key) answers success without a second post", async () => {
    postFindUnique.mockResolvedValue({ id: "cpost0000000001" });
    const result = await createPost(textPost({ backgroundStyle: "sunset", clientRequestId: "a".repeat(32) }));
    expect(result).toEqual({ error: null });
    expect(postCreate).not.toHaveBeenCalled();
  });
});

// Optional music (src/lib/post-music.ts): only a catalogue key, only on the author's own video, photo(s) or text post.
describe("createPost: music", () => {
  it("stores the track key on a text post, a styled text post and a video", async () => {
    await createPost(textPost({ musicTrack: "sunrise" }));
    await createPost(textPost({ musicTrack: "tender", backgroundStyle: "blush" }));
    await createPost(videoPost({ musicTrack: "groove", backgroundStyle: "neon" }));
    expect(postCreate.mock.calls.map((c) => c[0].data.musicTrack)).toEqual(["sunrise", "tender", "groove"]);
    expect(postCreate.mock.calls[2][0].data.backgroundStyle).toBe("neon");
  });

  it("leaves an ordinary post without music", async () => {
    await createPost(textPost());
    await createPost(videoPost());
    expect(postCreate.mock.calls.map((c) => c[0].data.musicTrack)).toEqual([null, null]);
  });

  it("puts an album's one track on its lead photo only", async () => {
    const photos = [1, 2, 3].map((i) => `${R2}/post-image/${ME}/p${i}.jpg`);
    moderateMediaChecks.mockResolvedValue(
      ["caption", "photo 1", "photo 2", "photo 3"].map((source) => ({ source, result: { allowed: true, flaggedCategories: [] } })),
    );
    expect(await createPost(textPost({ mediaType: "IMAGE", mediaUrls: JSON.stringify(photos), musicTrack: "island" }))).toEqual({
      error: null,
    });
    expect(postCreate.mock.calls.map((c) => [c[0].data.albumIndex, c[0].data.musicTrack])).toEqual([
      [0, "island"],
      [1, null],
      [2, null],
    ]);
  });

  it.each(["https://example.com/song.mp3", "Sunrise", "../../etc/passwd", "__proto__"])(
    "refuses a value that isn't a catalogue key (%s) and stores nothing",
    async (musicTrack) => {
      expect(await createPost(textPost({ musicTrack }))).toEqual({ error: "invalid" });
      expect(postCreate).not.toHaveBeenCalled();
    },
  );

  it("refuses music on a link, a GIF, an embedded video and an event", async () => {
    expect(await createPost(textPost({ musicTrack: "focus", mediaType: "LINK", embedUrl: "https://example.com/a" }))).toEqual({
      error: "music_not_allowed",
    });
    expect(
      await createPost(
        textPost({ musicTrack: "focus", mediaType: "GIF", mediaUrls: JSON.stringify(["https://media.giphy.com/media/abc/giphy.gif"]) }),
      ),
    ).toEqual({ error: "music_not_allowed" });
    expect(
      await createPost(textPost({ musicTrack: "focus", mediaType: "EMBED", embedUrl: "https://youtu.be/dQw4w9WgXcQ" })),
    ).toEqual({ error: "music_not_allowed" });
    expect(
      await createPost(
        textPost({ musicTrack: "focus", eventAt: new Date(Date.now() + 86_400_000).toISOString(), eventLocation: "The park" }),
      ),
    ).toEqual({ error: "music_not_allowed" });
    expect(postCreate).not.toHaveBeenCalled();
  });
});
