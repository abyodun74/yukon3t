// Pure rules for leaving the Story viewer by dragging it down (src/components/story-viewer.tsx). Kept free of React and
// the DOM so the decisions are unit-tested (story-dismiss-gesture.test.ts).
//
// One gesture on the story's media can mean four things: a tap (next/previous story), a hold (pause), a sideways swipe
// (next/previous person) or a drag down (close). Nothing is decided until the finger has moved DIRECTION_LOCK_PX; then
// the dominant axis wins for the rest of that touch, so a slightly diagonal sideways swipe never starts closing the
// viewer and a drag down never also changes person.

/** Movement (px) before the gesture commits to an axis. Below it, a release is still a tap or a hold. */
export const DIRECTION_LOCK_PX = 10;
/** A drag down past this distance (px) closes the viewer on release. Same value as Sheet's DISMISS_DISTANCE_PX. */
export const STORY_DISMISS_DISTANCE_PX = 120;
/** A downward flick faster than this (px/s) closes the viewer whatever the distance. Same as Sheet's DISMISS_VELOCITY. */
export const STORY_DISMISS_VELOCITY_PX_PER_S = 800;
/** The fade reaches its floor (STORY_DISMISS_MIN_OPACITY) at this drag distance (px). */
export const STORY_DISMISS_FADE_DISTANCE_PX = 400;
export const STORY_DISMISS_MIN_OPACITY = 0.35;
/** The viewer shrinks a little as it is dragged, never grows: scale stays within [1 - this, 1]. */
export const STORY_DISMISS_MAX_SHRINK = 0.08;
/** Close / snap-back tween: the app's default ease-out (src/lib/motion-defaults.ts), no overshoot. */
export const STORY_DISMISS_DURATION_MS = 200;
export const STORY_DISMISS_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export type GestureAxis = "vertical" | "horizontal";

/** The axis a gesture locks to once it has moved far enough, or null while it is still inside the dead zone. */
export function lockGestureAxis(dx: number, dy: number, threshold = DIRECTION_LOCK_PX): GestureAxis | null {
  if (Math.hypot(dx, dy) < threshold) return null;
  return Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
}

/**
 * Whether a drag that starts here may become a drag-to-close. Never from a control (the reply field, a button, a link)
 * and never while a panel or sheet is open over the story (comments, "Seen by", the delete confirmation, Share, the
 * emoji picker): there the drag belongs to that layer, and it closes first.
 */
export function canStartStoryDismiss({ onControl, layerOpen }: { onControl: boolean; layerOpen: boolean }): boolean {
  return !onControl && !layerOpen;
}

/**
 * Elements a press on which is never the start of a drag-to-close. The tap zones are buttons too, so they carry
 * `data-story-zone` and are let through.
 */
export const STORY_GESTURE_CONTROL_SELECTOR =
  'input, textarea, select, a, [contenteditable="true"], button:not([data-story-zone]), [role="button"], [role="dialog"]:not([data-story-viewer])';

/** `closest`-only view of an element, so the check runs in tests without a DOM. */
export function startsOnControl(target: { closest(selector: string): unknown } | null): boolean {
  if (!target) return false;
  return Boolean(target.closest(STORY_GESTURE_CONTROL_SELECTOR));
}

/** How far the viewer moves for a finger offset: down only (an upward pull leaves it in place). */
export function dismissOffset(dy: number): number {
  return Math.max(0, dy);
}

/** The viewer's look while being dragged `offset` px down: it follows the finger, fades and shrinks slightly. */
export function dismissVisual(offset: number): { translateY: number; opacity: number; scale: number } {
  const y = Math.max(0, offset);
  const progress = Math.min(1, y / STORY_DISMISS_FADE_DISTANCE_PX);
  return {
    translateY: y,
    opacity: 1 - progress * (1 - STORY_DISMISS_MIN_OPACITY),
    scale: 1 - progress * STORY_DISMISS_MAX_SHRINK,
  };
}

/** On release of a vertical drag: close, or snap back. A flick needs to be moving down, not just be fast. */
export function decideStoryDismiss(offsetY: number, velocityY: number): "dismiss" | "snap-back" {
  if (offsetY >= STORY_DISMISS_DISTANCE_PX) return "dismiss";
  if (offsetY > 0 && velocityY >= STORY_DISMISS_VELOCITY_PX_PER_S) return "dismiss";
  return "snap-back";
}

/** Downward speed in px/s between two samples (0 when no time passed). */
export function velocityBetween(y0: number, t0: number, y1: number, t1: number): number {
  const dt = t1 - t0;
  if (dt <= 0) return 0;
  return ((y1 - y0) / dt) * 1000;
}

/** A finger that stopped before lifting isn't flicking: the last sampled speed only counts if it is this recent (ms). */
export const FLICK_MAX_AGE_MS = 100;

/** The speed a release carries: the last move's, unless the finger has been still since. */
export function releaseVelocity(lastVelocity: number, msSinceLastMove: number): number {
  return msSinceLastMove > FLICK_MAX_AGE_MS ? 0 : lastVelocity;
}

/**
 * What a released pointer on the story does, given the axis it locked to. `vertical` never navigates (it either
 * closed the viewer or snapped back); `horizontal` and an unlocked press keep the existing swipe / tap / hold rules.
 */
export function releaseIntent(axis: GestureAxis | null): "dismiss-gesture" | "navigate" {
  return axis === "vertical" ? "dismiss-gesture" : "navigate";
}
