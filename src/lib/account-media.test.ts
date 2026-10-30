import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// Audit L7 (2026-10-29): deleting an account removes the files behind its content, through the reference check, and
// only the person's own Circle covers that no remaining Circle uses.

const R2 = "https://media.example.com";
const ME = "cme00000000001";
const deleteMediaIfUnreferenced = vi.fn();
const deleteOwnedObject = vi.fn();
const deleteStoredAvatar = vi.fn();
const circleFindMany = vi.fn();

const rows = {
  posts: [{ mediaUrls: [`${R2}/post-image/${ME}/p.jpg`], videoUrl: null, videoThumbnailUrl: null }],
  comments: [{ audioUrl: null, videoUrl: `${R2}/comment-video/${ME}/c.mp4`, videoThumbnailUrl: null }],
  messages: [{ mediaUrl: "https://media.giphy.com/x.gif", mediaThumbnailUrl: null }],
  stories: [{ mediaUrl: `${R2}/post-video/cother/shared.mp4`, mediaThumbnailUrl: null }],
  muses: [],
  moments: [{ imageUrl: `${R2}/ambient-image/${ME}/a.jpg` }],
  circles: [{ coverImageUrl: `${R2}/circle-cover/${ME}/mine.jpg` }, { coverImageUrl: `${R2}/post-image/cvictim/v.jpg` }],
};

vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: (u: unknown) => deleteMediaIfUnreferenced(u) }));
vi.mock("@/lib/avatar-storage", () => ({ deleteStoredAvatar: (...a: unknown[]) => deleteStoredAvatar(...a) }));
vi.mock("@/lib/storage", () => ({
  keyFromPublicUrl: (url: string) => (url.startsWith(R2) ? url.slice(R2.length + 1) : null),
  deleteOwnedObject: (...a: unknown[]) => deleteOwnedObject(...a),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findMany: async () => rows.posts },
    comment: { findMany: async () => rows.comments },
    message: { findMany: async () => rows.messages },
    story: { findMany: async () => rows.stories },
    muse: { findMany: async () => rows.muses },
    ambientMoment: { findMany: async () => rows.moments },
    circle: { findMany: (a: { where: { createdById?: string } }) => (a.where.createdById ? rows.circles : circleFindMany(a)) },
  },
}));

const { collectAccountMedia, deleteAccountMedia } = await import("@/lib/account-media");

beforeEach(() => {
  vi.clearAllMocks();
  circleFindMany.mockResolvedValue([]);
});

describe("account media cleanup", () => {
  it("collects our bucket's URLs and only the person's own circle covers", async () => {
    const media = await collectAccountMedia(ME, "/api/avatar/x/y-t.jpg");
    expect(media.urls).toEqual([
      `${R2}/post-image/${ME}/p.jpg`,
      `${R2}/comment-video/${ME}/c.mp4`,
      `${R2}/post-video/cother/shared.mp4`,
      `${R2}/ambient-image/${ME}/a.jpg`,
    ]);
    expect(media.circleCovers).toEqual([`${R2}/circle-cover/${ME}/mine.jpg`]);
  });

  it("deletes through the reference check, keeps covers still in use, and removes the avatar", async () => {
    const media = await collectAccountMedia(ME, "/api/avatar/x/y-t.jpg");
    circleFindMany.mockResolvedValue([{ coverImageUrl: `${R2}/circle-cover/${ME}/mine.jpg` }]);
    await deleteAccountMedia(ME, media);
    expect(deleteMediaIfUnreferenced).toHaveBeenCalledWith(media.urls);
    expect(deleteOwnedObject).not.toHaveBeenCalled();
    expect(deleteStoredAvatar).toHaveBeenCalledWith("/api/avatar/x/y-t.jpg", ME);
  });

  it("both delete paths collect before and clean up after the row delete (source scan)", () => {
    for (const f of ["src/app/actions/profile.ts", "src/app/actions/password-auth.ts"]) {
      const src = readFileSync(f, "utf8");
      const collect = src.indexOf("await collectAccountMedia(user.id, user.avatarUrl)");
      const del = src.indexOf("await prisma.user.delete({ where: { id: user.id } })", collect);
      const clean = src.indexOf("await deleteAccountMedia(user.id, media)", del);
      expect(collect).toBeGreaterThan(-1);
      expect(del).toBeGreaterThan(collect);
      expect(clean).toBeGreaterThan(del);
    }
  });
});
