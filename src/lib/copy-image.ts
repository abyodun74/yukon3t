"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  clipboardImageSize,
  imageClipboardSupport,
  isAndroidWebViewUserAgent,
  type ImageClipboardSupport,
} from "@/lib/link-copy-menu";

/**
 * Clipboard helpers for the press-and-hold menu (src/components/link-copy-menu.tsx). Browsers and the iOS app
 * (WKWebView) use the async Clipboard API; the Android app uses its native `ImageClipboard` plugin
 * (android/.../ImageClipboardPlugin.java), because Android WebView's clipboard silently drops pictures. See
 * `imageClipboardSupport` (src/lib/link-copy-menu.ts) for the decision.
 */

interface ImageClipboardPluginInterface {
  /** `data`: base64 (no `data:` prefix) of a PNG/JPEG/WebP. Rejects on any failure. */
  copyImage(options: { data: string; mimeType: string }): Promise<void>;
}

/** Bridges to ImageClipboardPlugin.java (Android only). */
const ImageClipboard = registerPlugin<ImageClipboardPluginInterface>("ImageClipboard");

export function detectImageClipboardSupport(): ImageClipboardSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const Item = (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  const supports = Item && typeof (Item as { supports?: (type: string) => boolean }).supports === "function"
    ? (Item as unknown as { supports: (type: string) => boolean }).supports("image/png")
    : undefined;
  return imageClipboardSupport({
    // Feature-detected, not version-checked: installed Android builds from before the plugin existed load the same
    // live site and must keep the "Share photo" path.
    nativePlugin: Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("ImageClipboard"),
    hasClipboardWrite: typeof navigator.clipboard?.write === "function",
    hasClipboardItem: typeof Item === "function",
    supportsPng: supports,
    androidWebView: Capacitor.getPlatform() === "android" || isAndroidWebViewUserAgent(navigator.userAgent),
  });
}

/** Plain text, with the legacy `execCommand("copy")` path for WebViews that refuse the async Clipboard API. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    const previous = document.activeElement as HTMLElement | null;
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    previous?.focus?.({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
    } catch {
      // Some engines can't decode every type through createImageBitmap; the <img> path below still can.
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_decode_failed"));
      el.src = objectUrl;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(objectUrl) };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

/**
 * The picture at `src` as an `image/png` Blob (the one image type every clipboard implementation accepts).
 *
 * Fetched with CORS, not drawn from the on-screen `<img>`: that one was loaded without `crossorigin`, so drawing it
 * would taint the canvas. The media bucket's CORS allows GET from the site's own origins (checked 2026-10-26:
 * https://yukon3t.com, the Vercel/Netlify hosts, localhost), and the Capacitor apps load https://yukon3t.com, so
 * this is a same-policy fetch everywhere. `cache: "no-store"` matters: the bucket only adds
 * `Access-Control-Allow-Origin` / `Vary: Origin` when the request has an Origin, so the cached copy from the
 * `<img>` (no Origin) has no CORS header and reusing it fails the fetch.
 */
async function fetchAsPng(src: string): Promise<Blob> {
  const res = await fetch(src, { mode: "cors", cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error(`image_fetch_${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not_an_image");

  const decoded = await decode(blob);
  try {
    const size = clipboardImageSize(decoded.width, decoded.height);
    if (blob.type === "image/png" && size.width === decoded.width) return blob;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no_canvas");
    ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!out) throw new Error("png_encode_failed");
    // Rebuilt from a plain ArrayBuffer, like upload-client.ts does: an Android WebView canvas.toBlob() Blob can be
    // backed by an already-invalid temp file.
    return new Blob([await out.arrayBuffer()], { type: "image/png" });
  } finally {
    decoded.done();
  }
}

/**
 * Puts the picture itself on the clipboard. Must be called straight from the tap/click handler: the
 * `ClipboardItem` is built synchronously with a promise for the PNG (Safari/WKWebView require that shape to keep the
 * user gesture; Chrome and Firefox accept it), and the download/convert happens inside it.
 */
export async function copyImageToClipboard(src: string): Promise<boolean> {
  try {
    const png = fetchAsPng(src);
    // write() below reports a failure; this only keeps an early refusal from also logging an unhandled rejection.
    png.catch(() => {});
    const item = new ClipboardItem({ "image/png": png });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Android app: the same PNG conversion as `copyImageToClipboard`, handed to the native `ImageClipboard` plugin,
 * which stores it in the app cache and puts a content:// URI to it on the system clipboard. No user-gesture
 * constraint here (the native clipboard has none). Only call when `detectImageClipboardSupport()` is `"native"`.
 */
export async function copyImageNatively(src: string): Promise<boolean> {
  try {
    const png = await fetchAsPng(src);
    const data = await blobToBase64(png);
    if (!data) return false;
    await ImageClipboard.copyImage({ data, mimeType: "image/png" });
    return true;
  } catch (err) {
    console.error("[copyImageNatively] failed", err);
    return false;
  }
}
