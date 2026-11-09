"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { captureError } from "@/lib/error-tracking";
import { readFileInChunks, type ShareFileChunk } from "@/lib/share-receiver-read";

interface NativePendingShareFile {
  name: string;
  mimeType: string;
  /** Android: absolute native filesystem path — see ShareReceiverPlugin.java's own doc comment for why this isn't base64 anymore. */
  path?: string;
  /** iOS: opaque id for readPendingFile (ShareReceiverPlugin.swift). */
  id?: string;
}

interface NativePendingShare {
  text: string | null;
  files: NativePendingShareFile[];
  /** Count of items the OS handed over that couldn't fit under the native side's size cap or otherwise failed to read — surfaced so a share doesn't just silently come back with fewer items than were actually sent (see ShareReceiverPlugin.java/ShareExtension's own doc comments). checkForPendingShare() below adds to this for its own JS-side failures (an unreadable path, a failed fetch, a genuinely unrecognized file type). */
  skipped: number;
}

interface ShareReceiverPluginType {
  getPendingShare(): Promise<NativePendingShare>;
  /** iOS only. */
  readPendingFile(options: { id: string; offset: number; length: number }): Promise<ShareFileChunk>;
}

/** Bridges to ShareReceiverPlugin.java (Android) / ShareReceiverPlugin.swift (iOS) — see their own doc comments. */
const ShareReceiver = registerPlugin<ShareReceiverPluginType>("ShareReceiver");

export interface PendingShareMedia {
  images: File[];
  video: File | null;
  text: string | null;
  /** See NativePendingShare.skipped above. */
  skipped: number;
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "3gp", "3gpp", "webm", "mkv", "avi"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "ogg", "opus"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Classifies a shared file as image/video/audio, preferring the native
 * side's reported MIME type but falling back to the file's own extension
 * when that type isn't a clear image/*, video/*, or audio/* — some content
 * providers report a generic type (e.g. "application/octet-stream")
 * instead of a precise one, which would otherwise match neither branch
 * below and silently vanish the file without even being counted as
 * skipped. Real (if less common) case, worth keeping — but confirmed
 * live (2026-09-25) NOT to be the cause of "share from Instagram/TikTok
 * comes back link-only": that's a source-app platform restriction (see
 * ShareReceiverPlugin.java's own doc comment), unrelated to classification.
 */
function mediaKind(mimeType: string, name: string): "image" | "video" | "audio" | null {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  const ext = extensionOf(name);
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return null;
}

/**
 * Reads the native file at `f.path` into a File via Capacitor's local-
 * resource loading (Capacitor.convertFileSrc + fetch) rather than a base64
 * bridge payload — see ShareReceiverPlugin.java's own doc comment for why:
 * this lets the WebView stream the bytes itself instead of ever holding two
 * full in-memory copies (raw + base64) at once, which is what capped the
 * old approach at 20MB — nowhere near enough for a typical shared Reel/
 * TikTok/Facebook video. Returns null on any failure (unreadable path,
 * fetch error) — best-effort, same as every other step in this pipeline.
 */
async function pathToFile(f: NativePendingShareFile): Promise<File | null> {
  if (!f.path) return null;
  try {
    const url = Capacitor.convertFileSrc(f.path);
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], f.name, { type: f.mimeType || blob.type || "application/octet-stream" });
  } catch {
    return null;
  }
}

/**
 * iOS: the WebView shows https://yukon3t.com, so the capacitor://localhost URL convertFileSrc gives there is another
 * origin (outside the CSP's connect-src, and without CORS headers for video); the plugin hands the bytes over in
 * base64 chunks instead. Failures are reported (stage only, never a file name) because nothing else would show them
 * on a TestFlight/App Store build.
 */
async function readIosFile(f: NativePendingShareFile): Promise<File | null> {
  const id = f.id;
  if (!id) return null;
  try {
    const parts = await readFileInChunks((offset, length) => ShareReceiver.readPendingFile({ id, offset, length }));
    return new File(parts, f.name, { type: f.mimeType || "application/octet-stream" });
  } catch (err) {
    void captureError(err, { component: "share-receiver", stage: "ios_read_file" });
    return null;
  }
}

/**
 * Checks whether the app was just launched/resumed via another app's Share
 * sheet ("Share to YuKon3t") and, if so, consumes it — the native side only
 * ever hands it back once (see ShareReceiverPlugin.getPendingShare), so a
 * second call in the same launch correctly comes back empty rather than
 * re-showing the same share. Returns null both when there's genuinely
 * nothing pending and on any native-call failure — callers don't need to
 * distinguish the two, there's nothing actionable either way.
 */
export async function checkForPendingShare(): Promise<PendingShareMedia | null> {
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return null;
  // iOS builds before 1.2 (5) never compiled the plugin in; nothing to read there.
  if (!Capacitor.isPluginAvailable("ShareReceiver")) return null;

  const result = await ShareReceiver.getPendingShare().catch((err: unknown) => {
    void captureError(err, { component: "share-receiver", stage: "get_pending_share", platform });
    return null;
  });
  if (!result || (!result.text && result.files.length === 0 && !result.skipped)) return null;

  const images: File[] = [];
  let video: File | null = null;
  // Starts from the native side's own count (files it couldn't fit under
  // its size cap) and adds any that failed on this side too (an unreadable
  // path, a failed fetch) — either way, "skipped" should reflect every item
  // the OS handed over that didn't make it into images/video, not just the
  // native-side subset.
  let skipped = result.skipped ?? 0;
  for (const f of result.files) {
    const file = platform === "ios" ? await readIosFile(f) : await pathToFile(f);
    if (!file) {
      skipped++;
      continue;
    }
    const kind = mediaKind(f.mimeType, f.name);
    if (kind === "video" && !video) {
      video = file;
    } else if (kind === "image") {
      images.push(file);
    } else if (kind === "audio") {
      // audio/* shared files are dropped here deliberately — neither
      // PostComposer nor ChatThread's pending-media slots have an "attach
      // an arbitrary shared audio file" path today (their own audio
      // recorders produce their own File objects internally); wire this up
      // if that changes rather than half-supporting it now.
    } else {
      // Genuinely unrecognized (e.g. a second video when one was already
      // claimed, or a type/extension this doesn't know) — counted as
      // skipped so it's visible, rather than silently vanishing.
      skipped++;
    }
  }
  return { images, video, text: result.text, skipped };
}
