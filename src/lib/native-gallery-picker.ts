"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

interface GalleryPickerPluginInterface {
  pickImages(options: { limit: number }): Promise<{
    images: { base64: string; mimeType: string; name: string }[];
  }>;
}

/** Bridges to GalleryPickerPlugin.java (Android only). */
const GalleryPicker = registerPlugin<GalleryPickerPluginInterface>("GalleryPicker");

function isAndroid() {
  return Capacitor.getPlatform() === "android";
}

function base64ToFile(base64: string, mimeType: string, name: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mimeType });
}

/**
 * Android's native multi-select Photo Picker, nicer than the WebView's
 * default file-chooser sheet for picking several photos at once — see
 * GalleryPickerPlugin.java. Returns:
 *   - an array of Files (possibly empty, if the user picked nothing and
 *     backed out) when the native picker actually ran, or
 *   - null when it didn't/couldn't — iOS, web, or an older installed
 *     Android build without this plugin yet (native code only reaches
 *     users through a new Play Store release, so the web app can ship
 *     ahead of it) — so callers should fall back to their existing
 *     `<input type="file" multiple>` in that case, never on an empty array.
 */
export async function pickImagesNative(limit: number): Promise<File[] | null> {
  if (!isAndroid()) return null;
  try {
    const { images } = await GalleryPicker.pickImages({ limit });
    return images.map((img) => base64ToFile(img.base64, img.mimeType, img.name));
  } catch {
    return null;
  }
}
