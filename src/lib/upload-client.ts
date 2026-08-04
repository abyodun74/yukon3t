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
const RESIZABLE_KINDS: UploadKind[] = ["avatar", "post-image", "message-image"];

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
 * Requests a presigned URL, then PUTs the file directly to R2 from the
 * browser. Never throws — both steps are network calls (the server action
 * is itself a fetch under the hood), and a rejected fetch (e.g. no
 * connectivity) would otherwise propagate as an uncaught exception through
 * whatever startTransition called this, which React/Next renders as a full
 * page crash rather than a normal form error.
 */
export async function uploadFileDirect(
  file: File,
  kind: UploadKind,
): Promise<ClientUploadResult> {
  const uploadFile = RESIZABLE_KINDS.includes(kind) ? await resizeImageFile(file) : file;

  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("contentType", uploadFile.type);

  let result;
  try {
    result = await requestUploadUrl(fd);
  } catch {
    return { ok: false, error: "network" };
  }
  if (result.error || !result.uploadUrl || !result.publicUrl || !result.key) {
    return { ok: false, error: result.error ?? "invalid" };
  }

  let putRes;
  try {
    putRes = await fetch(result.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": uploadFile.type },
      body: uploadFile,
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (!putRes.ok) {
    return { ok: false, error: "upload_failed" };
  }

  return { ok: true, publicUrl: result.publicUrl, key: result.key };
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
