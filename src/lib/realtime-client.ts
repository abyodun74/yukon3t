"use client";

import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { captureError } from "@/lib/error-tracking";

function isRealtimeConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

let cachedClient: SupabaseClient | null = null;

function client(): SupabaseClient | null {
  if (!isRealtimeConfigured()) return null;
  if (cachedClient) return cachedClient;
  cachedClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return cachedClient;
}

export type RealtimeTransport = {
  /**
   * Joins `topic` and returns the function that leaves it again. The close
   * function may return a promise that settles once the leave has actually
   * finished — the registry waits on it before joining the same topic again.
   */
  open(
    topic: string,
    onBroadcast: (event: string, payload: unknown) => void,
    onStatus: (status: string, err?: Error) => void,
  ): () => unknown;
};

type ChannelListener = { event: string; handler: (payload: unknown) => void };
type ChannelEntry = { listeners: Set<ChannelListener>; close: (() => unknown) | null };

/**
 * One transport channel per topic, shared by every listener on that topic
 * and left only when the last one goes.
 *
 * REAL BUG this replaces: supabase.channel(topic) hands back the SAME
 * channel object to every caller asking for a topic that's already open,
 * and supabase.removeChannel() leaves that one shared channel outright. So
 * with each useRealtimeEvent instance opening and removing "its own"
 * channel, the first of two components on a topic to unmount (CallButton
 * and IncomingCallListener on call:{userId}; the three Home components on
 * live-streams) silently unsubscribed the other until the next full reload.
 *
 * Two details that matter:
 * - The leave is deferred by a microtask, so one listener handing a topic
 *   straight to another in the same React commit (IncomingCallListener's
 *   two subscriptions swap on call:{userId} the moment a call connects)
 *   keeps the channel joined instead of dropping signals across a
 *   leave + rejoin.
 * - A leave is asynchronous on the wire, and until it completes
 *   supabase.channel(topic) still returns the channel that's on its way
 *   out — whose subscribe() is then a no-op. A topic re-requested in that
 *   window therefore waits for the leave to finish before opening afresh.
 */
