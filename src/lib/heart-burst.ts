// The big purple heart that pops over a post when it is liked (PostCard), and the double-tap detection behind
// "double-tap the post to like". Pure and timer-injectable so the restart / cleanup / gesture rules are unit tested
// (heart-burst.test.ts); src/lib/use-heart-burst.ts is the thin React wrapper.

/** How long the hearts stay mounted. At least the longest delay + duration planHearts can produce (2150ms). */
export const HEART_BURST_MS = 2200;
/** Reduced motion: one heart fading in place (CSS `post-heart-fade`, 700ms). */
export const HEART_BURST_REDUCED_MS = 800;
/** One lead heart plus this many trailing ones; only one set exists at a time (a new like replaces it). */
export const HEART_TRAIL_MIN = 3;
export const HEART_TRAIL_MAX = 5;
export const HEART_MAX = 1 + HEART_TRAIL_MAX;
/** Low-end phones (isLowEndDevice): one lead heart plus 2 or 3 trailing ones, never more than this. */
export const HEART_TRAIL_LOW_END_MIN = 2;
export const HEART_TRAIL_LOW_END_MAX = 3;
export const HEART_MAX_LOW_END = 1 + HEART_TRAIL_LOW_END_MAX;
/** The lead heart's size on a normal (media-sized) layer; a short layer (a text-only card) gets a smaller one. */
export const LEAD_HEART_PX = 104;
export const LEAD_HEART_MIN_PX = 44;
/** Two taps closer than this are a double tap. Nothing waits for it, except opening the Muse viewer from Home. */
export const DOUBLE_TAP_MS = 280;
/** ...and they must land within this many px of each other. */
export const DOUBLE_TAP_SLOP_PX = 40;

export type HeartBurstTimers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: HeartBurstTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * `onChange(key)` gets a new number each time the heart (re)starts, so the view can remount it and replay the
 * animation, and `null` when it is gone. `show()` while one is showing restarts it cleanly: the old timer is
 * cleared first, so there is never more than one timer. `dispose()` (unmount) clears it and never calls back.
 */
