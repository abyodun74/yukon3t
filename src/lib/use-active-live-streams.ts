"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getActiveLiveStreams } from "@/app/actions/live-streams";
import { createSignalThrottle, useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { LIVE_LIST_SIGNAL_COOLDOWN_MS, LIVE_LIST_SIGNAL_MAX_DELAY_MS } from "@/lib/live-stream-signal";

export type ActiveLiveStream = Awaited<ReturnType<typeof getActiveLiveStreams>>["streams"][number];

/**
 * Home's list of public live streams, shared by every component that shows it (the "Live now" strip and the feed
 * cards): one fetch per change for the whole tab, not one per component.
 *
 * The `live-streams` signal is global: every start and end anywhere reaches every open Home tab at the same
 * instant. Each refetch used to run immediately, in every component, so several people going live together meant
 * (streams started) x (open Home tabs) x 2 simultaneous getActiveLiveStreams calls, landing on the database right
 * while those hosts' own starts were being written. Signals now go through createSignalThrottle (a random wait of
 * up to LIVE_LIST_SIGNAL_MAX_DELAY_MS, then at most one fetch per LIVE_LIST_SIGNAL_COOLDOWN_MS however many streams
 * start or end meanwhile). The tab-focus resync (null payload, already spread out by useRealtimeEvent) and the
 * first mount fetch right away; concurrent fetches are deduplicated.
 */
const EMPTY: ActiveLiveStream[] = [];
let current: ActiveLiveStream[] = EMPTY;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function load(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = getActiveLiveStreams()
    .then(({ streams }) => {
      current = streams;
      for (const listener of listeners) listener();
    })
    // A transient failure keeps the last list; the next signal or foreground tries again.
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

let throttle: ReturnType<typeof createSignalThrottle> | null = null;

// Module-level and stable, so useRealtimeEvent's shared resync runs it once per tab however many components use it.
function handleLiveStreamsSignal(payload: unknown) {
  if (payload === null) return load();
  throttle ??= createSignalThrottle(load, {
    maxDelayMs: LIVE_LIST_SIGNAL_MAX_DELAY_MS,
    cooldownMs: LIVE_LIST_SIGNAL_COOLDOWN_MS,
  });
  throttle.signal();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveLiveStreams(): ActiveLiveStream[] {
  const streams = useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );
  // A subscription alone only reports new signals, not current state.
  useEffect(() => {
    void load();
  }, []);
  useRealtimeEvent(REALTIME_CHANNELS.liveStreams(), "changed", handleLiveStreamsSignal);
  return streams;
}
