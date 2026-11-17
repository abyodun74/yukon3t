// Run budget, candidate order, Hive cooldown and the summary log line for the moderate-videos cron
// (src/app/api/cron/moderate-videos/route.ts). Pure, unit-tested (video-scan-budget.test.ts).
//
// Why (production, 2026-11-16): the cron ran three 20-item batches in parallel, each a chain of synchronous 1-5s Hive
// calls with a 30s cap, so a run reached ~30s, right at Netlify's function limit (one invocation got a 504), and two
// ticks overlapped. When Hive then answered 429 to everything, every 5-minute tick re-claimed videos and hit 429 again.
// Now: one sequential pass over a few videos per kind, taken in turn, inside a fixed budget, and a provider-wide
// rate-limit / credit / key failure sets a cooldown during which runs don't call Hive at all.

import type { HiveFailure } from "@/lib/hive";
import type { VideoScanItemKind } from "@/lib/video-scan-diagnostics";

/** Wall time a run may spend starting Hive calls. Netlify cuts the function at ~30s; the rest is margin for the
 * post-call work (a failure HEAD of up to 3s, DB writes, Sentry) and the summary. */
export const VIDEO_SCAN_RUN_BUDGET_MS = 20_000;
/** Candidates read per kind per run (oldest first). Small on purpose: three kinds x this many, one at a time. */
export const VIDEO_SCAN_PER_KIND_CAP = 6;
/** A Hive call is not started with less than this left in the budget: it would most likely be cut short. */
export const VIDEO_SCAN_MIN_CALL_MS = 4_000;

/**
 * A Hive call given at least this long that still times out counts against the video (an ordinary `timeout`
 * failure; Hive normally answers in 1-5s). One given less was cut short by the run's budget: the video is handed back
 * without counting an attempt. Since a run's budget (20s) is below Hive's own 30s cap, "less than 30s" can't be the
 * test, or no timeout would ever count. The first call of a run always gets the full budget, and the first kind
 * rotates per tick, so a slow video at the head of its queue does get a fair call within three runs.
 */
export const VIDEO_SCAN_FAIR_TIMEOUT_MS = 15_000;

/** Whether a timeout after a call given `timeoutMs` is the video's (counted) or the budget's (handed back). */
export function timeoutCountsAgainstVideo(timeoutMs: number): boolean {
  return timeoutMs >= VIDEO_SCAN_FAIR_TIMEOUT_MS;
}

export const VIDEO_SCAN_KINDS: readonly VideoScanItemKind[] = ["post", "comment", "muse"];

/** Milliseconds left in a run that started at `startedAtMs`. Never negative. */
export function budgetRemainingMs(startedAtMs: number, nowMs: number, budgetMs = VIDEO_SCAN_RUN_BUDGET_MS): number {
  return Math.max(0, startedAtMs + budgetMs - nowMs);
}

/**
 * The timeout to give the next Hive call, or null when the budget can't fit one (the run stops claiming). A call
 * never runs past the end of the budget: min(Hive's own cap, what is left).
 */
export function hiveCallTimeoutMs(
  remainingMs: number,
  { maxMs, minMs = VIDEO_SCAN_MIN_CALL_MS }: { maxMs: number; minMs?: number },
): number | null {
  if (remainingMs < minMs) return null;
  return Math.min(maxMs, remainingMs);
}

/**
 * Interleaves per-kind candidate lists (each already oldest first) so no kind waits behind another: one of each kind
 * in turn. The kind that goes first rotates with `rotation` (the route passes the 5-minute tick number), so when the
 * budget only fits a couple of calls per run, each kind still gets the first slot every third run.
 */
export function roundRobin<T>(lists: readonly (readonly T[])[], rotation = 0): T[] {
  const n = lists.length;
  if (n === 0) return [];
  const start = ((Math.trunc(rotation) % n) + n) % n;
  const order = Array.from({ length: n }, (_, i) => lists[(start + i) % n]);
  const longest = Math.max(...order.map((l) => l.length));
  const out: T[] = [];
  for (let i = 0; i < longest; i++) {
    for (const list of order) if (i < list.length) out.push(list[i]);
  }
  return out;
}

/** The 5-minute tick a time falls in: the rotation for roundRobin. */
export function runRotation(nowMs: number, kinds = VIDEO_SCAN_KINDS.length): number {
  return Math.floor(nowMs / (5 * 60_000)) % kinds;
}

// --- Hive cooldown ---------------------------------------------------------------------------------------------

const MINUTE = 60_000;
/** First wait after a 429 (doubled for each 429 in a row, see hiveCooldownAfter). */
export const HIVE_RATE_LIMIT_COOLDOWN_MS = 15 * MINUTE;
/** A refused or out-of-credit key: nothing changes until someone acts, so check less often (but still check). */
export const HIVE_ACCOUNT_COOLDOWN_MS = 60 * MINUTE;
/** No cooldown is ever longer than this, so a fixed key or a reset quota is picked up within the hour. */
export const HIVE_COOLDOWN_MAX_MS = 60 * MINUTE;
/** Retry-After shorter than one cron tick changes nothing; below this the default wait applies. */
const RETRY_AFTER_FLOOR_MS = 5 * MINUTE;
/** A new cooldown counts as "in a row" with the last one if it starts within this of the last one's end. */
const STREAK_WINDOW_MS = 60 * MINUTE;

