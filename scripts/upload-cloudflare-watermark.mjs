// One-time setup: generates a transparent-background PNG of the yukon3t
// mark (same shape as public/icons/mark.svg / watermark.ts's canvas-drawn
// version — kept visually identical on purpose, so the brand reads the same
// whether it landed on an image client-side or a video server-side) and
// registers it as a Cloudflare Stream watermark profile
// (POST /stream/watermarks — see developers.cloudflare.com/stream/edit-videos/watermarks/).
// Prints the resulting `uid`, which needs to be set as
// CLOUDFLARE_STREAM_WATERMARK_UID everywhere the app runs (local .env,
// Vercel, Netlify) before src/lib/branded-video.ts can actually apply it —
// see cloudflare-stream.ts's createStreamCopy and branded-video-service.ts's
// isBrandingConfigured().
//
// Safe to run again: Cloudflare doesn't dedupe watermark profiles by
// content, so re-running this creates a *second* profile with its own uid
// rather than updating the existing one — don't run it again unless you
// mean to replace the configured uid everywhere it's set.
//
// Usage: node scripts/upload-cloudflare-watermark.mjs
import sharp from "sharp";

const ACCENT = "#b5651d";

// Same three-node mark as gen-icons.mjs, deliberately with NO background
// rect at all (unlike the app icon) — a video watermark should read as a
// small logo badge over the footage, not an opaque colored square blotting
// out part of the frame. The accent-colored ring gives it a readable edge
// against any background color the video underneath happens to have.
function markSvg(size) {
  const stroke = Math.max(2, Math.round(size * 0.03));
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="248" fill="${ACCENT}" fill-opacity="0.92"/>
  <g stroke="#ffffff" stroke-width="14" stroke-linecap="round">
    <line x1="256" y1="176" x2="186" y2="300"/>
    <line x1="256" y1="176" x2="326" y2="300"/>
    <line x1="186" y1="300" x2="326" y2="300"/>
  </g>
  <g fill="#ffffff">
    <circle cx="256" cy="176" r="34"/>
    <circle cx="186" cy="300" r="34"/>
    <circle cx="326" cy="300" r="34"/>
  </g>
  <circle cx="256" cy="256" r="${248 - stroke / 2}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="${stroke}"/>
</svg>
`.trim();
}

const accountId = process.env.R2_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
if (!accountId || !apiToken) {
  console.error("Missing R2_ACCOUNT_ID / CLOUDFLARE_STREAM_API_TOKEN in the environment — load .env first.");
  process.exit(1);
}

const png = await sharp(Buffer.from(markSvg(512))).resize(400, 400).png().toBuffer();

const form = new FormData();
form.set("file", new Blob([png], { type: "image/png" }), "yukon3t-watermark.png");
form.set("name", "yukon3t brand mark");
// Small enough not to obscure the video, matching watermark.ts's own
// WATERMARK_SIZE_RATIO reasoning for the image version.
form.set("scale", "0.12");
form.set("position", "lowerRight");
form.set("padding", "0.04");
form.set("opacity", "0.92");

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/watermarks`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiToken}` },
  body: form,
});
const data = await res.json();

if (!res.ok || !data?.success) {
  console.error("Cloudflare API error:", JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log("Created watermark profile:", data.result.uid);
console.log("\nSet this as CLOUDFLARE_STREAM_WATERMARK_UID in .env, Vercel, and Netlify:");
console.log(data.result.uid);
