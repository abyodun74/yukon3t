import { beforeEach, describe, expect, it, vi } from "vitest";

// Audit M2 (2026-10-29): removing reported/held content deletes only media nothing else still uses. A Story/Muse made
// from a post, or a forwarded message, reuses the original's file; removing the copy must not delete the original's.

const R2 = "https://media.example.com";
const deleteMediaIfUnreferenced = vi.fn();
const messageUpdate = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: (u: unknown) => deleteMediaIfUnreferenced(u) }));
vi.mock("@/lib/comment-count", () => ({ countPublishedInThread: async () => 0 }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { removeModeratedContent, cleanUpModeratedMedia } = await import("@/lib/content-moderation");

beforeEach(() => vi.clearAllMocks());

describe("cleanUpModeratedMedia", () => {
  it("goes through the reference-checked delete with the URLs", async () => {
    const urls = [`${R2}/post-video/cauthor/v.mp4`, `${R2}/video-thumb/cauthor/t.jpg`];
    await cleanUpModeratedMedia(urls);
    expect(deleteMediaIfUnreferenced).toHaveBeenCalledWith(urls);
  });

  it("the module no longer deletes R2 objects directly (source scan)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/content-moderation.ts", "utf8");
    expect(src).not.toMatch(/\bdeleteObject\b/);
    expect(src).toContain("deleteMediaIfUnreferenced(");
  });
});

describe("removeModeratedContent", () => {
  it("a removed message drops its media columns, so its own row isn't counted as a reference", async () => {
    const tx = {
      message: {
        findUnique: async () => ({
          id: "cmsg",
          conversationId: "cconv",
          senderId: "csender",
          mediaUrl: `${R2}/message-video/csender/v.mp4`,
          mediaThumbnailUrl: `${R2}/video-thumb/csender/t.jpg`,
        }),
        update: (a: unknown) => messageUpdate(a),
      },
    };
    const result = await removeModeratedContent("MESSAGE", "cmsg", tx as never);
    expect(messageUpdate).toHaveBeenCalledWith({
      where: { id: "cmsg" },
      data: { moderationStatus: "REMOVED", mediaUrl: null, mediaThumbnailUrl: null },
    });
    expect(result).toEqual({
      authorId: "csender",
      mediaUrlsToDelete: [`${R2}/message-video/csender/v.mp4`, `${R2}/video-thumb/csender/t.jpg`],
    });
  });

  it("returns URLs (not keys) for a removed Muse", async () => {
    const tx = {
      muse: {
        findUnique: async () => ({ id: "cm", authorId: "ca", videoUrl: `${R2}/post-video/corig/v.mp4`, videoThumbnailUrl: null, audioUrl: null }),
        delete: vi.fn(),
      },
    };
    const result = await removeModeratedContent("MUSE", "cm", tx as never);
    expect(result?.mediaUrlsToDelete).toEqual([`${R2}/post-video/corig/v.mp4`]);
  });
});
