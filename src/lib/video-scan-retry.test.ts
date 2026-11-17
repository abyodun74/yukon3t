import { describe, it, expect } from "vitest";
import { nextAfterVideoScanFailure, VIDEO_SCAN_BACKOFF_MS, VIDEO_SCAN_MAX_ATTEMPTS } from "@/lib/video-scan-retry";

const now = new Date("2026-10-14T12:00:00Z");
const base = { now, moderationStatus: "PUBLISHED" as const };

describe("nextAfterVideoScanFailure", () => {
  it("backs off further after each failure", () => {
    const waits = VIDEO_SCAN_BACKOFF_MS.map((_, failuresSoFar) => {
      const next = nextAfterVideoScanFailure({ ...base, failuresSoFar });
      expect(next.kind).toBe("retry");
      return next.kind === "retry" ? next.retryAt.getTime() - now.getTime() : 0;
    });
    expect(waits).toEqual(VIDEO_SCAN_BACKOFF_MS);
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1]);
  });

  it("gives up on Hive after the last attempt and holds a published video for an admin (never the Stream review)", () => {
    expect(nextAfterVideoScanFailure({ ...base, failuresSoFar: VIDEO_SCAN_MAX_ATTEMPTS - 1 })).toEqual({
      kind: "hold_for_admin",
    });
  });

  it("also records an admin hold for a video that is already hidden", () => {
    expect(
      nextAfterVideoScanFailure({ ...base, moderationStatus: "FLAGGED", failuresSoFar: VIDEO_SCAN_MAX_ATTEMPTS - 1 }),
    ).toEqual({ kind: "hold_for_admin" });
  });

  it("just stops for a video that was already removed", () => {
    expect(
      nextAfterVideoScanFailure({ ...base, moderationStatus: "REMOVED", failuresSoFar: VIDEO_SCAN_MAX_ATTEMPTS - 1 }),
    ).toEqual({ kind: "stop" });
  });

  it("keeps giving up if a count somehow passed the cap", () => {
    expect(nextAfterVideoScanFailure({ ...base, failuresSoFar: VIDEO_SCAN_MAX_ATTEMPTS + 5 })).toEqual({
      kind: "hold_for_admin",
    });
  });
});
