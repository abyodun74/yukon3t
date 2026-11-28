import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Every path that deletes a public-bucket file goes through storage.ts deleteObject, which forgets the key's upload
// record once (and only once) R2 confirmed the delete. These tests drive each user-facing delete path against a fake
// R2 client and a fake database.

const s3 = vi.hoisted(() => ({
  send: vi.fn(),
}));
const db = vi.hoisted(() => ({
  forgetCalls: [] as string[][],
  forgetFails: false,
  stories: [] as Record<string, unknown>[],
  linkedUrl: null as string | null,
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send = s3.send;
    },
  };
});

vi.mock("@/lib/prisma", () => {
  const empty = { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) };
  // A database that answers the way Postgres would: a LINK post / ad whose link is db.linkedUrl comes back only if
  // the query actually asks about linkUrl.
  const linkAware = (row: (url: string) => Record<string, unknown>) => ({
    findMany: vi.fn(async (args: { where: unknown }) =>
      db.linkedUrl && JSON.stringify(args.where).includes('"linkUrl"') ? [row(db.linkedUrl)] : [],
    ),
    count: vi.fn(async () => 0),
  });
  return {
    prisma: {
      uploadRecord: {
        deleteMany: vi.fn(async (args: { where: { key: { in: string[] } } }) => {
          if (db.forgetFails) throw new Error("db down");
          db.forgetCalls.push(args.where.key.in);
          return { count: args.where.key.in.length };
        }),
      },
      post: linkAware((url) => ({ mediaType: "LINK", mediaUrls: [], videoUrl: null, videoThumbnailUrl: null, linkUrl: url })),
      comment: empty,
      message: empty,
      muse: empty,
      adCampaign: linkAware((url) => ({ mediaUrl: null, linkUrl: url })),
      announcement: empty,
      ambientMoment: empty,
      circle: empty,
      videoConversion: empty,
      story: {
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) => ("expiresAt" in args.where ? db.stories : [])),
        deleteMany: vi.fn(async () => ({ count: db.stories.length })),
      },
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/moderation", () => ({ moderateImage: vi.fn() }));
vi.mock("@/lib/trust", () => ({ recomputeTrustScore: vi.fn() }));
vi.mock("@/lib/fetch-remote-image", () => ({ fetchRemoteImage: vi.fn() }));
vi.mock("@/lib/avatar-storage", () => ({ deleteStoredAvatar: vi.fn(async () => {}) }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: () => true }));

import {
  checkUploadedSize,
  deleteObject,
  deleteOwnedObject,
  isDefiniteNotFound,
  publicObjectStatus,
} from "@/lib/storage";
import { deleteOwnedUploads } from "@/lib/owned-uploads";
import { deleteMediaIfUnreferenced } from "@/lib/media-cleanup";
import { deleteAccountMedia } from "@/lib/account-media";
import { discardUploads } from "@/app/actions/media";
import { GET as expireStories } from "@/app/api/cron/expire-stories/route";

const BASE = "https://media.example.com";
const ENV = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "bucket",
  R2_PUBLIC_URL: BASE,
  CRON_SECRET: "cron",
};
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const deletedKeys = () =>
  s3.send.mock.calls
    .map(([cmd]) => cmd as { constructor: { name: string }; input: { Key: string } })
    .filter((cmd) => cmd.constructor.name === "DeleteObjectCommand")
    .map((cmd) => cmd.input.Key);
const forgotten = () => db.forgetCalls.flat().sort();

beforeEach(() => {
  s3.send.mockReset();
  s3.send.mockResolvedValue({});
  db.forgetCalls = [];
  db.forgetFails = false;
  db.stories = [];
  db.linkedUrl = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteObject", () => {
  it("forgets the upload record after R2 confirmed the delete", async () => {
    await expect(deleteObject("post-image/u1/a.jpg")).resolves.toBe(true);
    expect(forgotten()).toEqual(["post-image/u1/a.jpg"]);
  });

  it("keeps the record when the storage delete fails", async () => {
    s3.send.mockRejectedValueOnce(new Error("R2 down"));
    await expect(deleteObject("post-image/u1/a.jpg")).resolves.toBe(false);
    expect(forgotten()).toEqual([]);
  });

  it("a failing bookkeeping write never breaks the delete", async () => {
    db.forgetFails = true;
    await expect(deleteObject("post-image/u1/a.jpg")).resolves.toBe(true);
  });

  it("deleteOwnedObject skips (and forgets nothing for) someone else's key", async () => {
    await expect(deleteOwnedObject("post-image/u2/a.jpg", "u1")).resolves.toBe(false);
    expect(s3.send).not.toHaveBeenCalled();
    expect(forgotten()).toEqual([]);
    await expect(deleteOwnedObject("post-image/u1/a.jpg", "u1")).resolves.toBe(true);
    expect(forgotten()).toEqual(["post-image/u1/a.jpg"]);
  });

  it("an oversized upload deleted by the size check is forgotten too", async () => {
    s3.send.mockResolvedValueOnce({ ContentLength: 10_000 });
    await expect(checkUploadedSize({ key: "post-image/u1/big.jpg", maxBytes: 10, ownerId: "u1" })).resolves.toBe(
      "too_large",
    );
    expect(forgotten()).toEqual(["post-image/u1/big.jpg"]);
  });
});

