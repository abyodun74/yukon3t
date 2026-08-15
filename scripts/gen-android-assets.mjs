// Generates the Android launcher icon (legacy + adaptive), splash screens,
// and notification icon from the same hand-drawn mark used for the PWA/iOS
// icons (see gen-icons.mjs / gen-ios-assets.mjs) — kept as a separate script
// since it writes into android/app/src/main/res/ (native-project-only,
// irrelevant to the web build) rather than public/. Run manually with
// `node scripts/gen-android-assets.mjs` whenever the mark or brand colors
// change, then `npx cap sync android` is NOT needed for these (cap sync
// never touches res/, only assets/public/ and the plugin/config files).
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const ACCENT = "#b5651d";
// Matches manifest.ts's background_color / AppSplash's dark theme, and
// gen-ios-assets.mjs's DARK_BG — same "always dark, never a white flash"
// choice made for the PWA and iOS launch screens.
const DARK_BG = "#14181a";

const RES = "android/app/src/main/res";

// Same three-connected-nodes mark as gen-icons.mjs/gen-ios-assets.mjs.
function markSvg({ canvas, background, stroke = "#ffffff", fill = "#ffffff" }) {
  const scale = canvas / 512;
  const s = (n) => n * scale;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
  ${background ? `<rect width="${canvas}" height="${canvas}" fill="${background}"/>` : ""}
  <g stroke="${stroke}" stroke-width="${s(14)}" stroke-linecap="round">
    <line x1="${s(256)}" y1="${s(176)}" x2="${s(186)}" y2="${s(300)}"/>
    <line x1="${s(256)}" y1="${s(176)}" x2="${s(326)}" y2="${s(300)}"/>
    <line x1="${s(186)}" y1="${s(300)}" x2="${s(326)}" y2="${s(300)}"/>
  </g>
  <g fill="${fill}">
    <circle cx="${s(256)}" cy="${s(176)}" r="${s(34)}"/>
    <circle cx="${s(186)}" cy="${s(300)}" r="${s(34)}"/>
    <circle cx="${s(326)}" cy="${s(300)}" r="${s(34)}"/>
  </g>
</svg>
`.trim();
}

// --- Legacy launcher icon (ic_launcher / ic_launcher_round): full-bleed,
// opaque, brand-accent background — matches the iOS App Store icon look for
// cross-platform brand recognition. Pre-Android-8 launchers use this
// directly; newer launchers fall back to it too if adaptive icon parsing
// fails, so it should look correct standalone, not just as a background
// layer. ---
const LEGACY_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(LEGACY_SIZES)) {
  const icon = await sharp(Buffer.from(markSvg({ canvas: size, background: ACCENT })))
    .flatten({ background: ACCENT })
    .png()
    .toBuffer();
  for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
    writeFileSync(`${RES}/mipmap-${density}/${name}`, icon);
  }
  console.log(`wrote mipmap-${density}/ic_launcher{,_round}.png (${size}x${size})`);
}

// --- Adaptive icon foreground layer (Android 8+): transparent background,
// mark scaled to fit the ~66dp safe zone inside the 108dp canvas so the
// launcher's circle/squircle/rounded-square mask never clips it. The solid
// background color layer is set separately in
// res/values/ic_launcher_background.xml (updated below) to the same
// ACCENT used in the legacy icon and iOS App Store icon. ---
const FOREGROUND_SIZES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const SAFE_ZONE_RATIO = 0.62; // mark diameter as a fraction of the 108dp canvas
for (const [density, canvas] of Object.entries(FOREGROUND_SIZES)) {
  const markCanvas = Math.round(canvas * SAFE_ZONE_RATIO);
  const inset = Math.round((canvas - markCanvas) / 2);
  const mark = await sharp(Buffer.from(markSvg({ canvas: markCanvas, background: null })))
    .png()
    .toBuffer();
  const foreground = await sharp({
    create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mark, left: inset, top: inset }])
    .png()
    .toBuffer();
  writeFileSync(`${RES}/mipmap-${density}/ic_launcher_foreground.png`, foreground);
  console.log(`wrote mipmap-${density}/ic_launcher_foreground.png (${canvas}x${canvas})`);
}

writeFileSync(
  `${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${ACCENT}</color>
</resources>
`,
);
console.log("wrote values/ic_launcher_background.xml");

// --- Splash screens: dark background, mark drawn small and centered so
// Android's default centerCrop-equivalent fill on the splash theme never
// crops it, at each density/orientation Capacitor's template ships. ---
const SPLASH_SIZES = {
  "drawable": [480, 320],
  "drawable-land-mdpi": [480, 320],
  "drawable-land-hdpi": [800, 480],
  "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960],
  "drawable-land-xxxhdpi": [1920, 1280],
  "drawable-port-mdpi": [320, 480],
  "drawable-port-hdpi": [480, 800],
  "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600],
  "drawable-port-xxxhdpi": [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(SPLASH_SIZES)) {
  const markSize = Math.round(Math.min(w, h) * 0.3);
  const left = Math.round((w - markSize) / 2);
  const top = Math.round((h - markSize) / 2);
  const mark = await sharp(Buffer.from(markSvg({ canvas: markSize, background: null })))
    .png()
    .toBuffer();
  const splash = await sharp({
    create: { width: w, height: h, channels: 4, background: DARK_BG },
  })
    .composite([{ input: mark, left, top }])
    .flatten({ background: DARK_BG })
    .removeAlpha()
    .png()
    .toBuffer();
  writeFileSync(`${RES}/${dir}/splash.png`, splash);
  console.log(`wrote ${dir}/splash.png (${w}x${h})`);
}

// --- Push notification icon: Android requires a flat white-on-transparent
// silhouette (see @capacitor-firebase/messaging's README) — the full-color
// app icon would otherwise render as a plain white square/circle in the
// status bar. Referenced from AndroidManifest.xml's
// com.google.firebase.messaging.default_notification_icon meta-data. Single
// drawable/ entry (no per-density variants) — Android scales a
// default-bucket drawable acceptably for a flat vector-style mark like
// this one. ---
const notificationIcon = await sharp(Buffer.from(markSvg({ canvas: 96, background: null })))
  .png()
  .toBuffer();
writeFileSync(`${RES}/drawable/ic_stat_notify.png`, notificationIcon);
console.log("wrote drawable/ic_stat_notify.png (96x96)");
