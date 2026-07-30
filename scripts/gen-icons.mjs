// Generates PWA app icons from a hand-drawn SVG mark (three connected
// nodes, representing cross-border connection) in the brand accent color.
// Run manually with `node scripts/gen-icons.mjs` whenever the mark changes
// — not part of the build, so no sharp dependency at build/runtime.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const ACCENT = "#b5651d";

// Three nodes connected by lines, kept within the inner ~66% safe zone
// (Android maskable-icon convention) so circular/squircle OS masks never
// clip the mark. Same design reused for every size/purpose for simplicity.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${ACCENT}"/>
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
`;

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/mark.svg", svg.trim());

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-512-maskable.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

for (const { file, size } of targets) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .flatten({ background: ACCENT }) // no alpha — iOS renders transparency poorly
    .png()
    .toFile(`public/icons/${file}`);
  console.log("wrote", file);
}
