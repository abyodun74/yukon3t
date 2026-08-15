"use client";

import { requestUploadUrl } from "@/app/actions/media";
import type { UploadKind } from "@/lib/storage";

export type ClientUploadResult =
  | { ok: true; publicUrl: string; key: string }
  | { ok: false; error: string };

// Kinds where the source is typically a raw phone-camera photo (often
// several MB) but only ever needs to render as a feed thumbnail, avatar,
// or chat bubble — never full sensor resolution. Video/audio kinds are
// deliberately excluded; resizing those is a different problem entirely.
const RESIZABLE_KINDS: UploadKind[] = ["avatar", "post-image", "message-image", "circle-cover"];

const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_RESIZE_QUALITY = 0.85;

/**
 * Downscales an image client-side, in the browser, before it ever leaves
 * the device — this app deliberately never routes untrusted uploaded
 * images through server-side processing (see SECURITY.md: sharp/libvips,
 * which powers next/image, has known CVEs, and post/avatar images come
 * from arbitrary users), so this can't be done server-side. A no-op for
 * anything already smaller than the cap, and fails open (returns the
 * original file) on any error — never blocks an upload over a resize
 * failure.
 */
export async function resizeImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_load_failed"));
      el.src = objectUrl;
    });

    const { naturalWidth: width, naturalHeight: height } = img;
    if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
      return file;
    }

    const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // PNG stays PNG (preserves transparency); everything else (JPEG, WebP,
    // HEIC-as-JPEG from iOS's own conversion) re-encodes as JPEG.
    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, IMAGE_RESIZE_QUALITY),
    );
    if (!blob) return file;

    const ext = outputType === "image/png" ? "png" : "jpg";
    return new File([blob], file.name.replace(/\.\w+$/, `.${ext}`), { type: outputType });
  } catch {
    return file;
  } finally {
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
 * each attempt (backoff) rather than staying fixed, giving a flaky
 * connection more time to recover before the next try. When
 * waitForVisible is set, each retry also waits for the page to be in the
 * foreground first — see waitForForeground above.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
  delayMs = 800,
  waitForVisible = false,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      if (waitForVisible) await waitForForeground();
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
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
]);
const PUT_ATTEMPTS_DEFAULT = 2;
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
type RequestUploadUrlFn = (
  fd: FormData,
) => Promise<{ error: string | null; uploadUrl?: string; publicUrl?: string; key?: string }>;

export async function uploadFileDirect(
  file: File,
  kind: UploadKind,
  // Defaults to the authenticated requestUploadUrl action; the public
  // /advertise booking flow passes requestAdUploadUrl instead, since there's
  // no signed-in user to attribute the upload to there.
  requestUrlFn: RequestUploadUrlFn = requestUploadUrl,
): Promise<ClientUploadResult> {
  const uploadFile = RESIZABLE_KINDS.includes(kind) ? await resizeImageFile(file) : file;

  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("contentType", uploadFile.type);

  let result;
  try {
    result = await withRetry(() => withTimeout(requestUrlFn(fd), MIN_ATTEMPT_TIMEOUT_MS));
  } catch {
    return { ok: false, error: "network" };
  }
  if (result.error || !result.uploadUrl || !result.publicUrl || !result.key) {
    return { ok: false, error: result.error ?? "invalid" };
  }
  // Narrowed into their own const bindings — a closure over the `let
  // result` above can't be trusted by TS to keep the narrowing from the
  // guard just above (a real gap, not just noise: RequestUploadUrlFn's
  // return type isn't the discriminated union requestUploadUrl's own
  // inferred type is, so the two behave differently here).
  const { uploadUrl, publicUrl, key } = result;

  let putRes;
  try {
    // Retrying re-sends to the exact same presigned URL/key (not a fresh
    // request-upload-url round trip), so a retry just overwrites the same
    // R2 object rather than risking an orphaned duplicate. Video gets more
    // attempts than everything else, and waits for the page to be back in
    // the foreground before each retry — see PUT_ATTEMPTS_VIDEO and
    // waitForForeground above. The video-kind presigned URL is valid for an
    // hour (see createUploadUrl), so waiting for the app to be reopened
    // still has plenty of room even after a long backgrounded stretch.
    const isVideo = VIDEO_KINDS.has(kind);
    const putAttempts = isVideo ? PUT_ATTEMPTS_VIDEO : PUT_ATTEMPTS_DEFAULT;
    const timeoutMs = attemptTimeoutMs(uploadFile.size);
    putRes = await withRetry(
      () =>
        fetchWithTimeout(
          uploadUrl,
          {
            method: "PUT",
            headers: { "Content-Type": uploadFile.type },
            body: uploadFile,
          },
          timeoutMs,
        ),
      putAttempts,
      800,
      isVideo,
    );
  } catch {
    return { ok: false, error: "network" };
  }

  if (!putRes.ok) {
    return { ok: false, error: "upload_failed" };
  }

  return { ok: true, publicUrl, key };
}

export function captureVideoFrame(video: HTMLVideoElement): Promise<File | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    // Capped the same as resizeImageFile above — a 4K phone video would
    // otherwise produce a multi-MB 4K thumbnail frame for what's just a
    // small poster image, and risk tripping video-thumb's 3MB size limit.
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], "thumb.jpg", { type: "image/jpeg" }) : null),
      "image/jpeg",
      IMAGE_RESIZE_QUALITY,
    );
  });
}

/**
 * Self-contained frame grab from a local File (its own hidden <video>, not
 * one the caller has to wire up) — this has no dependency on the file having
 * been uploaded anywhere yet, so callers can run it in parallel with the
 * network upload of that same file instead of waiting for it to finish.
 */
export function captureVideoFrameFromFile(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    probe.src = URL.createObjectURL(file);
    probe.muted = true;
    probe.playsInline = true;
    probe.onloadeddata = () => {
      probe.currentTime = Math.min(1, probe.duration / 2);
    };
    probe.onseeked = async () => {
      const frame = await captureVideoFrame(probe);
      URL.revokeObjectURL(probe.src);
      resolve(frame);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(probe.src);
      resolve(null);
    };
  });
}
