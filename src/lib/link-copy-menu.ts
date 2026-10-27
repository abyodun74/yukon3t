/**
 * Pure rules for the app-wide long-press behaviour (`LinkCopyMenu`, mounted once in the root layout). The owner's
 * rules: pressing and holding anywhere in the app must never show a URL (the WebView's / browser's link or image
 * menu, link preview, "open in new tab"); the pressed photo or link is highlighted and our own small menu copies
 * *what was pressed*:
 * - a photo copies the picture itself (image data, pasted as a photo), never a yukon3t page URL or the file's URL;
 * - a link copies its real destination (an external link's own URL; an in-app link's own address); a card that
 *   stands for an external link without being an `<a>` (a LINK post, an embedded video's source line) says what it
 *   points to with `data-copy-url`, which is copied instead.
 * Not copyable (native menu still blocked, no menu of ours, or the surrounding link's menu): profile pictures
 * (`.protected-image`), media marked `data-no-copy-media` (secret chats, story previews), videos/audio, anything in
 * a full-screen viewer (lightbox, story, view-once, Muse). Plain text keeps native selection; editable fields keep
 * native Cut/Copy/Paste. A normal tap still navigates.
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
/**
 * Pictures that must never be copied: profile pictures (`protectedImageProps`, see src/lib/protected-image.ts) and
 * anything a component marks `data-no-copy-media` (secret-chat media, story previews). A press on one falls through
 * to the link around it, if any (an avatar inside a profile link still offers that link), never the picture.
 */
export const NO_COPY_MEDIA_SELECTOR = ".protected-image, [data-no-copy-media]";
/** A non-`<a>` element that stands for an external link (LINK post card, embed source line): copies this URL. */
export const COPY_URL_SELECTOR = "[data-copy-url]";

/** The subset of `Element` these rules read. */
export interface ElementLike {
  closest(selector: string): ElementLike | null;
  getAttribute(name: string): string | null;
  readonly tagName: string;
}

/** What the menu copies: link text, or the picture at `src` (fetched and put on the clipboard as image data). */
export type CopyTarget = { type: "link"; text: string } | { type: "image"; src: string };

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
  /** Link or photo: block the native menu, highlight `element` and offer our own menu copying `copy`. */
  | { kind: "menu"; element: E; copy: CopyTarget };

/**
 * Hosts whose images are animated GIFs from Giphy. A clipboard can only carry a still PNG, so for these the GIF's
 * own public Giphy link is copied instead (most chat apps show it animated when pasted).
 */
const GIPHY_HOST = /(^|\.)giphy\.com$/i;

/**
 * The picture an `<img src>` should copy, or `null` when it must not / cannot be copied: only http(s) images
 * (never `blob:`/`data:`, which are local previews or decrypted content), never a profile picture's address
 * (`/api/avatar/...` for private ones, the public bucket's `avatar/...` keys) even if a component forgot to protect it.
 */
