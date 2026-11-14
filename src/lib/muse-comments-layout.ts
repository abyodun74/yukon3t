// Where a Muse's video goes while its comments are open (the TikTok/Reels layout): pure geometry for MuseCard's
// media frame (components/muse-feed.tsx) and the comments sheet. The video's own box is never resized: the frame
// around it is moved and scaled (transform) and cut to a rounded card (clip-path), so the <video> element keeps
// playing, is never re-laid out and never re-buffers.

/** Shrink/expand and the sheet's slide: the app's ease-out curve (APP_DEFAULT_TRANSITION's), a little longer. */
export const MUSE_COMMENTS_TRANSITION = { type: "tween" as const, duration: 0.3, ease: [0.22, 1, 0.36, 1] as const };
/** Reduced motion: the same change, with no animation at all. */
export const MUSE_COMMENTS_INSTANT = { type: "tween" as const, duration: 0 };

/** The rounded card's corner radius, on screen. */
export const MUSE_CARD_RADIUS_PX = 20;
/** Space above the card (below the status bar / header), and between the card and the sheet. */
export const MUSE_CARD_GAP_PX = 12;
/** The sheet's share of the screen when nothing else constrains it. */
export const MUSE_SHEET_FRACTION = 0.6;
/** The card is at most this share of the screen's width... */
export const MUSE_CARD_MAX_WIDTH_FRACTION = 0.6;
/** ...and never wider than 3:4 (portrait), so on a wide screen it doesn't become a letterboxed strip. */
export const MUSE_CARD_MAX_ASPECT = 0.75;
/** Below this the screen is too small to make a sensible card; the sheet just covers the video. */
const MIN_CARD_HEIGHT_PX = 80;

export const FULL_FRAME = { y: 0, scale: 1, clipPath: "inset(0px 0px 0px 0px round 0px)" } as const;

export type MuseCommentsFrame = {
  /** Vertical move of the frame (px), applied after the scale, from the frame's centre. */
  y: number;
  /** Uniform scale of the frame, never above 1. */
  scale: number;
  /** The rounded card, in the frame's own (unscaled) pixels, so the motion can interpolate it. */
  clipPath: string;
  /** The card as it appears on screen. */
  card: { top: number; width: number; height: number };
  /** Height of the comments sheet: from just under the card to the bottom of the screen. */
  sheetHeight: number;
};

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * The frame for a screen of `width` x `height` (the Muse card's own box, which fills the screen) with `topInset` px
 * of status bar / header to keep clear above the card.
 */
export function museCommentsFrame({
  width,
  height,
  topInset,
}: {
  width: number;
  height: number;
  topInset: number;
}): MuseCommentsFrame {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const inset = Math.max(0, topInset);
  const top = inset + MUSE_CARD_GAP_PX;
  const sheetHeight = Math.round(h * MUSE_SHEET_FRACTION);
  const cardHeight = h - sheetHeight - MUSE_CARD_GAP_PX - top;
  if (cardHeight < MIN_CARD_HEIGHT_PX) {
    // No room for a card (a very short window, or a huge header): keep the video where it is under a full sheet.
    return { ...FULL_FRAME, card: { top: 0, width: w, height: h }, sheetHeight: Math.max(0, h - inset) };
  }
  const cardWidth = Math.min(w * MUSE_CARD_MAX_WIDTH_FRACTION, cardHeight * MUSE_CARD_MAX_ASPECT);
  // Big enough that the card is covered in both directions; never above 1 (the frame only ever shrinks).
  const scale = Math.min(1, Math.max(cardWidth / w, cardHeight / h));
  const insetX = Math.max(0, (w - cardWidth / scale) / 2);
  const insetY = Math.max(0, (h - cardHeight / scale) / 2);
  const radius = MUSE_CARD_RADIUS_PX / scale;
  // Scaling about the centre keeps the card's centre at h / 2; move it to the card's place.
  const y = top + cardHeight / 2 - h / 2;
  return {
    y: Math.round(y * 100) / 100,
    scale: Math.round(scale * 10000) / 10000,
    clipPath: `inset(${px(insetY)} ${px(insetX)} ${px(insetY)} ${px(insetX)} round ${px(radius)})`,
    card: { top, width: Math.round(cardWidth), height: Math.round(cardHeight) },
    sheetHeight,
  };
}
