import { beforeEach, describe, expect, it, vi } from "vitest";

// Audit M1 (2026-10-29): a video Story/message's still frame must be present, the sender's own `video-thumb/` upload
// and within the thumbnail cap; arbitrary URLs (outside images, other people's files) are refused before any R2 call.

const R2 = "https://media.example.com";
const ME = "cme00000000001";
const verifyUploadedSize = vi.fn();

vi.mock("@/lib/storage", () => ({
  MEDIA_LIMITS: { "video-thumb": 3 * 1024 * 1024 },
  keyFromPublicUrl: (url: string) => (url.startsWith(R2) ? url.slice(R2.length + 1) : null),
  verifyUploadedSize: (i: unknown) => verifyUploadedSize(i),
}));

const { checkVideoThumbnail } = await import("@/lib/video-thumbnail-check");
const { isOwnedUploadKey, isCircleCoverKey, uploadKindOfKey } = await import("@/lib/media-keys");

beforeEach(() => {
  vi.clearAllMocks();
  verifyUploadedSize.mockResolvedValue(true);
});

describe("checkVideoThumbnail", () => {
  it("requires a frame", async () => {
    expect(await checkVideoThumbnail(undefined, ME)).toBe("required");
    expect(await checkVideoThumbnail(null, ME)).toBe("required");
    expect(await checkVideoThumbnail("", ME)).toBe("required");
  });

  it("refuses outside URLs, other people's files and other kinds without touching R2", async () => {
    for (const url of [
      "https://evil.example/frame.jpg",
      `${R2}/video-thumb/cother00000001/t.jpg`,
      `${R2}/circle-cover/${ME}/c.jpg`,
      `${R2}/post-video/${ME}/v.mp4`,
      `${R2}/video-thumb/${ME}/../x.jpg`,
    ]) {
      expect(await checkVideoThumbnail(url, ME)).toBe("invalid");
    }
    expect(verifyUploadedSize).not.toHaveBeenCalled();
  });

  it("size-checks the caller's own frame against the thumbnail cap", async () => {
    expect(await checkVideoThumbnail(`${R2}/video-thumb/${ME}/t.jpg`, ME)).toBe("ok");
    expect(verifyUploadedSize).toHaveBeenCalledWith({ key: `video-thumb/${ME}/t.jpg`, maxBytes: 3 * 1024 * 1024, ownerId: ME });
    verifyUploadedSize.mockResolvedValue(false);
    expect(await checkVideoThumbnail(`${R2}/video-thumb/${ME}/t.jpg`, ME)).toBe("too_large");
  });
});

describe("media-keys", () => {
  it("isOwnedUploadKey needs both the kind and the owner", () => {
    expect(isOwnedUploadKey(`circle-cover/${ME}/a.jpg`, "circle-cover", ME)).toBe(true);
    expect(isOwnedUploadKey(`circle-cover/cother/a.jpg`, "circle-cover", ME)).toBe(false);
    expect(isOwnedUploadKey(`post-image/${ME}/a.jpg`, "circle-cover", ME)).toBe(false);
    expect(isOwnedUploadKey(`circle-cover/${ME}/x/a.jpg`, "circle-cover", ME)).toBe(false);
    expect(isOwnedUploadKey(`circle-cover/${ME}/`, "circle-cover", ME)).toBe(false);
  });

  it("isCircleCoverKey accepts any uploader's cover only", () => {
    expect(isCircleCoverKey("circle-cover/cabc/a.jpg")).toBe(true);
    expect(isCircleCoverKey("post-image/cabc/a.jpg")).toBe(false);
    expect(isCircleCoverKey("circle-cover/../post-image/a.jpg")).toBe(false);
    expect(uploadKindOfKey("ad-video/anonymous/a.mp4")).toBe("ad-video");
  });
});

describe("every video Story/message path checks its frame (source scan)", () => {
  it.each(["src/app/actions/stories.ts", "src/app/actions/messages.ts", "src/app/actions/share-to-chats.ts"])(
    "%s",
    async (file) => {
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(file, "utf8")).toContain("checkVideoThumbnail(mediaThumbnailUrl, user.id)");
    },
  );
});
