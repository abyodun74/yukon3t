import { prisma } from "@/lib/prisma";

// Sweeps up uploads nothing ever used.
//
// Composers upload an attachment the moment it's picked (upload-client.ts prefetchUpload). If it is then removed the
// client deletes it (discardUploads) — but a closed tab, a crash or a lost connection can't run that cleanup, and a
// post that failed after its media went up can leave media behind too. So every post-style presigned upload is
// recorded here, and sweepAbandonedUploads later deletes the ones that, after a grace period, no row in the database
// points at. Deleting stored media is irreversible, so this is deliberately cautious: dry-run unless explicitly turned
// on, a long grace period, an exact-URL reference check across EVERY column that can hold one of these URLs, a cap per
// run, a self-test of the reference check (known-used URLs must come back referenced), and the original tripwire
// (wouldTrip) that refuses to delete any file when a suspicious share of the batch looks unreferenced.
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
 * Every column findReferencedUrls checks, as "Model.field". Only columns whose every write path stores the writer's
 * OWN upload (or a URL copied server-side from a row the writer may share) belong here: findReferencedUrls also
 * decides what deleteMediaIfUnreferenced keeps, so a column anyone can type any URL into (Post.linkUrl,
 * AdCampaign.linkUrl) would let them keep someone else's deleted media alive. upload-records-coverage.test.ts fails
 * when a schema column that could hold an upload URL is neither here nor in its explicit exclusion list, and
 * upload-records.test.ts checks that each one listed here is really queried and counted.
 */
export const MEDIA_REFERENCE_COLUMNS = [
  "Post.mediaUrls",
  "Post.videoUrl",
  "Post.videoThumbnailUrl",
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
          OR: [{ videoUrl: inList }, { videoThumbnailUrl: inList }, { mediaUrls: { hasSome: urls } }],
        },
        select: { videoUrl: true, videoThumbnailUrl: true, mediaUrls: true },
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
      prisma.adCampaign.findMany({ where: { mediaUrl: inList }, select: { mediaUrl: true } }),
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
    r.mediaUrls.forEach(note);
  }
  for (const r of comments) [r.videoUrl, r.videoThumbnailUrl, r.audioUrl].forEach(note);
  for (const r of messages) [r.mediaUrl, r.mediaThumbnailUrl].forEach(note);
  for (const r of stories) [r.mediaUrl, r.mediaThumbnailUrl, r.audioUrl].forEach(note);
  for (const r of muses) [r.videoUrl, r.videoThumbnailUrl, r.audioUrl].forEach(note);
  for (const r of ads) note(r.mediaUrl);
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
  /** Unreferenced and storage definitely says the file is gone. Can't trip the tripwire on their own. */
  missing: number;
  /** Unreferenced but storage couldn't be asked (or couldn't be trusted this run). Left untouched, retried later. */
  unknown: number;
  /**
   * The reference check's self-test: URLs known to be in use (the newest of each checked column that has any) must
   * all come back as referenced. "failed" or "no_controls" blocks every file deletion this run.
   */
  referenceCheck: "ok" | "failed" | "no_controls" | "skipped";
  /** Dry run: records marked as checked so the next dry run moves on (nothing deleted). */
  marked: number;
  /** Delete mode: files deleted. */
  deleted: number;
  /** Delete mode: records cleared because their file was already gone. */
  cleared: number;
  aborted?: "no_public_url" | "tripwire" | "storage_unverified" | "reference_check_failed";
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

/** The tripwire's thresholds, unchanged from the original: see wouldTrip. */
export const TRIPWIRE_MIN_BATCH = 20;
export const TRIPWIRE_UNREFERENCED_SHARE = 0.5;
const STATUS_CONCURRENCY = 10;

/**
 * Blocks every FILE deletion of a batch exactly when the original tripwire would have tripped (examined >= 20 and
 * unreferenced >= 50%, missing files counted as unreferenced as before), except that a batch whose unreferenced
 * files are ALL definitely missing never trips: there is nothing in it to delete. Clearing the records of definitely
 * missing files is never blocked by it, so a backlog of gone files can't stall the sweep.
 */
export function wouldTrip(c: { examined: number; unreferenced: number; existing: number; unknown: number }): boolean {
  return (
    c.examined >= TRIPWIRE_MIN_BATCH &&
    c.unreferenced / c.examined >= TRIPWIRE_UNREFERENCED_SHARE &&
    c.existing + c.unknown > 0
  );
}

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
 * URLs the database certainly uses right now, under this bucket's public URL: the newest one of each checked column
 * that has any (up to two from Post.mediaUrls, whose rows may also hold Giphy links). They test the reference check
 * itself (each must come back referenced) and, as files that should exist, storage's "not found" answers. A wrong
 * public base URL finds none, which blocks every file deletion.
 */