export function createHeartBurst(opts: {
  onChange: (key: number | null) => void;
  reducedMotion?: () => boolean;
  timers?: HeartBurstTimers;
}) {
  const timers = opts.timers ?? realTimers;
  let handle: unknown = null;
  let key = 0;
  let disposed = false;

  function clearTimer() {
    if (handle !== null) timers.clear(handle);
    handle = null;
  }

  return {
    show() {
      if (disposed) return;
      clearTimer();
      key += 1;
      opts.onChange(key);
      const ms = opts.reducedMotion?.() ? HEART_BURST_REDUCED_MS : HEART_BURST_MS;
      handle = timers.set(() => {
        handle = null;
        if (!disposed) opts.onChange(null);
      }, ms);
    },
    /** Hide now (a like that was rolled back). */
    cancel() {
      if (disposed) return;
      clearTimer();
      opts.onChange(null);
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}

export type HeartSpec = {
  id: number;
  /** The lead heart (big, no delay); the others trail it. */
  lead: boolean;
  /** px */
  size: number;
  /** Horizontal start offset from the centre, in % of the container width. */
  offsetPct: number;
  /** Sway amplitude (px, signed: which way the S-curve starts), rotation (deg) and rise (% of container height). */
  sway: number;
  rotate: number;
  rise: number;
  delayMs: number;
  durationMs: number;
};

/** The lead heart's size for a layer this tall: full size on media, smaller on a short text card. */
export function leadHeartSize(heightPx?: number): number {
  if (typeof heightPx !== "number" || !Number.isFinite(heightPx) || heightPx <= 0) return LEAD_HEART_PX;
  return Math.max(LEAD_HEART_MIN_PX, Math.min(LEAD_HEART_PX, Math.round(heightPx * 0.55)));
}

/**
 * One lead heart plus 3 to 5 smaller ones (2 to 3 on a low-end phone), lightly randomised. `random` is injectable
 * (tests). Every heart ends by delay + duration <= 2150ms, inside HEART_BURST_MS. Reduced motion gets the lead heart
 * only. `heightPx` (the layer's measured height) scales the sizes down on a short layer so the hearts aren't clipped.
 */
export function planHearts(
  random: () => number,
  reduced: boolean,
  opts: { lowEnd?: boolean; heightPx?: number } = {},
): HeartSpec[] {
  const r = (min: number, max: number) => min + random() * (max - min);
  const sign = () => (random() < 0.5 ? -1 : 1);
  const leadSize = leadHeartSize(opts.heightPx);
  const sizeRatio = leadSize / LEAD_HEART_PX;
  const lead: HeartSpec = {
    id: 0,
    lead: true,
    size: leadSize,
    offsetPct: r(-6, 6),
    sway: sign() * r(16, 26),
    rotate: r(7, 13),
    rise: r(80, 90),
    delayMs: 0,
    durationMs: Math.round(r(1800, 1950)),
  };
  if (reduced) return [lead];
  const [min, max] = opts.lowEnd
    ? [HEART_TRAIL_LOW_END_MIN, HEART_TRAIL_LOW_END_MAX]
    : [HEART_TRAIL_MIN, HEART_TRAIL_MAX];
  const trail = min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
  const hearts: HeartSpec[] = [lead];
  for (let i = 0; i < trail; i++) {
    // Alternate sides so they fan out around the lead instead of stacking on it.
    const side = i % 2 === 0 ? -1 : 1;
    hearts.push({
      id: i + 1,
      lead: false,
      size: Math.round(r(34, 62) * sizeRatio),
      offsetPct: side * r(12, 34),
      sway: sign() * r(10, 22),
      rotate: r(6, 16),
      rise: r(65, 92),
      delayMs: Math.round(r(100, 500)),
      durationMs: Math.round(r(1300, 1650)),
    });
  }
  return hearts;
}

/**
 * Fewer hearts on a phone with <= 4 cores or <= 2 GB of memory. Feature-detected: a WebView that lacks either
 * property (or throws reading it) counts as a normal phone.
 */
export function isLowEndDevice(nav: unknown): boolean {
  try {
    if (!nav || typeof nav !== "object") return false;
    const { hardwareConcurrency: cores, deviceMemory: memory } = nav as {
      hardwareConcurrency?: unknown;
      deviceMemory?: unknown;
    };
    if (typeof cores === "number" && cores > 0 && cores <= 4) return true;
    if (typeof memory === "number" && memory > 0 && memory <= 2) return true;
  } catch {
    // Reading a navigator property threw in some embedded browser: treat as a normal phone.
  }
  return false;
}

/** A double tap on an unliked post likes it; on a liked one it only shows the heart again and never unlikes. */
export function doubleTapNeedsLike(liked: boolean): boolean {
  return !liked;
}

/** True when the second tap is within the window and close enough to the first one. */
export function isSecondTap(
  first: { t: number; x: number; y: number },
  t: number,
  x: number,
  y: number,
  windowMs = DOUBLE_TAP_MS,
  slopPx = DOUBLE_TAP_SLOP_PX,
): boolean {
  return t >= first.t && t - first.t <= windowMs && Math.hypot(x - first.x, y - first.y) <= slopPx;
}

/** Tracks the last tap; `tap()` is true when it is the second of a double tap (and then forgets it: a triple is 1 + 2). */
export function createDoubleTapDetector(windowMs = DOUBLE_TAP_MS, slopPx = DOUBLE_TAP_SLOP_PX) {
  let last: { t: number; x: number; y: number } | null = null;
  return {
    tap(t: number, x: number, y: number): boolean {
      if (last && isSecondTap(last, t, x, y, windowMs, slopPx)) {
        last = null;
        return true;
      }
      last = { t, x, y };
      return false;
    },
    reset() {
      last = null;
    },
  };
}

/**
 * Elements a double tap on the post text never likes through: links (mentions, hashtags, URLs), buttons ("Show more",
 * Translate), form fields, players and anything marked `data-no-double-tap-like`.
 */
export const DOUBLE_TAP_IGNORE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "video",
  "audio",
  "iframe",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="tab"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  "[data-no-double-tap-like]",
].join(", ");

type ElementLike = { closest(selector: string): unknown };
type ContainerLike = { contains(other: unknown): boolean };

/**
 * True when a tap on `target` must not count toward a double-tap like: it isn't an element, or it is (inside) an
 * interactive element within `boundary` (the text area; an interactive ancestor outside it doesn't count).
 */
export function isDoubleTapIgnoredTarget(target: unknown, boundary?: ContainerLike | null): boolean {
  if (!target || typeof (target as Partial<ElementLike>).closest !== "function") return true;
  const hit = (target as ElementLike).closest(DOUBLE_TAP_IGNORE_SELECTOR);
  if (!hit) return false;
  return boundary ? boundary.contains(hit) : true;
}

/** True when the reader has text selected: a double tap then is about the selection, never a like. */
export function hasActiveTextSelection(selection: unknown): boolean {
  try {
    if (!selection || typeof selection !== "object") return false;
    const sel = selection as { isCollapsed?: boolean; toString(): string };
    return sel.isCollapsed === false && sel.toString().trim().length > 0;
  } catch {
    return false;
  }
}

type PlaybackLike = { readonly paused: boolean; play(): unknown; pause(): unknown };

function startPlayback(video: PlaybackLike) {
  const result = video.play();
  // HTMLMediaElement.play() returns a promise that rejects when the browser refuses (autoplay rules); ignore that.
  if (result && typeof (result as Promise<unknown>).catch === "function") (result as Promise<unknown>).catch(() => {});
}

/**
 * Tap to play / pause a feed video at once, and double tap to like without changing playback: the first tap toggles
 * immediately (a single tap never waits), and the second tap of a double tap puts the video back to exactly the state
 * it had before the first tap (instead of toggling again, which could disagree if autoplay or a refused play() moved
 * it in between). `tap()` answers "double" when that happened, so the caller likes the post.
 */
export function createVideoTapToggle(windowMs = DOUBLE_TAP_MS, slopPx = DOUBLE_TAP_SLOP_PX) {
  const detector = createDoubleTapDetector(windowMs, slopPx);
  let pausedBeforeFirstTap: boolean | null = null;
  return {
    tap(t: number, x: number, y: number, video: PlaybackLike): "toggled" | "double" {
      if (detector.tap(t, x, y)) {
        const restorePaused = pausedBeforeFirstTap;
        pausedBeforeFirstTap = null;
        if (restorePaused === true && !video.paused) video.pause();
        else if (restorePaused === false && video.paused) startPlayback(video);
        return "double";
      }
      pausedBeforeFirstTap = video.paused;
      if (video.paused) startPlayback(video);
      else video.pause();
      return "toggled";
    },
    reset() {
      detector.reset();
      pausedBeforeFirstTap = null;
    },
  };
}

type TapEventLike = {
  clientX: number;
  clientY: number;
  preventDefault(): void;
  stopImmediatePropagation(): void;
};

export type CaptureTarget = {
  addEventListener(type: string, listener: (e: TapEventLike) => void, options: { capture: boolean }): void;
  removeEventListener(type: string, listener: (e: TapEventLike) => void, options: { capture: boolean }): void;
};

/**
 * A photo / GIF opens its viewer on the FIRST tap (no waiting). This watches for the second tap of a double tap, which
 * lands on the viewer that just opened: a click within DOUBLE_TAP_MS and DOUBLE_TAP_SLOP_PX of the first tap is
 * swallowed in the capture phase (the viewer never sees it) and `onDoubleTap` runs, which closes the viewer and likes.
 * Any other click (later, elsewhere, e.g. the viewer's close button) disarms it and goes through untouched. The
 * browser's own `dblclick` after a matched pair is swallowed too, so the viewer's double-click zoom can't fire. Returns
 * `disarm()` (idempotent); it also disarms itself after the window.
 */
export function armSecondTapGuard(opts: {
  target: CaptureTarget;
  first: { t: number; x: number; y: number };
  now: () => number;
  onDoubleTap: () => void;
  /** The first tap's own event, never treated as the second tap. */
  ignore?: unknown;
  timers?: HeartBurstTimers;
  windowMs?: number;
  slopPx?: number;
}): () => void {
  const timers = opts.timers ?? realTimers;
  const windowMs = opts.windowMs ?? DOUBLE_TAP_MS;
  const slopPx = opts.slopPx ?? DOUBLE_TAP_SLOP_PX;
  const capture = { capture: true };
  let clickArmed = true;
  let dblArmed = true;
  let matched = false;
  const handles: unknown[] = [];

  function removeClick() {
    if (!clickArmed) return;
    clickArmed = false;
    opts.target.removeEventListener("click", onClick, capture);
  }
  function removeDbl() {
    if (!dblArmed) return;
    dblArmed = false;
    opts.target.removeEventListener("dblclick", onDblClick, capture);
  }
  function disarm() {
    removeClick();
    removeDbl();
    for (const h of handles) timers.clear(h);
    handles.length = 0;
  }
  function near(e: TapEventLike) {
    return Math.hypot(e.clientX - opts.first.x, e.clientY - opts.first.y) <= slopPx;
  }
  function onClick(e: TapEventLike) {
    if (e === opts.ignore) return;
    if (!matched && isSecondTap(opts.first, opts.now(), e.clientX, e.clientY, windowMs, slopPx)) {
      matched = true;
      e.preventDefault();
      e.stopImmediatePropagation();
      removeClick();
      opts.onDoubleTap();
      return;
    }
    disarm();
  }
  function onDblClick(e: TapEventLike) {
    if (matched && near(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    removeDbl();
  }

  opts.target.addEventListener("click", onClick, capture);
  opts.target.addEventListener("dblclick", onDblClick, capture);
  handles.push(
    timers.set(() => {
      removeClick();
      if (!matched) removeDbl();
    }, windowMs),
    // A matched pair's dblclick follows its second click at once; this only bounds how long the listener can linger.
    timers.set(removeDbl, windowMs * 2),
  );
  return disarm;
}
