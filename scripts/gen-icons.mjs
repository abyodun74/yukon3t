// Generates PWA app icons from a hand-drawn SVG mark (three connected
// nodes, representing cross-border connection) in the brand accent color.
// Run manually with `node scripts/gen-icons.mjs` whenever the mark changes
// — not part of the build, so no sharp dependency at build/runtime.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const ACCENT = "#b5651d";
// ~22% of the canvas, matching the corner radius modern app-icon conventions
// (iOS's continuous "squircle", Android's rounded-square adaptive mask) use
// for a 512px canvas — gives the mark's own background rounded edges rather
// than a hard square.
const CORNER_RADIUS = 112;

// Three nodes connected by lines, kept within the inner ~66% safe zone
// (Android maskable-icon convention) so circular/squircle OS masks never
// clip the mark. Same design reused for every size/purpose for simplicity.
// `rounded` controls only the background shape: maskable and apple-touch
// variants stay a full-bleed square (the OS applies its own mask shape to
// maskable icons, and iOS always re-masks apple-touch-icon into its own
// squircle regardless of what's supplied — pre-rounding either would be
// redundant at best, clipped wrong at worst), while the plain "any"-purpose
// icons (shown as-is: browser tab favicon, non-adaptive launchers) get the
// rounding baked in directly since nothing else will round them.
function mark({ rounded }) {
  const rect = rounded
    ? `<rect width="512" height="512" rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}" fill="${ACCENT}"/>`
    : `<rect width="512" height="512" fill="${ACCENT}"/>`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${rect}
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
</svg>
`.trim();
}

mkdirSync("public/icons", { recursive: true });
// Kept as the rounded variant — this file is the standalone brand-mark
// reference, not consumed by the OS's own masking, so it should reflect
// the shape the mark is actually meant to read as.
writeFileSync("public/icons/mark.svg", mark({ rounded: true }));

const targets = [
  { file: "icon-192.png", size: 192, rounded: true },
  { file: "icon-512.png", size: 512, rounded: true },
  { file: "icon-512-maskable.png", size: 512, rounded: false },
  { file: "apple-touch-icon.png", size: 180, rounded: false },
];

for (const { file, size, rounded } of targets) {
  let image = sharp(Buffer.from(mark({ rounded }))).resize(size, size);
  // Only the full-square variants get flattened onto a solid backdrop (no
  // alpha — iOS renders transparency poorly there, and the maskable icon's
  // OS-applied mask needs an opaque full-bleed square to clip). The rounded
  // variants need to keep their alpha channel — flattening onto ACCENT
  // would fill the rounded-off corners with that same color, making the
  // rounding invisible — so Android/browsers show the actual rounded shape
  // with true transparency outside it.
  if (!rounded) {
    image = image.flatten({ background: ACCENT });
  }
  await image.png().toFile(`public/icons/${file}`);
  console.log("wrote", file);
}
