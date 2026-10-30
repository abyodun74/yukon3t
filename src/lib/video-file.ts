// Client-safe (no storage.ts import), shared by every composer that accepts a video file.

const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const VIDEO_EXTENSION_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

/**
 * Android's document picker often hands back a file from a content:// URI
 * (Google Photos, the system Photo Picker, a file manager, etc.) with
 * File.type empty or wrong, even for a perfectly normal .mp4 — a strict
 * MIME-type check alone rejected those outright with no indication why
 * (confirmed live: the post composer's picker silently did nothing). Falls
 * back to the file extension, and returns a corrected File so the upload
 * itself (which sends file.type as the R2 object's Content-Type) doesn't
 * inherit the same wrong/empty type. Null when it isn't an accepted video.
 */
export function normalizeVideoFile(f: File): File | null {
  if (VIDEO_TYPES.includes(f.type)) return f;
  const ext = f.name.split(".").pop()?.toLowerCase();
  const detectedType = ext ? VIDEO_EXTENSION_TYPES[ext] : undefined;
  if (!detectedType) return null;
  return new File([f], f.name, { type: detectedType });
}
