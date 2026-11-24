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
    case "arena-champion":
    case "challenge-winner":
      // Phase B: the challenge winner's award (and the live room's winner moment). A still picture: no animation,
      // nothing that flashes.
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#14102B" />
          <circle cx="32" cy="32" r="25" fill="none" stroke="#39FF88" strokeWidth="2" strokeDasharray="3 3" />
          <path d="M22 17h20v9a10 10 0 0 1-20 0z" fill="#FFD34D" stroke="#C98612" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M22 20h-5a5 5 0 0 0 5 7M42 20h5a5 5 0 0 1-5 7" fill="none" stroke="#FFD34D" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M29 36h6v6h-6z" fill="#C98612" />
          <path d="M23 46h18v-3a2 2 0 0 0-2-2H25a2 2 0 0 0-2 2z" fill="#33D6FF" />
          <path d="M32 20l1.8 3.6 4 .6-2.9 2.8.7 4L32 29.1 28.4 31l.7-4-2.9-2.8 4-.6z" fill="#FFFFFF" />
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
    // Gift marketplace (2026-11): hand-authored placeholders in the same flat style; commissioned art is pending.
    case "birthday-balloons":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFEFF4" />
          <path d="M22 34c0 6-2 12 6 20M34 30c0 8 2 14-4 24M44 34c0 6 0 12-12 20" stroke="#8A7F86" strokeWidth="1.2" fill="none" />
          <ellipse cx="22" cy="24" rx="8" ry="10" fill="#E8335A" />
          <ellipse cx="34" cy="20" rx="8" ry="10" fill="#F6B73C" />
          <ellipse cx="44" cy="26" rx="8" ry="10" fill="#3B7DC9" />
          <path d="M19 19c1-2 3-3 4-3M31 15c1-2 3-3 4-3M41 21c1-2 3-3 4-3" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity=".7" />
          <path d="M21 34l1-2 1 2zM33 30l1-2 1 2zM43 36l1-2 1 2z" fill="#5A4A52" />
        </svg>
      );
    case "teddy-bear":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF1E3" />
          <circle cx="21" cy="18" r="6" fill="#A86B3C" />
          <circle cx="43" cy="18" r="6" fill="#A86B3C" />
          <circle cx="21" cy="18" r="3" fill="#E8B48A" />
          <circle cx="43" cy="18" r="3" fill="#E8B48A" />
          <ellipse cx="32" cy="44" rx="13" ry="12" fill="#A86B3C" />
          <circle cx="32" cy="27" r="12" fill="#B97A47" />
          <ellipse cx="32" cy="31" rx="5.5" ry="4.5" fill="#E8B48A" />
          <circle cx="27.5" cy="25" r="1.6" fill="#3A2416" />
          <circle cx="36.5" cy="25" r="1.6" fill="#3A2416" />
          <path d="M30.5 29.5h3l-1.5 1.8z" fill="#3A2416" />
          <path d="M28 44c0-3 2-5 4-3 2-2 4 0 4 3 0 3-4 5-4 5s-4-2-4-5z" fill="#E8335A" />
        </svg>
      );
    case "playful-kitten":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#EEF3FF" />
          <path d="M18 22l4-10 6 7M46 22l-4-10-6 7" fill="#F2A65A" />
          <ellipse cx="32" cy="30" rx="14" ry="12" fill="#F2A65A" />
          <ellipse cx="32" cy="48" rx="11" ry="8" fill="#F2A65A" />
          <circle cx="27" cy="28" r="2" fill="#2E2A3A" />
          <circle cx="37" cy="28" r="2" fill="#2E2A3A" />
          <path d="M31 32h2l-1 1.5zM32 33.5c-1 2-3 2-4 1M32 33.5c1 2 3 2 4 1" stroke="#2E2A3A" strokeWidth="1" fill="#2E2A3A" />
          <path d="M20 31h-6M20 34h-6M44 31h6M44 34h6" stroke="#B9753A" strokeWidth="1" />
          <circle cx="49" cy="49" r="6" fill="#B26BFF" />
          <path d="M44 47c3 1 7 1 10-1M45 51c3 1 6 1 9-1" stroke="#FFFFFF" strokeWidth="1" fill="none" opacity=".7" />
        </svg>
      );
    case "houseplant":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#EAF6EC" />
          <path d="M32 40V22" stroke="#3E8E50" strokeWidth="2" />
          <path d="M32 30c-8-1-12-6-12-12 7 0 12 5 12 12zM32 26c6-1 10-6 10-11-6 0-10 4-10 11zM32 36c7 0 11-4 12-9-7 0-11 3-12 9z" fill="#57A86A" />
          <path d="M22 40h20l-3 14H25z" fill="#C9744A" />
          <rect x="20" y="38" width="24" height="5" rx="2" fill="#A85A34" />
        </svg>
      );
    case "sunset-postcard":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF4E6" />
          <rect x="12" y="18" width="40" height="28" rx="3" fill="#FFFFFF" stroke="#E1C9A8" strokeWidth="1.5" />
          <rect x="15" y="21" width="22" height="22" rx="1.5" fill="#FF9F5A" />
          <rect x="15" y="34" width="22" height="9" fill="#3B6FB6" />
          <circle cx="26" cy="34" r="6" fill="#FFD35C" />
          <path d="M15 34h22" stroke="#FFE7B0" strokeWidth="1" />
          <path d="M40 26h9M40 30h9M40 34h7" stroke="#C9B7A0" strokeWidth="1.5" strokeLinecap="round" />
          <rect x="43" y="38" width="6" height="5" fill="#E8335A" />
        </svg>
      );
    case "fireworks":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#1E1F3A" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <path key={angle} d="M26 24v-9" stroke="#FFD35C" strokeWidth="2" strokeLinecap="round" transform={`rotate(${angle} 26 24)`} />
          ))}
          {[22, 82, 142, 202, 262, 322].map((angle) => (
            <path key={angle} d="M43 38v-7" stroke="#FF5C8A" strokeWidth="2" strokeLinecap="round" transform={`rotate(${angle} 43 38)`} />
          ))}
          <circle cx="26" cy="24" r="2.5" fill="#FFF1C4" />
          <circle cx="43" cy="38" r="2" fill="#FFD1DE" />
          <circle cx="18" cy="46" r="1.5" fill="#7FD3FF" />
          <circle cx="48" cy="16" r="1.5" fill="#7FD3FF" />
        </svg>
      );
    case "shooting-star":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#24204A" />
          <path d="M10 50l22-18" stroke="#B26BFF" strokeWidth="5" strokeLinecap="round" opacity=".45" />
          <path d="M14 48l18-15" stroke="#FFE39A" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M40 14l3.5 7.5 8 1-6 5.5 1.5 8-7-4-7 4 1.5-8-6-5.5 8-1z" fill="#FFD35C" />
          <circle cx="16" cy="18" r="1.2" fill="#FFFFFF" />
          <circle cx="50" cy="44" r="1.2" fill="#FFFFFF" />
          <circle cx="24" cy="12" r="0.9" fill="#FFFFFF" />
        </svg>
      );
    case "keepsake-locket":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#141414" />
          <path d="M18 10c2 10 8 15 14 17 6-2 12-7 14-17" stroke="#E1A928" strokeWidth="1.5" fill="none" strokeDasharray="2 2" />
          <circle cx="32" cy="27" r="3" fill="none" stroke="#E1A928" strokeWidth="2" />
          <path d="M32 54s-15-8-15-19a8.5 8.5 0 0 1 15-5.5A8.5 8.5 0 0 1 47 35c0 11-15 19-15 19z" fill="#D9A62E" stroke="#FFF1C4" strokeWidth="1.5" />
          <path d="M32 49s-10-6-10-13a5 5 0 0 1 10-3 5 5 0 0 1 10 3c0 7-10 13-10 13z" fill="none" stroke="#8A6212" strokeWidth="1.2" />
          <path d="M25 33c1-2 3-3 5-3" stroke="#FFF1C4" strokeWidth="1.2" strokeLinecap="round" fill="none" />
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
