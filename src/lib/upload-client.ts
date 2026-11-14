"use client";

import {
  startMultipartUpload,
  completeMultipartUpload,
  abortMultipartUpload,
  discardUploads,
  requestPrivateAvatarUpload,
} from "@/app/actions/media";
import { requestViewOnceUpload } from "@/app/actions/view-once";
import type { UploadKind } from "@/lib/storage";
import { holdReload, looksLikeStaleServerActionError } from "@/lib/stale-build";
import { VIEW_ONCE_FRAME_CONTENT_TYPE, type ViewOnceMediaType } from "@/lib/view-once";
import { backoffDelayMs } from "@/lib/fetch-retry";
import { putAttemptOutcome, WRITE_ONCE_UPLOAD_PROTOCOL } from "@/lib/write-once-upload";
import { UPLOAD_ROUTE_HEADER } from "@/lib/upload-route-guard";
import {
  FRAME_CAPTURE_INITIAL,
  frameCanvasSize,
  frameCaptureStep,
  isBlankFrame,
  usableDuration,
  type FrameCaptureEvent,
  type FrameCaptureState,
  type FrameFailureReason,
} from "@/lib/media-file";

/**
 * Where a failed upload stopped (diagnostics, and so a composer can tell "pick the file again" from "try again"):
 * read = the picked file can't be read any more (iOS removed its temporary copy), presign = getting the upload URL,
 * put = sending the bytes, multipart = the parallel video path, exception = something threw.
 */
export type UploadFailureStep = "read" | "presign" | "put" | "multipart" | "exception";

export type ClientUploadResult =
  | { ok: true; publicUrl: string; key: string }
  | { ok: false; error: string; step?: UploadFailureStep };

// Kinds where the source is typically a raw phone-camera photo (often
// several MB) but only ever needs to render as a feed thumbnail, cover
// or chat bubble — never full sensor resolution. Video/audio kinds are
// deliberately excluded; resizing those is a different problem entirely.
// (Profile pictures are resized by AvatarUpload itself, see uploadPrivateAvatar.)
const RESIZABLE_KINDS: UploadKind[] = ["post-image", "message-image", "circle-cover", "ambient-image"];

const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_RESIZE_QUALITY = 0.85;

/**
 * Downscales (if needed) and re-encodes an image to WebP, client-side in
 * the browser, before it ever leaves the device — this app deliberately
 * never routes untrusted uploaded images through server-side processing
 * (see SECURITY.md: sharp/libvips, which powers next/image, has known
 * CVEs, and post/avatar images come from arbitrary users), so this can't
 * be done server-side. A no-op for a file that's already WebP and already
 * within the size cap (nothing to gain from decoding and re-encoding it),
 * and fails open (returns the original file) on any error — never blocks
 * an upload over a resize/re-encode failure.
 */
export function resizeImageFile(file: File): Promise<File> {
  return resizeImageToMax(file, MAX_IMAGE_DIMENSION);
}

/**
 * resizeImageFile with a caller-chosen long-side cap (private avatars upload a 320px and a 1080px copy). A separate
 * function rather than an optional parameter on purpose: resizeImageFile is passed straight to Array.map, whose
 * index argument would otherwise become the cap.
 */
// Files this module already produced by resizing (resizeImageToMax's output, and nothing else): an upload of one of
// them skips a second decode + re-encode. Composers resize at pick time and the upload used to decode the same image
// again, which on an iPhone is a second full-size bitmap in memory per photo.
const resizedOutputs = new WeakSet<File>();

// How long an image may take to decode before the resize gives up and keeps the original. An iPhone's <img> decode of
// a large HEIC can stall without ever firing load or error, which used to hang the pick (and the upload behind it).
const IMAGE_DECODE_TIMEOUT_MS = 20_000;

/** Frees a canvas's backing store now instead of at garbage collection (iOS caps total canvas memory per page). */
function releaseCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Already gone.
  }
}

/** Drops an <img>'s decoded bitmap and its handlers. */
function releaseImage(img: HTMLImageElement | null | undefined) {
  if (!img) return;
  img.onload = null;
  img.onerror = null;
  try {
    img.removeAttribute("src");
  } catch {
    // Already gone.
  }
}

