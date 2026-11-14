// Client-safe (no storage.ts import), shared by every composer that accepts a video file.

import { isUploadableVideoType, normalizeMediaType, safeUploadName } from "@/lib/media-file";

/**
 * Android's document picker often hands back a file from a content:// URI
 * (Google Photos, the system Photo Picker, a file manager, etc.) with
 * File.type empty or wrong, even for a perfectly normal .mp4 — a strict
 * MIME-type check alone rejected those outright with no indication why
 * (confirmed live: the post composer's picker silently did nothing). iOS and
 * other sources add their own spellings (`video/x-m4v`, upper-case `.MP4` /
 * `.MOV`, a type with parameters). normalizeMediaType (media-file.ts) maps all
 * of those case-insensitively, and this returns a File whose type is exactly
 * one the server accepts, so the upload (which sends file.type as the R2
 * object's Content-Type) never inherits a wrong/empty type. The same File is
 * returned untouched when its type is already right (prefetchUpload keys on
 * the File object). Null when it isn't an accepted video.
 */
export function normalizeVideoFile(f: File): File | null {
  const normalized = normalizeMediaType(f.type, f.name);
  if (!normalized || normalized.kind !== "video" || !isUploadableVideoType(normalized.type)) return null;
  if (f.type === normalized.type) return f;
  return new File([f], safeUploadName("video", normalized.type), { type: normalized.type, lastModified: f.lastModified });
}
