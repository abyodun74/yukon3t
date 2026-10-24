/**
 * Pure rules for the app-wide long-press behaviour (`LinkCopyMenu`, mounted once in the root layout). The owner's
 * rule: pressing and holding anywhere in the app must never show a URL (the WebView's / browser's link or image
 * menu, link preview, "open in new tab"); only copy/paste style actions. So: links and media get our own small menu
 * with a single "Copy link" action (the URL is copied, never displayed); plain text keeps native selection; editable
 * fields keep native Cut/Copy/Paste. A normal tap still navigates.
 *
 * Kept free of `window`/`document` so it can be unit-tested in Vitest's node environment: the DOM-facing parts
 * (`classifyPressTarget`) only use `closest` / `getAttribute` / `tagName`, which tests stub.
 */

/** How long a finger has to stay down on a link before the menu opens. */
export const LONG_PRESS_DELAY_MS = 480;
/** How far (px, either axis) a finger may drift before it counts as a scroll/swipe instead of a press. */
export const LONG_PRESS_SLOP_PX = 10;

/**
 * Text-entry surfaces keep their own native callout (Cut / Copy / Paste / Select all) untouched, even if a link is
 * somehow inside one (a contenteditable with a pasted link).
 */
export const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
/** Media whose native long-press menu shows its file URL (open image / save / copy address). */
export const MEDIA_SELECTOR = "img, video, audio, picture, canvas";
/** Embedded documents: a cross-origin frame's own content never reaches our listeners, so nothing to decide here. */
export const FRAME_SELECTOR = "iframe, object, embed";
/**
 * Full-screen viewers (story viewer, lightbox, view-once viewer, Muse player) are `aria-modal`. Holding media there
 * already means something (hold-to-pause, pinch-zoom), so the native menu is blocked but no menu of ours pops up.
 */
export const MODAL_SELECTOR = '[aria-modal="true"]';
/** Opt-out: a component that handles long-press on a link/media itself. The native menu is still blocked there. */
export const OPT_OUT_SELECTOR = "[data-no-link-menu]";
/** App chrome: tab bars / top nav. Native menu blocked, but "Copy link" on a tab would just be noise. */
export const CHROME_SELECTOR = 'nav, [role="tablist"], [role="tab"]';

/** The subset of `Element` these rules read. */
export interface ElementLike {
  closest(selector: string): ElementLike | null;
  getAttribute(name: string): string | null;
  readonly tagName: string;
}

export type PressTarget<E extends ElementLike = ElementLike> =
  /** Editable field or embedded frame: leave every native behaviour alone (Cut/Copy/Paste stays). */
  | { kind: "native" }
  /**
   * Ordinary content (text, cards, empty space). A touch long-press keeps native text selection and its toolbar
   * (Copy / Select all, which shows no URL); a mouse/keyboard context menu is blocked unless text is selected.
   */
  | { kind: "plain" }
  /** Link or media whose native menu must not show, but which gets no menu of ours either. */
  | { kind: "suppress"; element: E }
  /** Link or media: block the native menu and offer our own "Copy link" (copies `copyText`, never displayed). */
  | { kind: "menu"; element: E; copyText: string };

/**
 * What the text copied for a link's `href` should be: the absolute URL for web links (relative ones resolved
 * against `baseUrl`), the bare address for `mailto:`, the bare number for `tel:`/`sms:`. `null` for anything not
 * worth copying (`javascript:`, an empty href, a bare in-page `#` placeholder).
 */
export function linkCopyText(href: string | null | undefined, baseUrl: string): string | null {
  const raw = (href ?? "").trim();
  if (!raw || raw === "#") return null;
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol === "javascript:" || protocol === "data:" || protocol === "blob:" || protocol === "vbscript:") {
    return null;
  }
  if (protocol === "mailto:" || protocol === "tel:" || protocol === "sms:") {
    // Everything after the scheme, minus any ?subject=/&body= query.
    const rest = raw.slice(raw.indexOf(":") + 1).split("?")[0];
    let decoded = rest;
    try {
      decoded = decodeURIComponent(rest);
    } catch {
      // A stray "%" — keep the raw text rather than failing.
    }
    decoded = decoded.replace(/^\/\//, "").trim();
    return decoded || null;
  }
  return url.href;
}

/**
 * Decides what a long-press / context menu on `target` should do. `target` is the event target (the deepest
 * element under the finger / the focused element for the keyboard menu key); `pageUrl` is the current page,
 * which is what "Copy link" copies for a photo/video that isn't itself inside a link (never the media file's URL).
 */
