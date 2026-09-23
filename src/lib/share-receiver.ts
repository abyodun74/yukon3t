"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativePendingShareFile {
  name: string;
  mimeType: string;
  base64: string;
}

interface NativePendingShare {
  text: string | null;
  files: NativePendingShareFile[];
  /** Count of items the OS handed over that couldn't be read/fit under the native side's size cap — surfaced so a share doesn't just silently come back with fewer items than were actually sent (see ShareReceiverPlugin.java/ShareExtension's own doc comments). */
  skipped: number;
}

interface ShareReceiverPluginType {
  getPendingShare(): Promise<NativePendingShare>;
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

function base64ToFile(f: NativePendingShareFile): File {
  const byteChars = atob(f.base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new File([bytes], f.name, { type: f.mimeType || "application/octet-stream" });
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

  const result = await ShareReceiver.getPendingShare().catch(() => null);
  if (!result || (!result.text && result.files.length === 0 && !result.skipped)) return null;

  const images: File[] = [];
  let video: File | null = null;
  for (const f of result.files) {
    const file = base64ToFile(f);
    if (f.mimeType.startsWith("video/") && !video) {
      video = file;
    } else if (f.mimeType.startsWith("image/")) {
      images.push(file);
    }
    // audio/* shared files are dropped here deliberately — neither
    // PostComposer nor ChatThread's pending-media slots have an "attach an
    // arbitrary shared audio file" path today (their own audio recorders
    // produce their own File objects internally); wire this up if that
    // changes rather than half-supporting it now.
  }
  return { images, video, text: result.text, skipped: result.skipped ?? 0 };
}
