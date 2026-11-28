import { beforeEach, describe, expect, it, vi } from "vitest";

type Rec = { id: string; key: string; userId: string; kind: string; createdAt: Date; checkedAt: Date | null };

const db = vi.hoisted(() => ({
  records: [] as Rec[],
  // Rows each reference-check delegate returns (keyed by model delegate name), and the where clauses it was asked.
  rows: {} as Record<string, Record<string, unknown>[]>,
  wheres: {} as Record<string, unknown[]>,
  // Recent posts the control lookup finds (mediaUrls), and one in-use post video (the control findFirst returns it).
  controlPosts: [] as Record<string, unknown>[],
  controlUrl: null as string | null,
  // A broken reference check: every reference query comes back empty.
  brokenRefs: false,
  failDeleteMany: false,
}));

vi.mock("@/lib/prisma", () => {
  const refDelegate = (name: string) => ({
    findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
      // The control lookup on Post.mediaUrls (no `OR`): the recent posts.
      if (name === "post" && !("OR" in args.where)) return db.controlPosts;
      (db.wheres[name] ??= []).push(args.where);
      if (db.brokenRefs) return [];
      const rows = db.rows[name] ?? [];
      if (name !== "post") return rows;
      const control = db.controlUrl ? [{ mediaUrls: [], videoUrl: db.controlUrl, videoThumbnailUrl: null }] : [];
      return [...rows, ...control, ...db.controlPosts];
    }),
    findFirst: vi.fn(async (args: { where: Record<string, unknown> }) =>
      name === "post" && "videoUrl" in args.where && db.controlUrl ? { videoUrl: db.controlUrl } : null,
    ),
  });
  const idsOf = (where: { id?: string | { in: string[] }; key?: { in: string[] } }) => {
    if (where.key) return db.records.filter((r) => where.key!.in.includes(r.key));
    const id = where.id;
    return db.records.filter((r) => (typeof id === "string" ? r.id === id : id?.in.includes(r.id)));
  };
  return {
    prisma: {
      uploadRecord: {
        createMany: vi.fn(),
        findMany: vi.fn(
          async (args: { where: { createdAt: { lt: Date }; checkedAt?: null }; take: number }) =>
            db.records
              .filter((r) => r.createdAt < args.where.createdAt.lt)
              .filter((r) => !("checkedAt" in args.where) || r.checkedAt === null)
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
              .slice(0, args.take),
        ),
        deleteMany: vi.fn(async (args: { where: Parameters<typeof idsOf>[0] }) => {
          if (db.failDeleteMany) throw new Error("db down");
          const gone = new Set(idsOf(args.where).map((r) => r.id));
          db.records = db.records.filter((r) => !gone.has(r.id));
          return { count: gone.size };
        }),
        updateMany: vi.fn(async (args: { where: { id: { in: string[] } }; data: { checkedAt: Date } }) => {
          const hit = db.records.filter((r) => args.where.id.in.includes(r.id));
          hit.forEach((r) => (r.checkedAt = args.data.checkedAt));
          return { count: hit.length };
        }),
      },
      post: refDelegate("post"),
      comment: refDelegate("comment"),
      message: refDelegate("message"),
      story: refDelegate("story"),
      muse: refDelegate("muse"),
      adCampaign: refDelegate("adCampaign"),
      announcement: refDelegate("announcement"),
      ambientMoment: refDelegate("ambientMoment"),
      circle: refDelegate("circle"),
      videoConversion: refDelegate("videoConversion"),
    },
  };
});

import {
  MEDIA_REFERENCE_COLUMNS,
  findReferencedUrls,
  forgetUploadRecords,
  sweepAbandonedUploads,
  wouldTrip,
  type ObjectStatus,
} from "./upload-records";

const BASE = "https://media.example.com";
const OLD = new Date("2026-01-01T00:00:00Z");
const CONTROL_KEY = "post-video/u9/live.mp4";
const CONTROL_URL = `${BASE}/${CONTROL_KEY}`;

function seed(n: number, prefix = "post-image/u1/f") {
  for (let i = 0; i < n; i++) {
    db.records.push({
      id: `${prefix}-${i}`,
      key: `${prefix}${String(db.records.length).padStart(4, "0")}.jpg`,
      userId: "u1",
      kind: "post-image",
      createdAt: new Date(OLD.getTime() + db.records.length * 1000),
      checkedAt: null,
    });
  }
}

function referenceAsPostMedia(keys: string[]) {
  db.rows.post = [{ videoUrl: null, videoThumbnailUrl: null, mediaUrls: keys.map((k) => `${BASE}/${k}`) }];
}

