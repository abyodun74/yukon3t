"use client";

import { requestUploadUrl } from "@/app/actions/media";
import type { UploadKind } from "@/lib/storage";

export type ClientUploadResult =
  | { ok: true; publicUrl: string; key: string }
  | { ok: false; error: string };

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
  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("contentType", file.type);

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
      headers: { "Content-Type": file.type },
      body: file,
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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], "thumb.jpg", { type: "image/jpeg" }) : null),
      "image/jpeg",
      0.85,
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
