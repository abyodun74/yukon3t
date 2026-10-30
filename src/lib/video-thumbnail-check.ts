import { MEDIA_LIMITS, keyFromPublicUrl, verifyUploadedSize } from "@/lib/storage";
import { isOwnedUploadKey } from "@/lib/media-keys";

/**
 * The still frame sent with a video Story or chat message (audit M1, 2026-10-29). It is the only part of the video the
 * screen can look at, and it is stored and shown as the poster, so it must be:
 *  - present ("required": a video with no frame used to go out with only its caption checked),
 *  - the sender's own `video-thumb/` upload ("invalid": any URL used to be accepted, e.g. an outside image that shows
 *    the screen one thing and viewers another, or someone else's file that a later cleanup would delete),
 *  - within the thumbnail size cap ("too_large", also when the upload is missing).
 * Moderation itself stays with the caller's moderateMedia call (thumbnailUrl).
 */
export type VideoThumbnailCheck = "ok" | "required" | "invalid" | "too_large";

export async function checkVideoThumbnail(url: string | null | undefined, ownerId: string): Promise<VideoThumbnailCheck> {
  if (!url) return "required";
  const key = keyFromPublicUrl(url);
  if (!key || !isOwnedUploadKey(key, "video-thumb", ownerId)) return "invalid";
  const sizeOk = await verifyUploadedSize({ key, maxBytes: MEDIA_LIMITS["video-thumb"], ownerId });
  return sizeOk ? "ok" : "too_large";
}
