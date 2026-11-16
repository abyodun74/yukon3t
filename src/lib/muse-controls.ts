/**
 * The Muse viewer's video controls that are not buttons: the length / progress bar along the bottom of a Muse card and
 * the heart Like button in its right-hand rail. Pure rules only (no DOM, no React), so they are unit-tested in node;
 * the components that use them are MuseCard and MuseProgressBar in src/components/muse-feed.tsx.
 *
 * Progress bar rules (owner request 2026-11-15):
 * - Only for a video we play ourselves (a native <video>). An embed (YouTube / TikTok / Instagram / ... iframe) has no
 *   readable position, so it never gets a bar.
 * - Hidden while the video plays normally. Shown while the viewer holds a finger on the video (hold = pause while
 *   held), while the video is paused, while the bar itself is being dragged or has keyboard focus, and for
 *   PROGRESS_BAR_LINGER_MS after the last of those ends, so there is time to grab it after letting go.
 * - Never while the card's comments are open (the controls step aside then), and never without a known length.
 * - The bar always fills left to right, also in Arabic: a timeline is not mirrored.
 */
import { usableDuration } from "@/lib/media-file";

/** A press held this long without moving is a hold (pause while held, bar shown), not a tap. */
export const MUSE_HOLD_MS = 300;
/** A press that moves further than this before the hold fires is a scroll or a swipe, not a hold. */
export const MUSE_HOLD_MOVE_TOLERANCE_PX = 10;
/** How long the bar stays after the video resumes (or the hold / drag / focus ends). */
export const PROGRESS_BAR_LINGER_MS = 1500;
/** Arrow keys on the focused bar move this many seconds. */
export const PROGRESS_KEY_STEP_SECONDS = 5;
/** The bar's fade, as a plain opacity tween (no movement, no scale). */
export const PROGRESS_BAR_FADE_MS = 150;

/** The heart a Like adds. Any emoji reaction a person already has counts as their like (src/lib/like-groups.ts). */
export const MUSE_LIKE_EMOJI = "❤️";

// --- Time ----------------------------------------------------------------------------------------------------------

/** "0:07", "1:05", "12:00", "1:02:03": whole seconds, rounded down. Anything unusable reads "0:00". */
export function formatMediaTime(seconds: number | null | undefined): string {
  const total = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * The video's length in seconds, or null when it isn't known: the element's own duration when usable (an iPhone
 * screen recording reports Infinity, and every video NaN before its metadata loads: media-file.ts `usableDuration`),
 * else the length stored with the Muse when it was posted.
 */
export function resolveDuration(elementDuration: number | null | undefined, storedSeconds: number | null | undefined) {
  return usableDuration(elementDuration) ?? usableDuration(storedSeconds);
}

/** A position clamped into [0, duration]; 0 for anything unusable. */
export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || !(duration > 0)) return 0;
  return Math.min(duration, Math.max(0, time));
}

/** How far along the bar is filled, 0..1. */
export function progressFraction(current: number, duration: number | null): number {
  if (duration === null || !(duration > 0)) return 0;
  return clampTime(current, duration) / duration;
}

// --- Seeking -------------------------------------------------------------------------------------------------------

/**
 * Where on the timeline a pointer at `clientX` points, 0..1, clamped. The bar is laid out left to right in every
 * language (it is `dir="ltr"`), so this never flips for RTL.
 */
export function seekFractionFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!(rect.width > 0) || !Number.isFinite(clientX)) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

/** The time a pointer at `clientX` seeks to. */
export function seekTimeFromPointer(clientX: number, rect: { left: number; width: number }, duration: number): number {
  return clampTime(seekFractionFromPointer(clientX, rect) * duration, duration);
}

/**
 * The position a key moves the focused bar to, or null for a key the bar doesn't handle (so it keeps its default).
 * Right / Up forward, Left / Down back (not mirrored in RTL: the bar itself isn't), Home / End to either end.
 */
export function keyboardSeekTime(key: string, current: number, duration: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clampTime(current + PROGRESS_KEY_STEP_SECONDS, duration);
    case "ArrowLeft":
    case "ArrowDown":
      return clampTime(current - PROGRESS_KEY_STEP_SECONDS, duration);
    case "PageUp":
      return clampTime(current + PROGRESS_KEY_STEP_SECONDS * 2, duration);
    case "PageDown":
      return clampTime(current - PROGRESS_KEY_STEP_SECONDS * 2, duration);
    case "Home":
      return 0;
    case "End":
      return duration;
    default:
      return null;
  }
}

/** The slider's spoken value: "0:12 of 0:45" (the "of" wording comes from the dictionary). */
export function progressValueText(template: string, current: number, duration: number): string {
  return template.replace("{current}", formatMediaTime(current)).replace("{total}", formatMediaTime(duration));
}

