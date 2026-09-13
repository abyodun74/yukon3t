"use client";

// The app's icon mark (src/lib/native-share.ts, share-modal.tsx) — reused
// as a share watermark so a photo still reads as "from yukon3t" once it's
// outside the app's own UI chrome, since captions/urls routinely get
// stripped by whatever it lands in (WhatsApp, Instagram, SMS, ...).
const WATERMARK_SRC = "/icons/mark.svg";
// Fraction of the shared image's shorter side the logo badge occupies —
// large enough to read at chat-bubble/feed-thumbnail scale on the
// receiving app, small enough not to obscure the photo itself.
const WATERMARK_SIZE_RATIO = 0.14;
const WATERMARK_MARGIN_RATIO = 0.035;

let cachedLogo: Promise<HTMLImageElement> | null = null;
function loadLogo(): Promise<HTMLImageElement> {
  if (!cachedLogo) {
    cachedLogo = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("logo_load_failed"));
      img.src = WATERMARK_SRC;
    });
  }
  return cachedLogo;
}

/**
 * Stamps the yukon3t logo mark into the bottom-right corner of an image
 * before it leaves the app via native-share.ts/share-modal.tsx. Only
 * applies to static images — an animated GIF drawn onto a <canvas> would
 * flatten to a single still frame (same reasoning resizeImageFile already
 * documents for GIFs), and video has no equivalent client-side pixel path
 * at all (this app deliberately avoids ffmpeg/native media processing on
 * untrusted media, see SECURITY.md) — those are branded via the shared
 * text/link instead, not the media itself. Fails open (returns the
 * original file) on any error — a missing watermark should never block a
 * share.
 */
export async function watermarkImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const [img, logo] = await Promise.all([
      new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image_load_failed"));
        el.src = objectUrl;
      }),
      loadLogo(),
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0);

    const shortSide = Math.min(canvas.width, canvas.height);
    const size = Math.max(24, Math.round(shortSide * WATERMARK_SIZE_RATIO));
    const margin = Math.max(8, Math.round(shortSide * WATERMARK_MARGIN_RATIO));
    ctx.globalAlpha = 0.92;
    ctx.drawImage(logo, canvas.width - size - margin, canvas.height - size - margin, size, size);
    ctx.globalAlpha = 1;

    // PNG stays PNG (preserves transparency); everything else re-encodes as
    // JPEG — same rule as resizeImageFile (upload-client.ts).
    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.9));
    if (!blob) return file;

    // Rebuilt from a plain ArrayBuffer, not the canvas.toBlob() Blob
    // directly — same Android WebView stale-temp-file workaround
    // upload-client.ts's resizeImageFile documents (net::ERR_UPLOAD_FILE_CHANGED
    // on the very first read otherwise).
    const buf = await blob.arrayBuffer();
    const ext = outputType === "image/png" ? "png" : "jpg";
    return new File([buf], file.name.replace(/\.\w+$/, `.${ext}`), { type: outputType });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