export async function resizeImageToMax(file: File, maxDimension: number): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // Drawing onto a <canvas> only ever captures a single frame — running an
  // animated GIF through this would silently flatten it to a still image.
  // Skipped outright rather than dimension-gated like every other type
  // below: a small GIF happening to fit under MAX_IMAGE_DIMENSION already
  // isn't what breaks it, a large one would be, so "only resize when it's
  // actually over the cap" isn't a safe rule to apply here at all.
  if (file.type === "image/gif") return file;

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  let canvas: HTMLCanvasElement | null = null;
  const timers: { decode?: ReturnType<typeof setTimeout> } = {};
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image_load_failed"));
      timers.decode = setTimeout(() => reject(new Error("image_load_timeout")), IMAGE_DECODE_TIMEOUT_MS);
      img.src = objectUrl;
    });

    const { naturalWidth: width, naturalHeight: height } = img;
    const withinCap = width <= maxDimension && height <= maxDimension;
    if (withinCap && file.type === "image/webp") {
      return file;
    }

    // scale stays 1 (no resize, just re-encode) for anything already
    // within the cap — e.g. a same-size JPEG/PNG/HEIC-as-JPEG being
    // converted to WebP for its own sake, not because it's oversized.
    const scale = withinCap ? 1 : maxDimension / Math.max(width, height);
    canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const target = canvas;

    // Re-encodes everything as WebP — meaningfully smaller than JPEG or PNG
    // at the same visual quality, and (unlike JPEG) still preserves
    // transparency, so this replaces the old "PNG stays PNG, everything
    // else becomes JPEG" split entirely. Safe to request unconditionally:
    // every browser this app ships to (Chrome/Android WebView 32+, Safari
    // 14+) can encode it, and canvas.toBlob() falls back to PNG on its own
    // per spec if a browser somehow can't — checked via the blob's actual
    // returned type below rather than assumed, so that fallback can never
    // produce a mismatched extension/content-type.
    const blob = await new Promise<Blob | null>((resolve) =>
      target.toBlob(resolve, "image/webp", IMAGE_RESIZE_QUALITY),
    );
    if (!blob) return file;

    // Rebuilding from a plain ArrayBuffer rather than returning the
    // canvas.toBlob() Blob directly matters: on the installed Android app,
    // that Blob can come back backed by an already-stale temp file — even
    // an immediate, fully-foregrounded <img> preview of it fails instantly
    // with net::ERR_UPLOAD_FILE_CHANGED, and the same failure hits the
    // eventual upload PUT of the exact same object. A File built from raw
    // bytes has no such file backing to go stale, which fixes both the
    // preview (every caller here builds its thumbnail via
    // URL.createObjectURL on this return value) and the upload.
    const buf = await blob.arrayBuffer();
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    const resized = new File([buf], file.name.replace(/\.\w+$/, `.${ext}`), { type: blob.type });
    resizedOutputs.add(resized);
    return resized;
  } catch {
    return file;
  } finally {
    clearTimeout(timers.decode);
    releaseCanvas(canvas);
    releaseImage(img);
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Resolves immediately if the page is already in the foreground, otherwise
 * waits for it to become so. The installed Android app (a Trusted Web
 * Activity wrapping Chrome, not a plain browser tab) is far more aggressive
 * than a full browser about killing an in-flight network request the
 * moment it's backgrounded — a locked screen or an app-switch mid-upload
 * reliably kills a large video PUT that the same upload sails through in a
 * regular browser tab. Retrying on a blind timer in that situation just
 * burns attempts while still backgrounded, dying again immediately each
 * time — waiting for real foreground visibility first means a retry only
 * ever fires once Android is actually willing to grant network access
 * again. A no-op outside a browser (SSR) or in a context with no
 * Page Visibility API.
 */
function waitForForeground(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
  });
}

/**
 * Retries a flaky network call before giving up — mobile connections
 * (especially a TWA switching between wifi/cellular mid-upload) routinely
 * drop a request without the connection actually being down, and neither of
 * uploadFileDirect's two network calls had any resilience to that: one
 * dropped packet meant the whole upload failed with "couldn't reach the
 * server," even though a retry would have gone through. Delay grows with
 * each attempt (exponential, capped at 8s, with random jitter so clients
 * that failed together don't retry together — see backoffDelayMs) rather
 * than staying fixed, giving a flaky connection more time to recover
 * before the next try. When
 * waitForVisible is set, each retry also waits for the page to be in the
 * foreground first — see waitForForeground above.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
  delayMs = 800,
  waitForVisible = false,
  // Lets a caller opt certain errors out of retrying at all — e.g. a stale
  // Server Action id after a redeploy (see looksLikeStaleServerActionError in stale-build.ts) will never
  // succeed no matter how many times it's retried, so burning the full
  // attempt budget on it just delays showing the (actionable) error.
  shouldRetry: (err: unknown) => boolean = () => true,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !shouldRetry(err)) throw err;
      if (waitForVisible) await waitForForeground();
      await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt, { baseMs: delayMs })));
    }
  }
}

// Video files can run into the tens/hundreds of MB — a single dropped
// packet costs far more (the whole file re-uploads from scratch, since the
// PUT isn't resumable) than it does for a small photo, so a real-world
// connection blip is much likelier to exhaust 2 total attempts before a
// large video finishes than it is for anything else this app uploads.
// More attempts, with the growing backoff above and the foreground wait,
// gives a shaky (or backgrounded) connection a real chance to recover
// mid-upload instead of failing outright.
const VIDEO_KINDS: ReadonlySet<UploadKind> = new Set([
  "post-video",
  "message-video",
  "story-video",
  "ad-video",
  "muse-video",
]);
// 3, not 2: a photo PUT is cheap to resend (same presigned URL, same key) and
// a single retry wasn't enough to ride out a weak-signal patch or a Wi-Fi to
// cellular handoff.
const PUT_ATTEMPTS_DEFAULT = 3;
const PUT_ATTEMPTS_VIDEO = 6;

// A connection that gets established but then stalls (no bytes flowing —
// seen from the installed Android app specifically) leaves a plain fetch()
// neither resolving nor rejecting, sometimes for a very long time. That
// silently eats far more wall-clock time per attempt than any backoff delay
// between attempts, and the retry logic above can't even start the next
// attempt until the stuck one finally gives up on its own — this is why a
// trivial, sub-second, near-empty video was observed taking 30+ seconds to
// finish even though the file itself is tiny. Bounding each attempt makes a
// genuinely stuck request fail fast and move on to the next retry instead.
// The budget scales with file size (using a conservative worst-case mobile
// throughput) so a large, legitimately slow-but-progressing upload isn't
// aborted prematurely, with a floor so small files still get a reasonable
// minimum window.
const MIN_ATTEMPT_TIMEOUT_MS = 15_000;
const WORST_CASE_BYTES_PER_SECOND = 300_000; // ~2.4 Mbps — a conservative mobile-data floor, not a target

function attemptTimeoutMs(fileSizeBytes: number): number {
  return Math.max(MIN_ATTEMPT_TIMEOUT_MS, (fileSizeBytes / WORST_CASE_BYTES_PER_SECOND) * 1000);
}

/** fetch() with a hard ceiling on how long a single attempt is allowed to hang before being treated as failed. */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Bounds a promise that can't take an AbortSignal itself (a Server Action
 * call, under the hood a fetch this module doesn't control) — doesn't cancel
 * the underlying request server-side, just stops the client from waiting on
 * it indefinitely so the retry loop can move on to a fresh attempt.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Requests a presigned URL, then PUTs the file directly to R2 from the
 * browser. Never throws — both steps are network calls (the server action
 * is itself a fetch under the hood), and a rejected fetch (e.g. no
 * connectivity) would otherwise propagate as an uncaught exception through
 * whatever startTransition called this, which React/Next renders as a full
 * page crash rather than a normal form error.
 */
