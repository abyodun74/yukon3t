import { useId } from "react";
import { resolveGiftArt } from "@/lib/gift-assets";

// The art for every digital gift (src/lib/gifts-data.ts `assetKey`), resolved by src/lib/gift-assets.ts to either a
// raster picture served same-origin from public/gifts/art/ (the owner's icon sheet and Legendary diptych) or an
// SVG drawn here (no files, nothing from another server). The SVG drawings are decorative (aria-hidden): the name next
// to them, or the caller's own label, is what a screen reader announces. A raster picture carries the item's localized
// name as its alt text, so callers always pass `name`. Works in server and client components alike.

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
  const common = { width: size, height: size, viewBox: "0 0 64 64", "aria-hidden": true as const, focusable: false as const, className };
  const art = resolveGiftArt(assetKey);

  // Same-origin files, so the CSP's img-src 'self' covers them. Fixed width/height: no layout shift while loading.
  if (art.type === "image") {
    // Drawn whole on its own dark backdrop that fades out at the edges: no card around it.
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static same-origin asset, sized by srcSet; the app renders images with plain <img>
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
        className={`inline-block shrink-0 object-contain ${className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }

  switch (art.key) {
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
    case "birthday-candle-out":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="30" fill="#FFF3D6" />
          <rect x="27" y="26" width="10" height="24" rx="2" fill="#7B5CE6" />
          <path d="M27 31l10-3M27 38l10-3M27 45l10-3" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M32 26v-4M32 20c-3-2 3-4 0-7" stroke="#B9967E" strokeWidth="1.5" strokeLinecap="round" fill="none" />
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
