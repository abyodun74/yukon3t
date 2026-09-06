"use client";

export const POPOVER_VIEWPORT_MARGIN = 8;

export type PopoverPosition = { top: number; left: number; width: number; height: number };

/**
 * window.visualViewport (not window.innerWidth/innerHeight) is what
 * actually shrinks when a mobile on-screen keyboard opens — callers of this
 * live inside the message/comment composer, where the keyboard is up by the
 * time someone taps the trigger. Falls back to the layout viewport for
 * browsers without the API.
 */
export function getViewportSize() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
}

/**
 * Shared by EmojiPickerButton and GifPickerButton — the popup is rendered
 * via a portal, positioned with `fixed` coordinates computed from the
 * trigger button's own bounding rect — not CSS `top-full`/`bottom-full` on
 * a relatively-positioned ancestor. Buttons live inside scrollable message
 * lists, and an absolutely-positioned popup taller than the remaining space
 * in that scroll container gets silently clipped (and its "visible" — but
 * unclickable — remainder swallows clicks meant for whatever sits behind
 * it). A portal escapes that clipping and lets us flip/clamp against the
 * actual viewport.
 *
 * Width/height are also clamped to the viewport, not just position — on a
 * narrow phone (or any viewport shorter than ~376px once the keyboard is
 * up) a fixed desired size itself doesn't fit, and clamping only the
 * top/left coordinates against a size larger than the viewport pushes the
 * box partly off-screen rather than shrinking it to fit.
 */
export function computePopoverPosition(rect: DOMRect, desiredWidth: number, desiredHeight: number): PopoverPosition {
  const { width: viewportWidth, height: viewportHeight } = getViewportSize();
  const margin = POPOVER_VIEWPORT_MARGIN;
  const width = Math.min(desiredWidth, viewportWidth - margin * 2);
  const height = Math.min(desiredHeight, viewportHeight - margin * 2);

  const spaceBelow = viewportHeight - rect.bottom;
  const openUp = spaceBelow < height + margin && rect.top > spaceBelow;

  const top = openUp
    ? Math.max(margin, rect.top - height - margin)
    : Math.min(rect.bottom + margin, viewportHeight - height - margin);

  const left = Math.min(Math.max(margin, rect.right - width), viewportWidth - width - margin);

  return { top, left, width, height };
}
