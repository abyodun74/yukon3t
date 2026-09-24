import { prisma } from "@/lib/prisma";

// Sweeps up uploads nothing ever used.
//
// Composers upload an attachment the moment it's picked (upload-client.ts prefetchUpload). If it is then removed the
// client deletes it (discardUploads) — but a closed tab, a crash or a lost connection can't run that cleanup, and a
// post that failed after its media went up can leave media behind too. So every post-style presigned upload is
// recorded here, and sweepAbandonedUploads later deletes the ones that, after a grace period, no row in the database
// points at. Deleting stored media is irreversible, so this is deliberately cautious: dry-run unless explicitly turned
// on, a long grace period, an exact-URL reference check across EVERY column that can hold one of these URLs, a cap per
// run, and a tripwire that refuses to delete anything if a suspicious share of candidates look unreferenced (which is
// what a broken reference check would look like).

/** Kinds recorded and swept — the ones a composer uploads ahead of posting. Same set discardUploads may delete. */
const SWEEPABLE_KINDS = new Set([
  "post-image",
  "post-video",
  "video-thumb",
  "muse-video",
  "message-image",
  "message-video",
  "comment-video",
  "story-image",
  "story-video",
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
 * Which of `urls` are referenced by anything in the database. Exact match against every column that can hold one of
 * these media URLs, plus a .mov that a conversion is still working on. If a new place that stores a media URL is ever
 * added, it MUST be added here too — otherwise the sweep would delete media that place is using.
 */
export async function findReferencedUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const inList = { in: urls };
  const [posts, comments, messages, stories, muses, ads, conversions] = await Promise.all([
    prisma.post.findMany({
      where: { OR: [{ videoUrl: inList }, { videoThumbnailUrl: inList }, { mediaUrls: { hasSome: urls } }] },
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
      where: { OR: [{ mediaUrl: inList }, { mediaThumbnailUrl: inList }] },
      select: { mediaUrl: true, mediaThumbnailUrl: true },
    }),
    prisma.muse.findMany({
      where: { OR: [{ videoUrl: inList }, { videoThumbnailUrl: inList }, { audioUrl: inList }] },
      select: { videoUrl: true, videoThumbnailUrl: true, audioUrl: true },
    }),
    prisma.adCampaign.findMany({ where: { mediaUrl: inList }, select: { mediaUrl: true } }),
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
  for (const r of stories) [r.mediaUrl, r.mediaThumbnailUrl].forEach(note);
  for (const r of muses) [r.videoUrl, r.videoThumbnailUrl, r.audioUrl].forEach(note);
  for (const r of ads) note(r.mediaUrl);
  for (const r of conversions) note(r.sourceUrl);
  return found;
}

export type SweepResult = {
  mode: "dry_run" | "delete";
  examined: number;
  referenced: number;
  unreferenced: number;
  deleted: number;
  aborted?: "no_public_url" | "tripwire";
  sample: string[];
};

export type SweepOptions = {
  dryRun: boolean;
  /** Only uploads older than this are looked at — comfortably longer than any real "pick, then post" gap. */
  minAgeMs: number;
  /** At most this many uploads examined (and so deleted) per run. */
  limit: number;
  publicBaseUrl: string | undefined;
  deleteObject: (key: string) => Promise<void>;
};

/** A candidate batch this size or larger with at least this share unreferenced is treated as a sign the reference check is broken. */
const TRIPWIRE_MIN_BATCH = 20;
const TRIPWIRE_UNREFERENCED_SHARE = 0.5;

export async function sweepAbandonedUploads(opts: SweepOptions): Promise<SweepResult> {
  const result: SweepResult = {
    mode: opts.dryRun ? "dry_run" : "delete",
    examined: 0,
    referenced: 0,
    unreferenced: 0,
    deleted: 0,
    sample: [],
  };
  if (!opts.publicBaseUrl) return { ...result, aborted: "no_public_url" };
  const base = opts.publicBaseUrl.replace(/\/$/, "");

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
  result.sample = orphans.slice(0, 5).map((o) => o.key);

  // Referenced uploads are in use: forget the record (the object stays), whether or not this is a dry run.
  if (referenced.length > 0) {
    await prisma.uploadRecord.deleteMany({ where: { id: { in: referenced.map((c) => c.id) } } });
  }

  if (candidates.length >= TRIPWIRE_MIN_BATCH && orphans.length / candidates.length >= TRIPWIRE_UNREFERENCED_SHARE) {
    console.error(
      `[upload-sweep] tripwire: ${orphans.length}/${candidates.length} candidates look unreferenced — refusing to delete anything`,
    );
    return { ...result, aborted: "tripwire" };
  }

  if (opts.dryRun) {
    if (orphans.length > 0) {
      await prisma.uploadRecord.updateMany({ where: { id: { in: orphans.map((o) => o.id) } }, data: { checkedAt: new Date() } });
    }
    return result;
  }

  for (const orphan of orphans) {
    await opts.deleteObject(orphan.key);
    await prisma.uploadRecord.delete({ where: { id: orphan.id } }).catch(() => {});
    result.deleted += 1;
  }
  return result;
}
