"use client";

// Fraction of the shared image's shorter side the logo badge occupies —
// large enough to read at chat-bubble/feed-thumbnail scale on the
// receiving app, small enough not to obscure the photo itself.
const WATERMARK_SIZE_RATIO = 0.14;
const WATERMARK_MARGIN_RATIO = 0.035;

// The mark's own geometry, copied from public/icons/mark.svg's 512x512
// viewBox (rounded-square background + a 3-node/3-line triangle glyph) —
// see drawMark below for why this is redrawn with plain canvas primitives
// instead of rendering that SVG file directly.
const MARK_VIEWBOX = 512;
const MARK_BG = "#b5651d";
const MARK_CORNER_RADIUS_RATIO = 112 / MARK_VIEWBOX;
const MARK_NODES = [
  { x: 256, y: 176 },
  { x: 186, y: 300 },
  { x: 326, y: 300 },
] as const;
const MARK_NODE_RADIUS_RATIO = 34 / MARK_VIEWBOX;
const MARK_STROKE_RATIO = 14 / MARK_VIEWBOX;

/**
 * Draws the yukon3t icon mark at (x, y), sized size x size. Deliberately
 * NOT the public/icons/mark.svg file loaded as an <img> and drawn via
 * ctx.drawImage — confirmed live on a real Android share (the whole photo
 * attachment silently dropped to a link-only share): some WebView/Chromium
 * builds treat an SVG-sourced image as tainting the canvas even when it's
 * same-origin, which makes canvas.toBlob() throw a SecurityError.
 * watermarkImageFile below fails open on that error, but the failure
 * happens inside native-share.ts's downloadToCache, whose caller treats
 * "watermarking failed" the same as "download failed" and falls back to
 * sharing a bare link instead of the photo at all. Redrawing the same
 * handful of shapes with plain canvas 2D calls has no image resource to
 * taint anything with, so it can't hit that failure mode.
 */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const radius = size * MARK_CORNER_RADIUS_RATIO;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + size, y, x + size, y + size, radius);
  ctx.arcTo(x + size, y + size, x, y + size, radius);
  ctx.arcTo(x, y + size, x, y, radius);
  ctx.arcTo(x, y, x + size, y, radius);
  ctx.closePath();
  ctx.fillStyle = MARK_BG;
  ctx.fill();

  const scale = size / MARK_VIEWBOX;
  const nodes = MARK_NODES.map((n) => ({ x: x + n.x * scale, y: y + n.y * scale }));

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * MARK_STROKE_RATIO;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  ctx.lineTo(nodes[1].x, nodes[1].y);
  ctx.moveTo(nodes[0].x, nodes[0].y);
  ctx.lineTo(nodes[2].x, nodes[2].y);
  ctx.moveTo(nodes[1].x, nodes[1].y);
  ctx.lineTo(nodes[2].x, nodes[2].y);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  const nodeRadius = size * MARK_NODE_RADIUS_RATIO;
  for (const n of nodes) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_load_failed"));
      el.src = objectUrl;
    });

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
    drawMark(ctx, canvas.width - size - margin, canvas.height - size - margin, size);
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