export function createChannelRegistry(
  transport: RealtimeTransport,
  onChannelFailure: (topic: string, status: string, err?: Error) => void,
) {
  const entries = new Map<string, ChannelEntry>();
  const closing = new Map<string, Promise<void>>();
  // A channel that errors retries on its own and reports the same status
  // again on every attempt — once per topic is enough to know it happened.
  const reportedTopics = new Set<string>();

  function open(topic: string, entry: ChannelEntry) {
    entry.close = transport.open(
      topic,
      (event, payload) => {
        const name = event.toLowerCase();
        for (const listener of [...entry.listeners]) {
          if (listener.event === name && entry.listeners.has(listener)) listener.handler(payload);
        }
      },
      (status, err) => {
        if ((status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") || reportedTopics.has(topic)) return;
        reportedTopics.add(topic);
        onChannelFailure(topic, status, err);
      },
    );
  }

  function release(topic: string, entry: ChannelEntry) {
    if (entry.listeners.size > 0 || entries.get(topic) !== entry) return;
    entries.delete(topic);
    if (!entry.close) return;
    const closed: Promise<void> = Promise.resolve()
      .then(entry.close)
      .catch(() => undefined)
      .then(() => {
        if (closing.get(topic) === closed) closing.delete(topic);
      });
    closing.set(topic, closed);
  }

  return {
    subscribe(topic: string, event: string, handler: (payload: unknown) => void): () => void {
      let entry = entries.get(topic);
      if (!entry) {
        const created: ChannelEntry = { listeners: new Set(), close: null };
        entries.set(topic, created);
        const leaving = closing.get(topic);
        if (leaving) {
          leaving.then(() => {
            if (entries.get(topic) === created) open(topic, created);
          });
        } else {
          open(topic, created);
        }
        entry = created;
      }
      const joined = entry;
      const listener: ChannelListener = { event: event.toLowerCase(), handler };
      joined.listeners.add(listener);
      return () => {
        joined.listeners.delete(listener);
        if (joined.listeners.size === 0) queueMicrotask(() => release(topic, joined));
      };
    },
  };
}

export type ResyncSource = {
  /** Whatever function this source would run right now — what sources are deduped by. */
  getHandler(): unknown;
  run(): void;
  /** Resync the moment the tab is visible again: no jitter, no minimum interval. */
  immediate?: boolean;
};

/**
 * The tab-focus-regain safety net for every useRealtimeEvent instance at
 * once. Each instance used to run its own handler the instant the tab
 * became visible, so foregrounding the app on Home fired ~10 requests in
 * the same tick (and /api/badge-counts twice — one refetch registered on
 * two channels). trigger() instead runs each distinct handler once, spread
 * over `maxJitterMs`, and never the same handler twice within
 * `minIntervalMs` — a handler that ran more recently than that is deferred
 * to the end of its interval rather than dropped, so a signal missed during
 * a quick hide/show still gets its resync.
 *
 * A source marked `immediate` (calls: a ring only lasts so long) skips both
 * the jitter and the minimum interval — its handler runs on every trigger,
 * still once however many sources share it, and ahead of any deferred run
 * of that same handler already waiting.
 */
export function createResyncScheduler({
  minIntervalMs,
  maxJitterMs,
  isVisible,
  random = Math.random,
}: {
  minIntervalMs: number;
  maxJitterMs: number;
  isVisible: () => boolean;
  random?: () => number;
}) {
  const sources = new Set<ResyncSource>();
  const pending = new Map<unknown, { timer: ReturnType<typeof setTimeout>; immediate: boolean }>();
  const lastRunAt = new Map<unknown, number>();

  return {
    add(source: ResyncSource): () => void {
      sources.add(source);
      return () => {
        sources.delete(source);
      };
    },
    trigger() {
      const now = Date.now();
      for (const [handler, ranAt] of lastRunAt) {
        if (now - ranAt >= minIntervalMs) lastRunAt.delete(handler);
      }
      const immediateHandlers = new Set<unknown>();
      for (const source of sources) {
        if (source.immediate) immediateHandlers.add(source.getHandler());
      }
      for (const source of sources) {
        const handler = source.getHandler();
        const immediate = immediateHandlers.has(handler);
        const queued = pending.get(handler);
        if (queued) {
          if (!immediate || queued.immediate) continue;
          clearTimeout(queued.timer);
        }
        const ranAt = lastRunAt.get(handler);
        const wait = ranAt === undefined ? 0 : ranAt + minIntervalMs - now;
        const timer = setTimeout(
          () => {
            pending.delete(handler);
            // Gone, or backgrounded again before its turn came — the next
            // time the tab becomes visible schedules it afresh.
            if (!sources.has(source) || !isVisible()) return;
            lastRunAt.set(handler, Date.now());
            source.run();
          },
          immediate ? 0 : wait + random() * maxJitterMs,
        );
        pending.set(handler, { timer, immediate });
      }
    },
  };
}

/**
 * Turns a burst of "something changed" signals into at most one `run` per
 * `cooldownMs`, each started a random 0..`maxDelayMs` after the signal that
 * asked for it. For a channel every client hears at once (home-feed:*),
 * where reacting immediately would have every open tab hit the server in
 * the same instant for every single signal. Signals arriving while a run is
 * already scheduled are absorbed by it; one arriving while a run is in
 * flight (too late for that run's own query to have seen whatever it's
 * about) or during the cooldown gets a single follow-up run once the
 * cooldown ends.
 */
export function createSignalThrottle(
  run: () => unknown,
  {
    maxDelayMs,
    cooldownMs,
    random = Math.random,
  }: { maxDelayMs: number; cooldownMs: number; random?: () => number },
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastStartedAt: number | null = null;
  let inFlight = false;
  let signalledInFlight = false;
  let cancelled = false;

  function schedule() {
    const cooldownLeft = lastStartedAt === null ? 0 : lastStartedAt + cooldownMs - Date.now();
    timer = setTimeout(start, Math.max(random() * maxDelayMs, cooldownLeft));
  }

  function start() {
    timer = null;
    lastStartedAt = Date.now();
    inFlight = true;
    Promise.resolve()
      .then(run)
      .catch(() => undefined)
      .then(() => {
        inFlight = false;
        if (signalledInFlight && !cancelled) schedule();
        signalledInFlight = false;
      });
  }

  return {
    signal() {
      if (cancelled || timer !== null) return;
      if (inFlight) signalledInFlight = true;
      else schedule();
    },
    cancel() {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

function supabaseTransport(supabase: SupabaseClient): RealtimeTransport {
  return {
    open(topic, onBroadcast, onStatus) {
      const sub = supabase
        .channel(topic)
        .on("broadcast", { event: "*" }, ({ event, payload }) => onBroadcast(event, payload))
        .subscribe(onStatus);
      return () => supabase.removeChannel(sub);
    },
  };
}

let cachedRegistry: ReturnType<typeof createChannelRegistry> | null = null;

function registry(supabase: SupabaseClient) {
  cachedRegistry ??= createChannelRegistry(supabaseTransport(supabase), (topic, status, err) => {
    captureError(err ?? new Error(`Realtime channel ${status}`), {
      hook: "useRealtimeEvent",
      channel: topic,
      status,
    });
  });
  return cachedRegistry;
}

// A handler that already resynced this recently isn't run again yet — long
// enough to absorb an app-switcher flick back and forth, short enough that
// a real return to the app still resyncs promptly.
const RESYNC_MIN_INTERVAL_MS = 10_000;
// Spreads the resyncs of everything mounted on one page (and of every
// client that foregrounds at the same moment, e.g. off one push
// notification) instead of firing them all in the same tick.
const RESYNC_MAX_JITTER_MS = 2_000;

const resync = createResyncScheduler({
  minIntervalMs: RESYNC_MIN_INTERVAL_MS,
  maxJitterMs: RESYNC_MAX_JITTER_MS,
  isVisible: () => document.visibilityState === "visible",
});

let listeningForVisibility = false;

function addResyncSource(source: ResyncSource) {
  if (!listeningForVisibility) {
    listeningForVisibility = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resync.trigger();
    });
  }
  return resync.add(source);
}

/**
 * Subscribes to one broadcast event on one channel for the lifetime of the
 * calling component — the direct replacement for usePolling across this
 * app (see src/lib/realtime-server.ts's own doc comment for the "signal
 * only, never sensitive payload" design this pairs with). `handler` fires
 * with the broadcast payload whenever the matching server-side
 * publishEvent() call lands; treat that as "something changed" and re-run
 * whatever already-authorized fetch (a Server Action/API route) used to
 * live behind the poll tick — this hook is the trigger, not the data
 * source.
 *
 * Also calls `handler(null)` once whenever the tab regains visibility — a
 * one-shot resync, not a repeating timer — as a safety net against an
 * event missed while the WebSocket was disconnected (backgrounded mobile
 * WebView, a brief network drop). Callers can tell "a real event, with a
 * payload" apart from "just in case, go check" by whether payload is null.
 * That resync is shared across every instance of this hook (see
 * createResyncScheduler): it lands up to RESYNC_MAX_JITTER_MS after the
 * tab becomes visible, and a function passed as `handler` to several
 * instances at once resyncs once, not once per instance. Pass
 * `{ resync: "immediate" }` where that delay is itself the problem (the
 * call checks: opening the app mid-ring has to show the ring now) — that
 * handler then resyncs the instant the tab is visible, every time.
 *
 * Any number of components can subscribe to the same channel — they share
 * one underlying Supabase channel (see createChannelRegistry).
 *
 * `channel` may be null to skip subscribing entirely (e.g. before the
 * relevant id — a conversationId, a liveStreamId — is known yet).
 */
export function useRealtimeEvent<T = unknown>(
  channel: string | null,
  event: string,
  handler: (payload: T | null) => void,
  { resync: resyncMode = "jittered" }: { resync?: "jittered" | "immediate" } = {},
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const supabase = client();
    if (!supabase || !channel) return undefined;

    // REAL BUG fixed here (confirmed live via Sentry: an unhandled
    // "TypeError: Load failed" on iOS Safari, /messages): `handler` is
    // typed as returning void, but almost every real caller passes an
    // async refetch function, which returns a Promise at runtime
    // regardless of what the type says. Calling it bare, with no
    // await/catch, meant a rejection — e.g. a Server Action's own fetch
    // aborting because the app was just backgrounded/foregrounded, exactly
    // what the visibility-regain resync below triggers on — became an
    // unhandled promise rejection that crashed as a reported error instead
    // of the transient, self-recovering blip it actually is (the next real
    // broadcast or visibility change just tries again).
    function invokeHandler(payload: T | null) {
      try {
        Promise.resolve(handlerRef.current(payload)).catch((err) => {
          captureError(err, { hook: "useRealtimeEvent", channel, event });
        });
      } catch (err) {
        captureError(err, { hook: "useRealtimeEvent", channel, event });
      }
    }

    const unsubscribe = registry(supabase).subscribe(channel, event, (payload) => invokeHandler(payload as T));
    const removeResyncSource = addResyncSource({
      getHandler: () => handlerRef.current,
      run: () => invokeHandler(null),
      immediate: resyncMode === "immediate",
    });

    return () => {
      removeResyncSource();
      unsubscribe();
    };
  }, [channel, event, resyncMode]);
}
