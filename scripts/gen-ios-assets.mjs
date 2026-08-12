// Generates the iOS App Store icon and native launch-screen image from the
// same hand-drawn mark used for the PWA icons (see gen-icons.mjs) — kept as
// a separate script since it writes into ios/App/App/Assets.xcassets
// (native-project-only, irrelevant to the web build) rather than public/.
// Run manually with `node scripts/gen-ios-assets.mjs` whenever the mark or
// brand colors change.
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const ACCENT = "#b5651d";
// Matches manifest.ts's background_color / AppSplash's dark theme — the
// launch screen is a single static image (no animation, no dark-mode
// awareness possible), so it uses the same "always dark, never a white
// flash" choice already made for the PWA launch background.
const DARK_BG = "#14181a";

// Same three-connected-nodes mark as gen-icons.mjs, full-bleed opaque
// square — Apple's App Store Connect rejects icon uploads that have an
// alpha channel or aren't a plain square, and iOS re-masks the icon into
// its own squircle at display time regardless of what's supplied, so
// there's no reason (and no way) to pre-round this one.
function markSvg({ canvas, background }) {
  const scale = canvas / 512;
  const s = (n) => n * scale;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
  <rect width="${canvas}" height="${canvas}" fill="${background}"/>
  <g stroke="#ffffff" stroke-width="${s(14)}" stroke-linecap="round">
    <line x1="${s(256)}" y1="${s(176)}" x2="${s(186)}" y2="${s(300)}"/>
    <line x1="${s(256)}" y1="${s(176)}" x2="${s(326)}" y2="${s(300)}"/>
    <line x1="${s(186)}" y1="${s(300)}" x2="${s(326)}" y2="${s(300)}"/>
  </g>
  <g fill="#ffffff">
    <circle cx="${s(256)}" cy="${s(176)}" r="${s(34)}"/>
    <circle cx="${s(186)}" cy="${s(300)}" r="${s(34)}"/>
    <circle cx="${s(326)}" cy="${s(300)}" r="${s(34)}"/>
  </g>
</svg>
`.trim();
}

// --- App Store icon: 1024x1024, opaque, brand-accent background (matches
// the Android/PWA icon look for cross-platform brand recognition) ---
await sharp(Buffer.from(markSvg({ canvas: 1024, background: ACCENT })))
  .flatten({ background: ACCENT })
  .png()
  .toFile("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
console.log("wrote AppIcon-512@2x.png");

// --- Launch screen: 2732x2732 (Capacitor/Xcode's default single splash
// asset, scaled/cropped to fill any device screen — see LaunchScreen
// .storyboard's contentMode="scaleAspectFill"). The mark is drawn small and
// centered so aspect-fill cropping on any device shape never touches it. ---
const SPLASH_CANVAS = 2732;
const MARK_SIZE = 820; // ~30% of canvas, well inside safe zone
const inset = (SPLASH_CANVAS - MARK_SIZE) / 2;
const splashSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SPLASH_CANVAS}" height="${SPLASH_CANVAS}" viewBox="0 0 ${SPLASH_CANVAS} ${SPLASH_CANVAS}">
  <rect width="${SPLASH_CANVAS}" height="${SPLASH_CANVAS}" fill="${DARK_BG}"/>
</svg>
`.trim();

const markBuffer = await sharp(Buffer.from(markSvg({ canvas: MARK_SIZE, background: "transparent" })))
  .png()
  .toBuffer();

const splashImage = await sharp(Buffer.from(splashSvg))
  .composite([{ input: markBuffer, left: Math.round(inset), top: Math.round(inset) }])
  // The base rect already fully covers the canvas, but sharp promotes the
  // output to RGBA when compositing an alpha-channel image (the mark) on
  // top. flatten() alone computes fully-opaque pixels but doesn't drop the
  // channel itself in this sharp version — removeAlpha() forces the PNG
  // back down to plain opaque RGB.
  .flatten({ background: DARK_BG })
  .removeAlpha()
  .png()
  .toBuffer();

for (const file of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  writeFileSync(`ios/App/App/Assets.xcassets/Splash.imageset/${file}`, splashImage);
  console.log("wrote", file);
}