// `headers` are the request headers the presigned URL was signed with (`If-None-Match: *`, see write-once-upload.ts):
// the PUT must send them exactly, or R2 refuses it as a bad signature.
type RequestUploadUrlFn = (
  fd: FormData,
) => Promise<{ error: string | null; uploadUrl?: string; publicUrl?: string; key?: string; headers?: Record<string, string> }>;

// --- Batched presigning -----------------------------------------------------
// Next.js runs one browser's Server Action calls strictly one after another. A post with five photos, or a video plus
// its thumbnail, used to make five/two presign calls in a row — each a full round trip through auth, the rate limit
// and R2 signing — before the last file could even start uploading. Every presign request made in the same instant
// (callers use Promise.all) is now coalesced into ONE requestUploadUrls call.
type PresignResult = { error: string | null; uploadUrl?: string; publicUrl?: string; key?: string; headers?: Record<string, string> };
type PendingPresign = {
  item: { kind: string; contentType: string };
  resolve: (r: PresignResult) => void;
  reject: (e: unknown) => void;
};
const BATCH_WINDOW_MS = 12;
const MAX_BATCH = 12; // matches requestUploadBatchSchema
let pendingPresigns: PendingPresign[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * One batch of presigned URLs from POST /api/uploads/presign, with its own timeout. Not the requestUploadUrls Server
 * Action any more: a tab's Server Actions run one at a time with no timeout, so one that never settled (an iPhone
 * request suspended with the app and never failed on resume) blocked every later upload until a reload. Resolves with
 * the action's answer, or rejects (network, timeout, 5xx) so withRetry in uploadToStorage tries again.
 */
async function presignViaRoute(items: { kind: string; contentType: string }[]) {
  const res = await fetchWithTimeout(
    "/api/uploads/presign",
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", [UPLOAD_ROUTE_HEADER]: "1" },
      body: JSON.stringify({ items, protocol: WRITE_ONCE_UPLOAD_PROTOCOL }),
    },
    MIN_ATTEMPT_TIMEOUT_MS,
  );
  // The route isn't on this server: a newer client than the deploy answering it.
  if (res.status === 404) return { error: "stale_deployment" as const };
  if (res.status === 401 || res.status === 403) return { error: "unauthorized" as const };
  if (!res.ok) throw new Error(`presign_${res.status}`);
  return (await res.json()) as { error: string | null; items?: PresignResult[] };
}

async function flushPresigns() {
  flushTimer = null;
  const all = pendingPresigns;
  pendingPresigns = [];
  for (let i = 0; i < all.length; i += MAX_BATCH) {
    const chunk = all.slice(i, i + MAX_BATCH);
    try {
      const res = await presignViaRoute(chunk.map((p) => p.item));
      const items = "items" in res ? res.items : null;
      if (items) {
        chunk.forEach((p, idx) => p.resolve(items[idx] ?? { error: "invalid" }));
      } else {
        chunk.forEach((p) => p.resolve({ error: res.error }));
      }
    } catch (err) {
      chunk.forEach((p) => p.reject(err));
    }
  }
}

/** Default presign function: same shape as the single-file action, but shares one server round trip with its neighbours. */
const requestUploadUrlBatched: RequestUploadUrlFn = (fd) =>
  new Promise<PresignResult>((resolve, reject) => {
    pendingPresigns.push({
      item: { kind: String(fd.get("kind") ?? ""), contentType: String(fd.get("contentType") ?? "") },
      resolve,
      reject,
    });
    if (!flushTimer) flushTimer = setTimeout(() => void flushPresigns(), BATCH_WINDOW_MS);
  });

// --- Multipart (parallel + resumable) video upload ---------------------------
// A big video sent as ONE PUT can only be restarted from byte zero when the connection drops, and rides one stream.
// Split into 16MB parts, up to PART_CONCURRENCY at a time, and a dropped connection only re-sends the part it hit.
// Below MULTIPART_MIN_BYTES the extra round trips aren't worth it, so small videos still take the single PUT.
// (Numbers mirror MULTIPART_* in storage.ts; duplicated because that file is server-only.)
const MULTIPART_MIN_BYTES = 32 * 1024 * 1024;
const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 6;

/**
 * Uploads `file` as a multipart upload. Returns null when multipart couldn't even be started (the caller then falls
 * back to the ordinary single PUT), otherwise the final result. Never throws.
 */
