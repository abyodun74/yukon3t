import { prisma } from "@/lib/prisma";

// Sweeps up uploads nothing ever used.
//
// Composers upload an attachment the moment it's picked (upload-client.ts prefetchUpload). If it is then removed the
// client deletes it (discardUploads) — but a closed tab, a crash or a lost connection can't run that cleanup, and a
// post that failed after its media went up can leave media behind too. So every post-style presigned upload is
// recorded here, and sweepAbandonedUploads later deletes the ones that, after a grace period, no row in the database
// points at. Deleting stored media is irreversible, so this is deliberately cautious: dry-run unless explicitly turned
// on, a long grace period, an exact-URL reference check across EVERY column that can hold one of these URLs, a cap per
// run, and a tripwire that refuses to delete anything if a suspicious share of the files that still exist look
// unreferenced (which is what a broken reference check would look like).
//
// A record is also forgotten whenever its file is deleted by any other path (storage.ts deleteObject calls
// forgetUploadRecords once R2 confirmed the delete), so records of files that are already gone don't pile up.

/**
 * Kinds recorded and swept — the ones a composer uploads ahead of posting (the same set discardUploads may delete),
 * plus the public ad booking's uploads (requestAdUpload, owner "anonymous"): a booking that is never completed leaves
 * them behind, and AdCampaign.mediaUrl is in findReferencedUrls, so a booked creative is never swept. A video ad's
 * poster frame is only used for screening, so it is swept even when the booking went through.
 */
export const SWEEPABLE_KINDS: ReadonlySet<string> = new Set([
  "post-image",
  "post-video",
  "video-thumb",
  "muse-video",
  "message-image",
  "message-video",
  "comment-video",
  "story-image",
  "story-video",
  "ad-image",
  "ad-video",
]);

/** Remembers that `keys` (all belonging to `userId`) were handed out as upload URLs. Never throws — recording must not break an upload. */
export async function recordUploads(items: { key: string; kind: string }[], userId: string) {
  const rows = items.filter((i) => SWEEPABLE_KINDS.has(i.kind)).map((i) => ({ key: i.key, kind: i.kind, userId }));
  if (rows.length === 0) return;
  try {
    await prisma.uploadRecord.createMany({ data: rows, skipDuplicates: true });
  } catch (err) {
    console.error("[upload-records] failed to record uploads", err);
  }
}

/**
 * Drops the upload records of files that were just deleted from storage. Call it only AFTER the storage delete
 * succeeded (storage.ts deleteObject does). Never throws: this is bookkeeping, and a failure must not turn the user's
 * delete into an error. A record left behind by a failure here is harmless; the sweep finds its file missing.
 */
export async function forgetUploadRecords(keys: readonly string[]): Promise<void> {
  const list = [...new Set(keys.filter((k) => typeof k === "string" && k.length > 0))];
  if (list.length === 0) return;
  try {
    await prisma.uploadRecord.deleteMany({ where: { key: { in: list } } });
  } catch (err) {
    console.error("[upload-records] failed to forget records of deleted uploads", err);
  }
}

/**
 * Every column findReferencedUrls checks, as "Model.field". upload-records-coverage.test.ts fails when a schema
 * column that could hold an upload URL is neither here nor in its explicit exclusion list, and
 * upload-records.test.ts checks that each one listed here is really queried and counted.
 */
export const MEDIA_REFERENCE_COLUMNS = [
  "Post.mediaUrls",
  "Post.videoUrl",
  "Post.videoThumbnailUrl",
  "Post.linkUrl",
  "Comment.videoUrl",
  "Comment.videoThumbnailUrl",
  "Comment.audioUrl",
  "Message.mediaUrl",
  "Message.mediaThumbnailUrl",
  "Story.mediaUrl",
  "Story.mediaThumbnailUrl",
  "Story.audioUrl",
  "Muse.videoUrl",
  "Muse.videoThumbnailUrl",
  "Muse.audioUrl",
  "AdCampaign.mediaUrl",
  "AdCampaign.linkUrl",
  "Announcement.mediaUrl",
  "Announcement.mediaThumbnailUrl",
  "AmbientMoment.imageUrl",
  "Circle.coverImageUrl",
  "VideoConversion.sourceUrl",
] as const;

