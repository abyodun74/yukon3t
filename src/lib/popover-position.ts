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
 * How far the popup's top edge must stay clear of the true top of the
 * display — on the Android Capacitor build the status bar overlays the
 * WebView edge-to-edge (see capacitor-bridge.tsx), so `env(safe-area-inset-
 * top)` alone isn't reliable there and nav.tsx's header instead falls back
 * to a `--status-bar-inset-top` CSS var populated from the native
 * StatusBar plugin. A `position: fixed` popup positioned via a plain
 * viewport-height clamp (no such fallback) rendered flush against y:0 on
 * that build, its top clipped/overlapped by the status bar icons — same
 * failure nav.tsx already had to fix for its header, just not carried over
 * to this shared popover positioner. Probing `max(env(...), var(...))` via
 * a throwaway element (rather than reading the CSS var directly) keeps iOS
 * working too, where only env() is populated and the var is never set.
 */
function getTopSafeAreaInset(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.height = "max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px))";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).height) || 0;
  document.body.removeChild(probe);
  return inset;
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
  const topClamp = margin + getTopSafeAreaInset();
  const width = Math.min(desiredWidth, viewportWidth - margin * 2);
  const height = Math.min(desiredHeight, viewportHeight - margin * 2);

  const spaceBelow = viewportHeight - rect.bottom;
  const openUp = spaceBelow < height + margin && rect.top > spaceBelow;

  const top = openUp
    ? Math.max(topClamp, rect.top - height - margin)
    : Math.min(rect.bottom + margin, viewportHeight - height - margin);

  const left = Math.min(Math.max(margin, rect.right - width), viewportWidth - width - margin);

  return { top: Math.max(topClamp, top), left, width, height };
}
