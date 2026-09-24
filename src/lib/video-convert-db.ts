import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import {
  createStreamCopy,
  deleteStreamVideo,
  getMp4Download,
  getStreamStatus,
  requestMp4Download,
} from "@/lib/cloudflare-stream";
import { deleteObject, keyFromPublicUrl, uploadStream } from "@/lib/storage";
import { MAX_CONVERTED_BYTES, type ConversionDeps } from "@/lib/video-convert";

const MOV = { endsWith: ".mov", mode: "insensitive" as const };

/**
 * Stored .mov URLs still awaiting conversion, oldest first, across every place
 * a video URL is saved. Every such URL is pending by definition — a finished
 * conversion swaps the URL to the .mp4 — so this needs no bookkeeping beyond
 * the exclusion list of ones already given up on.
 */
export async function findMovSources(limit: number, excludeUrls: string[]): Promise<string[]> {
  const notGivenUp = excludeUrls.length ? { notIn: excludeUrls } : undefined;
  const cond = (field: string) => ({ [field]: { ...MOV, ...(notGivenUp ?? {}) } });

  const [posts, comments, muses, stories, messages, ads] = await Promise.all([
    prisma.post.findMany({ where: { mediaType: "VIDEO", ...cond("videoUrl") }, orderBy: { createdAt: "asc" }, take: limit, select: { videoUrl: true } }),
    prisma.comment.findMany({ where: cond("videoUrl"), orderBy: { createdAt: "asc" }, take: limit, select: { videoUrl: true } }),
    prisma.muse.findMany({ where: cond("videoUrl"), orderBy: { createdAt: "asc" }, take: limit, select: { videoUrl: true } }),
    prisma.story.findMany({ where: { mediaType: "VIDEO", ...cond("mediaUrl") }, orderBy: { createdAt: "asc" }, take: limit, select: { mediaUrl: true } }),
    prisma.message.findMany({ where: { mediaType: "VIDEO", ...cond("mediaUrl") }, orderBy: { createdAt: "asc" }, take: limit, select: { mediaUrl: true } }),
    prisma.adCampaign.findMany({ where: { mediaType: "VIDEO", ...cond("mediaUrl") }, orderBy: { createdAt: "asc" }, take: limit, select: { mediaUrl: true } }),
  ]);

  const urls = [
    ...posts.map((r) => r.videoUrl),
    ...comments.map((r) => r.videoUrl),
    ...muses.map((r) => r.videoUrl),
    ...stories.map((r) => r.mediaUrl),
    ...messages.map((r) => r.mediaUrl),
    ...ads.map((r) => r.mediaUrl),
  ].filter((u): u is string => Boolean(u));
  return [...new Set(urls)].slice(0, limit);
}

/**
 * Muse videos still awaiting orientation normalization (see video-convert.ts's
 * top-of-file comment), oldest first — every Muse video, not just .mov ones,
 * since the bug this fixes isn't specific to that format. Unlike
 * findMovSources above, a video's extension alone can't signal "already
 * done" here (the output is still just an .mp4, same as the input usually
 * already was) — so a candidate is instead recognized by checking whether
 * its current videoUrl is any earlier job's own source or finished output.
 * Bounded by how many videos have ever gone through this pipeline, not by
 * the total Muse count, so this scales with conversion volume rather than
 * total Muse volume.
 */
export async function findMuseVideoSources(limit: number, excludeUrls: string[]): Promise<string[]> {
  const tracked = await prisma.videoConversion.findMany({
    select: { sourceUrl: true, outputUrl: true },
  });
  const excluded = new Set(excludeUrls);
  for (const t of tracked) {
    excluded.add(t.sourceUrl);
    if (t.outputUrl) excluded.add(t.outputUrl);
  }

  const muses = await prisma.muse.findMany({
    where: excluded.size ? { videoUrl: { notIn: [...excluded] } } : undefined,
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { videoUrl: true },
  });
  return [...new Set(muses.map((m) => m.videoUrl))];
}

/** Points every stored reference to `fromUrl` at `toUrl` (every table that keeps a video URL); returns rows changed. */
async function swapVideoUrl(fromUrl: string, toUrl: string): Promise<number> {
  const results = await Promise.all([
    prisma.post.updateMany({ where: { videoUrl: fromUrl }, data: { videoUrl: toUrl } }),
    prisma.comment.updateMany({ where: { videoUrl: fromUrl }, data: { videoUrl: toUrl } }),
    prisma.muse.updateMany({ where: { videoUrl: fromUrl }, data: { videoUrl: toUrl } }),
    prisma.story.updateMany({ where: { mediaUrl: fromUrl }, data: { mediaUrl: toUrl } }),
    prisma.message.updateMany({ where: { mediaUrl: fromUrl }, data: { mediaUrl: toUrl } }),
    prisma.adCampaign.updateMany({ where: { mediaUrl: fromUrl }, data: { mediaUrl: toUrl } }),
  ]);
  return results.reduce((sum, r) => sum + r.count, 0);
}

/** Streams the converted MP4 from Cloudflare into R2 — never buffered in memory. `signal` bounds one attempt to this tick's time budget. */
async function copyDownloadToR2(downloadUrl: string, key: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(downloadUrl, { cache: "no-store", signal });
  if (!res.ok || !res.body) throw new Error(`download_${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_CONVERTED_BYTES) throw new Error("too_large");
  return uploadStream({
    key,
    body: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    contentType: "video/mp4",
    signal,
  });
}

/** The real dependencies for advanceConversion. `signal` cuts a long copy off when this cron tick runs out of time. */
export function productionConversionDeps(signal: AbortSignal): ConversionDeps {
  return {
    createStreamCopy,
    getStreamStatus,
    requestMp4Download,
    getMp4Download,
    deleteStreamVideo,
    keyFromPublicUrl,
    copyToR2: (downloadUrl, key) => copyDownloadToR2(downloadUrl, key, signal),
    deleteObject,
    swapUrl: swapVideoUrl,
  };
}