/**
 * Which of `urls` are referenced by anything in the database. Exact match against every column that can hold one of
 * these media URLs (MEDIA_REFERENCE_COLUMNS), plus a .mov that a conversion is still working on. If a new place that
 * stores a media URL is ever added, it MUST be added here too — otherwise the sweep (and deleteMediaIfUnreferenced)
 * would delete media that place is using.
 */
export async function findReferencedUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const inList = { in: urls };
  const [posts, comments, messages, stories, muses, ads, announcements, moments, circles, conversions] =
    await Promise.all([
      prisma.post.findMany({
        where: {
          OR: [{ videoUrl: inList }, { videoThumbnailUrl: inList }, { mediaUrls: { hasSome: urls } }, { linkUrl: inList }],
        },
        select: { videoUrl: true, videoThumbnailUrl: true, mediaUrls: true, linkUrl: true },
      }),
      prisma.comment.findMany({
        where: { OR: [{ videoUrl: inList }, { videoThumbnailUrl: inList }, { audioUrl: inList }] },
        select: { videoUrl: true, videoThumbnailUrl: true, audioUrl: true },
      }),
      prisma.message.findMany({
        where: { OR: [{ mediaUrl: inList }, { mediaThumbnailUrl: inList }] },
        select: { mediaUrl: true, mediaThumbnailUrl: true },
      }),
      prisma.story.findMany({
        where: { OR: [{ mediaUrl: inList }, { mediaThumbnailUrl: inList }, { audioUrl: inList }] },
        select: { mediaUrl: true, mediaThumbnailUrl: true, audioUrl: true },
      }),
      prisma.muse.findMany({
        where: { OR: [{ videoUrl: inList }, { videoThumbnailUrl: inList }, { audioUrl: inList }] },
        select: { videoUrl: true, videoThumbnailUrl: true, audioUrl: true },
      }),
      prisma.adCampaign.findMany({
        where: { OR: [{ mediaUrl: inList }, { linkUrl: inList }] },
        select: { mediaUrl: true, linkUrl: true },
      }),
      prisma.announcement.findMany({
        where: { OR: [{ mediaUrl: inList }, { mediaThumbnailUrl: inList }] },
        select: { mediaUrl: true, mediaThumbnailUrl: true },
      }),
      prisma.ambientMoment.findMany({ where: { imageUrl: inList }, select: { imageUrl: true } }),
      prisma.circle.findMany({ where: { coverImageUrl: inList }, select: { coverImageUrl: true } }),
      prisma.videoConversion.findMany({ where: { sourceUrl: inList }, select: { sourceUrl: true } }),
    ]);

  const wanted = new Set(urls);
  const found = new Set<string>();
  const note = (u: string | null | undefined) => {
    if (u && wanted.has(u)) found.add(u);
  };
  for (const r of posts) {
    note(r.videoUrl);
    note(r.videoThumbnailUrl);
    note(r.linkUrl);
    r.mediaUrls.forEach(note);
  }
  for (const r of comments) [r.videoUrl, r.videoThumbnailUrl, r.audioUrl].forEach(note);
  for (const r of messages) [r.mediaUrl, r.mediaThumbnailUrl].forEach(note);
  for (const r of stories) [r.mediaUrl, r.mediaThumbnailUrl, r.audioUrl].forEach(note);
  for (const r of muses) [r.videoUrl, r.videoThumbnailUrl, r.audioUrl].forEach(note);
  for (const r of ads) [r.mediaUrl, r.linkUrl].forEach(note);
  for (const r of announcements) [r.mediaUrl, r.mediaThumbnailUrl].forEach(note);
  for (const r of moments) note(r.imageUrl);
  for (const r of circles) note(r.coverImageUrl);
  for (const r of conversions) note(r.sourceUrl);
  return found;
}

/**
 * What storage says about one object: present, definitely not found (a 404 / NotFound answer), or anything else
 * (outage, timeout, credentials). "error" is never treated as missing and never leads to a delete.
 */
export type ObjectStatus = "exists" | "missing" | "error";

