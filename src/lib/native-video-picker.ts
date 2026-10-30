"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { withNativePickerActive } from "@/lib/native-picker-activity";
import { base64ToFile } from "@/lib/base64-file";

interface VideoPickerPluginInterface {
  pickVideo(): Promise<{
    uri: string | null;
    name?: string;
    mimeType?: string;
    size?: number;
    durationSeconds?: number | null;
    thumbnailBase64?: string | null;
  }>;
  uploadVideo(options: { uri: string; uploadUrl: string; contentType: string }): Promise<{ success: boolean }>;
}

// Same native module as native-gallery-picker.ts's GalleryPicker — one
// Android plugin class backs both pickImages and this file's pickVideo/
// uploadVideo (see GalleryPickerPlugin.java).
const GalleryPicker = registerPlugin<VideoPickerPluginInterface>("GalleryPicker");

function isAndroid() {
  return Capacitor.getPlatform() === "android";
}

/**
 * Android's native video picker — bypasses the WebView's plain
 * `<input type="file">` file-chooser, which doesn't reliably deliver a
 * content:// result back to the page for a video pick on this platform
 * (confirmed live via adb logcat: the system picker opens fine and
 * returns a result, but the page's file input's change event never
 * fires — no error anywhere, the composer just never receives a file).
 * Returns:
 *   - the picked video's metadata + a small JPEG thumbnail (as a real
 *     File, ready for the existing video-thumb upload path) when the
 *     native picker actually ran, or
 *   - null when it didn't/couldn't — iOS, web, or an older installed
 *     Android build without this plugin yet — so callers should fall
 *     back to their existing `<input type="file">` in that case, same
 *     contract as pickImagesNative.
 * Never on a user backing out with nothing picked — that resolves with
 * `uri: null`, surfaced here as `null` too, same no-op shape as
 * cancelling the plain file dialog.
 */
export async function pickVideoNative(): Promise<{
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  durationSeconds: number | null;
  thumbnailFile: File | null;
} | null> {
  if (!isAndroid()) return null;
  try {
    const result = await withNativePickerActive(() => GalleryPicker.pickVideo());
    if (!result.uri) return null;
    return {
      uri: result.uri,
      name: result.name ?? "video.mp4",
      mimeType: result.mimeType ?? "video/mp4",
      size: result.size ?? 0,
      durationSeconds: result.durationSeconds ?? null,
      thumbnailFile: result.thumbnailBase64 ? base64ToFile(result.thumbnailBase64, "image/jpeg", "thumb.jpg") : null,
    };
  } catch {
    return null;
  }
}

/**
 * Streams the video at `uri` (from pickVideoNative above) directly from
 * native code to a presigned R2 PUT URL — the bytes never cross the JS
 * bridge. `uploadUrl` is the single part URL of a one-part multipart upload
 * (startNativeVideoUpload), never a createUploadUrl single-PUT URL: the
 * installed apps' Java uploader sends only Content-Type, so it can't send the
 * signed `If-None-Match: *` those require (see write-once-upload.ts), and it
 * re-sends the same URL on retry, which a part URL allows until the upload is
 * completed. Any header-signed URL passed here would fail on every installed
 * build.
 */
export async function uploadVideoNative(uri: string, uploadUrl: string, contentType: string): Promise<boolean> {
  try {
    const { success } = await GalleryPicker.uploadVideo({ uri, uploadUrl, contentType });
    return success;
  } catch {
    return false;
  }
}
