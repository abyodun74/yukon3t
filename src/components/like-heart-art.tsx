import { useId } from "react";

/**
 * A glossy, 3D-looking purple heart as inline SVG (no emoji, no image file, so it looks the same on every phone):
 * a light-to-deep purple radial fill, a darker lower edge for depth, a soft specular highlight and a purple glow.
 * Decorative only; the caller hides it from assistive tech.
 */
export function LikeHeartArt({ size }: { size: number }) {
  const uid = useId().replace(/:/g, "");
  const body = `hb-body-${uid}`;
  const edge = `hb-edge-${uid}`;
  const shine = `hb-shine-${uid}`;
  const path =
    "M16 28.5C16 28.5 1.5 19.6 1.5 9.6 1.5 4.9 5.2 1.8 9.2 1.8c2.8 0 5.2 1.5 6.8 4 1.6-2.5 4-4 6.8-4 4 0 7.7 3.1 7.7 7.8 0 10-14.5 18.9-14.5 18.9z";
  return (
    <svg
      width={size}
      height={size * 0.94}
      viewBox="0 0 32 30"
      aria-hidden="true"
      focusable="false"
      style={{
        display: "block",
        filter: "drop-shadow(0 0 7px rgb(160 80 240 / 0.6)) drop-shadow(0 3px 5px rgb(40 10 80 / 0.35))",
      }}
    >
      <defs>
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
      <path d={path} fill={`url(#${body})`} />
      <path d={path} fill={`url(#${edge})`} />
      <ellipse cx="9.6" cy="8" rx="4.6" ry="2.7" transform="rotate(-32 9.6 8)" fill={`url(#${shine})`} />
      <ellipse cx="22.6" cy="6.4" rx="1.3" ry="0.8" transform="rotate(-25 22.6 6.4)" fill="#fff" opacity="0.5" />
    </svg>
  );
}
