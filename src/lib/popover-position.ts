"use client";

export const POPOVER_VIEWPORT_MARGIN = 8;

export type PopoverPosition = { top: string; left: number; width: number; height: number };

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
 *
 * `top` comes back as a CSS `max()` expression, not a plain number, for
 * the same reason nav.tsx's header sets its padding that way instead of a
 * JS-computed pixel value (see capacitor-bridge.tsx): on the Android
 * Capacitor build the status bar overlays the WebView edge-to-edge, and
 * the inset that corrects for it — `env(safe-area-inset-top)`, with a
 * `--status-bar-inset-top` fallback populated by an async native
 * StatusBar.getInfo() round-trip — isn't guaranteed to have a real value
 * yet the instant a popup opens (e.g. right after a cold app launch, a
 * button tapped before that round-trip resolves). A one-off JS snapshot
 * of the inset bakes in whatever it read at that instant and never
 * corrects itself; folding the same `max(env(...), var(...))` the header
 * uses directly into the CSS `top` value instead means the browser
 * re-resolves it on every repaint, so the popup self-corrects the moment
 * the real inset lands, even if that's after this function already ran.
 */
export function computePopoverPosition(rect: DOMRect, desiredWidth: number, desiredHeight: number): PopoverPosition {
  const { width: viewportWidth, height: viewportHeight } = getViewportSize();
  const margin = POPOVER_VIEWPORT_MARGIN;
  const width = Math.min(desiredWidth, viewportWidth - margin * 2);
  const height = Math.min(desiredHeight, viewportHeight - margin * 2);

  const spaceBelow = viewportHeight - rect.bottom;
  const openUp = spaceBelow < height + margin && rect.top > spaceBelow;

  const idealTop = openUp
    ? Math.max(margin, rect.top - height - margin)
    : Math.min(rect.bottom + margin, viewportHeight - height - margin);

  const left = Math.min(Math.max(margin, rect.right - width), viewportWidth - width - margin);

  // Confirmed on-device (a colored-border diagnostic rendered on a real
  // Android Capacitor build) that this WebView paints `position: fixed`
  // at layout-viewport-relative coordinates even once the on-screen
  // keyboard has scrolled the visual viewport away from the layout
  // viewport's origin: a popup computed to sit ~54px below the visible
  // top instead rendered ~7px below it — off by almost exactly
  // visualViewport.offsetTop (the measured layout/visual scroll delta),
  // confirmed via getBoundingClientRect() matching the intended value
  // while the popup's actual on-screen border did not. Adding that
  // offset back is a no-op whenever it's 0 (no keyboard-driven scroll,
  // the common case), and even on an engine that already anchors fixed
  // elements to the visual viewport correctly, over-adding it here only
  // pushes the popup somewhat lower than ideal — mild, versus the
  // confirmed failure otherwise (rendered off-screen under the status
  // bar), so this stays unconditional rather than trying to detect which
  // behavior a given engine has.
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const vvOffsetTop = vv?.offsetTop ?? 0;
  const vvOffsetLeft = vv?.offsetLeft ?? 0;

  const top = `max(${idealTop + vvOffsetTop}px, calc(${margin + vvOffsetTop}px + max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px))))`;

  return { top, left: left + vvOffsetLeft, width, height };
}
