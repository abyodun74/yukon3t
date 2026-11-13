// How a gift item's `assetKey` (src/lib/gifts-data.ts, GiftItem.assetKey) becomes a picture. Pure and client-safe;
// src/components/gift-art.tsx renders whatever this resolves to, everywhere a gift is shown (picker, open overlay,
// chat card, profile Gifts area, live room).
//
// Two kinds of art:
// - "svg": drawn by the app in gift-art.tsx, keyed by the assetKey itself (every Phase 1 gift).
// - "image": a raster picture served same-origin from public/gifts/ (made web-ready ahead of time: a large WebP of
//   about 768px and a ~256px thumbnail, both square). The browser picks the file from `srcSet` by the size it is drawn
//   at and the screen's pixel density. These pictures are opaque photos, so they are shown in a rounded square card.
//
// An assetKey in neither list (a key a newer catalog row has but this build doesn't know) resolves to the plain
// "sparkle" SVG, never a broken image.

export type GiftImageAsset = {
  /** The large picture (about 768px square). */
  src: string;
  /** The thumbnail (about 256px square). */
  thumbSrc: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
};

/** Raster gift art, by assetKey. Files live in public/gifts/. */
export const GIFT_IMAGE_ASSETS: Readonly<Record<string, GiftImageAsset>> = {
  "luxury-red-rose": {
    src: "/gifts/luxury-red-rose.webp",
    thumbSrc: "/gifts/luxury-red-rose-256.webp",
    width: 768,
    height: 768,
    thumbWidth: 256,
    thumbHeight: 256,
  },
};

/** The assetKeys gift-art.tsx draws as SVG. */
export const GIFT_SVG_ASSET_KEYS = [
  "wave",
  "heart-burst",
  "high-five",
  "coffee",
  "rose",
  "supporter-star",
  "kindred-spirit",
  "aurora-frame",
  "frost-frame",
  "gold-ring-frame",
  "confetti",
  "aurora-sweep",
  "sparkle",
] as const;

export type GiftSvgKey = (typeof GIFT_SVG_ASSET_KEYS)[number];

export type ResolvedGiftArt =
  | { type: "svg"; key: GiftSvgKey }
  | ({ type: "image"; srcSet: string } & GiftImageAsset);

const SVG_KEYS: ReadonlySet<string> = new Set(GIFT_SVG_ASSET_KEYS);

/** What to draw for `assetKey`: one of the app's SVGs, a raster picture, or the plain sparkle for anything unknown. */
export function resolveGiftArt(assetKey: string): ResolvedGiftArt {
  const image = Object.prototype.hasOwnProperty.call(GIFT_IMAGE_ASSETS, assetKey) ? GIFT_IMAGE_ASSETS[assetKey] : undefined;
  if (image) {
    return { type: "image", ...image, srcSet: `${image.thumbSrc} ${image.thumbWidth}w, ${image.src} ${image.width}w` };
  }
  if (SVG_KEYS.has(assetKey)) return { type: "svg", key: assetKey as GiftSvgKey };
  return { type: "svg", key: "sparkle" };
}
