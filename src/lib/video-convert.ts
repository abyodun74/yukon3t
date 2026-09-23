// Re-encodes a video through Cloudflare Stream and writes the result back
// over the original. Two independent reasons a video goes through this:
//
//  1. Compatibility: an iPhone's default "High Efficiency" capture is HEVC
//     in a .mov, which only Safari and hardware-HEVC setups play — a viewer
//     on another browser gets a blank video. isMovUrl below is what finds
//     these.
//  2. Orientation (Muse only): a re-encode also bakes in whatever rotation/
//     mirror transform the source file's container carries as actual pixel
//     data, instead of leaving a player to interpret that transform itself.
//     Reported live: every Muse video plays left-right mirrored regardless
//     of device. The working theory (not device-verified) is that browsers
//     apply a video's rotation metadata reliably but not consistently a
//     horizontal mirror flip specifically (common on a front-camera
//     recording) — and Muse is the one upload path with no native picker
//     fallback (see native-video-picker.ts's callers elsewhere), so it's
//     the one place this app can't let the native picker's own
//     platform-side handling paper over it. Re-encoding fixes it either
//     way regardless of the exact mechanism, since the output has no
//     transform left for a player to (mis)interpret — every Muse video
//     goes through here for this reason, not just its .mov ones.
//     findMuseVideoSources in video-convert-db.ts is what finds these.
//
// Same policy as video-review.ts/cloudflare-stream.ts either way: this app
// does NOT run ffmpeg (or any native media binary) on untrusted uploads, so
// the actual decode/encode happens on Cloudflare Stream, our own code only
// moves URLs and bytes of Stream's own well-formed MP4 output.
//
// How: a cron (api/cron/convert-mov-videos) finds stored candidate URLs
// (from both reasons above), copies each into Stream (which transcodes it),
// asks Stream for its MP4 download, streams that MP4 into R2 under a
// derived key (see outputKeyFor), swaps the stored URL everywhere it was
// saved, then deletes the original and the temporary Stream copy. Until the
// swap lands (typically a few minutes) viewers get the original, which
// plays wherever it always did — so this only ever improves things; a
// conversion that fails (or that Stream can't read) simply leaves the
// original in place.
//
// The step logic below is a pure state machine over injected dependencies so
// it can be unit-tested without Cloudflare, R2 or a database.

import type { Mp4DownloadState } from "@/lib/cloudflare-stream";

/** Stop after this many failed attempts and leave the original as it is. */
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

/**
 * The R2 key this pipeline writes its output to for a given source key —
 * always .mp4, and, critically, always different from the source key even
 * when the source was already .mp4 (every Android-recorded Muse video, and
 * any Muse video that already went through this once for a different
 * reason). That matters because a Muse candidate is recognized as "already
 * done" by checking whether its current videoUrl is some earlier job's own
 * outputUrl (see findMuseVideoSources) — unlike a .mov, there's no
 * extension change alone to signal that. Same owner segment either way, so
 * ownership checks keep working.
 */
export function outputKeyFor(sourceKey: string): string {
  const alreadyMp4 = /\.mp4$/i.test(sourceKey);
  const base = sourceKey.replace(/\.\w+$/, "");
  return alreadyMp4 ? `${base}.norm.mp4` : `${base}.mp4`;
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
 *  1. hand the source to Cloudflare Stream
 *  2. wait for it to be processed
 *  3. ask for the MP4 download and wait for it
 *  4. copy the MP4 into R2 (see outputKeyFor), swap every stored URL, clean up
 */
export async function advanceConversion(state: ConversionState, deps: ConversionDeps): Promise<ConversionStep> {
  const sourceKey = deps.keyFromPublicUrl(state.sourceUrl);
  if (!sourceKey) {
    // Not one of our own R2 objects: nothing we can (or should) convert.
    return { kind: "failed", reason: "not_our_video", terminal: true, patch: { attempts: MAX_CONVERSION_ATTEMPTS } };
  }
  const outputKey = outputKeyFor(sourceKey);

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