async function uploadMultipart(file: File, kind: UploadKind, contentType: string): Promise<ClientUploadResult | null> {
  const startFd = new FormData();
  startFd.set("kind", kind);
  startFd.set("contentType", contentType);
  startFd.set("size", String(file.size));

  let started;
  try {
    started = await withRetry(
      () => withTimeout(startMultipartUpload(startFd), MIN_ATTEMPT_TIMEOUT_MS),
      2,
      800,
      false,
      (err) => !looksLikeStaleServerActionError(err),
    );
  } catch {
    return null;
  }
  if (started.error || !("uploadId" in started)) return null;
  const { key, uploadId, partSize, partUrls, publicUrl } = started;

  const ref = new FormData();
  ref.set("key", key);
  ref.set("uploadId", uploadId);
  const abort = () => void abortMultipartUpload(ref).catch(() => {});

  let nextPart = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && nextPart < partUrls.length) {
      const index = nextPart++;
      const blob = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize));
      try {
        await withRetry(
          async () => {
            const res = await fetchWithTimeout(partUrls[index], { method: "PUT", body: blob }, attemptTimeoutMs(blob.size));
            if (!res.ok) throw new Error(`part_${index + 1}_${res.status}`);
          },
          PART_ATTEMPTS,
          800,
          true,
        );
      } catch {
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partUrls.length) }, worker));
  if (failed) {
    abort();
    return { ok: false, error: "network", step: "multipart" };
  }

  const doneFd = new FormData();
  doneFd.set("key", key);
  doneFd.set("uploadId", uploadId);
  doneFd.set("partCount", String(partUrls.length));
  try {
    const done = await withRetry(() => withTimeout(completeMultipartUpload(doneFd), 60_000), 3, 800);
    if (done.error) {
      abort();
      return { ok: false, error: "upload_failed", step: "multipart" };
    }
  } catch {
    abort();
    return { ok: false, error: "network", step: "multipart" };
  }
  return { ok: true, publicUrl, key };
}

// Every upload in this module goes through here, so this is also where a
// stale-build reload is held off until the transfer has finished.
// Never rejects: an exception anywhere below (a File read the browser refuses, a DOM error) is a failed upload with
// step "exception", so a composer awaiting it always gets an answer and can release its submit lock.
async function uploadNow(file: File, kind: UploadKind, requestUrlFn?: RequestUploadUrlFn): Promise<ClientUploadResult> {
  const release = holdReload("work");
  try {
    return await uploadToStorage(file, kind, requestUrlFn);
  } catch {
    return { ok: false, error: "upload_failed", step: "exception" };
  } finally {
    release();
  }
}

/**
 * Whether the picked file can still be read. On an iPhone a picked photo/video is a temporary copy that iOS can remove
 * (after the app was in the background, under memory pressure); every later read of that same File then fails, so a
 * retry of it can never work and the person has to pick it again. One byte is enough to tell.
 */
export async function isFileReadable(file: Blob): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

async function uploadToStorage(
  file: File,
  kind: UploadKind,
  // Defaults to the authenticated requestUploadUrl action; the public
  // /advertise booking flow passes a function returning the URL requestAdUpload already minted, since there's
  // no signed-in user to attribute the upload to there.
  requestUrlFn: RequestUploadUrlFn = requestUploadUrlBatched,
): Promise<ClientUploadResult> {
  if (!(await isFileReadable(file))) return { ok: false, error: "file_unreadable", step: "read" };
  // A file this module already resized (at pick time) isn't decoded and re-encoded a second time.
  const uploadFile = RESIZABLE_KINDS.includes(kind) && !resizedOutputs.has(file) ? await resizeImageFile(file) : file;

  // Big videos go up as parallel, individually-retried parts. Only on the signed-in path (the public /advertise flow
  // passes its own presign function and has no multipart counterpart), and only when multipart could be started —
  // otherwise this falls straight through to the single PUT below.
  if (requestUrlFn === requestUploadUrlBatched && VIDEO_KINDS.has(kind) && uploadFile.size >= MULTIPART_MIN_BYTES) {
    const multipart = await uploadMultipart(uploadFile, kind, uploadFile.type);
    if (multipart) return multipart;
  }

  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("contentType", uploadFile.type);

  let result;
  try {
    // A stale Server Action id (see looksLikeStaleServerActionError in stale-build.ts) is excluded from
    // retrying — no number of attempts will make the old-deploy request
    // resolve, so failing fast here just gets to the (actionable) error
    // sooner instead of burning the whole retry budget on it.
    result = await withRetry(
      () => withTimeout(requestUrlFn(fd), MIN_ATTEMPT_TIMEOUT_MS),
      2,
      800,
      false,
      (err) => !looksLikeStaleServerActionError(err),
    );
  } catch (err) {
    return { ok: false, error: looksLikeStaleServerActionError(err) ? "stale_deployment" : "network", step: "presign" };
  }
  if (result.error || !result.uploadUrl || !result.publicUrl || !result.key || !result.headers) {
    return { ok: false, error: result.error ?? "invalid", step: "presign" };
  }
  // Narrowed into their own const bindings — a closure over the `let
  // result` above can't be trusted by TS to keep the narrowing from the
  // guard just above (a real gap, not just noise: RequestUploadUrlFn's
  // return type isn't the discriminated union requestUploadUrl's own
  // inferred type is, so the two behave differently here).
  const { uploadUrl, publicUrl, key, headers: signedHeaders } = result;

  // Android WebView (confirmed on the installed app, not just theorized —
  // see the investigation this comment came out of) can hand back a
  // canvas.toBlob() Blob that's already backed by a stale/invalid temp
  // file: the very first read of it — even just an <img> preview, with the
  // page fully foregrounded and no backgrounding involved — fails
  // instantly with net::ERR_UPLOAD_FILE_CHANGED. Passing that Blob/File
  // straight into fetch()'s body hits the same file-freshness check.
  // Reading it into a plain in-memory ArrayBuffer up front sidesteps the
  // check entirely, since an ArrayBuffer body has no file backing to go
  // stale. Only safe for the resized/size-capped kinds here — video files
  // can run into the hundreds of MB, where forcing the whole thing into one
  // contiguous in-memory buffer risks exhausting the WebView's heap, so
  // video keeps streaming straight from the File/Blob as before.
  const isVideo = VIDEO_KINDS.has(kind);
  let putBody: BodyInit;
  try {
    putBody = isVideo ? uploadFile : await uploadFile.arrayBuffer();
  } catch {
    return { ok: false, error: "file_unreadable", step: "read" };
  }

  let stored: boolean;
  try {
    // Retrying re-sends to the exact same presigned URL/key (not a fresh
    // request-upload-url round trip). The key is write-once (the URL signs
    // `If-None-Match: *`, see write-once-upload.ts), so a retry after an
    // attempt that did reach R2 but whose response was lost gets 412: that
    // counts as stored on a retry only, never on the first attempt (see
    // putAttemptOutcome). Video gets more attempts than everything else, and
    // waits for the page to be back in the foreground before each retry —
    // see PUT_ATTEMPTS_VIDEO and waitForForeground above. The video-kind
    // presigned URL is valid for hours (see createUploadUrl), so waiting for
    // the app to be reopened still has plenty of room even after a long
    // backgrounded stretch.
    const putAttempts = isVideo ? PUT_ATTEMPTS_VIDEO : PUT_ATTEMPTS_DEFAULT;
    const timeoutMs = attemptTimeoutMs(uploadFile.size);
    let attempt = 0;
    stored = await withRetry(
      async () => {
        attempt++;
        const res = await fetchWithTimeout(
          uploadUrl,
          {
            method: "PUT",
            headers: { ...signedHeaders, "Content-Type": uploadFile.type },
            body: putBody,
          },
          timeoutMs,
        );
        // A storage-side 5xx/429 is as transient as a dropped connection;
        // anything else (403 expired URL, 400, a first-attempt 412) is final.
        const outcome = putAttemptOutcome(res.status, attempt);
        if (outcome === "retry") throw new Error(`PUT ${res.status}`);
        return outcome === "ok";
      },
      putAttempts,
      800,
      isVideo,
    );
  } catch {
    // Every PUT attempt failed in transit. If the file itself has become unreadable meanwhile (iOS removed its
    // temporary copy), say so: retrying the same File can never work.
    if (!(await isFileReadable(uploadFile))) return { ok: false, error: "file_unreadable", step: "read" };
    return { ok: false, error: "network", step: "put" };
  }

  if (!stored) {
    return { ok: false, error: "upload_failed", step: "put" };
  }

  return { ok: true, publicUrl, key };
}

