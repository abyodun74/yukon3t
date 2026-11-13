import { useId } from "react";

// The art for every digital gift (src/lib/gifts-data.ts `assetKey`), drawn by the app as plain SVG: no files, no
// uploads, nothing from another server. Decorative: the name next to it (or the caller's own label) is what a screen
// reader announces, so every drawing here is aria-hidden. Works in server and client components alike.

type ArtProps = { assetKey: string; size?: number; className?: string };

/** The picture of one item (or the plain "sparkle" for anything unknown). */
export function GiftArt({ assetKey, size = 48, className }: ArtProps) {
  const uid = useId().replace(/:/g, "");
  const g = (name: string) => `${uid}-${name}`;
  const common = { width: size, height: size, viewBox: "0 0 64 64", "aria-hidden": true as const, focusable: false as const, className };

  switch (assetKey) {
    case "wave":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF4D6" />
          <path
            d="M22 40V24a3 3 0 0 1 6 0v10V18a3 3 0 0 1 6 0v16V20a3 3 0 0 1 6 0v16-8a3 3 0 0 1 6 0v12c0 8-6 14-14 14h-2c-5 0-8-2-11-6l-6-8a3 3 0 0 1 5-4z"
            fill="#F6B73C"
            stroke="#C98612"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M12 18c2-3 5-5 8-6M10 26c1-2 2-3 4-4" stroke="#C98612" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      );
    case "heart-burst":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFE3EA" />
          <path d="M32 48s-14-8-14-18a8 8 0 0 1 14-5 8 8 0 0 1 14 5c0 10-14 18-14 18z" fill="#E8335A" />
          <path d="M14 16s-4-2-4-5a2.5 2.5 0 0 1 4-1.5A2.5 2.5 0 0 1 18 11c0 3-4 5-4 5z" fill="#F07A95" />
          <path d="M50 14s-3-2-3-4a2 2 0 0 1 3-1 2 2 0 0 1 3 1c0 2-3 4-3 4z" fill="#F07A95" />
          <path d="M52 44s-3-2-3-4a2 2 0 0 1 3-1 2 2 0 0 1 3 1c0 2-3 4-3 4z" fill="#F07A95" />
        </svg>
      );
    case "high-five":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#E3F1FF" />
          <path d="M16 44l4-20a3 3 0 0 1 6 1l-1 8 3-14a3 3 0 0 1 6 1l-2 14" fill="#7FB6F2" stroke="#3B7DC9" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M48 44l-4-20a3 3 0 0 0-6 1l1 8-3-14a3 3 0 0 0-6 1l2 14" fill="#9FD0A8" stroke="#3E8E50" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M28 12l4-4 4 4" stroke="#F6B73C" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </svg>
      );
    case "coffee":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#F3E8DF" />
          <path d="M16 28h26v8a12 12 0 0 1-12 12h-2a12 12 0 0 1-12-12z" fill="#8A5A3B" />
          <path d="M42 30h3a5 5 0 0 1 0 10h-4" stroke="#8A5A3B" strokeWidth="3" fill="none" />
          <path d="M24 22c-2-3 2-4 0-8M31 22c-2-3 2-4 0-8" stroke="#B9967E" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      );
    case "rose":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FDE8EC" />
          <path d="M32 34v20" stroke="#3E8E50" strokeWidth="3" strokeLinecap="round" />
          <path d="M32 46c-6 0-9-4-10-7 5 0 8 2 10 7z" fill="#57A86A" />
          <circle cx="32" cy="24" r="11" fill="#D7263D" />
          <path d="M26 24c0-4 3-6 6-6s6 2 6 6c-2-2-4-2-6 0-2-2-4-2-6 0z" fill="#A5162A" />
        </svg>
      );
    case "supporter-star":
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={g("star")} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FFD35C" />
              <stop offset="1" stopColor="#F29E1F" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="30" fill="#2A2350" />
          <path d="M32 12l6 13 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2z" fill={`url(#${g("star")})`} />
        </svg>
      );
    case "kindred-spirit":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#EAE4FF" />
          <circle cx="25" cy="32" r="11" fill="none" stroke="#7B5CE6" strokeWidth="4" />
          <circle cx="39" cy="32" r="11" fill="none" stroke="#E46FB0" strokeWidth="4" />
        </svg>
      );
    case "aurora-frame":
    case "frost-frame":
    case "gold-ring-frame":
      return (
        <svg {...common}>
          <FrameRing assetKey={assetKey} uid={uid} />
          <circle cx="32" cy="32" r="18" fill="#D9DEE8" />
          <circle cx="32" cy="28" r="6" fill="#A5ADBD" />
          <path d="M20 44a12 9 0 0 1 24 0" fill="#A5ADBD" />
        </svg>
      );
    case "confetti":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF6E0" />
          {[
            [14, 18, "#E8335A", 20],
            [26, 12, "#3B7DC9", -15],
            [42, 16, "#3E8E50", 30],
            [50, 28, "#F6B73C", -25],
            [18, 34, "#7B5CE6", 10],
            [34, 30, "#E46FB0", -35],
            [44, 42, "#E8335A", 15],
            [24, 46, "#F6B73C", -10],
          ].map(([x, y, fill, rotate], i) => (
            <rect
              key={i}
              x={x as number}
              y={y as number}
              width="6"
              height="3"
              rx="1"
              fill={fill as string}
              transform={`rotate(${rotate} ${(x as number) + 3} ${(y as number) + 1.5})`}
            />
          ))}
        </svg>
      );
    case "aurora-sweep":
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={g("sweep")} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#34E3B0" />
              <stop offset="0.5" stopColor="#4FA3FF" />
              <stop offset="1" stopColor="#B26BFF" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="30" fill="#0F1A33" />
          <path d="M6 36c10-12 18 4 26-6s16-8 26-2" stroke={`url(#${g("sweep")})`} strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M8 44c10-8 18 2 26-4s14-6 22-1" stroke={`url(#${g("sweep")})`} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF4D6" />
          <path d="M32 12c2 12 8 18 20 20-12 2-18 8-20 20-2-12-8-18-20-20 12-2 18-8 20-20z" fill="#F6B73C" />
        </svg>
      );
  }
}

