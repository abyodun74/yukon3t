/**
 * What a "changed" broadcast on a live stream's own channel
 * (REALTIME_CHANNELS.liveStream) is actually about, so a listener can refetch
 * just that instead of everything — with hundreds of viewers in one room,
 * "every signal refetches everything for everyone" is what made a single
 * comment cost four Server Actions (one of them a Daily REST call) per
 * viewer. Still a thin signal (see realtime-server.ts): the kind names which
 * already-authorized fetch to re-run, never the data itself.
 *
 * Dependency-free on purpose, same as realtime-channels.ts — imported by
 * both the publishing Server Actions and the subscribing client components.
 */
export const LIVE_STREAM_SIGNAL_KINDS = ["comment", "presence", "stage"] as const;
export type LiveStreamSignalKind = (typeof LIVE_STREAM_SIGNAL_KINDS)[number];

/**
 * Null means "refetch everything": the focus-regain resync (useRealtimeEvent
 * passes a null payload), a server still running the pre-kind code during a
 * deploy (publishes `{}`), or a kind this client's cached JS doesn't know
 * about yet. Never guess narrower than the signal actually says.
 */
export function liveStreamSignalKind(payload: unknown): LiveStreamSignalKind | null {
  if (typeof payload !== "object" || payload === null) return null;
  const kind = (payload as { kind?: unknown }).kind;
  return LIVE_STREAM_SIGNAL_KINDS.includes(kind as LiveStreamSignalKind) ? (kind as LiveStreamSignalKind) : null;
}

/**
 * Runs `fn` at most once per `intervalMs`: immediately if it hasn't run
 * within the interval, otherwise once more when the interval is up — so a
 * burst always ends with a run *after* its last trigger and the final state
 * shown is the correct one, just late. `cancel` drops a pending trailing run
 * (unmount).
 */
export function createTrailingThrottle(fn: () => void, intervalMs: number) {
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function run() {
    timer = null;
    lastRunAt = Date.now();
    fn();
  }

  return {
    trigger() {
      if (timer) return;
      const wait = lastRunAt + intervalMs - Date.now();
      if (wait <= 0) {
        run();
      } else {
        timer = setTimeout(run, wait);
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Returns a runner that keeps only one async call in flight: calls that land
 * while one is running collapse into exactly one more run afterwards (of the
 * most recently passed `fn`), however many there were. For a cursor-based
 * fetch this is also what keeps two overlapping calls from both reading the
 * same cursor and returning the same rows twice. `fn` is passed per call
 * rather than at creation so a component can hold one runner for its whole
 * lifetime without it closing over a ref during render.
 */
export function createCoalescer() {
  let running = false;
  let queued: (() => Promise<void>) | null = null;

  return async function run(fn: () => Promise<void>) {
    if (running) {
      queued = fn;
      return;
    }
    running = true;
    try {
      let next: (() => Promise<void>) | null = fn;
      while (next) {
        queued = null;
        await next();
        next = queued;
      }
    } finally {
      running = false;
    }
  };
}