// --- Start uploading when a file is picked ----------------------------------
// Composers used to upload only when the person tapped Post, so the whole transfer sat between "Post" and "posted".
// prefetchUpload starts it the moment the file is attached — while they write their caption — and the eventual
// uploadFileDirect / uploadVideoWithThumb call at submit just picks up the (usually finished) result. If the file is
// removed or replaced first, discardUpload deletes what was uploaded so abandoned picks don't pile up in storage.
type EagerEntry = {
  kind: UploadKind;
  main: Promise<ClientUploadResult>;
  /** Only for videos: the poster frame, captured and uploaded alongside. */
  thumb: Promise<ClientUploadResult | null> | null;
  /**
   * Set while a submit holds the result: the upload may belong to a post, so it is never discarded. A submit that
   * failed without creating a post hands it back with releaseUploads (so a retry reuses the stored file instead of
   * sending it again, and removing the attachment afterwards deletes it).
   */
  consumed: boolean;
};
// A WeakMap keyed by the picked File: an entry lives exactly as long as something still holds that File.
const eagerUploads = new WeakMap<File, EagerEntry>();

function startEntry(
  file: File,
  kind: UploadKind,
  withThumb: boolean,
  reuseThumb: Promise<ClientUploadResult | null> | null = null,
): EagerEntry {
  const entry: EagerEntry = {
    kind,
    main: uploadNow(file, kind),
    thumb:
      reuseThumb ??
      (withThumb
        ? captureVideoFrameFromFile(file)
            .then((frame) => (frame ? uploadNow(frame, "video-thumb") : null))
            .catch(() => null)
        : null),
    consumed: false,
  };
  eagerUploads.set(file, entry);
  return entry;
}

// Failures that a second try of the same File, right now, can't fix.
const NOT_WORTH_AN_IMMEDIATE_RETRY = new Set([
  "file_unreadable",
  "stale_deployment",
  "rate_limited",
  "unauthorized",
  "not_configured",
  "too_large",
]);

/** Begin uploading `file` now (idempotent). Fire and forget — never throws. */
export function prefetchUpload(file: File, kind: UploadKind, options: { withThumb?: boolean } = {}) {
  if (eagerUploads.has(file)) return;
  startEntry(file, kind, Boolean(options.withThumb));
}

/**
 * Uploads a file to R2 and resolves to its public URL. If prefetchUpload already started (or finished) this exact
 * file, that upload is reused instead of sending it again. Never throws.
 */
