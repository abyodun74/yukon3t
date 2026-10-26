// Pure rules behind useNetworkQuality (src/lib/network-quality-client.ts):
// how the browser's own connection hints, the user's Data saver setting and
// how long our own recent requests actually took combine into one answer —
// "good", "slow" or "offline" — that the rest of the app adapts to (no feed
// video autoplay, smaller feed pages, tap-to-load embeds, no session replay).
// No DOM access here so every rule is unit-testable in node.

export type NetworkQuality = "good" | "slow" | "offline";

/**
 * The per-device Data saver setting (Settings → Data saver). "auto" (the
 * default) follows the network; "on" always behaves as on a slow
 * connection; "off" never does (offline still counts as offline).
 */
export const DATA_SAVER_VALUES = ["auto", "on", "off"] as const;
export type DataSaverPreference = (typeof DATA_SAVER_VALUES)[number];
export const DATA_SAVER_STORAGE_KEY = "yk3-data-saver";

export function parseDataSaverPreference(value: unknown): DataSaverPreference {
  return (DATA_SAVER_VALUES as readonly unknown[]).includes(value) ? (value as DataSaverPreference) : "auto";
}

export type NetworkSignals = {
  online: boolean;
  /** navigator.connection.effectiveType ("slow-2g" | "2g" | "3g" | "4g"); absent on iOS/Safari/Firefox. */
  effectiveType?: string | null;
  /** navigator.connection.saveData — the OS/browser's own data saver. */
  saveData?: boolean | null;
  /** navigator.connection.downlink, Mbps (Chrome rounds it and reports 0 when it doesn't know). */
  downlinkMbps?: number | null;
  /** navigator.connection.rtt, ms (rounded to 25ms; 0 when unknown). */
  rttMs?: number | null;
  /** Median time-to-first-byte of our own recent requests, or null with too few samples (see medianLatency). */
  observedLatencyMs?: number | null;
};

const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g", "3g"]);
// Below ~1 Mbps a feed video or an embed's player script takes long enough
// to start that autoplaying it mostly just competes with the page itself.
export const SLOW_DOWNLINK_MBPS = 1;
// Chrome's own "3g" bucket starts around 400ms; 600ms leaves room for a
// congested-but-usable 4G/5G cell before calling it slow.
export const SLOW_RTT_MS = 600;
// Our own requests include server time (a cold function, a DB query), so the
// bar is higher than for a pure network RTT, and it's a median of several.
export const SLOW_OBSERVED_LATENCY_MS = 2_500;

export function classifyNetwork(signals: NetworkSignals, preference: DataSaverPreference = "auto"): NetworkQuality {
  if (!signals.online) return "offline";
  if (preference === "on") return "slow";
  if (preference === "off") return "good";
  if (signals.saveData) return "slow";
  if (signals.effectiveType && SLOW_EFFECTIVE_TYPES.has(signals.effectiveType)) return "slow";
  if (typeof signals.downlinkMbps === "number" && signals.downlinkMbps > 0 && signals.downlinkMbps < SLOW_DOWNLINK_MBPS) {
    return "slow";
  }
  if (typeof signals.rttMs === "number" && signals.rttMs >= SLOW_RTT_MS) return "slow";
  if (typeof signals.observedLatencyMs === "number" && signals.observedLatencyMs >= SLOW_OBSERVED_LATENCY_MS) {
    return "slow";
  }
  return "good";
}

export type LatencySample = { at: number; ms: number };

export const LATENCY_SAMPLE_LIMIT = 6;
export const LATENCY_MIN_SAMPLES = 3;
export const LATENCY_MAX_AGE_MS = 2 * 60_000;

/** Keeps the newest LATENCY_SAMPLE_LIMIT samples, oldest first. */
export function addLatencySample(samples: readonly LatencySample[], sample: LatencySample): LatencySample[] {
  const next = [...samples, sample];
  return next.length > LATENCY_SAMPLE_LIMIT ? next.slice(next.length - LATENCY_SAMPLE_LIMIT) : next;
}

/**
 * The median of the samples taken within the last LATENCY_MAX_AGE_MS, or
 * null with fewer than LATENCY_MIN_SAMPLES of them — one slow cold start
 * shouldn't flip the whole app into slow mode, and an old measurement says
 * nothing about the network the phone is on now.
 */
export function medianLatency(samples: readonly LatencySample[], now: number): number | null {
  const recent = samples.filter((s) => now - s.at <= LATENCY_MAX_AGE_MS).map((s) => s.ms).sort((a, b) => a - b);
  if (recent.length < LATENCY_MIN_SAMPLES) return null;
  const mid = Math.floor(recent.length / 2);
  return recent.length % 2 === 1 ? recent[mid]! : (recent[mid - 1]! + recent[mid]!) / 2;
}

/**
 * Which of our own same-origin requests say something about the network:
 * RSC navigations/prefetches (`_rsc`) and the light read-only API routes.
 * Server Actions (a POST to the page URL) are left out on purpose — some do
 * slow work server-side (moderation, AI classification) whatever the network.
 */
export function isLatencyProbeUrl(rawUrl: string, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.searchParams.has("_rsc")) return true;
  return (
    url.pathname === "/api/badge-counts" ||
    url.pathname === "/api/build-id" ||
    url.pathname === "/api/health" ||
    url.pathname.startsWith("/api/feed/")
  );
}

/** Home feed "load more" page size: the server's full page normally, half of it on a slow connection. */
export const FEED_PAGE_SIZE = 20;
export const FEED_PAGE_SIZE_SLOW = 10;
export function feedPageSize(quality: NetworkQuality): number {
  return quality === "slow" ? FEED_PAGE_SIZE_SLOW : FEED_PAGE_SIZE;
}

const FEED_PAGE_SIZE_MIN = 5;

/** The `limit` a feed load-more request asked for, clamped to 5..FEED_PAGE_SIZE (missing/garbage → the full page). */
export function parseFeedPageSize(raw: string | null): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return FEED_PAGE_SIZE;
  return Math.min(FEED_PAGE_SIZE, Math.max(FEED_PAGE_SIZE_MIN, n));
}
