import { beforeEach, describe, expect, it, vi } from "vitest";

// moderate-long-videos against a mocked database: a flagged long-video verdict holds the item for an admin (FLAGGED,
// media kept, a CONTENT_FLAGGED_FOR_REVIEW audit row), for a Post, a Comment and a Muse alike. Nothing is deleted.

type Row = { id: string; videoUrl: string; videoDurationSeconds: number; videoStreamUid: string | null };

const advanceLongVideoReview = vi.fn();
const notifyVideoFlaggedForReview = vi.fn();
const auditCreate = vi.fn();
const deletes: string[] = [];
const updates: Array<{ model: string; data: Record<string, unknown> }> = [];
let posts: Row[] = [];
let comments: Row[] = [];
let muses: Row[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: () => true }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/video-review", () => ({ advanceLongVideoReview: (a: unknown) => advanceLongVideoReview(a) }));
vi.mock("@/lib/video-review-notice", () => ({
  notifyVideoFlaggedForReview: (...a: unknown[]) => notifyVideoFlaggedForReview(...a),
}));

function model(name: string, rows: () => Row[]) {
  return {
    findMany: async () => rows(),
    findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, authorId: "cauthor", postId: "cparent" }),
    updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push({ model: name, data });
      return { count: 1 };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push({ model: name, data });
      return {};
    },
    delete: async ({ where }: { where: { id: string } }) => {
      deletes.push(`${name}:${where.id}`);
      return {};
    },
    deleteMany: async () => {
      deletes.push(`${name}:many`);
      return { count: 0 };
    },
  };
}

vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    post: model("post", () => posts),
    comment: model("comment", () => comments),
    muse: model("muse", () => muses),
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});

const { GET } = await import("./route");

const row = (id: string): Row => ({ id, videoUrl: `https://media.example/${id}.mp4`, videoDurationSeconds: 120, videoStreamUid: "uid" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
  deletes.length = 0;
  updates.length = 0;
  posts = [];
  comments = [];
  muses = [];
});

describe("moderate-long-videos: a flagged verdict is held for an admin, never deleted", () => {
  it("holds a flagged Post, Comment and Muse as FLAGGED with an audit row, deleting nothing", async () => {
    posts = [row("cpost1")];
    comments = [row("ccomment1")];
    muses = [row("cmuse1")];
    advanceLongVideoReview.mockResolvedValue({ kind: "flagged", reasons: ["frame@30s: violence/graphic"] });

    const res = await GET(new Request("https://x.example/api/cron/moderate-long-videos"));
    const body = await res.json();
    expect(body).toMatchObject({ postOutcomes: ["flagged"], commentOutcomes: ["flagged"], museOutcomes: ["flagged"] });

    for (const name of ["post", "comment", "muse"]) {
      expect(updates.some((u) => u.model === name && u.data.moderationStatus === "FLAGGED"), name).toBe(true);
    }
    expect(deletes).toEqual([]);
    expect(auditCreate).toHaveBeenCalledTimes(3);
    for (const [arg] of auditCreate.mock.calls) {
      expect(arg.data.action).toBe("CONTENT_FLAGGED_FOR_REVIEW");
      expect(arg.data.reason).toContain("flagged for admin review");
    }
  });

  it("publishes a clean verdict", async () => {
    posts = [row("cpost1")];
    advanceLongVideoReview.mockResolvedValue({ kind: "clean" });
    await GET(new Request("https://x.example/api/cron/moderate-long-videos"));
    expect(updates.some((u) => u.model === "post" && u.data.moderationStatus === "PUBLISHED")).toBe(true);
    expect(deletes).toEqual([]);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
