// The big purple heart that pops over a post when it is liked (PostCard), and the double-tap detection behind
// "double-tap the media to like". Pure and timer-injectable so the restart / cleanup rules are unit tested
// (heart-burst.test.ts); src/lib/use-heart-burst.ts is the thin React wrapper.

/** How long the hearts stay mounted. At least the longest delay + duration planHearts can produce (2150ms). */
export const HEART_BURST_MS = 2200;
/** Reduced motion: one heart fading in place (CSS `post-heart-fade`, 700ms). */
export const HEART_BURST_REDUCED_MS = 800;
/** One lead heart plus this many trailing ones; only one set exists at a time (a new like replaces it). */
export const HEART_TRAIL_MIN = 3;
export const HEART_TRAIL_MAX = 5;
export const HEART_MAX = 1 + HEART_TRAIL_MAX;
/** Two taps on the media closer than this are a double tap. A single tap that opens something waits this long. */
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

/**
 * One lead heart plus 3 to 5 smaller ones, lightly randomised. `random` is injectable (tests). Every heart ends by
 * delay + duration <= 2150ms, inside HEART_BURST_MS. Reduced motion gets the lead heart only.
 */
export function planHearts(random: () => number, reduced: boolean): HeartSpec[] {
  const r = (min: number, max: number) => min + random() * (max - min);
  const sign = () => (random() < 0.5 ? -1 : 1);
  const lead: HeartSpec = {
    id: 0,
    lead: true,
    size: 104,
    offsetPct: r(-6, 6),
    sway: sign() * r(16, 26),
    rotate: r(7, 13),
    rise: r(80, 90),
    delayMs: 0,
    durationMs: Math.round(r(1800, 1950)),
  };
  if (reduced) return [lead];
  const trail = HEART_TRAIL_MIN + Math.floor(random() * (HEART_TRAIL_MAX - HEART_TRAIL_MIN + 1));
  const hearts: HeartSpec[] = [lead];
  for (let i = 0; i < trail; i++) {
    // Alternate sides so they fan out around the lead instead of stacking on it.
    const side = i % 2 === 0 ? -1 : 1;
    hearts.push({
      id: i + 1,
      lead: false,
      size: Math.round(r(34, 62)),
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

/** A double tap on an unliked post likes it; on a liked one it only shows the heart again and never unlikes. */
export function doubleTapNeedsLike(liked: boolean): boolean {
  return !liked;
}

/** Tracks the last tap; `tap()` is true when it is the second of a double tap (and then forgets it: a triple is 1 + 2). */
export function createDoubleTapDetector(windowMs = DOUBLE_TAP_MS, slopPx = DOUBLE_TAP_SLOP_PX) {
  let last: { t: number; x: number; y: number } | null = null;
  return {
    tap(t: number, x: number, y: number): boolean {
      const prev = last;
      if (prev && t >= prev.t && t - prev.t <= windowMs && Math.hypot(x - prev.x, y - prev.y) <= slopPx) {
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