export type SweepResult = {
  mode: "dry_run" | "delete";
  /** Records looked at this run. */
  examined: number;
  /** Records whose URL something in the database uses (their record is forgotten; the file stays). */
  referenced: number;
  /** Records nothing references (= existing + missing + unknown). */
  unreferenced: number;
  /** Unreferenced and the file is in storage: what delete mode deletes. */
  existing: number;
  /** Unreferenced and storage definitely says the file is gone. Never counted by the tripwire. */
  missing: number;
  /** Unreferenced but storage couldn't be asked (or couldn't be trusted this run). Left untouched, retried later. */
  unknown: number;
  /** Dry run: records marked as checked so the next dry run moves on (nothing deleted). */
  marked: number;
  /** Delete mode: files deleted. */
  deleted: number;
  /** Delete mode: records cleared because their file was already gone. */
  cleared: number;
  aborted?: "no_public_url" | "tripwire" | "storage_unverified";
  sample: string[];
};

type SweepOptions = {
  dryRun: boolean;
  /** Only uploads older than this are looked at — comfortably longer than any real "pick, then post" gap. */
  minAgeMs: number;
  /** At most this many uploads examined (and so deleted) per run. */
  limit: number;
  publicBaseUrl: string | undefined;
  /** Deletes a stored file; true only when storage confirmed the delete. */
  deleteObject: (key: string) => Promise<boolean>;
  /** HEADs a stored file. */
  objectStatus: (key: string) => Promise<ObjectStatus>;
};

/**
 * Among the files that exist (plus the ones storage couldn't check, counted as if they existed and were unreferenced),
 * a batch this size or larger with at least this share unreferenced is treated as a sign the reference check is
 * broken: delete mode refuses to delete anything.
 */
export const TRIPWIRE_MIN_BATCH = 20;
export const TRIPWIRE_UNREFERENCED_SHARE = 0.5;
const STATUS_CONCURRENCY = 10;
const CONTROL_POSTS = 5;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function safeStatus(check: SweepOptions["objectStatus"], key: string): Promise<ObjectStatus> {
  try {
    const s = await check(key);
    return s === "exists" || s === "missing" ? s : "error";
  } catch {
    return "error";
  }
}

/**
 * Keys of files that should exist: this batch's referenced uploads first, then the media of a few recent posts.
 * Used only to prove that storage is answering for the right bucket before any "not found" is believed.
 */
async function controlKeys(base: string, referencedKeys: string[]): Promise<string[]> {
  const prefix = `${base}/`;
  const keys = referencedKeys.slice(0, 3);
  try {
    const [videos, images] = await Promise.all([
      prisma.post.findMany({
        where: { videoUrl: { startsWith: prefix } },
        orderBy: { createdAt: "desc" },
        take: CONTROL_POSTS,
        select: { videoUrl: true },
      }),
      prisma.post.findMany({
        where: { mediaUrls: { isEmpty: false } },
        orderBy: { createdAt: "desc" },
        take: CONTROL_POSTS,
        select: { mediaUrls: true },
      }),
    ]);
    for (const u of [...videos.map((v) => v.videoUrl), ...images.flatMap((p) => p.mediaUrls)]) {
      if (u && u.startsWith(prefix)) keys.push(u.slice(prefix.length));
    }
  } catch (err) {
    console.error("[upload-sweep] couldn't look up control files", err);
  }
  return [...new Set(keys)].slice(0, 2 * CONTROL_POSTS + 3);
}

