import { useId } from "react";

/** The heart path lives in a 32x30 box; this margin around it holds the baked-in glow and shadow. */
const PAD = 5;
const VIEW_W = 32 + PAD * 2;
const VIEW_H = 30 + PAD * 2;

/**
 * A glossy, 3D-looking purple heart as inline SVG (no emoji, no image file, so it looks the same on every phone):
 * a light-to-deep purple radial fill, a darker lower edge for depth, a soft specular highlight, and a purple glow plus
 * a soft shadow drawn as gradients inside the SVG. No CSS or SVG filter anywhere: a filter is costly on
 * low-end Android while the heart moves, and these gradients are painted once. `size` is the heart's own width; the
 * SVG is a little bigger to hold the glow. Decorative only; the caller hides it from assistive tech.
 */
export function LikeHeartArt({ size }: { size: number }) {
  const uid = useId().replace(/:/g, "");
  const body = `hb-body-${uid}`;
  const edge = `hb-edge-${uid}`;
  const shine = `hb-shine-${uid}`;
  const glow = `hb-glow-${uid}`;
  const shadow = `hb-shadow-${uid}`;
  const path =
    "M16 28.5C16 28.5 1.5 19.6 1.5 9.6 1.5 4.9 5.2 1.8 9.2 1.8c2.8 0 5.2 1.5 6.8 4 1.6-2.5 4-4 6.8-4 4 0 7.7 3.1 7.7 7.8 0 10-14.5 18.9-14.5 18.9z";
  const scale = size / 32;
  return (
    <svg
      width={Math.round(VIEW_W * scale)}
      height={Math.round(VIEW_H * scale)}
      viewBox={`${-PAD} ${-PAD} ${VIEW_W} ${VIEW_H}`}
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <defs>
        <radialGradient id={glow} cx="50%" cy="50%" r="50%">
          <stop offset="0.35" stopColor="#a050f0" stopOpacity="0.5" />
          <stop offset="1" stopColor="#a050f0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={shadow} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#280a50" stopOpacity="0.35" />
          <stop offset="1" stopColor="#280a50" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={body} cx="35%" cy="28%" r="85%">
          <stop offset="0" stopColor="#d9a6ff" />
          <stop offset="0.45" stopColor="#9b4de6" />
          <stop offset="1" stopColor="#4a1790" />
        </radialGradient>
        <linearGradient id={edge} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#2a0b5c" stopOpacity="0" />
          <stop offset="1" stopColor="#2a0b5c" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id={shine} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="16" cy="15" rx="21" ry="20" fill={`url(#${glow})`} />
      <ellipse cx="16" cy="31" rx="10" ry="3" fill={`url(#${shadow})`} />
      <path d={path} fill={`url(#${body})`} />
      <path d={path} fill={`url(#${edge})`} />
      <ellipse cx="9.6" cy="8" rx="4.6" ry="2.7" transform="rotate(-32 9.6 8)" fill={`url(#${shine})`} />
      <ellipse cx="22.6" cy="6.4" rx="1.3" ry="0.8" transform="rotate(-25 22.6 6.4)" fill="#fff" opacity="0.5" />
    </svg>
  );
}
