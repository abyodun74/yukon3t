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
  // Phase A (the five universes, and the free kind words).
  "heartbeat-note",
  "paper-crane",
  "forget-me-not",
  "birthday-candle",
  // Not a catalog item: the Birthday Candle once blown out in the open-gift overlay.
  "birthday-candle-out",
  "cake-slice",
  "grad-cap",
  "gold-star",
  "gg-badge",
  "level-up",
  "trophy-frame",
  "pixel-heart",
  "gold-orchid",
  "midnight-crystal-frame",
  "lantern",
  "shared-table",
  "thank-you",
  "appreciate-you",
  "cheering-you-on",
  "proud-of-you",
  // Phase B: the challenge winner's award badge (a static drawing; see gift-assets.test.ts for its size budget).
  "arena-champion",
  // Not a catalog item: the live room's winner moment (a challenge result), drawn like a gift effect.
  "challenge-winner",
  "sparkle",
] as const;

export type GiftSvgKey = (typeof GIFT_SVG_ASSET_KEYS)[number];

/**
 * An animated gift (Phase A): a Lottie JSON file served same-origin from public/gifts/lottie/, played by
 * src/components/gift-lottie.tsx with lottie-web's light SVG player (no expression engine, no eval, no web worker),
 * loaded lazily only when one of these renders large (the open-gift overlay, a live-room effect). Everywhere else, and
 * whenever "reduce motion" is on, the item's static art is drawn instead: its SVG (same assetKey, the still that
 * matches the animation's poster frame) or, for reduce motion inside the player, the frame at the "poster" marker.
 *
 * Every file must pass gift-assets.test.ts: under GIFT_LOTTIE_MAX_BYTES, no expressions, no image or font assets (shapes
 * only, nothing fetched from anywhere), a "poster" marker inside the animation, a live effect no longer than
 * LIVE_GIFT_EFFECT_MS and never flashing more than 3 times a second, and a `source` and `licence` recorded here.
 * To swap in a commissioned or licensed animation: drop the .json in public/gifts/lottie/ under the same name (or add a
 * new entry), set `source` and `licence` truthfully, add a "poster" marker in the editor (After Effects: a composition
 * marker named "poster"; LottieFiles: a marker), export with "Bodymovin" expressions off and images not embedded, and
 * run `npx vitest run src/lib/gift-assets.test.ts`.
 */
export type GiftLottieAsset = {
  /** Same-origin path of the Lottie JSON. */
  src: string;
  /** Play once and hold the last frame (false), or loop while shown (true). */
  loop: boolean;
  /** Who made it. */
  source: string;
  /** Its licence (or "original work, owned by YuKon3t"). */
  licence: string;
};

/** Largest Lottie file accepted. */
export const GIFT_LOTTIE_MAX_BYTES = 150 * 1024;
/** The marker name of the still shown with reduce motion on (and the frame a poster SVG must match). */
export const GIFT_LOTTIE_POSTER_MARKER = "poster";

/** Lottie animations, by assetKey. Each key is also a GIFT_SVG_ASSET_KEYS entry: its still. */
export const GIFT_LOTTIE_ASSETS: Readonly<Record<string, GiftLottieAsset>> = {
  "gold-orchid": {
    src: "/gifts/lottie/gold-orchid.json",
    loop: false,
    source: "Hand-authored for YuKon3t, 2026-11 (Phase A pipeline proof)",
    licence: "Original work, owned by YuKon3t",
  },
  "level-up": {
    src: "/gifts/lottie/level-up.json",
    loop: false,
    source: "Hand-authored for YuKon3t, 2026-11 (Phase A pipeline proof)",
    licence: "Original work, owned by YuKon3t",
  },
};

/** The animation for `assetKey`, or null when it has none (it is drawn still). */
export function resolveGiftAnimation(assetKey: string): GiftLottieAsset | null {
  return Object.prototype.hasOwnProperty.call(GIFT_LOTTIE_ASSETS, assetKey) ? GIFT_LOTTIE_ASSETS[assetKey] : null;
}

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
