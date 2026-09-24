// Produces a yukon3t-watermarked copy of a video for native-share
// attachment — the video counterpart to watermark.ts's client-side canvas
// stamp for images. Images can be stamped instantly client-side (a plain
// <canvas> draw); video has no equivalent client-side pixel path (this app
// deliberately avoids ffmpeg/native media processing on untrusted uploads —
// same policy video-review.ts/video-convert.ts/cloudflare-stream.ts already
// document), so the actual compositing happens on Cloudflare Stream, the
// same untrusted-decode boundary already used for long-video moderation and
// .mov re-encoding.
//
// How: same pipeline shape as video-convert.ts's advanceConversion — copy
// the source into Cloudflare Stream (this time with a watermark profile
// attached), wait for it to encode, ask for the MP4 download, copy that
// into R2 under a derived key, then clean up the temporary Stream copy.
// Two real differences from VideoConversion: (1) the Stream copy carries
// `watermark: { uid: CLOUDFLARE_STREAM_WATERMARK_UID }`, applied at
// encode time — Cloudflare bakes it into the generated MP4 itself, not just
// Stream Player's own HLS/DASH playback, so it travels with the file
// wherever it's shared, the same way a TikTok/Instagram download keeps
// their logo baked in; (2) this never touches the original — no delete, no
// swap-everywhere-it's-stored — the unwatermarked source keeps playing
// in-app exactly as it always has, `outputUrl` here is only ever handed to
// the native share sheet as an alternate attachment.
//
// Unlike VideoConversion (which proactively scans for every .mov/Muse video
// in the whole app), a BrandedVideoRendition row is only ever created
// on-demand, the first time someone actually taps "Share via device" on
// that specific video — branding every video ever uploaded regardless of
// whether it's ever shared out would be pure wasted Cloudflare Stream spend.
//
// The step logic below is a pure state machine over injected dependencies,
// same testable shape as advanceConversion.

import type { Mp4DownloadState } from "@/lib/cloudflare-stream";

/** Stop after this many failed attempts and just fall back to sharing the unwatermarked original. */
export const MAX_BRANDING_ATTEMPTS = 3;

/** Same ceiling as VideoConversion — the largest MP4 this will copy into R2. */
export const MAX_BRANDED_BYTES = 2048 * 1024 * 1024;

export type BrandingState = {
  sourceUrl: string;
  streamUid: string | null;
  attempts: number;
};

export type BrandingDeps = {
  createStreamCopy(sourceUrl: string, options: { watermarkUid: string }): Promise<string | null>;
  getStreamStatus(uid: string): Promise<{ ready: boolean; failed: boolean } | null>;
  requestMp4Download(uid: string): Promise<Mp4DownloadState | null>;
  getMp4Download(uid: string): Promise<Mp4DownloadState | null>;
  deleteStreamVideo(uid: string): Promise<void>;
  keyFromPublicUrl(url: string): string | null;
  /** Streams the MP4 at `downloadUrl` into R2 at `key`; returns its public URL. */
  copyToR2(downloadUrl: string, key: string): Promise<string>;
  watermarkUid: string;
};

export type BrandingStep =
  | { kind: "waiting"; patch: Partial<BrandingState> }
  | { kind: "done"; outputUrl: string }
  | { kind: "failed"; reason: string; terminal: boolean; patch: Partial<BrandingState> };

function fail(state: BrandingState, reason: string, patch: Partial<BrandingState> = {}): BrandingStep {
  const attempts = state.attempts + 1;
  return { kind: "failed", reason, terminal: attempts >= MAX_BRANDING_ATTEMPTS, patch: { ...patch, attempts } };
}

/**
 * The R2 key this writes its branded copy to for a given source key — always
 * distinct from the source (so it's never mistaken for a replacement of it,
 * and a repeat run has a stable, predictable target).
 */
function brandedKeyFor(sourceKey: string): string {
  return `${sourceKey.replace(/\.\w+$/, "")}.branded.mp4`;
}

/**
 * Advances one branding job by one step:
 *  1. hand the source to Cloudflare Stream with the watermark profile attached
 *  2. wait for it to be processed
 *  3. ask for the MP4 download and wait for it
 *  4. copy the MP4 into R2 (see brandedKeyFor) and clean up the Stream copy
 */
export async function advanceBranding(state: BrandingState, deps: BrandingDeps): Promise<BrandingStep> {
  const sourceKey = deps.keyFromPublicUrl(state.sourceUrl);
  if (!sourceKey) {
    // Not one of our own R2 objects: nothing we can (or should) brand.
    return { kind: "failed", reason: "not_our_video", terminal: true, patch: { attempts: MAX_BRANDING_ATTEMPTS } };
  }
  const outputKey = brandedKeyFor(sourceKey);

  if (!state.streamUid) {
    const uid = await deps.createStreamCopy(state.sourceUrl, { watermarkUid: deps.watermarkUid });
    if (!uid) return fail(state, "stream_copy_failed");
    return { kind: "waiting", patch: { streamUid: uid } };
  }
  const uid = state.streamUid;

  const status = await deps.getStreamStatus(uid);
  if (!status) return { kind: "waiting", patch: {} }; // transient API blip
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

  let outputUrl: string;
  try {
    outputUrl = await deps.copyToR2(download.url, outputKey);
  } catch (err) {
    return fail(state, `copy_failed:${err instanceof Error ? err.message : "unknown"}`);
  }

  await deps.deleteStreamVideo(uid);
  return { kind: "done", outputUrl };
}