// --- Visibility ----------------------------------------------------------------------------------------------------

/** What is keeping the bar up right now, plus the short linger after the last of it ends. */
export type ProgressBarState = {
  holding: boolean;
  paused: boolean;
  scrubbing: boolean;
  focused: boolean;
  /** Set when the last reason ended; the card clears it with `linger_done` after PROGRESS_BAR_LINGER_MS. */
  lingering: boolean;
};

export type ProgressBarEvent =
  | { type: "hold_start" }
  | { type: "hold_end" }
  | { type: "pause" }
  | { type: "play" }
  | { type: "scrub_start" }
  | { type: "scrub_end" }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "linger_done" };

export const INITIAL_PROGRESS_BAR_STATE: ProgressBarState = {
  holding: false,
  paused: false,
  scrubbing: false,
  focused: false,
  lingering: false,
};

function wantsBar(s: ProgressBarState) {
  return s.holding || s.paused || s.scrubbing || s.focused;
}

export function progressBarReducer(state: ProgressBarState, event: ProgressBarEvent): ProgressBarState {
  let next: ProgressBarState;
  switch (event.type) {
    case "hold_start":
      next = { ...state, holding: true };
      break;
    case "hold_end":
      next = { ...state, holding: false };
      break;
    case "pause":
      next = { ...state, paused: true };
      break;
    case "play":
      next = { ...state, paused: false };
      break;
    case "scrub_start":
      next = { ...state, scrubbing: true };
      break;
    case "scrub_end":
      next = { ...state, scrubbing: false };
      break;
    case "focus":
      next = { ...state, focused: true };
      break;
    case "blur":
      next = { ...state, focused: false };
      break;
    case "linger_done":
      return state.lingering ? { ...state, lingering: false } : state;
  }
  // Every reason gone: linger a moment. Any reason back: the linger is moot.
  next.lingering = wantsBar(next) ? false : wantsBar(state) || state.lingering;
  const unchanged = (Object.keys(next) as Array<keyof ProgressBarState>).every((k) => next[k] === state[k]);
  return unchanged ? state : next;
}

/** Whether the bar shows: never for an embed, with comments open or without a known length. */
export function progressBarVisible(
  state: ProgressBarState,
  context: { isEmbed: boolean; commentsOpen: boolean; duration: number | null },
): boolean {
  if (context.isEmbed || context.commentsOpen || context.duration === null) return false;
  return wantsBar(state) || state.lingering;
}

/** Whether the video should be playing: the card is on screen, not paused, not held and not being scrubbed. */
export function shouldVideoPlay(input: { isVisible: boolean; paused: boolean; holding: boolean; scrubbing: boolean }) {
  return input.isVisible && !input.paused && !input.holding && !input.scrubbing;
}

// --- Hold gesture --------------------------------------------------------------------------------------------------

/** A press moved too far to still become a hold (it's a scroll / swipe). */
export function holdCancelledByMove(start: { x: number; y: number }, now: { x: number; y: number }): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) > MUSE_HOLD_MOVE_TOLERANCE_PX;
}

// --- Like button ---------------------------------------------------------------------------------------------------

/**
 * The emoji to send to toggleMuseReaction for one tap of the heart: not liked -> the heart (adds a like); liked with
 * any emoji -> that same emoji (the server removes a reaction when it is sent again), so an older non-heart reaction is
 * unliked too, never swapped for a heart.
 */
export function likeToggleEmoji(myReaction: string | null): string {
  return myReaction ?? MUSE_LIKE_EMOJI;
}

/** What a tap shows at once, before the server answers: the opposite state, and the count moved by one. */
export function optimisticLike(current: { myReaction: string | null; likeCount: number }) {
  const liking = current.myReaction === null;
  return {
    myReaction: liking ? MUSE_LIKE_EMOJI : null,
    likeCount: Math.max(0, current.likeCount + (liking ? 1 : -1)),
  };
}

/**
 * The state after the server answered. Success: the server's liked state and count (for a like group it is the
 * group's count, not this Muse's own). Failure: back to exactly what was shown before the tap.
 */
export function settleLike(
  before: { myReaction: string | null; likeCount: number },
  result: { error: string | null; liked?: boolean; likeCount?: number },
) {
  if (result.error !== null || result.liked === undefined || result.likeCount === undefined) return before;
  return {
    // A like kept by the server (it can't change emoji on a tap) keeps whatever emoji the person already had.
    myReaction: result.liked ? (before.myReaction ?? MUSE_LIKE_EMOJI) : null,
    likeCount: result.likeCount,
  };
}
