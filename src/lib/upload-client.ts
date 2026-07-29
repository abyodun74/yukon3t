"use client";

import { requestUploadUrl } from "@/app/actions/media";
import type { UploadKind } from "@/lib/storage";

export type ClientUploadResult =
  | { ok: true; publicUrl: string; key: string }
  | { ok: false; error: string };

/** Requests a presigned URL, then PUTs the file directly to R2 from the browser. */
export async function uploadFileDirect(
  file: File,
  kind: UploadKind,
): Promise<ClientUploadResult> {
  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("contentType", file.type);

  const result = await requestUploadUrl(fd);
  if (result.error || !result.uploadUrl || !result.publicUrl || !result.key) {
    return { ok: false, error: result.error ?? "invalid" };
  }

  const putRes = await fetch(result.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

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
