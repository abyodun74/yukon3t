/** Longest text story a person can write (it is rasterized onto the image; any overflow rides along as the caption). */
export const TEXT_STORY_MAX_CHARS = 2000;
/** Text stories longer than this show only an excerpt on the image (so the font stays large) and carry the full text as the caption. */
export const TEXT_STORY_IMAGE_MAX_CHARS = 280;
/** Collapsed story captions longer than this get a "Show more" toggle. */
export const STORY_CAPTION_COLLAPSED_CHARS = 140;

/**
 * The part of `text` that goes on the story image. Text up to `max` characters is returned unchanged; longer text is cut
 * at the last word boundary within `max` and gets an ellipsis (a single unbroken run longer than `max` is cut at `max`).
 * Counts code points, so an emoji is never split.
 */
export function textStoryExcerpt(text: string, max: number = TEXT_STORY_IMAGE_MAX_CHARS): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max);
  // Cut at the last whitespace in the second half of the window if there is one; otherwise hard-cut.
  let cut = -1;
  for (let i = head.length - 1; i >= Math.floor(max / 2); i--) {
    if (/\s/.test(head[i])) {
      cut = i;
      break;
    }
  }
  const kept = (cut > 0 ? head.slice(0, cut) : head).join("").trimEnd();
  return `${kept}…`;
}

/** True when the full text does not fit on the image and must also be sent as the caption. */
export function textStoryNeedsCaption(text: string, max: number = TEXT_STORY_IMAGE_MAX_CHARS): boolean {
  return Array.from(text).length > max;
}