export function classifyPressTarget<E extends ElementLike>(target: E | null, pageUrl: string): PressTarget<E> {
  if (!target || typeof target.closest !== "function") return { kind: "plain" };
  if (target.closest(EDITABLE_SELECTOR)) return { kind: "native" };
  if (target.closest(FRAME_SELECTOR)) return { kind: "native" };

  const anchor = target.closest("a[href]") as E | null;
  if (anchor) {
    if (anchor.closest(OPT_OUT_SELECTOR)) return { kind: "suppress", element: anchor };
    // An <a> acting as a button (role="button") is a control, not a link.
    if ((anchor.getAttribute("role") ?? "").toLowerCase() === "button") return { kind: "suppress", element: anchor };
    if (anchor.closest(CHROME_SELECTOR)) return { kind: "suppress", element: anchor };
    const copyText = linkCopyText(anchor.getAttribute("href"), pageUrl);
    if (!copyText) return { kind: "suppress", element: anchor };
    return { kind: "menu", element: anchor, copyText };
  }

  const media = target.closest(MEDIA_SELECTOR) as E | null;
  if (media) {
    if (media.closest(OPT_OUT_SELECTOR) || media.closest(MODAL_SELECTOR)) return { kind: "suppress", element: media };
    const copyText = linkCopyText(pageUrl, pageUrl);
    if (!copyText) return { kind: "suppress", element: media };
    return { kind: "menu", element: media, copyText };
  }

  return { kind: "plain" };
}

// ---------------------------------------------------------------------------------------------------------------
// Long-press detection: a tiny pure state machine. The component feeds it touch events and a timer tick; it says
// when the press has become a long-press. Any movement past the slop, a second finger, a scroll, lifting the finger
// or a cancel ends the press without firing.
// ---------------------------------------------------------------------------------------------------------------

export type LongPressState =
  | { phase: "idle" }
  | { phase: "pressing"; id: number; startX: number; startY: number; startedAt: number }
  | { phase: "fired"; id: number; x: number; y: number };

export type LongPressEvent =
  | { type: "down"; id: number; x: number; y: number; at: number; touches: number }
  | { type: "move"; x: number; y: number }
  | { type: "timeout"; id: number; at: number }
  | { type: "up" }
  | { type: "cancel" }
  | { type: "scroll" };

export interface LongPressResult {
  state: LongPressState;
  /** True exactly once per press: the transition into "fired". */
  fire: boolean;
}

export const LONG_PRESS_IDLE: LongPressState = { phase: "idle" };

export function longPressReducer(
  state: LongPressState,
  event: LongPressEvent,
  options: { delayMs?: number; slopPx?: number } = {},
): LongPressResult {
  const delayMs = options.delayMs ?? LONG_PRESS_DELAY_MS;
  const slopPx = options.slopPx ?? LONG_PRESS_SLOP_PX;
  switch (event.type) {
    case "down":
      // A second finger means pinch/zoom, never a long-press.
      if (event.touches !== 1) return { state: LONG_PRESS_IDLE, fire: false };
      return {
        state: { phase: "pressing", id: event.id, startX: event.x, startY: event.y, startedAt: event.at },
        fire: false,
      };
    case "move":
      if (state.phase !== "pressing") return { state, fire: false };
      if (Math.abs(event.x - state.startX) > slopPx || Math.abs(event.y - state.startY) > slopPx) {
        return { state: LONG_PRESS_IDLE, fire: false };
      }
      return { state, fire: false };
    case "timeout":
      // A stale timer from an earlier press, or one that fired early, does nothing.
      if (state.phase !== "pressing" || state.id !== event.id) return { state, fire: false };
      if (event.at - state.startedAt < delayMs) return { state, fire: false };
      return { state: { phase: "fired", id: state.id, x: state.startX, y: state.startY }, fire: true };
    case "up":
    case "cancel":
    case "scroll":
      return { state: LONG_PRESS_IDLE, fire: false };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Placement: near the touch point, inside the viewport (with a margin), above the finger when there is room so the
// finger doesn't cover it. Physical (left/top) coordinates, so it is the same in RTL.
// ---------------------------------------------------------------------------------------------------------------

export function placeLinkMenu(
  point: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  options: { margin?: number; gap?: number } = {},
): { left: number; top: number } {
  const margin = options.margin ?? 12;
  const gap = options.gap ?? 16;
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const left = Math.min(Math.max(point.x - menu.width / 2, margin), maxLeft);
  const above = point.y - gap - menu.height;
  const below = point.y + gap;
  let top = above >= margin ? above : below;
  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  top = Math.min(Math.max(top, margin), maxTop);
  return { left: Math.round(left), top: Math.round(top) };
}