export type HiveCooldown = {
  /** When runs may call Hive again (ms since epoch). */
  untilMs: number;
  failure: HiveFailure;
  /** Cooldowns in a row for this failure (1 = first). */
  streak: number;
  setAtMs: number;
};

/**
 * The cooldown a provider-wide failure sets, or null for one that doesn't get one. Only failures that every
 * immediate retry would repeat back off: rate_limited (15 min, doubled per 429 in a row, or Hive's Retry-After when
 * longer), out_of_credit and unauthorized (60 min). not_configured makes no call, provider_error / unreachable are
 * usually brief, and per-video failures never get one. Every cooldown is capped at HIVE_COOLDOWN_MAX_MS, so Hive is
 * always tried again eventually.
 */
export function hiveCooldownAfter({
  failure,
  retryAfterSeconds,
  nowMs,
  previous,
}: {
  failure: HiveFailure;
  retryAfterSeconds?: number;
  nowMs: number;
  previous: HiveCooldown | null;
}): HiveCooldown | null {
  if (failure !== "rate_limited" && failure !== "out_of_credit" && failure !== "unauthorized") return null;
  const inARow = previous !== null && previous.failure === failure && nowMs - previous.untilMs <= STREAK_WINDOW_MS;
  const streak = inARow ? previous.streak + 1 : 1;
  let waitMs: number;
  if (failure === "rate_limited") {
    waitMs = HIVE_RATE_LIMIT_COOLDOWN_MS * 2 ** Math.min(streak - 1, 8);
    const retryAfterMs = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : 0;
    if (retryAfterMs >= RETRY_AFTER_FLOOR_MS) waitMs = Math.max(waitMs, retryAfterMs);
  } else {
    waitMs = HIVE_ACCOUNT_COOLDOWN_MS;
  }
  return { untilMs: nowMs + Math.min(waitMs, HIVE_COOLDOWN_MAX_MS), failure, streak, setAtMs: nowMs };
}

/** True while a stored cooldown says not to call Hive. A record that can't be read is treated as no cooldown. */
export function hiveCooldownActive(cooldown: HiveCooldown | null, nowMs: number): boolean {
  return cooldown !== null && Number.isFinite(cooldown.untilMs) && nowMs < cooldown.untilMs;
}

/** A stored record, validated (it comes from Redis or memory as JSON); null when it isn't one. */
export function parseHiveCooldown(value: unknown): HiveCooldown | null {
  const v = typeof value === "string" ? safeJson(value) : value;
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.untilMs !== "number" || typeof r.failure !== "string" || typeof r.setAtMs !== "number") return null;
  const streak = typeof r.streak === "number" && r.streak >= 1 ? Math.floor(r.streak) : 1;
  return { untilMs: r.untilMs, failure: r.failure as HiveFailure, streak, setAtMs: r.setAtMs };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- Summary line ----------------------------------------------------------------------------------------------

export type KindRunSummary = { checked: number; flagged: number; cleared: number; failed: number; heldForAdmin: number };

export type VideoScanStop =
  | "done" // ran out of candidates
  | "budget" // the time budget ran out (anything claimed and not scanned was handed back)
  | "cooldown" // a Hive cooldown was active: no call made
  | "error" // an unexpected exception ended the run
  | HiveFailure; // a provider-wide failure stopped it

export type VideoScanRunSummary = {
  kinds: Record<VideoScanItemKind, KindRunSummary>;
  stoppedBy: VideoScanStop;
  budgetUsedMs: number;
  budgetMs: number;
  /** Handed back unscanned because the budget ran out. */
  unclaimed: number;
  cooldown: { action: "set" | "skipped" | "none"; failure?: HiveFailure; untilMs?: number; store?: string };
};

export function emptyKindSummary(): KindRunSummary {
  return { checked: 0, flagged: 0, cleared: 0, failed: 0, heldForAdmin: 0 };
}

/** One log line: counts per kind, why the run stopped, budget used, cooldown. No ids, URLs or Hive text. */
export function formatVideoScanRunSummary(s: VideoScanRunSummary, nowMs: number): string {
  const kinds = VIDEO_SCAN_KINDS.map((k) => {
    const c = s.kinds[k];
    return `${k}s checked=${c.checked} cleared=${c.cleared} flagged=${c.flagged} failed=${c.failed} held=${c.heldForAdmin}`;
  }).join("; ");
  let cooldown = "none";
  if (s.cooldown.action !== "none") {
    const mins = s.cooldown.untilMs !== undefined ? Math.max(0, Math.ceil((s.cooldown.untilMs - nowMs) / MINUTE)) : 0;
    cooldown = `${s.cooldown.action}(${s.cooldown.failure ?? "?"}, ${mins}m left${s.cooldown.store ? `, ${s.cooldown.store}` : ""})`;
  }
  return (
    `[moderate-videos] summary: ${kinds}; stoppedBy=${s.stoppedBy} budgetMs=${s.budgetUsedMs}/${s.budgetMs}` +
    ` unclaimed=${s.unclaimed} cooldown=${cooldown}`
  );
}
