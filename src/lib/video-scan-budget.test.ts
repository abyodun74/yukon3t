import { describe, expect, it } from "vitest";
import {
  budgetRemainingMs,
  emptyKindSummary,
  formatVideoScanRunSummary,
  HIVE_ACCOUNT_COOLDOWN_MS,
  HIVE_COOLDOWN_MAX_MS,
  HIVE_RATE_LIMIT_COOLDOWN_MS,
  hiveCallTimeoutMs,
  hiveCooldownActive,
  hiveCooldownAfter,
  nextCallStart,
  parseHiveCooldown,
  roundRobin,
  runRotation,
  timeoutCountsAgainstVideo,
  VIDEO_SCAN_CONCURRENCY,
  VIDEO_SCAN_FAIR_TIMEOUT_MS,
  VIDEO_SCAN_MIN_CALL_MS,
  VIDEO_SCAN_MIN_START_GAP_MS,
  VIDEO_SCAN_PER_KIND_CAP,
  VIDEO_SCAN_RUN_BUDGET_MS,
  type HiveCooldown,
} from "@/lib/video-scan-budget";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

describe("run budget", () => {
  it("counts down from the start and never goes negative", () => {
    expect(budgetRemainingMs(NOW, NOW)).toBe(VIDEO_SCAN_RUN_BUDGET_MS);
    expect(budgetRemainingMs(NOW, NOW + 5_000, 20_000)).toBe(15_000);
    expect(budgetRemainingMs(NOW, NOW + 25_000, 20_000)).toBe(0);
  });

  it("gives a call min(Hive's cap, what is left), and none when too little is left", () => {
    expect(hiveCallTimeoutMs(20_000, { maxMs: 30_000 })).toBe(20_000);
    expect(hiveCallTimeoutMs(45_000, { maxMs: 30_000 })).toBe(30_000);
    expect(hiveCallTimeoutMs(VIDEO_SCAN_MIN_CALL_MS, { maxMs: 30_000 })).toBe(VIDEO_SCAN_MIN_CALL_MS);
    expect(hiveCallTimeoutMs(VIDEO_SCAN_MIN_CALL_MS - 1, { maxMs: 30_000 })).toBeNull();
    expect(hiveCallTimeoutMs(0, { maxMs: 30_000 })).toBeNull();
  });

  it("counts a timeout against the video only when the call had a fair amount of time", () => {
    expect(timeoutCountsAgainstVideo(20_000)).toBe(true);
    expect(timeoutCountsAgainstVideo(15_000)).toBe(true);
    expect(timeoutCountsAgainstVideo(9_000)).toBe(false);
  });
});

describe("VLM concurrency and pacing", () => {
  it("runs three calls at once, inside the 20s budget, with a fair 15s call", () => {
    expect(VIDEO_SCAN_CONCURRENCY).toBe(3);
    expect(VIDEO_SCAN_RUN_BUDGET_MS).toBeLessThanOrEqual(25_000); // Netlify cut a ~30s run; keep the tail margin
    expect(VIDEO_SCAN_FAIR_TIMEOUT_MS).toBeLessThanOrEqual(VIDEO_SCAN_RUN_BUDGET_MS); // a first-wave call is fair
    expect(VIDEO_SCAN_FAIR_TIMEOUT_MS).toBeGreaterThanOrEqual(12_000); // a ~10-12s 30-frame call fits
    expect(VIDEO_SCAN_MIN_CALL_MS).toBeLessThan(VIDEO_SCAN_FAIR_TIMEOUT_MS);
  });

  it("reads about what three workers can finish in one run", () => {
    expect(VIDEO_SCAN_PER_KIND_CAP * 3).toBeLessThanOrEqual(VIDEO_SCAN_CONCURRENCY * 3);
  });

  it("starts calls at most 4 per second (Hive allows 5)", () => {
    expect(1000 / VIDEO_SCAN_MIN_START_GAP_MS).toBeLessThan(5);
    let last: number | null = null;
    const starts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const slot = nextCallStart(last, NOW); // six workers asking in the same instant
      last = slot.startMs;
      starts.push(slot.startMs);
      expect(slot.waitMs).toBe(slot.startMs - NOW);
    }
    expect(starts).toEqual([0, 1, 2, 3, 4, 5].map((i) => NOW + i * VIDEO_SCAN_MIN_START_GAP_MS));
    const inAnySecond = (t: number) => starts.filter((s) => s >= t && s < t + 1000).length;
    for (const s of starts) expect(inAnySecond(s)).toBeLessThan(5);
  });

  it("does not wait once the gap has passed", () => {
    expect(nextCallStart(NOW, NOW + 5_000)).toEqual({ startMs: NOW + 5_000, waitMs: 0 });
    expect(nextCallStart(null, NOW)).toEqual({ startMs: NOW, waitMs: 0 });
  });
});