export async function sweepAbandonedUploads(opts: SweepOptions): Promise<SweepResult> {
  const result: SweepResult = {
    mode: opts.dryRun ? "dry_run" : "delete",
    examined: 0,
    referenced: 0,
    unreferenced: 0,
    existing: 0,
    missing: 0,
    unknown: 0,
    marked: 0,
    deleted: 0,
    cleared: 0,
    sample: [],
  };
  if (!opts.publicBaseUrl) return { ...result, aborted: "no_public_url" };
  const base = opts.publicBaseUrl.replace(/\/$/, "");

  // Delete mode deliberately ignores checkedAt: a dry run's marks can never make delete mode skip, or trust, anything.
  const candidates = await prisma.uploadRecord.findMany({
    where: { createdAt: { lt: new Date(Date.now() - opts.minAgeMs) }, ...(opts.dryRun ? { checkedAt: null } : {}) },
    orderBy: { createdAt: "asc" },
    take: opts.limit,
  });
  result.examined = candidates.length;
  if (candidates.length === 0) return result;

  const referencedUrls = await findReferencedUrls(candidates.map((c) => `${base}/${c.key}`));
  const referenced = candidates.filter((c) => referencedUrls.has(`${base}/${c.key}`));
  const orphans = candidates.filter((c) => !referencedUrls.has(`${base}/${c.key}`));
  result.referenced = referenced.length;
  result.unreferenced = orphans.length;

  // Referenced uploads are in use: forget the record (the object stays), whether or not this is a dry run.
  if (referenced.length > 0) {
    await prisma.uploadRecord.deleteMany({ where: { id: { in: referenced.map((c) => c.id) } } });
  }
  if (orphans.length === 0) return result;

  const statuses = await mapLimit(orphans, STATUS_CONCURRENCY, (o) => safeStatus(opts.objectStatus, o.key));
  const existing = orphans.filter((_, i) => statuses[i] === "exists");
  let missing = orphans.filter((_, i) => statuses[i] === "missing");
  let unknown = orphans.filter((_, i) => statuses[i] === "error");

  // A misconfigured bucket or a storage fault can answer "not found" for everything. Believe a not-found only once
  // storage has shown it can see a file that should be there: one of these orphans, or a known-used control file.
  if (missing.length > 0 && existing.length === 0) {
    const controls = await controlKeys(
      base,
      referenced.map((r) => r.key),
    );
    let verified = false;
    for (const key of controls) {
      if ((await safeStatus(opts.objectStatus, key)) === "exists") {
        verified = true;
        break;
      }
    }
    if (!verified) {
      console.error(
        `[upload-sweep] storage answered "not found" for ${missing.length} upload(s) but couldn't show any file that should exist — treating them as unknown`,
      );
      unknown = [...unknown, ...missing];
      missing = [];
      result.aborted = "storage_unverified";
    }
  }
  result.existing = existing.length;
  result.missing = missing.length;
  result.unknown = unknown.length;
  result.sample = [...existing, ...missing, ...unknown].slice(0, 5).map((o) => o.key);

  // Missing files don't count: the ratio is over files that exist. Files storage couldn't check are counted as if
  // they existed and were unreferenced, so an outage makes the tripwire likelier to trip, never less.
  const suspicious = existing.length + unknown.length;
  const pool = referenced.length + suspicious;
  const tripped = pool >= TRIPWIRE_MIN_BATCH && suspicious / pool >= TRIPWIRE_UNREFERENCED_SHARE;
  if (tripped) {
    console.error(
      `[upload-sweep] tripwire: ${suspicious}/${pool} existing (or uncheckable) candidates look unreferenced — ${
        opts.dryRun ? "a delete run would refuse to delete anything" : "refusing to delete anything"
      }`,
    );
    // storage_unverified, if set, is kept: it is the more fundamental problem. Either way nothing is deleted.
    result.aborted ??= "tripwire";
  }

  if (opts.dryRun) {
    // Mark (never delete) what was checked, so the next dry run moves on to newer records even when the tripwire
    // tripped. Unknown ones stay unmarked and are looked at again next time.
    const checked = [...existing, ...missing];
    if (checked.length > 0) {
      const { count } = await prisma.uploadRecord.updateMany({
        where: { id: { in: checked.map((o) => o.id) } },
        data: { checkedAt: new Date() },
      });
      result.marked = count;
    }
    return result;
  }

  if (tripped) return result;

  for (const orphan of existing) {
    if (await opts.deleteObject(orphan.key)) {
      await prisma.uploadRecord.deleteMany({ where: { id: orphan.id } }).catch(() => {});
      result.deleted += 1;
    }
  }
  if (missing.length > 0) {
    const { count } = await prisma.uploadRecord.deleteMany({ where: { id: { in: missing.map((o) => o.id) } } });
    result.cleared = count;
  }
  return result;
}
