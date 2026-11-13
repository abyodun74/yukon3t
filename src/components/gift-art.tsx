import { useId } from "react";
import { resolveGiftArt } from "@/lib/gift-assets";

// The art for every digital gift (src/lib/gifts-data.ts `assetKey`), resolved by src/lib/gift-assets.ts to either an
// SVG drawn here (no files, nothing from another server) or a raster picture served same-origin from public/gifts/.
// The SVG drawings are decorative (aria-hidden): the name next to them, or the caller's own label, is what a screen
// reader announces. A raster picture carries the item's localized name as its alt text, so callers always pass `name`.
// Works in server and client components alike.

type ArtProps = {
  assetKey: string;
  /** The item's name in the reader's language (giftItemName): the alt text of a raster picture. */
  name: string;
  size?: number;
  className?: string;
  /** Load a raster picture straight away instead of lazily (for art that is on screen the moment it mounts). */
  eager?: boolean;
};

/** The picture of one item (or the plain "sparkle" for anything unknown). */
export function GiftArt({ assetKey, name, size = 48, className, eager = false }: ArtProps) {
  const uid = useId().replace(/:/g, "");
  const g = (id: string) => `${uid}-${id}`;
  const common = { width: size, height: size, viewBox: "0 0 64 64", "aria-hidden": true as const, focusable: false as const, className };
  const art = resolveGiftArt(assetKey);

  if (art.type === "image") {
    // An opaque photo: shown as a rounded square card with a hairline edge (the theme's own line colour, so it
    // reads in light and dark mode alike), cropped to fill. Same-origin file, so the CSP's img-src 'self' covers it.
    return (
      <span
        className={`inline-block shrink-0 overflow-hidden rounded-[22%] bg-surface shadow-sm ring-1 ring-line ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static same-origin asset, sized by srcSet; the app renders images with plain <img> */}
        <img
          src={art.thumbSrc}
          srcSet={art.srcSet}
          sizes={`${size}px`}
          width={size}
          height={size}
          alt={name}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          className="block h-full w-full object-cover"
        />
      </span>
    );
  }

  switch (art.key) {
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
    case "trophy-frame":
    case "midnight-crystal-frame":
      return (
        <svg {...common}>
          <FrameRing assetKey={art.key} uid={uid} />
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
    // ---------- Phase A: Love & Emotion (blush and rose, soft lines) ----------
    case "heartbeat-note":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FDECEF" />
          <rect x="12" y="18" width="40" height="28" rx="5" fill="#FFFFFF" stroke="#E7A3B5" strokeWidth="1.5" />
          <path d="M14 33h9l3-7 5 13 4-10 3 4h12" stroke="#D9577A" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "paper-crane":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FDECEF" />
          <path d="M10 38l18-4 4-16 6 16 16-10-10 20H22z" fill="#F7C6D3" stroke="#C9466B" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M28 34l4-16 6 16" fill="#EFA3B8" />
        </svg>
      );
    case "forget-me-not":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FDECEF" />
          {[
            [24, 26],
            [40, 28],
            [32, 42],
          ].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              {[0, 72, 144, 216, 288].map((a) => (
                <circle key={a} cx="0" cy="-5" r="4" fill="#7FA8E8" transform={`rotate(${a})`} />
              ))}
              <circle r="2.4" fill="#F6D365" />
            </g>
          ))}
        </svg>
      );
    // ---------- Celebrate & Inspire (bright confetti palette) ----------
    case "birthday-candle":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF3D6" />
          <rect x="27" y="26" width="10" height="24" rx="2" fill="#7B5CE6" />
          <path d="M27 31l10-3M27 38l10-3M27 45l10-3" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M32 24c-4-4-2-9 0-12 2 3 4 8 0 12z" fill="#F6B73C" />
          <path d="M32 23c-2-2-1-5 0-6 1 1 2 4 0 6z" fill="#E8335A" />
        </svg>
      );
    case "birthday-candle-out":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF3D6" />
          <rect x="27" y="26" width="10" height="24" rx="2" fill="#7B5CE6" />
          <path d="M27 31l10-3M27 38l10-3M27 45l10-3" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M32 26v-4M32 20c-3-2 3-4 0-7" stroke="#B9967E" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      );
    case "cake-slice":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF3D6" />
          <path d="M12 44l36-14v16H12z" fill="#F7D9A8" />
          <path d="M12 44l36-14v5L12 49z" fill="#E46FB0" />
          <path d="M12 44l36-14" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
          <circle cx="40" cy="27" r="3.5" fill="#E8335A" />
        </svg>
      );
    case "grad-cap":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#E3F1FF" />
          <path d="M32 16l22 10-22 10-22-10z" fill="#24324A" />
          <path d="M20 31v8c0 3 6 6 12 6s12-3 12-6v-8l-12 5z" fill="#3B4D6E" />
          <path d="M50 27v12" stroke="#F6B73C" strokeWidth="2" />
          <circle cx="50" cy="41" r="2.5" fill="#F6B73C" />
        </svg>
      );
    case "gold-star":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF3D6" />
          <path d="M32 11l6.5 13.5 14.5 2-10.5 10 2.5 14.5L32 44l-13 7 2.5-14.5L11 26.5l14.5-2z" fill="#F6B73C" stroke="#C98612" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M26 31l4 4 8-8" stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    // ---------- Gaming Arena (neon arcade) ----------
    case "gg-badge":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#14102B" />
          <circle cx="32" cy="32" r="22" fill="none" stroke="#39FF88" strokeWidth="3" />
          <path d="M28 25h-7v14h7v-6h-3M43 25h-7v14h7v-6h-3" stroke="#33D6FF" strokeWidth="3" fill="none" strokeLinecap="square" />
        </svg>
      );
    case "level-up":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#14102B" />
          <path d="M32 12l14 16h-8v12H26V28h-8z" fill="#39FF88" />
          <path d="M20 46h24M24 51h16" stroke="#FF3DCB" strokeWidth="3" strokeLinecap="square" />
        </svg>
      );
    case "pixel-heart":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#14102B" />
          <path
            d="M18 22h8v4h4v4h4v-4h4v-4h8v4h4v10h-4v4h-4v4h-4v4h-4v4h-4v-4h-4v-4h-4v-4h-4v-4h-4V26h4z"
            fill="#FF3DCB"
          />
          <path d="M22 26h4v4h-4z" fill="#FFFFFF" />
        </svg>
      );
    // ---------- Luxury Universe (black and gold) ----------
    case "gold-orchid":
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={g("orchid")} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#F3D27A" />
              <stop offset="1" stopColor="#B8862B" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="30" fill="#121212" />
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx="32" cy="21" rx="6" ry="11" fill={`url(#${g("orchid")})`} transform={`rotate(${a} 32 31)`} />
          ))}
          <circle cx="32" cy="31" r="4" fill="#5A3A0E" />
          <path d="M32 42v14" stroke="#D4A73A" strokeWidth="1.5" />
        </svg>
      );
    // ---------- Culture & Community (warm patterns, neutral) ----------
    case "lantern":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#F6E6D2" />
          <path d="M32 8v6" stroke="#6B4A2B" strokeWidth="2" />
          <rect x="26" y="14" width="12" height="4" rx="1" fill="#6B4A2B" />
          <rect x="20" y="18" width="24" height="26" rx="11" fill="#E8833A" />
          <path d="M26 19c-3 8-3 16 0 24M32 18v26M38 19c3 8 3 16 0 24" stroke="#C4572E" strokeWidth="1.3" fill="none" />
          <rect x="26" y="44" width="12" height="4" rx="1" fill="#6B4A2B" />
          <path d="M32 48v6" stroke="#2F6E73" strokeWidth="2" />
        </svg>
      );
    case "shared-table":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#F6E6D2" />
          <rect x="12" y="20" width="40" height="24" rx="4" fill="#B97A45" />
          <path d="M14 26h36M14 38h36" stroke="#9C6436" strokeWidth="1" />
          {[
            [20, 32],
            [32, 32],
            [44, 32],
          ].map(([x, y]) => (
            <g key={x}>
              <circle cx={x} cy={y} r="5" fill="#FFFFFF" />
              <circle cx={x} cy={y} r="2.5" fill={x === 32 ? "#2F6E73" : "#E8833A"} />
            </g>
          ))}
        </svg>
      );
    // ---------- Free kind words (no text in the art: the name is the words) ----------
    case "thank-you":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FDECEF" />
          <rect x="14" y="20" width="36" height="24" rx="3" fill="#FFFFFF" stroke="#E7A3B5" strokeWidth="1.5" />
          <path d="M14 22l18 13 18-13" stroke="#E7A3B5" strokeWidth="1.5" fill="none" />
          <path d="M32 44s-7-4-7-9a3.5 3.5 0 0 1 7-1 3.5 3.5 0 0 1 7 1c0 5-7 9-7 9z" fill="#D9577A" />
        </svg>
      );
    case "appreciate-you":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF3D6" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M32 8v7" stroke="#F6B73C" strokeWidth="3" strokeLinecap="round" transform={`rotate(${a} 32 32)`} />
          ))}
          <circle cx="32" cy="32" r="13" fill="#F6B73C" />
          <path d="M32 39s-6-3.5-6-7.5a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z" fill="#E8335A" />
        </svg>
      );
    case "cheering-you-on":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#E3F1FF" />
          <path d="M18 34l20-12v24z" fill="#3B7DC9" />
          <rect x="12" y="30" width="8" height="10" rx="2" fill="#24324A" />
          <path d="M44 26c3 2 3 10 0 12M48 22c5 4 5 16 0 20" stroke="#F6B73C" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "proud-of-you":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF3D6" />
          <path d="M24 10l8 14 8-14z" fill="#E8335A" />
          <path d="M28 10l4 7 4-7" fill="#3B7DC9" />
          <circle cx="32" cy="38" r="13" fill="#F6B73C" stroke="#C98612" strokeWidth="2" />
          <circle cx="32" cy="38" r="7" fill="none" stroke="#FFF3D6" strokeWidth="2" />
        </svg>
      );
    case "sparkle":
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
        : assetKey === "trophy-frame"
          ? ["#FFD34D", "#FF3DCB", "#33D6FF", "#FFD34D"]
          : assetKey === "midnight-crystal-frame"
            ? ["#0B0D1A", "#6E7BFF", "#E9ECFF", "#1A1F3D"]
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
      {assetKey === "trophy-frame" && <path d="M28 4h8v4a4 4 0 0 1-8 0z" fill="#FFD34D" />}
      {assetKey === "midnight-crystal-frame" &&
        [45, 135, 225, 315].map((angle) => (
          <path key={angle} d="M32 2l3 4-3 4-3-4z" fill="#E9ECFF" transform={`rotate(${angle} 32 32)`} />
        ))}
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