export async function uploadFileDirect(
  file: File,
  kind: UploadKind,
  requestUrlFn?: RequestUploadUrlFn,
): Promise<ClientUploadResult> {
  if (requestUrlFn) return uploadNow(file, kind, requestUrlFn); // the public ad-booking flow: never prefetched

  const entry = eagerUploads.get(file);
  if (entry && entry.kind === kind) {
    entry.consumed = true;
    const result = await entry.main;
    if (result.ok) return result;
    if (NOT_WORTH_AN_IMMEDIATE_RETRY.has(result.error)) {
      eagerUploads.delete(file); // a later attempt starts over instead of getting this answer again
      return result;
    }
  }
  // No upload yet, or the earlier one failed (e.g. offline): from scratch, with a new presigned URL and key (a
  // write-once key is never PUT again on purpose). Kept as this file's entry, so a later retry of the same post can
  // reuse it if this one succeeds and only the post itself fails.
  const fresh = startEntry(file, kind, false);
  fresh.consumed = true;
  return fresh.main;
}

/** A video and its poster frame, uploaded together — reusing whatever prefetchUpload already got done. */
export async function uploadVideoWithThumb(
  file: File,
  kind: UploadKind,
): Promise<[ClientUploadResult, ClientUploadResult | null]> {
  let entry = eagerUploads.get(file);
  if (!entry || entry.kind !== kind || !entry.thumb) entry = startEntry(file, kind, true);
  entry.consumed = true;
  const [video, thumb] = await Promise.all([entry.main, entry.thumb ?? Promise.resolve(null)]);
  if (video.ok) return [video, thumb];
  if (NOT_WORTH_AN_IMMEDIATE_RETRY.has(video.error)) {
    eagerUploads.delete(file); // a later attempt starts over instead of getting this answer again
    return [video, thumb];
  }
  // Again from scratch (new presigned URL and key), keeping the poster frame if that part already worked.
  const retry = startEntry(file, kind, true, thumb?.ok ? Promise.resolve(thumb) : null);
  retry.consumed = true;
  return Promise.all([retry.main, retry.thumb ?? Promise.resolve(null)]);
}

/**
 * A submit that took these files failed without creating a post: hand their uploads back. Whatever is already stored
 * stays as each file's entry, so retrying the same post reuses it (only the failed step runs again), and removing the
 * attachment afterwards deletes it like any other abandoned pick.
 */
export function releaseUploads(files: Iterable<File>) {
  for (const file of files) {
    const entry = eagerUploads.get(file);
    if (entry) entry.consumed = false;
  }
}

/**
 * The picked file was removed or replaced without being posted: delete whatever was (or is still being) uploaded for
 * it. A no-op for a file a submit already took. Best effort, never throws.
 */
export function discardUpload(file: File) {
  const entry = eagerUploads.get(file);
  if (!entry) return;
  // Taken by a submit that hasn't settled (the composer clears its attachments the moment Post is tapped): its fate
  // is that submit's. The entry stays so a failed submit can put the file back and reuse what was uploaded.
  if (entry.consumed) return;
  eagerUploads.delete(file);
  void Promise.all([entry.main, entry.thumb ?? Promise.resolve(null)])
    .then((results) => {
      const keys = results.flatMap((r) => (r?.ok ? [r.key] : []));
      if (keys.length > 0) return discardUploads(keys);
    })
    .catch(() => {});
}

// Overall ceiling for one poster-frame grab, and how long a seek may go unanswered before falling back to playing
// the muted clip. 12s, not the old 4s: an iPhone decoding a large HEVC screen recording from a blob: URL in a hidden
// element can take several seconds to answer its first seek, and a Story video with no frame is refused.
const FRAME_CAPTURE_TIMEOUT_MS = 12_000;
const FRAME_SEEK_STALL_MS = 3_500;
const PROBE_TIMEOUT_MS = 8_000;

/** A hidden <video> set up the way iOS WebKit needs to decode it without a user gesture or fullscreen. */
function hiddenProbeVideo(preload: "auto" | "metadata"): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = preload;
  return video;
}

function releaseProbeVideo(video: HTMLVideoElement, url: string) {
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    // Already torn down.
  }
  URL.revokeObjectURL(url);
}

export type FrameCaptureResult = {
  frame: File | null;
  /** Why there is no frame (diagnostics only). */
  reason: FrameFailureReason | null;
  /** The duration the element reported, raw (Infinity for a not-yet-scanned screen recording). */
  rawDuration: number | null;
};

/**
 * Grabs one still (JPEG, long side <= 1920px) from a local video File with its own hidden <video>, independent of
 * any upload, so callers run it alongside the upload. The sequencing rules (metadata -> seek about a second in ->
 * draw; a seek that never answers -> play muted and grab the first painted frame; a blank still -> one retry later;
 * timeout/error -> a reason) are the pure frameCaptureStep in media-file.ts; this only wires the element to it.
 * Never throws and always frees its object URL. Story/Muse/view-once refuse a video with no frame, so the reason is
 * returned for the caller to report.
 */