export async function referenceControls(base: string): Promise<string[]> {
  const prefix = `${base}/`;
  const sw = { startsWith: prefix };
  const newest = { orderBy: { createdAt: "desc" as const } };
  try {
    const [images, ...singles] = await Promise.all([
      prisma.post.findMany({ where: { mediaUrls: { isEmpty: false } }, ...newest, take: 5, select: { mediaUrls: true } }),
      prisma.post.findFirst({ where: { videoUrl: sw }, ...newest, select: { videoUrl: true } }),
      prisma.post.findFirst({ where: { videoThumbnailUrl: sw }, ...newest, select: { videoThumbnailUrl: true } }),
      prisma.comment.findFirst({ where: { videoUrl: sw }, ...newest, select: { videoUrl: true } }),
      prisma.comment.findFirst({ where: { audioUrl: sw }, ...newest, select: { audioUrl: true } }),
      prisma.message.findFirst({ where: { mediaUrl: sw }, ...newest, select: { mediaUrl: true } }),
      prisma.story.findFirst({ where: { mediaUrl: sw }, ...newest, select: { mediaUrl: true } }),
      prisma.muse.findFirst({ where: { videoUrl: sw }, ...newest, select: { videoUrl: true } }),
      prisma.adCampaign.findFirst({ where: { mediaUrl: sw }, ...newest, select: { mediaUrl: true } }),
      prisma.announcement.findFirst({ where: { mediaUrl: sw }, ...newest, select: { mediaUrl: true } }),
      prisma.ambientMoment.findFirst({ where: { imageUrl: sw }, ...newest, select: { imageUrl: true } }),
      prisma.circle.findFirst({ where: { coverImageUrl: sw }, ...newest, select: { coverImageUrl: true } }),
      prisma.videoConversion.findFirst({ where: { sourceUrl: sw }, ...newest, select: { sourceUrl: true } }),
    ]);
    const urls = images
      .flatMap((p) => p.mediaUrls)
      .filter((u) => u.startsWith(prefix))
      .slice(0, 2);
    for (const row of singles) {
      for (const v of Object.values(row ?? {})) if (typeof v === "string" && v.startsWith(prefix)) urls.push(v);
    }
    return [...new Set(urls)];
  } catch (err) {
    console.error("[upload-sweep] couldn't look up control URLs", err);
    return [];
  }
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
    referenceCheck: "skipped",
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

  // The controls go through the very same query as the candidates, so a reference check that can't see what the
  // database uses (a wrong public URL, a broken query) fails its self-test however small the batch is.
  const controls = await referenceControls(base);
  const candidateUrls = candidates.map((c) => `${base}/${c.key}`);
  const referencedUrls = await findReferencedUrls([...new Set([...candidateUrls, ...controls])]);
  result.referenceCheck =
    controls.length === 0 ? "no_controls" : controls.every((u) => referencedUrls.has(u)) ? "ok" : "failed";
  const referenced = candidates.filter((c) => referencedUrls.has(`${base}/${c.key}`));
  const orphans = candidates.filter((c) => !referencedUrls.has(`${base}/${c.key}`));
  result.referenced = referenced.length;
  result.unreferenced = orphans.length;

  // Referenced uploads are in use: forget the record (the object stays), whether or not this is a dry run.
  if (referenced.length > 0) {
    await prisma.uploadRecord.deleteMany({ where: { id: { in: referenced.map((c) => c.id) } } });
  }
  if (orphans.length === 0) return result;
  if (result.referenceCheck !== "ok") {
    console.error(
      `[upload-sweep] reference check self-test: ${result.referenceCheck} (${controls.length} control URL(s)) — no file will be deleted this run`,
    );
    result.aborted = "reference_check_failed";
  }

  const statuses = await mapLimit(orphans, STATUS_CONCURRENCY, (o) => safeStatus(opts.objectStatus, o.key));
  const existing = orphans.filter((_, i) => statuses[i] === "exists");
  let missing = orphans.filter((_, i) => statuses[i] === "missing");
  let unknown = orphans.filter((_, i) => statuses[i] === "error");

  // A misconfigured bucket or a storage fault can answer "not found" for everything. Believe a not-found only once
  // storage has shown it can see a file that should be there: one of these orphans, or a file known to be in use.
  if (missing.length > 0 && existing.length === 0) {
    const prefix = `${base}/`;
    const controlKeys = [
      ...referenced.slice(0, 3).map((r) => r.key),
      ...controls.filter((u) => u.startsWith(prefix)).map((u) => u.slice(prefix.length)),
    ];
    let verified = false;
    for (const key of [...new Set(controlKeys)]) {
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
      result.aborted ??= "storage_unverified";
    }
  }
  result.existing = existing.length;
  result.missing = missing.length;
  result.unknown = unknown.length;
  result.sample = [...existing, ...missing, ...unknown].slice(0, 5).map((o) => o.key);

  const tripped = wouldTrip(result);
  if (tripped) {
    console.error(
      `[upload-sweep] tripwire: ${orphans.length}/${candidates.length} candidates look unreferenced (${existing.length} existing, ${unknown.length} uncheckable) — ${
        opts.dryRun ? "a delete run would refuse to delete any file" : "refusing to delete any file"
      }`,
    );
    // An earlier reason, if set, is kept: it is the more fundamental problem. Either way no file is deleted.
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

  // Files only with a passing self-test and no tripwire. Records of definitely missing files (storage verified) are
  // cleared either way: there is no file left to protect, and a backlog of them must not stall the sweep.
  if (!tripped && result.referenceCheck === "ok") {
    for (const orphan of existing) {
      if (await opts.deleteObject(orphan.key)) {
        await prisma.uploadRecord.deleteMany({ where: { id: orphan.id } }).catch(() => {});
        result.deleted += 1;
      }
    }
  }
  if (missing.length > 0) {
    const { count } = await prisma.uploadRecord.deleteMany({ where: { id: { in: missing.map((o) => o.id) } } });
    result.cleared = count;
  }
  return result;
}
