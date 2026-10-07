import { describe, it, expect } from "vitest";
import { nextOccurrence, formatScheduleDays, formatScheduleTime } from "@/lib/collab-schedule";

describe("nextOccurrence", () => {
  it("returns null when there's no schedule", () => {
    expect(nextOccurrence([], "18:00", new Date("2026-10-07T00:00:00Z"))).toBeNull();
  });

  // 2026-10-07 is a Wednesday (UTC).
  it("finds a later day in the same week", () => {
    // Wed 2026-10-07 09:00 UTC, schedule is Fri (5) at 18:00.
    const from = new Date("2026-10-07T09:00:00Z");
    const next = nextOccurrence([5], "18:00", from);
    expect(next?.toISOString()).toBe("2026-10-09T18:00:00.000Z");
  });

  it("rolls over to next week when today's time has already passed", () => {
    // Wed 2026-10-07 20:00 UTC, schedule is Wed (3) at 18:00 — already passed today.
    const from = new Date("2026-10-07T20:00:00Z");
    const next = nextOccurrence([3], "18:00", from);
    expect(next?.toISOString()).toBe("2026-10-14T18:00:00.000Z");
  });

  it("lands later today when today's time hasn't passed yet", () => {
    // Wed 2026-10-07 09:00 UTC, schedule is Wed (3) at 18:00 — still ahead today.
    const from = new Date("2026-10-07T09:00:00Z");
    const next = nextOccurrence([3], "18:00", from);
    expect(next?.toISOString()).toBe("2026-10-07T18:00:00.000Z");
  });

  it("picks the soonest of several scheduled days", () => {
    // Wed 2026-10-07 09:00 UTC, schedule is Mon/Wed/Fri — Wed later today wins.
    const from = new Date("2026-10-07T09:00:00Z");
    const next = nextOccurrence([1, 3, 5], "18:00", from);
    expect(next?.toISOString()).toBe("2026-10-07T18:00:00.000Z");
  });

  it("is always strictly after `from`, never equal to it", () => {
    const from = new Date("2026-10-07T18:00:00.000Z");
    const next = nextOccurrence([3], "18:00", from);
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
    expect(next?.toISOString()).toBe("2026-10-14T18:00:00.000Z");
  });
});

describe("formatScheduleDays", () => {
  it("sorts into week order regardless of selection order", () => {
    expect(formatScheduleDays([5, 1, 3])).toBe("Monday, Wednesday, Friday");
  });

  it("handles a single day", () => {
    expect(formatScheduleDays([0])).toBe("Sunday");
  });
});

describe("formatScheduleTime", () => {
  it("formats midnight and noon correctly", () => {
    expect(formatScheduleTime("00:00")).toBe("12:00 AM");
    expect(formatScheduleTime("12:00")).toBe("12:00 PM");
  });

  it("formats an afternoon time", () => {
    expect(formatScheduleTime("18:05")).toBe("6:05 PM");
  });

  it("formats a morning time", () => {
    expect(formatScheduleTime("09:30")).toBe("9:30 AM");
  });
});