/** The coloured ring of a frame item, drawn on a 64x64 box around a picture of radius ~20. */
function FrameRing({ assetKey, uid }: { assetKey: string; uid: string }) {
  const id = `${uid}-ring`;
  const stops =
    assetKey === "aurora-frame"
      ? ["#34E3B0", "#4FA3FF", "#B26BFF", "#34E3B0"]
      : assetKey === "frost-frame"
        ? ["#E8F6FF", "#9FD3FF", "#FFFFFF", "#7FC1F2"]
        : ["#FFE39A", "#E1A928", "#FFF1C4", "#B9801A"];
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {stops.map((color, i) => (
            <stop key={i} offset={i / (stops.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="none" stroke={`url(#${id})`} strokeWidth="6" />
      {assetKey === "frost-frame" &&
        [0, 60, 120, 180, 240, 300].map((angle) => (
          <path key={angle} d="M32 3v6M29 6h6" stroke="#FFFFFF" strokeWidth="1.5" transform={`rotate(${angle} 32 32)`} />
        ))}
    </>
  );
}

/**
 * A frame worn on the profile, drawn around the avatar. Sized to the avatar it surrounds (`size` = the avatar's
 * diameter); purely visual and lets taps through to the avatar underneath.
 */
export function GiftFrameOverlay({ assetKey, size }: { assetKey: string; size: number }) {
  const uid = useId().replace(/:/g, "");
  // The ring sits just outside the avatar: the 64-unit box maps the ring's outer edge (r 29) to size/2 + 6px.
  const outer = size + 12;
  return (
    <svg
      width={outer}
      height={outer}
      viewBox="3 3 58 58"
      aria-hidden
      focusable={false}
      // Physical left (not start): centring is the same in both directions.
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <FrameRing assetKey={assetKey} uid={uid} />
    </svg>
  );
}
