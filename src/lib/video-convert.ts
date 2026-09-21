// Re-encodes QuickTime (.mov) uploads to a broadly playable H.264 MP4.
//
// Why: an iPhone's default "High Efficiency" capture is HEVC in a .mov, which
// only Safari and hardware-HEVC setups play — a viewer on another browser gets
// a blank video. Same policy as video-review.ts / cloudflare-stream.ts: this
// app does NOT run ffmpeg (or any native media binary) on untrusted uploads,
// so the actual decode/encode happens on Cloudflare Stream, our own code only
// moves URLs and bytes of Stream's own well-formed MP4 output.
//
// How: a cron (api/cron/convert-mov-videos) finds stored .mov URLs, copies
// each into Stream (which transcodes it), asks Stream for its MP4 download,
// streams that MP4 into R2 under the same key with a .mp4 extension, swaps the
// stored URL everywhere it was saved, then deletes the .mov and the temporary
// Stream copy. Until the swap lands (typically a few minutes) viewers get the
// original .mov, which plays wherever it always did — so this only ever
// improves things; a conversion that fails (or that Stream can't read) simply
// leaves the .mov in place.
//
// The step logic below is a pure state machine over injected dependencies so
// it can be unit-tested without Cloudflare, R2 or a database.

import type { Mp4DownloadState } from "@/lib/cloudflare-stream";

/** Stop after this many failed attempts and leave the original .mov as it is. */
export const MAX_CONVERSION_ATTEMPTS = 3;

/** Same ceiling as every video upload (storage.ts MAX_VIDEO_BYTES). */
export const MAX_CONVERTED_BYTES = 2048 * 1024 * 1024;

/** True for a stored media URL that points at a QuickTime .mov file. */
export function isMovUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return /\.mov$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** `post-video/<owner>/<uuid>.mov` → `post-video/<owner>/<uuid>.mp4` (same owner segment, so ownership checks keep working). */
export function mp4KeyForMovKey(key: string): string | null {
  return /\.mov$/i.test(key) ? key.replace(/\.mov$/i, ".mp4") : null;
}

/** Only ever fetch the converted file from Cloudflare Stream itself — the URL comes from an API response, not from us. */
export function isCloudflareStreamUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".cloudflarestream.com");
  } catch {
    return false;
  }
}

export type ConversionState = {
  sourceUrl: string;
  streamUid: string | null;
  attempts: number;
};

export type ConversionDeps = {
  createStreamCopy(sourceUrl: string): Promise<string | null>;
  getStreamStatus(uid: string): Promise<{ ready: boolean; failed: boolean } | null>;
  requestMp4Download(uid: string): Promise<Mp4DownloadState | null>;
  getMp4Download(uid: string): Promise<Mp4DownloadState | null>;
  deleteStreamVideo(uid: string): Promise<void>;
  keyFromPublicUrl(url: string): string | null;
  /** Streams the MP4 at `downloadUrl` into R2 at `key`; returns its public URL. */
  copyToR2(downloadUrl: string, key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  /** Points every stored reference to `fromUrl` at `toUrl`; returns how many rows changed. */
  swapUrl(fromUrl: string, toUrl: string): Promise<number>;
};

export type ConversionStep =
  /** Nothing more to do this tick — call again after a pause. `patch` is what to persist. */
  | { kind: "waiting"; patch: Partial<ConversionState> }
  | { kind: "done"; outputUrl: string; swapped: number }
  /** Counts as a failed attempt; `terminal` once MAX_CONVERSION_ATTEMPTS is used up. */
  | { kind: "failed"; reason: string; terminal: boolean; patch: Partial<ConversionState> };

function fail(state: ConversionState, reason: string, patch: Partial<ConversionState> = {}): ConversionStep {
  const attempts = state.attempts + 1;
  return { kind: "failed", reason, terminal: attempts >= MAX_CONVERSION_ATTEMPTS, patch: { ...patch, attempts } };
}

/**
 * Advances one conversion by one step:
 *  1. hand the .mov to Cloudflare Stream
 *  2. wait for it to be processed
 *  3. ask for the MP4 download and wait for it
 *  4. copy the MP4 into R2 (.mp4 key next to the .mov), swap every stored URL, clean up
 */
export async function advanceConversion(state: ConversionState, deps: ConversionDeps): Promise<ConversionStep> {
  const sourceKey = deps.keyFromPublicUrl(state.sourceUrl);
  const outputKey = sourceKey ? mp4KeyForMovKey(sourceKey) : null;
  if (!sourceKey || !outputKey) {
    // Not one of our own R2 .mov objects: nothing we can (or should) convert.
    return { kind: "failed", reason: "not_our_mov", terminal: true, patch: { attempts: MAX_CONVERSION_ATTEMPTS } };
  }

  if (!state.streamUid) {
    const uid = await deps.createStreamCopy(state.sourceUrl);
    if (!uid) return fail(state, "stream_copy_failed");
    return { kind: "waiting", patch: { streamUid: uid } };
  }
  const uid = state.streamUid;

  const status = await deps.getStreamStatus(uid);
  if (!status) return { kind: "waiting", patch: {} }; // transient API blip — not the video's fault
  if (status.failed) {
    await deps.deleteStreamVideo(uid);
    return fail(state, "stream_encode_failed", { streamUid: null });
  }
  if (!status.ready) return { kind: "waiting", patch: {} };

  let download = await deps.getMp4Download(uid);
  if (download?.status === "missing") download = await deps.requestMp4Download(uid);
  if (!download) return { kind: "waiting", patch: {} };
  if (download.status === "error") return fail(state, "stream_download_failed");
  if (download.status !== "ready" || !download.url) return { kind: "waiting", patch: {} };

  if (!isCloudflareStreamUrl(download.url)) return fail(state, "unexpected_download_host");

  let outputUrl: string;
  try {
    outputUrl = await deps.copyToR2(download.url, outputKey);
  } catch (err) {
    return fail(state, `copy_failed:${err instanceof Error ? err.message : "unknown"}`);
  }

  const swapped = await deps.swapUrl(state.sourceUrl, outputUrl);
  if (swapped === 0) {
    // The post/message/etc. was deleted while we worked — don't leave an orphaned MP4 behind.
    await deps.deleteObject(outputKey);
  }
  await deps.deleteObject(sourceKey);
  await deps.deleteStreamVideo(uid);
  return { kind: "done", outputUrl, swapped };
}
