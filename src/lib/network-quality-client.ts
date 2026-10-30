"use client";

import { useSyncExternalStore } from "react";
import {
  DATA_SAVER_STORAGE_KEY,
  addLatencySample,
  classifyNetwork,
  isLatencyProbeUrl,
  medianLatency,
  parseDataSaverPreference,
  type DataSaverPreference,
  type LatencySample,
  type NetworkQuality,
} from "@/lib/network-quality";
import { fetchWithRetry, type FetchRetryOptions } from "@/lib/fetch-retry";

// The browser half of network-quality.ts: one module-level store (not one
// per component) fed by the online/offline events, navigator.connection's
// "change" event where it exists (Chrome/Android WebView; iOS has none, so
// there the observed latency and the Data saver setting are what count),
// a PerformanceObserver timing our own light same-origin requests, and the
// Data saver setting itself (localStorage, per device — synced across tabs
// through the "storage" event). Components read it with useNetworkQuality();
// non-React code with getNetworkQuality().

type NetworkInformationLike = EventTarget & {
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
  rtt?: number;
};

function connection(): NetworkInformationLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection ?? null;
}

function readPreference(): DataSaverPreference {
  try {
    return parseDataSaverPreference(window.localStorage.getItem(DATA_SAVER_STORAGE_KEY));
  } catch {
    // Storage blocked (private mode, a locked-down WebView): the default.
    return "auto";
  }
}

const listeners = new Set<() => void>();
let samples: LatencySample[] = [];
let preference: DataSaverPreference | null = null;
let quality: NetworkQuality = "good";
let started = false;
let retrying = 0;
const retryListeners = new Set<() => void>();

function compute(): NetworkQuality {
  const conn = connection();
  return classifyNetwork(
    {
      online: navigator.onLine,
      effectiveType: conn?.effectiveType ?? null,
      saveData: conn?.saveData ?? null,
      downlinkMbps: conn?.downlink ?? null,
      rttMs: conn?.rtt ?? null,
      observedLatencyMs: medianLatency(samples, Date.now()),
    },
    preference ?? "auto",
  );
}

function refresh() {
  const next = compute();
  if (next === quality) return;
  quality = next;
  for (const listener of listeners) listener();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  preference = readPreference();
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  window.addEventListener("storage", (event) => {
    if (event.key !== DATA_SAVER_STORAGE_KEY) return;
    preference = parseDataSaverPreference(event.newValue);
    refresh();
  });
  connection()?.addEventListener?.("change", refresh);
  // Coming back to the app is when an old measurement is most likely stale
  // (a different network by now): re-evaluate, which also ages samples out.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          // responseStart is 0 for a request that never got a response
          // (aborted, failed) — fetchWithRetryClient records those itself.
          if (entry.responseStart <= 0 || !isLatencyProbeUrl(entry.name, location.origin)) continue;
          recordLatencySample(entry.responseStart - entry.startTime);
        }
      });
      observer.observe({ type: "resource", buffered: true });
    } catch {
      // No resource timing in this WebView: the connection hints still work.
    }
  }
  quality = compute();
}

/** Feeds one observed request time (ms until response headers, or until it timed out) into the latency median. */
function recordLatencySample(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  samples = addLatencySample(samples, { at: Date.now(), ms });
  refresh();
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Calls `listener` whenever the answer changes (outside React; components use useNetworkQuality). Returns the unsubscribe. */
export function onNetworkQualityChange(listener: () => void): () => void {
  return subscribe(listener);
}

/** The current answer, for code outside React (an effect, a fetch helper). "good" on the server. */
export function getNetworkQuality(): NetworkQuality {
  if (typeof window === "undefined") return "good";
  start();
  return quality;
}

/**
 * "good" | "slow" | "offline". Server-rendered as "good" (the server can't
 * know), so the first client render matches and anything adaptive switches
 * right after hydration.
 */
export function useNetworkQuality(): NetworkQuality {
  return useSyncExternalStore(subscribe, () => quality, () => "good");
}

function getDataSaverPreference(): DataSaverPreference {
  if (typeof window === "undefined") return "auto";
  start();
  return preference ?? "auto";
}

export function setDataSaverPreference(next: DataSaverPreference) {
  start();
  preference = next;
  try {
    if (next === "auto") window.localStorage.removeItem(DATA_SAVER_STORAGE_KEY);
    else window.localStorage.setItem(DATA_SAVER_STORAGE_KEY, next);
  } catch {
    // Not persisted (storage blocked) — still applies until the app is closed.
  }
  // The setting component re-renders off this too, so notify even when the
  // resulting quality doesn't change.
  quality = compute();
  for (const listener of listeners) listener();
}

export function useDataSaverPreference(): DataSaverPreference {
  return useSyncExternalStore(subscribe, getDataSaverPreference, () => "auto");
}

// --- "Slow connection — retrying" indicator -------------------------------

function subscribeRetrying(listener: () => void) {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

function setRetrying(delta: number) {
  retrying = Math.max(0, retrying + delta);
  for (const listener of retryListeners) listener();
}

/** True while any fetchWithRetryClient call is between a failed attempt and its outcome. */
export function useIsRetrying(): boolean {
  return useSyncExternalStore(subscribeRetrying, () => retrying > 0, () => false);
}

function waitUntilOnline(): Promise<void> {
  if (navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("online", done);
      clearTimeout(cap);
      resolve();
    };
    // Don't wait forever on a navigator.onLine that's wrong (it can be):
    // the next attempt itself is the real test.
    const cap = setTimeout(done, 60_000);
    window.addEventListener("online", done);
  });
}

// A slow link legitimately takes longer to answer; give it more time before
// calling an attempt dead, rather than aborting a request that was arriving.
const TIMEOUT_GOOD_MS = 15_000;
const TIMEOUT_SLOW_MS = 30_000;

/**
 * fetchWithRetry (fetch-retry.ts) wired to this device: per-attempt timeout
 * by network quality, retries held until the device is back online, every
 * attempt's time fed into the latency median, and the app-wide "retrying"
 * indicator shown while a retry is pending — unless `silent`, for a
 * background refresh the reader didn't ask for and isn't waiting on (badge
 * counts, new-posts check), which shouldn't put anything on screen. For
 * idempotent reads only — a non-GET request is sent once, exactly like
 * fetch().
 */
export async function fetchWithRetryClient(
  input: string,
  init: RequestInit = {},
  { silent = false, ...options }: Omit<FetchRetryOptions, "waitUntilReady" | "onRetry" | "onSample"> & { silent?: boolean } = {},
): Promise<Response> {
  let retried = false;
  try {
    return await fetchWithRetry(input, init, {
      timeoutMs: getNetworkQuality() === "slow" ? TIMEOUT_SLOW_MS : TIMEOUT_GOOD_MS,
      ...options,
      waitUntilReady: waitUntilOnline,
      onRetry: () => {
        if (!retried && !silent) {
          retried = true;
          setRetrying(1);
        }
      },
      onSample: (ms) => {
        // A timed-out attempt never produces a resource-timing entry, so the
        // observer above can't see it; a completed one it already counted.
        if (ms >= TIMEOUT_GOOD_MS) recordLatencySample(ms);
      },
    });
  } finally {
    if (retried) setRetrying(-1);
  }
}
