"use client";

import { Capacitor } from "@capacitor/core";
import { Media } from "@capacitor-community/media";

const ALBUM_NAME = "YuKon3t";
let albumPathPromise: Promise<string> | null = null;

/**
 * @capacitor-community/media's savePhoto/saveVideo require an existing
 * album *directory* identifier on Android — there's no "default album" the
 * way iOS has (an unset albumIdentifier there is fine). The path is
 * deterministic (getAlbumsPath() + a fixed folder name), so it's computed
 * once per app session; createAlbum() is only ever attempted the first
 * time — calling it again on a folder that already exists rejects with
 * "Album already exists", which is expected here and safely ignored.
 */
function ensureAndroidAlbum(): Promise<string> {
  if (!albumPathPromise) {
    albumPathPromise = (async () => {
      const { path } = await Media.getAlbumsPath();
      const albumPath = `${path}/${ALBUM_NAME}`;
      await Media.createAlbum({ name: ALBUM_NAME }).catch(() => {});
      return albumPath;
    })();
  }
  return albumPathPromise;
}

function guessExtension(url: string, kind: "photo" | "video") {
  const fromUrl = url.match(/\.([a-z0-9]{2,4})(?:\?|#|$)/i)?.[1]?.toLowerCase();
  return fromUrl ?? (kind === "video" ? "mp4" : "jpg");
}

/**
 * Downloads a URL through the browser's own save flow — the only option
 * outside the native app. Browsers don't expose a "save to Photos" API to
 * web pages, but the file lands in Downloads, which is good enough for a
 * plain browser tab/PWA install.
 */
async function saveViaBrowserDownload(url: string, fileName: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves a post/message/story photo or video to the device's own gallery
 * (Photos on iOS, an app-named album under Gallery on Android) via the
 * native Media plugin — falls back to a plain browser download when
 * running outside the native app, or when the currently-installed native
 * build predates this feature (web ships ahead of a native release in this
 * app — see CLAUDE.md's "Mobile" section — so isPluginAvailable can be
 * false even though Capacitor.isNativePlatform() is true).
 */
export async function saveMediaToGallery(url: string, kind: "photo" | "video"): Promise<boolean> {
  const fileName = `yukon3t-${Date.now()}.${guessExtension(url, kind)}`;

  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Media")) {
    return saveViaBrowserDownload(url, fileName);
  }

  try {
    const albumIdentifier = Capacitor.getPlatform() === "android" ? await ensureAndroidAlbum() : undefined;
    // fileName must not include an extension — the plugin appends its own.
    const options = { path: url, albumIdentifier, fileName: fileName.replace(/\.\w+$/, "") };
    if (kind === "video") await Media.saveVideo(options);
    else await Media.savePhoto(options);
    return true;
  } catch {
    return false;
  }
}