function run(dryRun: boolean, status: (key: string) => ObjectStatus | Promise<ObjectStatus>, limit = 200) {
  const deleteObject = vi.fn<(key: string) => Promise<boolean>>(async () => true);
  const objectStatus = vi.fn(async (key: string) => status(key));
  const promise = sweepAbandonedUploads({
    dryRun,
    minAgeMs: 48 * 3600_000,
    limit,
    publicBaseUrl: `${BASE}/`,
    deleteObject,
    objectStatus,
  });
  return { promise, deleteObject, objectStatus };
}

beforeEach(() => {
  db.records = [];
  db.rows = {};
  db.wheres = {};
  db.controlPosts = [];
  db.controlUrl = CONTROL_URL;
  db.brokenRefs = false;
  db.failDeleteMany = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("findReferencedUrls covers every listed column", () => {
  const MODEL_DELEGATE: Record<string, string> = {
    Post: "post",
    Comment: "comment",
    Message: "message",
    Story: "story",
    Muse: "muse",
    AdCampaign: "adCampaign",
    Announcement: "announcement",
    AmbientMoment: "ambientMoment",
    Circle: "circle",
    VideoConversion: "videoConversion",
  };

  it.each(MEDIA_REFERENCE_COLUMNS.map((c) => [c]))("%s is queried and counted", async (column) => {
    const [model, field] = column.split(".");
    const delegate = MODEL_DELEGATE[model];
    expect(delegate, `no delegate mapping for ${model}`).toBeTruthy();
    const url = `${BASE}/post-image/u1/${field}.jpg`;
    db.rows[delegate] = [{ ...(model === "Post" ? { mediaUrls: [] } : {}), [field]: field === "mediaUrls" ? [url] : url }];
    const found = await findReferencedUrls([url, `${BASE}/post-image/u1/other.jpg`]);
    expect([...found]).toEqual([url]);
    expect(JSON.stringify(db.wheres[delegate])).toContain(`"${field}"`);
  });

  it("never counts a LINK post's or an ad's free-form link (anyone can paste someone else's media URL)", async () => {
    const url = `${BASE}/post-video/victim/v.mp4`;
    db.rows.post = [{ mediaUrls: [], videoUrl: null, videoThumbnailUrl: null, linkUrl: url }];
    db.rows.adCampaign = [{ mediaUrl: `${BASE}/ad-image/anonymous/a.jpg`, linkUrl: url }];
    expect(await findReferencedUrls([url])).toEqual(new Set());
    expect(JSON.stringify(db.wheres)).not.toContain("linkUrl");
  });

  it("counts announcement media as in use (it used to be missed)", async () => {
    const media = `${BASE}/announcement-video/admin/a.mp4`;
    const thumb = `${BASE}/announcement-image/admin/a.jpg`;
    db.rows.announcement = [{ mediaUrl: media, mediaThumbnailUrl: thumb }];
    const found = await findReferencedUrls([media, thumb]);
    expect(found).toEqual(new Set([media, thumb]));
  });
});

describe("forgetUploadRecords", () => {
  it("removes the records of the given keys only", async () => {
    seed(3);
    const [a, , c] = db.records.map((r) => r.key);
    await forgetUploadRecords([a, c, a]);
    expect(db.records.map((r) => r.key)).not.toContain(a);
    expect(db.records.map((r) => r.key)).not.toContain(c);
    expect(db.records).toHaveLength(1);
  });

  it("never throws when the database fails", async () => {
    seed(1);
    db.failDeleteMany = true;
    await expect(forgetUploadRecords([db.records[0].key])).resolves.toBeUndefined();
  });
});

describe("sweepAbandonedUploads — dry run", () => {
  it("advances to a new batch every run, even when the tripwire would trip", async () => {
    seed(30);
    const first = run(true, () => "exists", 25);
    const r1 = await first.promise;
    expect(r1).toMatchObject({ mode: "dry_run", examined: 25, existing: 25, marked: 25, aborted: "tripwire" });
    const second = run(true, () => "exists", 25);
    const r2 = await second.promise;
    expect(r2.examined).toBe(5);
    expect(r2.sample.every((k) => !r1.sample.includes(k))).toBe(true);
    expect((await run(true, () => "exists", 25).promise).examined).toBe(0);
    // Nothing deleted: no file, no record.
    expect(first.deleteObject).not.toHaveBeenCalled();
    expect(second.deleteObject).not.toHaveBeenCalled();
    expect(db.records).toHaveLength(30);
  });

  it("never deletes a file and only forgets referenced records (as before)", async () => {
    seed(6);
    referenceAsPostMedia([db.records[0].key, db.records[1].key]);
    const missingKey = db.records[2].key;
    const { promise, deleteObject } = run(true, (k) => (k === missingKey ? "missing" : "exists"));
    const r = await promise;
    expect(r).toMatchObject({ referenced: 2, unreferenced: 4, existing: 3, missing: 1, marked: 4, deleted: 0, cleared: 0 });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(db.records).toHaveLength(4);
    expect(db.records.every((rec) => rec.checkedAt !== null)).toBe(true);
  });

  it("leaves records storage couldn't check unmarked, so they're looked at again", async () => {
    seed(3);
    const errKey = db.records[0].key;
    const r = await run(true, (k) => (k === errKey ? "error" : "exists")).promise;
    expect(r).toMatchObject({ existing: 2, unknown: 1, marked: 2 });
    expect(db.records.find((rec) => rec.key === errKey)?.checkedAt).toBeNull();
  });

  it("treats a throwing status check as an error, not as missing", async () => {
    seed(2);
    const r = await run(true, () => Promise.reject(new Error("boom"))).promise;
    expect(r).toMatchObject({ missing: 0, unknown: 2, marked: 0 });
  });
});

describe("sweepAbandonedUploads — tripwire", () => {
  it("delete mode refuses to delete anything when it trips", async () => {
    seed(25);
    const { promise, deleteObject } = run(false, () => "exists");
    const r = await promise;
    expect(r).toMatchObject({ mode: "delete", aborted: "tripwire", deleted: 0, cleared: 0 });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(db.records).toHaveLength(25);
  });

  it("delete mode is not made more permissive by earlier dry runs (it ignores their marks)", async () => {
    seed(25);
    await run(true, () => "exists").promise;
    expect(db.records.every((rec) => rec.checkedAt !== null)).toBe(true);
    const { promise, deleteObject } = run(false, () => "exists");
    const r = await promise;
    expect(r).toMatchObject({ examined: 25, aborted: "tripwire", deleted: 0 });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("wouldTrip: exactly the original rule, except an all-missing batch", () => {
    const t = (examined: number, unreferenced: number, existing: number, unknown = 0) =>
      wouldTrip({ examined, unreferenced, existing, unknown });
    expect(t(19, 19, 19)).toBe(false); // under the minimum batch, as before
    expect(t(20, 10, 1)).toBe(true); // exactly 50%, one existing file is enough
    expect(t(20, 9, 9)).toBe(false); // under 50%
    expect(t(20, 10, 0, 1)).toBe(true); // an uncheckable file counts like an existing one
    expect(t(20, 20, 0)).toBe(false); // every unreferenced file is definitely missing: nothing to delete
    expect(t(200, 200, 15)).toBe(true); // 185 missing + 15 existing
    expect(t(200, 99, 99)).toBe(false);
  });

  it("185 missing + 15 existing: no file is deleted, the missing records are still cleared", async () => {
    seed(200);
    const existingKeys = new Set(db.records.slice(0, 15).map((r) => r.key));
    const status = (k: string): ObjectStatus => (existingKeys.has(k) || k === CONTROL_KEY ? "exists" : "missing");
    const { promise, deleteObject } = run(false, status);
    const r = await promise;
    expect(r).toMatchObject({ examined: 200, existing: 15, missing: 185, deleted: 0, cleared: 185, aborted: "tripwire" });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(db.records.map((rec) => rec.key).sort()).toEqual([...existingKeys].sort());
  });

  it("the few files left after that are still protected when the reference check is broken", async () => {
    seed(15);
    db.brokenRefs = true;
    const { promise, deleteObject } = run(false, () => "exists");
    const r = await promise;
    expect(r).toMatchObject({ examined: 15, referenceCheck: "failed", aborted: "reference_check_failed", deleted: 0 });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(db.records).toHaveLength(15);
  });

  it("...and are deleted once the reference check passes its self-test (no stall)", async () => {
    seed(15);
    const { promise, deleteObject } = run(false, () => "exists");
    const r = await promise;
    expect(r).toMatchObject({ examined: 15, referenceCheck: "ok", deleted: 15 });
    expect(r.aborted).toBeUndefined();
    expect(deleteObject).toHaveBeenCalledTimes(15);
    expect(db.records).toHaveLength(0);
  });

  it("a mostly-referenced batch doesn't trip, even with missing files in it", async () => {
    seed(40);
    referenceAsPostMedia(db.records.slice(0, 25).map((r) => r.key));
    const missing = new Set(db.records.slice(25, 35).map((r) => r.key));
    const r = await run(false, (k) => (missing.has(k) ? "missing" : "exists")).promise;
    // 15 of 40 unreferenced: below half.
    expect(r).toMatchObject({ referenced: 25, existing: 5, missing: 10, deleted: 5, cleared: 10 });
    expect(r.aborted).toBeUndefined();
  });

  it("an all-missing batch never trips and clears its records", async () => {
    seed(30);
    const r = await run(false, (k) => (k === CONTROL_KEY ? "exists" : "missing")).promise;
    expect(r).toMatchObject({ missing: 30, cleared: 30, deleted: 0 });
    expect(r.aborted).toBeUndefined();
    expect(db.records).toHaveLength(0);
  });

  it("with no control URL at all (e.g. a wrong public base URL) no file is deleted", async () => {
    seed(3);
    db.controlUrl = null;
    const { promise, deleteObject } = run(false, () => "exists");
    const r = await promise;
    expect(r).toMatchObject({ referenceCheck: "no_controls", aborted: "reference_check_failed", deleted: 0 });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("a failed self-test still lets delete mode clear definitely missing records, and dry run still advances", async () => {
    seed(4);
    db.brokenRefs = true;
    const present = db.records[0].key;
    const status = (k: string): ObjectStatus => (k === present ? "exists" : "missing");
    const r = await run(false, status).promise;
    expect(r).toMatchObject({ referenceCheck: "failed", existing: 1, missing: 3, deleted: 0, cleared: 3 });
    seed(2);
    const dry = await run(true, status).promise;
    expect(dry).toMatchObject({ referenceCheck: "failed", marked: 3, deleted: 0 });
  });

  it("counts files storage couldn't check as suspicious, so an outage trips it", async () => {
    seed(25);
    const { promise, deleteObject } = run(false, () => "error");
    const r = await promise;
    expect(r).toMatchObject({ unknown: 25, aborted: "tripwire", deleted: 0, cleared: 0 });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(db.records).toHaveLength(25);
  });
});

describe("sweepAbandonedUploads — missing vs error", () => {
  it("never deletes or clears a record whose check errored", async () => {
    seed(4);
    const errKey = db.records[0].key;
    const missingKey = db.records[1].key;
    const { promise, deleteObject } = run(false, (k) => (k === errKey ? "error" : k === missingKey ? "missing" : "exists"));
    const r = await promise;
    expect(r).toMatchObject({ existing: 2, missing: 1, unknown: 1, deleted: 2, cleared: 1 });
    expect(deleteObject).not.toHaveBeenCalledWith(errKey);
    expect(deleteObject).not.toHaveBeenCalledWith(missingKey);
    expect(db.records.map((rec) => rec.key)).toEqual([errKey]);
  });

  it("keeps the record when the storage delete fails", async () => {
    seed(1);
    const deleteObject = vi.fn(async () => false);
    const r = await sweepAbandonedUploads({
      dryRun: false,
      minAgeMs: 48 * 3600_000,
      limit: 200,
      publicBaseUrl: BASE,
      deleteObject,
      objectStatus: async () => "exists",
    });
    expect(r.deleted).toBe(0);
    expect(db.records).toHaveLength(1);
  });

  it("doesn't believe 'not found' for everything unless a file that should exist is seen (misconfigured bucket)", async () => {
    seed(25);
    db.controlPosts = [{ videoUrl: `${BASE}/post-video/u2/live.mp4`, mediaUrls: [`${BASE}/post-image/u2/live.jpg`] }];
    for (const dryRun of [true, false]) {
      const { promise, deleteObject, objectStatus } = run(dryRun, () => "missing");
      const r = await promise;
      expect(r).toMatchObject({ existing: 0, missing: 0, unknown: 25, marked: 0, deleted: 0, cleared: 0, aborted: "storage_unverified" });
      expect(objectStatus).toHaveBeenCalledWith(CONTROL_KEY);
      expect(deleteObject).not.toHaveBeenCalled();
    }
    expect(db.records).toHaveLength(25);
    expect(db.records.every((rec) => rec.checkedAt === null)).toBe(true);
  });

  it("believes 'not found' once a known-used control file is seen", async () => {
    seed(25);
    db.controlPosts = [{ videoUrl: null, mediaUrls: ["https://giphy.example/x.gif", `${BASE}/post-image/u2/live.jpg`] }];
    const r = await run(false, (k) => (k === "post-image/u2/live.jpg" ? "exists" : "missing")).promise;
    expect(r).toMatchObject({ missing: 25, cleared: 25, deleted: 0 });
    expect(r.aborted).toBeUndefined();
    expect(db.records).toHaveLength(0);
  });

  it("dry run marks (never clears) confirmed-missing records", async () => {
    seed(3);
    referenceAsPostMedia([db.records[0].key]);
    const presentKey = db.records[1].key;
    const r = await run(true, (k) => (k === presentKey ? "exists" : "missing")).promise;
    expect(r).toMatchObject({ referenced: 1, existing: 1, missing: 1, marked: 2, cleared: 0 });
    expect(db.records).toHaveLength(2);
  });
});

describe("sweepAbandonedUploads — guards", () => {
  it("does nothing without a public URL", async () => {
    seed(2);
    const r = await sweepAbandonedUploads({
      dryRun: false,
      minAgeMs: 0,
      limit: 10,
      publicBaseUrl: undefined,
      deleteObject: vi.fn(),
      objectStatus: vi.fn(),
    });
    expect(r.aborted).toBe("no_public_url");
    expect(db.records).toHaveLength(2);
  });
});
