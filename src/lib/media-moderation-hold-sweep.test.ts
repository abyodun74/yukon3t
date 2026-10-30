import { beforeEach, describe, expect, it, vi } from "vitest";
import { mediaHoldAuditReason } from "@/lib/media-moderation-hold";

// sweepExpiredMediaHolds against a mocked database: only held posts still FLAGGED past the review window are deleted
// (with their media), each with an audit row; a post an admin already published is left alone.

const AUTHOR = "cau00000000001";
let holds: Array<{ reason: string }> = [];
let posts: Record<string, { moderationStatus: string }> = {};
const findManyAudit = vi.fn();
const auditCreate = vi.fn();
const removeModeratedContent = vi.fn();
const cleanUpModeratedMedia = vi.fn();

vi.mock("@/lib/content-moderation", () => ({
  removeModeratedContent: (...a: unknown[]) => removeModeratedContent(...a),
  cleanUpModeratedMedia: (urls: string[]) => cleanUpModeratedMedia(urls),
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    post: { findUnique: async ({ where }: { where: { id: string } }) => posts[where.id] ?? null },
    auditLog: { create: (args: unknown) => auditCreate(args) },
  };
  return {
    prisma: {
      auditLog: { findMany: (args: unknown) => findManyAudit(args) },
      post: {
        findMany: async ({ where }: { where: { id: { in: string[] }; moderationStatus: string } }) =>
          where.id.in.filter((id) => posts[id]?.moderationStatus === where.moderationStatus).map((id) => ({ id })),
      },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

const { sweepExpiredMediaHolds } = await import("@/lib/media-moderation-hold-sweep");

beforeEach(() => {
  vi.clearAllMocks();
  holds = [];
  posts = {};
  findManyAudit.mockImplementation(async () => holds);
  removeModeratedContent.mockImplementation(async (_type: string, id: string) => ({
    authorId: AUTHOR,
    mediaUrlsToDelete: [`https://media.example.com/post-video/${AUTHOR}/${id}.mp4`],
  }));
});

describe("sweepExpiredMediaHolds", () => {
  it("asks only for media holds older than the review window", async () => {
    const now = new Date("2026-10-26T00:00:00Z");
    await sweepExpiredMediaHolds(now);
    const where = findManyAudit.mock.calls[0][0].where;
    expect(where.action).toBe("CONTENT_FLAGGED_FOR_REVIEW");
    expect(where.performedBy).toBe("system:media-moderation-hold");
    expect(where.createdAt.lt.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("deletes a still-held post and its media, with an audit row saying it expired unreviewed", async () => {
    holds = [{ reason: mediaHoldAuditReason("cpost1", "VIDEO", ["video frame: violence"]) }];
    posts = { cpost1: { moderationStatus: "FLAGGED" } };
    expect(await sweepExpiredMediaHolds()).toEqual({ expired: 1 });
    expect(removeModeratedContent).toHaveBeenCalledWith("POST", "cpost1", expect.anything());
    expect(cleanUpModeratedMedia).toHaveBeenCalledWith([`https://media.example.com/post-video/${AUTHOR}/cpost1.mp4`]);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetId: AUTHOR,
        action: "CONTENT_REMOVED",
        performedBy: "system:media-hold-expired",
        reason: expect.stringContaining("Not a confirmed violation"),
      }),
    });
  });

  it("leaves alone a post an admin published, or one already gone", async () => {
    holds = [
      { reason: mediaHoldAuditReason("cpub", "VIDEO", ["video frame: violence"]) },
      { reason: mediaHoldAuditReason("cgone", "IMAGE", ["photo: sexual"]) },
    ];
    posts = { cpub: { moderationStatus: "PUBLISHED" } };
    expect(await sweepExpiredMediaHolds()).toEqual({ expired: 0 });
    expect(removeModeratedContent).not.toHaveBeenCalled();
    expect(cleanUpModeratedMedia).not.toHaveBeenCalled();
  });
});
