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

/*
 * A list of text stories posted in one go (the Story composer's Text mode). Each slide becomes its own Story, posted
 * in list order. Pure list operations only; the composer (story-upload-modal.tsx) owns rendering and posting.
 */

/** Most text stories one list can hold. */
export const TEXT_STORY_MAX_SLIDES = 10;

export type TextStorySlide = {
  /** Local-only key, never sent to the server. */
  id: string;
  text: string;
  /** Index into the composer's background palette. */
  bgIndex: number;
};

/** True when a slide has something to post (whitespace alone doesn't count). */
export function isPostableSlide(slide: TextStorySlide): boolean {
  return slide.text.trim().length > 0;
}

/** The slides that will be posted, in list order (empty ones are skipped). */
export function postableSlides(slides: readonly TextStorySlide[]): TextStorySlide[] {
  return slides.filter(isPostableSlide);
}

/** The background a new slide starts on: the one after the last slide's, wrapping round. */
export function nextBackgroundIndex(slides: readonly TextStorySlide[], paletteSize: number): number {
  if (paletteSize <= 0) return 0;
  const last = slides[slides.length - 1];
  return last ? (last.bgIndex + 1) % paletteSize : 0;
}

export type AddSlideCheck = "ok" | "empty" | "full";

/**
 * Whether "Add another" may open a new slide: the slide being edited must have text (no stacking empty slides) and
 * the list must have room.
 */
export function canAddSlide(
  slides: readonly TextStorySlide[],
  activeId: string,
  max: number = TEXT_STORY_MAX_SLIDES,
): AddSlideCheck {
  const active = slides.find((s) => s.id === activeId);
  if (!active || !isPostableSlide(active)) return "empty";
  if (slides.length >= max) return "full";
  return "ok";
}

/** Appends `slide` (unless the list is full) and returns the new list; the caller makes it the active one. */
export function addSlide(
  slides: readonly TextStorySlide[],
  slide: TextStorySlide,
  max: number = TEXT_STORY_MAX_SLIDES,
): TextStorySlide[] {
  if (slides.length >= max) return [...slides];
  return [...slides, slide];
}

/** Applies `patch` to the slide with `id`. */
export function updateSlide(
  slides: readonly TextStorySlide[],
  id: string,
  patch: Partial<Omit<TextStorySlide, "id">>,
): TextStorySlide[] {
  return slides.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/**
 * Removes the slide with `id`. The list never becomes empty: removing the last one leaves `makeEmpty()`. When the
 * removed slide was the active one, the slide that took its place (or the one before it, at the end) becomes active.
 */
export function removeSlide(
  slides: readonly TextStorySlide[],
  id: string,
  activeId: string,
  makeEmpty: () => TextStorySlide,
): { slides: TextStorySlide[]; activeId: string } {
  const index = slides.findIndex((s) => s.id === id);
  if (index === -1) return { slides: [...slides], activeId };
  const rest = slides.filter((s) => s.id !== id);
  if (rest.length === 0) {
    const fresh = makeEmpty();
    return { slides: [fresh], activeId: fresh.id };
  }
  if (id !== activeId && rest.some((s) => s.id === activeId)) return { slides: rest, activeId };
  return { slides: rest, activeId: rest[Math.min(index, rest.length - 1)].id };
}

/**
 * The list after a posting run: every slide that was posted is gone (so a retry can never post it twice), the rest
 * keep their order. The first slide that failed (or, failing that, the first one left) becomes active. Never empty.
 */
export function slidesAfterPosting(
  slides: readonly TextStorySlide[],
  postedIds: ReadonlySet<string>,
  failedId: string | null,
  makeEmpty: () => TextStorySlide,
): { slides: TextStorySlide[]; activeId: string } {
  const rest = slides.filter((s) => !postedIds.has(s.id));
  if (rest.length === 0) {
    const fresh = makeEmpty();
    return { slides: [fresh], activeId: fresh.id };
  }
  const active = (failedId && rest.find((s) => s.id === failedId)) || rest[0];
  return { slides: rest, activeId: active.id };
}