describe("every delete path forgets the records of the files it deleted", () => {
  it("discardUploads", async () => {
    await discardUploads(["post-image/u1/a.jpg", "story-video/u1/b.mp4", "post-image/u2/stranger.jpg"]);
    expect(deletedKeys().sort()).toEqual(["post-image/u1/a.jpg", "story-video/u1/b.mp4"]);
    expect(forgotten()).toEqual(["post-image/u1/a.jpg", "story-video/u1/b.mp4"]);
  });

  it("deleteOwnedUploads (a composer's rejected-upload cleanup)", async () => {
    await deleteOwnedUploads([`${BASE}/message-image/u1/a.jpg`, "https://elsewhere.example/x.jpg"], "u1");
    expect(forgotten()).toEqual(["message-image/u1/a.jpg"]);
  });

  it("deleteMediaIfUnreferenced (post/comment/message/Muse/moderation deletes)", async () => {
    await deleteMediaIfUnreferenced([`${BASE}/post-video/u1/v.mp4`, `${BASE}/video-thumb/u1/v.jpg`, null]);
    expect(forgotten()).toEqual(["post-video/u1/v.mp4", "video-thumb/u1/v.jpg"]);
  });

  it("a LINK post or ad pointing at a media URL doesn't stop deleteMediaIfUnreferenced", async () => {
    const url = `${BASE}/post-video/u1/v.mp4`;
    db.linkedUrl = url;
    await deleteMediaIfUnreferenced([url]);
    expect(deletedKeys()).toEqual(["post-video/u1/v.mp4"]);
    expect(forgotten()).toEqual(["post-video/u1/v.mp4"]);
  });

  it("story expiry", async () => {
    db.stories = [{ id: "s1", mediaUrl: `${BASE}/story-image/u1/s.jpg`, mediaThumbnailUrl: null, audioUrl: null }];
    const res = await expireStories(new Request("https://x.example/api/cron/expire-stories"));
    expect(res.status).toBe(200);
    expect(forgotten()).toEqual(["story-image/u1/s.jpg"]);
  });

  it("account cleanup", async () => {
    await deleteAccountMedia("u1", { urls: [`${BASE}/muse-video/u1/m.mp4`], circleCovers: [], avatarUrl: null });
    expect(forgotten()).toEqual(["muse-video/u1/m.mp4"]);
  });

  it("a delete that R2 refuses forgets nothing", async () => {
    s3.send.mockRejectedValue(new Error("R2 down"));
    await deleteMediaIfUnreferenced([`${BASE}/post-video/u1/v.mp4`]);
    await discardUploads(["post-image/u1/a.jpg"]);
    expect(forgotten()).toEqual([]);
  });
});

describe("publicObjectStatus", () => {
  it("is 'missing' only for a definite not-found", async () => {
    s3.send.mockResolvedValueOnce({ ContentLength: 5 });
    await expect(publicObjectStatus("k")).resolves.toBe("exists");
    s3.send.mockRejectedValueOnce(Object.assign(new Error("nf"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
    await expect(publicObjectStatus("k")).resolves.toBe("missing");
    for (const err of [
      Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }),
      Object.assign(new Error("boom"), { $metadata: { httpStatusCode: 500 } }),
      new Error("socket hang up"),
    ]) {
      s3.send.mockRejectedValueOnce(err);
      await expect(publicObjectStatus("k")).resolves.toBe("error");
    }
  });

  it("isDefiniteNotFound", () => {
    expect(isDefiniteNotFound({ name: "NoSuchKey" })).toBe(true);
    expect(isDefiniteNotFound({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isDefiniteNotFound({ $metadata: { httpStatusCode: 503 } })).toBe(false);
    expect(isDefiniteNotFound(null)).toBe(false);
    expect(isDefiniteNotFound("NotFound")).toBe(false);
  });
});