export function captureVideoFrameDetailed(file: File): Promise<FrameCaptureResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = hiddenProbeVideo("auto");
    let state: FrameCaptureState = FRAME_CAPTURE_INITIAL;
    let rawDuration: number | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = (frame: File | null, reason: FrameFailureReason | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (stallTimer) clearTimeout(stallTimer);
      video.onloadedmetadata = video.onloadeddata = video.onseeked = video.ontimeupdate = video.onerror = null;
      releaseProbeVideo(video, url);
      // Every path (frame, failure, timeout) frees the drawing canvas now: iOS caps total canvas memory per page, and
      // canvases left for the garbage collector after a failed capture made later captures fail too.
      releaseCanvas(canvas);
      canvas = null;
      resolve({ frame, reason, rawDuration });
    };

    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => dispatch({ type: "seek_stalled" }), FRAME_SEEK_STALL_MS);
    };

    const draw = () => {
      const size = frameCanvasSize(video.videoWidth, video.videoHeight, MAX_IMAGE_DIMENSION);
      const ctx = size ? (canvas ??= document.createElement("canvas")).getContext("2d") : null;
      if (!size || !canvas || !ctx) {
        dispatch({ type: "encode_failed" });
        return;
      }
      canvas.width = size.width;
      canvas.height = size.height;
      let blank = false;
      // A small sample is enough to tell "nothing painted yet" from a real frame.
      const sample = document.createElement("canvas");
      try {
        ctx.drawImage(video, 0, 0, size.width, size.height);
        sample.width = 16;
        sample.height = 16;
        const sctx = sample.getContext("2d");
        if (sctx) {
          sctx.drawImage(canvas, 0, 0, 16, 16);
          blank = isBlankFrame(sctx.getImageData(0, 0, 16, 16).data);
        }
      } catch {
        dispatch({ type: "encode_failed" });
        return;
      } finally {
        releaseCanvas(sample);
      }
      dispatch({ type: "drawn", blank });
    };

    const encode = () => {
      if (!canvas) {
        finish(null, "encode_failed");
        return;
      }
      canvas.toBlob(
        // See resizeImageFile above for why this reads into a plain ArrayBuffer instead of wrapping the Blob directly.
        (blob) => {
          if (!blob) {
            finish(null, "encode_failed");
            return;
          }
          blob
            .arrayBuffer()
            .then((buf) => finish(new File([buf], "thumb.jpg", { type: "image/jpeg" }), null))
            .catch(() => finish(null, "encode_failed"));
        },
        "image/jpeg",
        IMAGE_RESIZE_QUALITY,
      );
    };

    function dispatch(event: FrameCaptureEvent) {
      if (settled) return;
      const previous = state;
      state = frameCaptureStep(state, event);
      if (state === previous) return;
      switch (state.phase) {
        case "seeking": {
          armStall();
          const target = state.target;
          try {
            if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) {
              // Already there: no seeked event would come.
              queueMicrotask(() => dispatch({ type: "frame_ready" }));
            } else {
              video.currentTime = target;
            }
          } catch {
            dispatch({ type: "seek_stalled" });
          }
          return;
        }
        case "playing":
          armStall();
          video.ontimeupdate = () => {
            if (video.currentTime > 0 && video.readyState >= 2) {
              video.ontimeupdate = null;
              video.pause();
              dispatch({ type: "frame_ready" });
            }
          };
          void video.play().catch(() => dispatch({ type: "seek_stalled" }));
          return;
        case "drawing":
          if (stallTimer) clearTimeout(stallTimer);
          if (video.readyState >= 2) {
            draw();
          } else {
            armStall();
            video.onloadeddata = () => {
              video.onloadeddata = null;
              if (state.phase === "drawing") draw();
            };
          }
          return;
        case "done":
          encode();
          return;
        case "failed":
          finish(null, state.reason);
          return;
        default:
          return;
      }
    }

    const overallTimer = setTimeout(() => dispatch({ type: "timeout" }), FRAME_CAPTURE_TIMEOUT_MS);
    const onMetadata = () => {
      rawDuration = Number.isNaN(video.duration) ? null : video.duration;
      // iOS can report 0x0 at loadedmetadata for some files; loadeddata (below) tries again with real dimensions.
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        dispatch({ type: "metadata", duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      }
    };
    video.onloadedmetadata = onMetadata;
    video.onloadeddata = () => {
      if (state.phase === "loading") {
        rawDuration = Number.isNaN(video.duration) ? null : video.duration;
        dispatch({ type: "metadata", duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      }
    };
    video.onseeked = () => dispatch({ type: "seeked" });
    video.onerror = () => dispatch({ type: "error" });
    video.src = url;
    try {
      video.load();
    } catch {
      dispatch({ type: "error" });
    }
  });
}

/** captureVideoFrameDetailed without the reason: the still, or null when none could be made. */
export function captureVideoFrameFromFile(file: File): Promise<File | null> {
  return captureVideoFrameDetailed(file).then((r) => r.frame);
}

/**
 * Resolves a local video File's real, finite duration in seconds — or null
 * if it genuinely can't be determined. Exists because of a well-documented
 * WebKit/Chromium behavior: a video file with no (or an unreliable)
 * duration in its header — a WebM Blob straight out of MediaRecorder (see
 * video-recorder-modal.tsx), an iPhone screen recording (ReplayKit writes a
 * variable-frame-rate file), and plenty of files re-encoded/forwarded
 * through other apps — reads `<video>.duration` as Infinity (or NaN) at
 * `loadedmetadata` instead of a real number. Seeking far past the end forces
 * the browser to scan the file, after which `duration` reads correctly
 * (durationchange / timeupdate / seeked, whichever this engine fires).
 *
 * Muse's server action *requires* videoDurationSeconds for a VIDEO Muse, so
 * this has to succeed, not just fail open (an earlier version bailed out on
 * Infinity and left Muse's Post button disabled with no message). The
 * element is muted + playsinline with an explicit load(): without those, iOS
 * WKWebView may never load a detached element's metadata at all.
 */
export function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = hiddenProbeVideo("metadata");

    let settled = false;
    const finish = (result: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      probe.onloadedmetadata = probe.ondurationchange = probe.ontimeupdate = probe.onseeked = probe.onerror = null;
      releaseProbeVideo(probe, url);
      resolve(result);
    };
    const timeout = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);

    let scanning = false;
    const check = () => {
      const d = usableDuration(probe.duration);
      if (d !== null) finish(d);
    };
    probe.onloadedmetadata = () => {
      if (usableDuration(probe.duration) !== null) {
        finish(probe.duration);
        return;
      }
      if (scanning) return;
      scanning = true;
      probe.ondurationchange = check;
      probe.ontimeupdate = check;
      probe.onseeked = check;
      try {
        probe.currentTime = 1e101;
      } catch {
        finish(null);
      }
    };
    probe.onerror = () => finish(null);
    probe.src = url;
    try {
      probe.load();
    } catch {
      finish(null);
    }
  });
}

