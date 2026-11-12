import { describe, expect, it } from "vitest";
import {
  announceSweepAction,
  announcementKind,
  chunk,
  existingLiveDecision,
  LIVE_ANNOUNCE_MAX_AGE_MS,
  LIVE_ANNOUNCE_RETRY_AFTER_MS,
  LIVE_START_PENDING_STALE_MS,
  liveStartLockKey,
  runWithConcurrency,
} from "@/lib/live-stream-start";

const now = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("existingLiveDecision", () => {
  it("starts when the host has nothing live", () => {
    expect(existingLiveDecision(null, now)).toBe("start");
  });

  it("answers already_live for a working stream, however old", () => {
    expect(existingLiveDecision({ id: "s", roomName: "live-s", startedAt: ago(5 * 60 * 60_000) }, now)).toBe("already_live");
  });

  it("answers already_live for a start still attaching its room (the double tap)", () => {
    expect(existingLiveDecision({ id: "s", roomName: "", startedAt: ago(5_000) }, now)).toBe("already_live");
  });

  it("reclaims a start that died before its room was attached", () => {
    expect(existingLiveDecision({ id: "s", roomName: "", startedAt: ago(LIVE_START_PENDING_STALE_MS) }, now)).toBe("reclaim");
  });
});

describe("liveStartLockKey", () => {
  it("is per host, so different hosts never share a lock", () => {
    expect(liveStartLockKey("a")).not.toBe(liveStartLockKey("b"));
    expect(liveStartLockKey("a")).toBe(liveStartLockKey("a"));
  });
});

describe("announcementKind", () => {
  it("follows who the stream was started for", () => {
    expect(announcementKind({ targetUserId: "u", circleId: null })).toBe("invite");
    expect(announcementKind({ targetUserId: null, circleId: "c" })).toBe("circle");
    expect(announcementKind({ targetUserId: null, circleId: null })).toBe("subscribers");
  });
});

describe("announceSweepAction", () => {
  it("leaves fresh streams to the normal path, retries, then expires", () => {
    expect(announceSweepAction(ago(1_000), now)).toBe("wait");
    expect(announceSweepAction(ago(LIVE_ANNOUNCE_RETRY_AFTER_MS), now)).toBe("announce");
    expect(announceSweepAction(ago(LIVE_ANNOUNCE_MAX_AGE_MS), now)).toBe("announce");
    expect(announceSweepAction(ago(LIVE_ANNOUNCE_MAX_AGE_MS + 1), now)).toBe("expire");
  });
});

describe("chunk", () => {
  it("splits into batches of at most size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe("runWithConcurrency", () => {
  it("never runs more than the limit at once, visits every item, and survives failures", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      seen.push(n);
      if (n === 4) throw new Error("boom");
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
