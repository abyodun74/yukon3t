// Cloudflare Stream — the untrusted-decode boundary for long-video review
// (src/lib/video-review.ts). Deliberately NOT ffmpeg-in-our-own-function:
// this app has an existing, explicit policy against running a native
// media-processing binary on untrusted user uploads (see storage.ts's
// captureVideoFrameFromFile comment / SECURITY.md's sharp/libvips note —
// post/avatar images are resized client-side specifically to keep libvips
// off untrusted bytes). ffmpeg carries the same class of CVE history with a
// larger surface, so the actual video decode instead happens entirely on
// Cloudflare's infrastructure — our own functions only ever touch Cloudflare
// Stream's own well-formed API responses (thumbnail images, VTT captions),
// never the raw uploaded file.
//
// Endpoint shapes below confirmed against Cloudflare's own docs at
// developers.cloudflare.com/stream (upload-via-link, displaying-thumbnails,
// adding-captions), same "don't guess API shapes" practice as hive.ts.
//
// Reuses R2_ACCOUNT_ID (storage.ts) as the Stream account id — Stream and R2
// live under the same top-level Cloudflare account for this app, so a
// second account-id env var would just be a duplicate of one that already
// exists.

const API_BASE = "https://api.cloudflare.com/client/v4";

export function isStreamConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.CLOUDFLARE_STREAM_API_TOKEN &&
      process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE,
  );
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_STREAM_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// One shared per-call budget, same reasoning/value as moderation.ts's
// MODERATION_TIMEOUT_MS — bounds how long a stalled Cloudflare API response
// can hold a cron tick open. Actual video processing (copy/encode/caption)
// happens asynchronously on Cloudflare's side regardless of this timeout;
// this only bounds each individual status-check/trigger call.
const CF_API_TIMEOUT_MS = 15_000;

async function cfFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), CF_API_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}/accounts/${process.env.R2_ACCOUNT_ID}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...init.headers },
      signal: timeoutController.signal,
    });
  } catch (err) {
    console.error(`[cloudflare-stream] fetch failed for ${path}`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Kicks off a Stream copy of an already-public video URL (our own R2 object). Returns the new video's uid, or null on failure. */
export async function createStreamCopy(sourceUrl: string): Promise<string | null> {
  const res = await cfFetch("/stream/copy", {
    method: "POST",
    body: JSON.stringify({ url: sourceUrl }),
  });
  if (!res?.ok) return null;
  const data = await res.json();
  return data?.result?.uid ?? null;
}

/** True once Cloudflare has finished downloading+encoding the copy and it's playable. */
export async function isStreamReady(uid: string): Promise<boolean | null> {
  const res = await cfFetch(`/stream/${uid}`);
  if (!res?.ok) return null;
  const data = await res.json();
  return Boolean(data?.result?.readyToStream);
}

type CaptionState = "missing" | "inprogress" | "ready" | "error";

/** Reads the current state of the English auto-caption job for this video — "missing" means generation hasn't been requested yet. */
export async function getCaptionState(uid: string): Promise<CaptionState | null> {
  const res = await cfFetch(`/stream/${uid}/captions`);
  if (!res?.ok) return null;
  const data = await res.json();
  const captions: Array<{ language: string; status: string }> = data?.result ?? [];
  const en = captions.find((c) => c.language === "en");
  if (!en) return "missing";
  if (en.status === "ready") return "ready";
  if (en.status === "error") return "error";
  return "inprogress";
}

/** Fire-and-forget: asks Cloudflare to start generating English captions. Safe to call again if a prior request errored. */
export async function requestCaptions(uid: string): Promise<boolean> {
  const res = await cfFetch(`/stream/${uid}/captions/en/generate`, { method: "POST" });
  return Boolean(res?.ok);
}

/** Raw WebVTT text of the finished caption track. */
export async function getCaptionsVtt(uid: string): Promise<string | null> {
  const res = await cfFetch(`/stream/${uid}/captions/en/vtt`);
  if (!res?.ok) return null;
  return res.text();
}

// Strips WebVTT structure (the "WEBVTT" header, cue-number lines, and
// "00:00:01.000 --> 00:00:04.000"-style timing lines) down to the spoken
// text, then drops consecutive duplicate lines — Cloudflare's cues commonly
// repeat the same line across overlapping timing windows.
export function vttToPlainText(vtt: string): string {
  const timingLine = /-->/;
  const cueNumberLine = /^\d+$/;
  const lines = vtt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "WEBVTT" && !timingLine.test(l) && !cueNumberLine.test(l));

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }
  return deduped.join(" ");
}

/** Public thumbnail-image URL for this video at a given offset — hands straight to moderation.ts's moderateImage, no download needed. */
export function thumbnailUrl(uid: string, seconds: number): string {
  return `https://customer-${process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?time=${Math.max(0, Math.round(seconds))}s&height=480`;
}

/** Best-effort cleanup — never leave a playable copy of reviewed user content sitting on a second platform once a verdict is reached. */
export async function deleteStreamVideo(uid: string): Promise<void> {
  const res = await cfFetch(`/stream/${uid}`, { method: "DELETE" });
  if (!res?.ok) {
    console.error(`[cloudflare-stream] failed to delete video ${uid}`);
  }
}