type PrivateAvatarUploadResult =
  | { ok: true; thumbKey: string; fullKey: string }
  | { ok: false; error: string };

/**
 * Uploads a profile picture's two already-resized images (a ~320px thumbnail and a ~1080px full
 * image, same content type) to the private avatar bucket through their own presigned PUTs (requestPrivateAvatarUpload).
 * Not prefetched, batched or recorded like the ordinary uploads. Same retry/timeout treatment as uploadToStorage, and
 * both are sent from memory (Android's stale-temp-file bug). Never throws.
 */
export async function uploadPrivateAvatar(full: File, thumb: File): Promise<PrivateAvatarUploadResult> {
  if (full.type !== thumb.type) return { ok: false, error: "invalid" };
  const release = holdReload("work");
  try {
    let presigned;
    try {
      presigned = await withRetry(
        () => withTimeout(requestPrivateAvatarUpload({ contentType: full.type }), MIN_ATTEMPT_TIMEOUT_MS),
        2,
        800,
        false,
        (err) => !looksLikeStaleServerActionError(err),
      );
    } catch (err) {
      return { ok: false, error: looksLikeStaleServerActionError(err) ? "stale_deployment" : "network" };
    }
    if (presigned.error !== null) return { ok: false, error: presigned.error };
    const { thumbUploadUrl, thumbKey, fullUploadUrl, fullKey } = presigned;

    const put = async (url: string, file: File) => {
      const body = await file.arrayBuffer();
      return withRetry(
        () => fetchWithTimeout(url, { method: "PUT", headers: { "Content-Type": file.type }, body }, attemptTimeoutMs(file.size)),
        PUT_ATTEMPTS_DEFAULT,
        800,
      );
    };
    try {
      const [thumbRes, fullRes] = await Promise.all([put(thumbUploadUrl, thumb), put(fullUploadUrl, full)]);
      if (!thumbRes.ok || !fullRes.ok) return { ok: false, error: "upload_failed" };
    } catch {
      return { ok: false, error: "network" };
    }
    return { ok: true, thumbKey, fullKey };
  } finally {
    release();
  }
}

type ViewOnceUploadResult =
  | { ok: true; objectKey: string; frameKey: string | null; mediaType: ViewOnceMediaType }
  | { ok: false; error: string };

/**
 * Uploads one photo or video for a view-once message. A separate path from everything above on purpose: the file
 * goes to the PRIVATE bucket through its own presigned PUT (actions/view-once.ts), so no public URL for it ever
 * exists, and it is never prefetched, batched or recorded with the ordinary uploads. A video's still frame goes up
 * alongside it — it is what the video is moderated by, and the server deletes it as soon as it has been checked.
 * Same retry/timeout treatment as uploadToStorage. Never throws. The caller passes an already-resized image.
 */
export async function uploadViewOnceMedia(file: File, conversationId: string): Promise<ViewOnceUploadResult> {
  const release = holdReload("work");
  try {
    const isVideo = file.type.startsWith("video/");
    // Before asking for anything: a video whose frame can't be captured on this device would be refused at send.
    const frame = isVideo ? await captureVideoFrameFromFile(file) : null;
    if (isVideo && !frame) return { ok: false, error: "frame_required" };

    let presigned;
    try {
      presigned = await withRetry(
        () =>
          withTimeout(
            requestViewOnceUpload({ conversationId, contentType: file.type, size: file.size }),
            MIN_ATTEMPT_TIMEOUT_MS,
          ),
        2,
        800,
        false,
        (err) => !looksLikeStaleServerActionError(err),
      );
    } catch (err) {
      return { ok: false, error: looksLikeStaleServerActionError(err) ? "stale_deployment" : "network" };
    }
    if (presigned.error !== null) return { ok: false, error: presigned.error };
    const { uploadUrl, objectKey, frameUploadUrl, frameKey, mediaType } = presigned;

    const put = (url: string, body: BodyInit, contentType: string, size: number, attempts: number) =>
      withRetry(
        () => fetchWithTimeout(url, { method: "PUT", headers: { "Content-Type": contentType }, body }, attemptTimeoutMs(size)),
        attempts,
        800,
        isVideo,
      );

    try {
      // See uploadToStorage: an image is sent from memory (Android's stale-temp-file bug), a video streams from the File.
      const body: BodyInit = isVideo ? file : await file.arrayBuffer();
      const [mediaRes, frameRes] = await Promise.all([
        put(uploadUrl, body, file.type, file.size, isVideo ? PUT_ATTEMPTS_VIDEO : PUT_ATTEMPTS_DEFAULT),
        frame && frameUploadUrl
          ? frame.arrayBuffer().then((buf) => put(frameUploadUrl, buf, VIEW_ONCE_FRAME_CONTENT_TYPE, frame.size, PUT_ATTEMPTS_DEFAULT))
          : null,
      ]);
      if (!mediaRes.ok || (frameRes && !frameRes.ok)) return { ok: false, error: "upload_failed" };
    } catch {
      return { ok: false, error: "network" };
    }

    return { ok: true, objectKey, frameKey: frame ? frameKey : null, mediaType };
  } finally {
    release();
  }
}