describe("roundRobin", () => {
  it("takes the kinds in turn, each list kept in its own (oldest-first) order", () => {
    expect(roundRobin([["p1", "p2", "p3"], ["c1"], ["m1", "m2"]])).toEqual(["p1", "c1", "m1", "p2", "m2", "p3"]);
  });

  it("rotates which kind goes first", () => {
    const lists = [["p1", "p2"], ["c1", "c2"], ["m1", "m2"]];
    expect(roundRobin(lists, 1)).toEqual(["c1", "m1", "p1", "c2", "m2", "p2"]);
    expect(roundRobin(lists, 2)).toEqual(["m1", "p1", "c1", "m2", "p2", "c2"]);
    expect(roundRobin(lists, 3)).toEqual(roundRobin(lists, 0));
    expect(roundRobin(lists, -1)).toEqual(roundRobin(lists, 2));
  });

  it("handles empty input", () => {
    expect(roundRobin([])).toEqual([]);
    expect(roundRobin([[], [], []])).toEqual([]);
  });

  it("rotates per 5-minute tick", () => {
    const tick = Math.floor(NOW / (5 * MIN)) * 5 * MIN;
    const r = runRotation(tick);
    expect(runRotation(tick + 4 * MIN)).toBe(r);
    expect(runRotation(tick + 5 * MIN)).toBe((r + 1) % 3);
  });
});

describe("hiveCooldownAfter", () => {
  it("backs off 15 minutes after a first 429, doubling for 429s in a row, capped at 60", () => {
    const first = hiveCooldownAfter({ failure: "rate_limited", nowMs: NOW, previous: null })!;
    expect(first).toEqual({ untilMs: NOW + HIVE_RATE_LIMIT_COOLDOWN_MS, failure: "rate_limited", streak: 1, setAtMs: NOW });
    const t2 = first.untilMs + 5 * MIN;
    const second = hiveCooldownAfter({ failure: "rate_limited", nowMs: t2, previous: first })!;
    expect(second.streak).toBe(2);
    expect(second.untilMs - t2).toBe(30 * MIN);
    const t3 = second.untilMs + MIN;
    const third = hiveCooldownAfter({ failure: "rate_limited", nowMs: t3, previous: second })!;
    expect(third.untilMs - t3).toBe(HIVE_COOLDOWN_MAX_MS);
    const fourth = hiveCooldownAfter({ failure: "rate_limited", nowMs: third.untilMs, previous: third })!;
    expect(fourth.untilMs - third.untilMs).toBe(HIVE_COOLDOWN_MAX_MS);
  });

  it("starts over when the last cooldown ended long ago", () => {
    const old: HiveCooldown = { untilMs: NOW - 3 * 60 * MIN, failure: "rate_limited", streak: 4, setAtMs: 0 };
    expect(hiveCooldownAfter({ failure: "rate_limited", nowMs: NOW, previous: old })!.streak).toBe(1);
  });

  it("honours a long Retry-After, ignores a short one, and caps it", () => {
    const at = (s: number) => hiveCooldownAfter({ failure: "rate_limited", retryAfterSeconds: s, nowMs: NOW, previous: null })!;
    expect(at(40 * 60).untilMs - NOW).toBe(40 * MIN);
    expect(at(30).untilMs - NOW).toBe(HIVE_RATE_LIMIT_COOLDOWN_MS);
    expect(at(6 * 60 * 60).untilMs - NOW).toBe(HIVE_COOLDOWN_MAX_MS);
  });

  it("backs off longer (but not forever) for a refused or out-of-credit key", () => {
    for (const failure of ["out_of_credit", "unauthorized"] as const) {
      const c = hiveCooldownAfter({ failure, nowMs: NOW, previous: null })!;
      expect(c.untilMs - NOW).toBe(HIVE_ACCOUNT_COOLDOWN_MS);
      expect(c.untilMs - NOW).toBeLessThanOrEqual(HIVE_COOLDOWN_MAX_MS);
    }
  });

  it("sets none for brief provider errors, a missing key or per-video failures", () => {
    for (const failure of ["provider_error", "unreachable", "not_configured", "rejected_media", "timeout", "bad_response"] as const) {
      expect(hiveCooldownAfter({ failure, nowMs: NOW, previous: null }), failure).toBeNull();
    }
  });

  it("is active only until it ends, and reads stored records defensively", () => {
    const c: HiveCooldown = { untilMs: NOW + MIN, failure: "rate_limited", streak: 1, setAtMs: NOW };
    expect(hiveCooldownActive(c, NOW)).toBe(true);
    expect(hiveCooldownActive(c, NOW + MIN)).toBe(false);
    expect(hiveCooldownActive(null, NOW)).toBe(false);
    expect(parseHiveCooldown(JSON.stringify(c))).toEqual(c);
    expect(parseHiveCooldown(c)).toEqual(c);
    expect(parseHiveCooldown("not json")).toBeNull();
    expect(parseHiveCooldown({ untilMs: "soon" })).toBeNull();
    expect(parseHiveCooldown(null)).toBeNull();
  });
});

describe("formatVideoScanRunSummary", () => {
  it("is one line with counts per kind, stop reason, budget and cooldown, and no ids or URLs", () => {
    const kinds = { post: emptyKindSummary(), comment: emptyKindSummary(), muse: emptyKindSummary() };
    kinds.post.checked = 2;
    kinds.post.cleared = 1;
    kinds.post.failed = 1;
    const line = formatVideoScanRunSummary(
      {
        kinds,
        stoppedBy: "rate_limited",
        budgetUsedMs: 3_210,
        budgetMs: 20_000,
        unclaimed: 0,
        cooldown: { action: "set", failure: "rate_limited", untilMs: NOW + 15 * MIN, store: "redis" },
      },
      NOW,
    );
    expect(line).not.toContain("\n");
    expect(line).toContain("posts checked=2 cleared=1 flagged=0 unsure=0 failed=1 held=0");
    expect(line).toContain("muses checked=0");
    expect(line).toContain("stoppedBy=rate_limited budgetMs=3210/20000 unclaimed=0 cooldown=set(rate_limited, 15m left, redis)");
  });
});
