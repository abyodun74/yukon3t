"use client";

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { watermarkImageFile } from "@/lib/watermark";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

type DownloadResult = { ok: true; uri: string } | { ok: false; reason: string };

function mimeTypeFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

function base64ToFile(base64: string, fileName: string, mimeType: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType });
}

/**
 * @capacitor/share's `files` option only accepts file:// paths, never a
 * remote URL directly (unlike the Web Share API, which can take a File
 * built straight from a fetch()'d Blob) — so a media URL has to be
 * downloaded into the app's own cache dir first to get a URI Share.share()
 * can actually attach. Returns a reason string on failure (not just null)
 * — this is the only path a "share via device" failure has to a human,
 * since this app's release build doesn't forward WebView console output
 * to logcat and has remote debugging disabled, so a plain console.error
 * here is otherwise completely invisible.
 *
 * Every source downloads via Filesystem.downloadFile — Android's native
 * HTTP stack, entirely outside the WebView's fetch()/CORS layer — rather
 * than a plain fetch(). Confirmed live: fetch(src) throws a bare
 * "TypeError: Failed to fetch" against this app's own R2 media host for
 * both images and videos on a real device, while the exact same URL
 * downloads fine through this native path — so this isn't a size/memory
 * problem fetch() just needs more headroom for, it's fetch() itself
 * failing outright for this host in this WebView. For a watermark: true
 * source (a still IMAGE — see share-modal.tsx), the file is then read
 * back from local disk (Filesystem.readFile, not the network — a plain
 * local file read, unaffected by whatever breaks the remote fetch) to get
 * its bytes into JS for the canvas watermark step, and the stamped result
 * overwrites the same cache file.
 */
async function downloadToCache(src: string, fileName: string, watermark: boolean): Promise<DownloadResult> {
  try {
    await Filesystem.downloadFile({ url: src, path: fileName, directory: Directory.Cache });

    if (!watermark) {
      const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      return { ok: true, uri };
    }

    // Branding happens here, on the downloaded copy, rather than before
    // upload — the original post image stays untouched in R2 (still needed
    // unwatermarked for the feed/lightbox/etc.), only the copy that's about
    // to leave the app via the native share sheet gets stamped.
    const { data } = await Filesystem.readFile({ path: fileName, directory: Directory.Cache });
    const base64Downloaded = typeof data === "string" ? data : await blobToBase64(data);
    const watermarked = await watermarkImageFile(
      base64ToFile(base64Downloaded, fileName, mimeTypeFromFileName(fileName)),
    );
    const base64Watermarked = await blobToBase64(watermarked);
    const { uri } = await Filesystem.writeFile({ path: fileName, data: base64Watermarked, directory: Directory.Cache });
    return { ok: true, uri };
  } catch (err) {
    return { ok: false, reason: `${fileName}: ${err instanceof Error ? err.message : String(err)}` };
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

export type ShareNativeResult = { attachedFiles: boolean; warning?: string };

/**
 * Shares a post via the OS-native share sheet (Android Intent.ACTION_SEND /
 * iOS UIActivityViewController) instead of the browser's Web Share API —
 * WebView support for `navigator.share` varies by the installed system
 * WebView build and isn't reliable, whereas this goes straight through
 * Capacitor's native plugin bridge. `sources` are optional remote media
 * URLs to attach (all-or-nothing: if any fails to download, the share goes
 * out as a plain link/text instead of a partial attachment — `warning`
 * carries why, so the caller can surface it instead of it just silently
 * being a worse share than intended). Always "succeeds" from the caller's
 * perspective — the user simply cancelling the share sheet rejects the
 * same promise as a real invocation failure, and there's no reliable way
 * to tell them apart, so both just surface as a `warning` here rather than
 * a rejection (matching the existing Web Share `.catch(() => {})` behavior
 * elsewhere in this app). Call `canShareNatively()` first; this assumes
 * the plugin is actually present.
 */
export async function shareNative(options: {
  url?: string;
  text?: string;
  sources?: { src: string; fileName: string; watermark?: boolean }[];
}): Promise<ShareNativeResult> {
  try {
    let files: string[] | undefined;
    let warning: string | undefined;
    if (options.sources?.length) {
      const downloaded = await Promise.all(
        options.sources.map((s) => downloadToCache(s.src, s.fileName, s.watermark ?? false)),
      );
      const failures = downloaded.filter((d): d is { ok: false; reason: string } => !d.ok);
      if (failures.length === 0) {
        files = downloaded.map((d) => (d as { ok: true; uri: string }).uri);
      } else {
        warning = `Couldn't attach media, sent link only (${failures.map((f) => f.reason).join("; ")})`;
      }
    }
    await Share.share({ url: options.url, text: options.text, files });
    return { attachedFiles: Boolean(files?.length), warning };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // @capacitor/share's Android plugin only ever clears its internal
    // "isPresenting" flag when the share sheet's own activity-result
    // callback fires — which real devices have shown doesn't always happen
    // if a previous share got abandoned mid-flow (backgrounding/killing the
    // app while the chooser or picked target app was on screen). When that
    // happens every subsequent share() call fails immediately with this
    // exact message, regardless of which post or how much later it's
    // retried. Patched at the source for the next native release (see
    // patches/@capacitor+share+8.0.1.patch — resets the flag whenever the
    // app returns to the foreground), but that fix only reaches real users
    // through a new Play Store release, not this web deploy — so the
    // currently-live app still needs an actionable message here rather than
    // the plugin's own unhelpful raw error text.
    if (message.includes("sharing is in progress")) {
      return {
        attachedFiles: false,
        warning: "A previous share didn't finish — fully close and reopen the app, then try again.",
      };
    }
    return { attachedFiles: false, warning: message };
  }
}
