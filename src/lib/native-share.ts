"use client";

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * @capacitor/share's `files` option only accepts file:// paths, never a
 * remote URL directly (unlike the Web Share API, which can take a File
 * built straight from a fetch()'d Blob) — so a media URL has to be
 * downloaded and re-written into the app's own cache dir first to get a
 * URI Share.share() can actually attach.
 */
async function downloadToCache(src: string, fileName: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const base64 = await blobToBase64(await res.blob());
    const { uri } = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    return uri;
  } catch {
    return null;
  }
}

/**
 * True only when the native Share plugin is actually usable right now —
 * `Capacitor.isNativePlatform()` alone isn't enough, since this app's web
 * code ships ahead of native releases (see CLAUDE.md): a device still on an
 * older installed build would have `isNativePlatform()` true but no Share
 * plugin compiled in, and calling it would just silently fail.
 */
export function canShareNatively(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Share");
}

/**
 * Shares a post via the OS-native share sheet (Android Intent.ACTION_SEND /
 * iOS UIActivityViewController) instead of the browser's Web Share API —
 * WebView support for `navigator.share` varies by the installed system
 * WebView build and isn't reliable, whereas this goes straight through
 * Capacitor's native plugin bridge. `sources` are optional remote media
 * URLs to attach (all-or-nothing: if any fails to download, the share goes
 * out as a plain link/text instead of a partial attachment). Returns false
 * only on an actual failure to invoke the share sheet — the user simply
 * cancelling it rejects the same promise as a real error — both are
 * swallowed here (returns true either way) rather than surfacing an error
 * or falling back to a second share attempt, matching the existing Web
 * Share `.catch(() => {})` behavior elsewhere in this app. Call
 * `canShareNatively()` first; this assumes the plugin is actually present.
 */
export async function shareNative(options: {
  url?: string;
  text?: string;
  sources?: { src: string; fileName: string }[];
}): Promise<boolean> {
  try {
    let files: string[] | undefined;
    if (options.sources?.length) {
      const downloaded = await Promise.all(
        options.sources.map((s) => downloadToCache(s.src, s.fileName)),
      );
      const uris = downloaded.filter((u): u is string => u !== null);
      if (uris.length === options.sources.length) files = uris;
    }
    await Share.share({ url: options.url, text: options.text, files });
    return true;
  } catch {
    return true;
  }
}