export function imageCopyTarget(src: string | null | undefined, baseUrl: string): CopyTarget | null {
  const raw = (src ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (/^\/(api\/avatar|avatar)\//i.test(url.pathname)) return null;
  if (GIPHY_HOST.test(url.hostname)) return { type: "link", text: url.href };
  return { type: "image", src: url.href };
}

/** A `data-copy-url` value: absolute http(s) only (it names an external destination), else `null`. */
export function externalCopyUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

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
 * element under the finger / the focused element for the keyboard menu key); `pageUrl` resolves relative
 * addresses. A photo wins over a link around it (pressing an album photo copies the photo, not its post page);
 * media that can't be copied falls through to the surrounding link, or is suppressed when there is none.
 */
export function classifyPressTarget<E extends ElementLike>(target: E | null, pageUrl: string): PressTarget<E> {
  if (!target || typeof target.closest !== "function") return { kind: "plain" };
  if (target.closest(EDITABLE_SELECTOR)) return { kind: "native" };
  if (target.closest(FRAME_SELECTOR)) return { kind: "native" };

  const media = target.closest(MEDIA_SELECTOR) as E | null;
  if (media) {
    if (media.closest(OPT_OUT_SELECTOR)) return { kind: "suppress", element: media };
    const copyable =
      media.tagName.toUpperCase() === "IMG" &&
      !media.closest(MODAL_SELECTOR) &&
      !media.closest(CHROME_SELECTOR) &&
      !media.closest(NO_COPY_MEDIA_SELECTOR);
    const copy = copyable ? imageCopyTarget(media.getAttribute("src"), pageUrl) : null;
    if (copy) return { kind: "menu", element: media, copy };
    // Not copyable (profile picture, secret-chat media, video/audio, viewer): the link around it, if any, or nothing.
    const around = linkTarget(media, pageUrl);
    return around ?? { kind: "suppress", element: media };
  }

  return linkTarget(target, pageUrl) ?? { kind: "plain" };
}

/** The link `target` is in (a `data-copy-url` card or an `<a href>`), or `null` when it isn't in one. */
function linkTarget<E extends ElementLike>(target: E, pageUrl: string): PressTarget<E> | null {
  const card = target.closest(COPY_URL_SELECTOR) as E | null;
  if (card) {
    if (card.closest(OPT_OUT_SELECTOR)) return { kind: "suppress", element: card };
    const text = externalCopyUrl(card.getAttribute("data-copy-url"));
    return text ? { kind: "menu", element: card, copy: { type: "link", text } } : { kind: "suppress", element: card };
  }

  const anchor = target.closest("a[href]") as E | null;
  if (!anchor) return null;
  if (anchor.closest(OPT_OUT_SELECTOR)) return { kind: "suppress", element: anchor };
  // An <a> acting as a button (role="button") is a control, not a link.
  if ((anchor.getAttribute("role") ?? "").toLowerCase() === "button") return { kind: "suppress", element: anchor };
  if (anchor.closest(CHROME_SELECTOR)) return { kind: "suppress", element: anchor };
  const text = linkCopyText(anchor.getAttribute("href"), pageUrl);
  if (!text) return { kind: "suppress", element: anchor };
  return { kind: "menu", element: anchor, copy: { type: "link", text } };
}

// ---------------------------------------------------------------------------------------------------------------
// Can this device put a picture on the clipboard? The async Clipboard API (`navigator.clipboard.write` with a
// `ClipboardItem`) carries `image/png` in current Chrome/Edge, Firefox and Safari (macOS and iOS, including
// WKWebView). Android System WebView is the exception: the call resolves, but Chromium's Android clipboard drops
// the picture unless the embedding app installed an image file provider (`ClipboardImpl.setImage` returns early
// when `mImageFileProvider` is null; only Chrome sets one), so a "Photo copied" there would be a lie. The Capacitor
// Android app copies through its own native plugin instead (`ImageClipboardPlugin.java`, first shipped in the Android
// build after 1.26 / versionCode 29); older installed Android builds lack it, and they and other Android in-app browsers report
// "unsupported" instead of pretending.
// ---------------------------------------------------------------------------------------------------------------

/** Android System WebView marks its user agent with "; wv)" (e.g. "Linux; Android 14; Pixel 8 Build/...; wv)"). */
export function isAndroidWebViewUserAgent(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent) && /;\s*wv\)/i.test(userAgent);
}

/**
 * How this device can put a picture on the clipboard: `"native"` through the app's `ImageClipboard` plugin,
 * `"web"` through `navigator.clipboard.write`, or `"unsupported"`.
 */
export type ImageClipboardSupport = "native" | "web" | "unsupported";

export function imageClipboardSupport(env: {
  /** The native `ImageClipboard` plugin is in this installed app build (`Capacitor.isPluginAvailable`). */
  nativePlugin: boolean;
  hasClipboardWrite: boolean;
  hasClipboardItem: boolean;
  /** `ClipboardItem.supports("image/png")` where the browser has it, otherwise `undefined`. */
  supportsPng: boolean | undefined;
  androidWebView: boolean;
}): ImageClipboardSupport {
  if (env.nativePlugin) return "native";
  if (env.androidWebView) return "unsupported";
  if (!env.hasClipboardWrite || !env.hasClipboardItem) return "unsupported";
  if (env.supportsPng === false) return "unsupported";
  return "web";
}

/** Largest side (px) of a picture put on the clipboard; bigger ones are scaled down (PNG of a huge photo is tens of MB). */
export const CLIPBOARD_IMAGE_MAX_SIDE = 4096;

export function clipboardImageSize(width: number, height: number, maxSide = CLIPBOARD_IMAGE_MAX_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest === 0) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
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
