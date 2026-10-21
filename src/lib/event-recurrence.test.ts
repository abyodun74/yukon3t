import { describe, expect, it } from "vitest";
import {
  EVENT_SERIES_MAX_OCCURRENCES,
  EVENT_SERIES_ROLLOVER_DELAY_MS,
  buildSeriesRule,
  isSeriesDue,
  nextOccurrence,
  occurrenceAt,
  seriesDueCutoff,
  seriesOccurrences,
  type EventSeriesRule,
} from "@/lib/event-recurrence";

const anchor = new Date("2026-10-21T18:30:00.000Z");
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

describe("occurrenceAt", () => {
  it("is the anchor itself at index 0", () => {
    for (const f of ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const) expect(iso(occurrenceAt(anchor, f, 0))).toBe(iso(anchor));
  });

  it("adds exact 7 / 14 day steps in UTC (the UTC time of day never moves)", () => {
    expect(iso(occurrenceAt(anchor, "WEEKLY", 1))).toBe("2026-10-28T18:30:00.000Z");
    // Across the US/EU daylight-saving change in early November: still 18:30 UTC.
    expect(iso(occurrenceAt(anchor, "WEEKLY", 3))).toBe("2026-11-11T18:30:00.000Z");
    expect(iso(occurrenceAt(anchor, "BIWEEKLY", 2))).toBe("2026-11-18T18:30:00.000Z");
  });

  it("keeps the day of the month, rolling over the year", () => {
    expect(iso(occurrenceAt(anchor, "MONTHLY", 1))).toBe("2026-11-21T18:30:00.000Z");
    expect(iso(occurrenceAt(anchor, "MONTHLY", 3))).toBe("2027-01-21T18:30:00.000Z");
    expect(iso(occurrenceAt(anchor, "MONTHLY", 14))).toBe("2027-12-21T18:30:00.000Z");
  });

  it("uses the month's last day when it is shorter, without drifting afterwards", () => {
    const jan31 = new Date("2027-01-31T09:00:00.000Z");
    expect(iso(occurrenceAt(jan31, "MONTHLY", 1))).toBe("2027-02-28T09:00:00.000Z");
    expect(iso(occurrenceAt(jan31, "MONTHLY", 2))).toBe("2027-03-31T09:00:00.000Z");
    expect(iso(occurrenceAt(jan31, "MONTHLY", 3))).toBe("2027-04-30T09:00:00.000Z");
    // Leap year.
    expect(iso(occurrenceAt(new Date("2028-01-30T09:00:00.000Z"), "MONTHLY", 1))).toBe("2028-02-29T09:00:00.000Z");
  });
});

describe("buildSeriesRule", () => {
  it("accepts a count of 2 to 12", () => {
    expect(buildSeriesRule(anchor, { frequency: "WEEKLY", count: 2 })).toEqual({
      rule: { frequency: "WEEKLY", anchorAt: anchor, maxOccurrences: 2, until: null },
    });
    expect("rule" in buildSeriesRule(anchor, { frequency: "MONTHLY", count: 12 })).toBe(true);
    expect(buildSeriesRule(anchor, { frequency: "WEEKLY", count: 1 })).toEqual({ error: "repeat_too_short" });
    expect(buildSeriesRule(anchor, { frequency: "WEEKLY", count: 13 })).toEqual({ error: "repeat_too_long" });
    expect(buildSeriesRule(anchor, { frequency: "WEEKLY", count: 2.5 })).toEqual({ error: "repeat_too_short" });
  });

  it("needs exactly one end", () => {
    expect(buildSeriesRule(anchor, { frequency: "WEEKLY" })).toEqual({ error: "repeat_invalid" });
    expect(
      buildSeriesRule(anchor, { frequency: "WEEKLY", count: 3, until: new Date("2026-12-01T00:00:00Z") }),
    ).toEqual({ error: "repeat_invalid" });
  });

  it("caps an end date at a year after the first date, and needs a second date before it", () => {
    const ok = buildSeriesRule(anchor, { frequency: "WEEKLY", until: new Date("2026-11-05T00:00:00Z") });
    expect(ok).toEqual({
      rule: { frequency: "WEEKLY", anchorAt: anchor, maxOccurrences: EVENT_SERIES_MAX_OCCURRENCES, until: new Date("2026-11-05T00:00:00Z") },
    });
    expect(buildSeriesRule(anchor, { frequency: "WEEKLY", until: new Date("2027-10-22T00:00:00Z") })).toEqual({
      error: "repeat_too_long",
    });
    // Only the first date falls before it.
    expect(buildSeriesRule(anchor, { frequency: "WEEKLY", until: new Date("2026-10-25T00:00:00Z") })).toEqual({
      error: "repeat_too_short",
    });
    expect(buildSeriesRule(anchor, { frequency: "WEEKLY", until: new Date("2026-10-01T00:00:00Z") })).toEqual({
      error: "repeat_too_short",
    });
  });
});

describe("seriesOccurrences", () => {
  it("stops at the count, at the end date, and never past 12", () => {
    expect(seriesOccurrences({ frequency: "WEEKLY", anchorAt: anchor, maxOccurrences: 3, until: null }).map(iso)).toEqual([
      "2026-10-21T18:30:00.000Z",
      "2026-10-28T18:30:00.000Z",
      "2026-11-04T18:30:00.000Z",
    ]);
    // An occurrence starting exactly at the end date still happens.
    const until = new Date("2026-11-04T18:30:00.000Z");
    expect(seriesOccurrences({ frequency: "WEEKLY", anchorAt: anchor, maxOccurrences: 12, until })).toHaveLength(3);
    const long = { frequency: "WEEKLY" as const, anchorAt: anchor, maxOccurrences: 40, until: null };
    expect(seriesOccurrences(long)).toHaveLength(EVENT_SERIES_MAX_OCCURRENCES);
  });
});

describe("nextOccurrence", () => {
  const rule: EventSeriesRule = { frequency: "WEEKLY", anchorAt: anchor, maxOccurrences: 4, until: null };

  it("is the next index once the latest has passed", () => {
    const now = new Date("2026-10-21T20:00:00.000Z");
    expect(nextOccurrence(rule, 0, now)).toEqual({ index: 1, at: new Date("2026-10-28T18:30:00.000Z") });
  });

  it("skips occurrences already in the past (cron was down) instead of creating them", () => {
    const now = new Date("2026-11-05T00:00:00.000Z");
    expect(nextOccurrence(rule, 0, now)).toEqual({ index: 3, at: new Date("2026-11-11T18:30:00.000Z") });
  });

  it("is null once the count or the end date is reached", () => {
    expect(nextOccurrence(rule, 3, new Date("2026-11-11T20:00:00.000Z"))).toBeNull();
    const now = new Date("2026-12-01T00:00:00.000Z");
    expect(nextOccurrence(rule, 0, now)).toBeNull();
    const dated = { ...rule, maxOccurrences: 12, until: new Date("2026-10-30T00:00:00Z") };
    expect(nextOccurrence(dated, 1, new Date("2026-10-28T20:00:00Z"))).toBeNull();
  });
});

describe("rollover timing", () => {
  it("is due an hour after the latest occurrence starts", () => {
    const start = new Date("2026-10-21T18:30:00.000Z");
    expect(isSeriesDue(start, new Date(start.getTime() + EVENT_SERIES_ROLLOVER_DELAY_MS - 1))).toBe(false);
    expect(isSeriesDue(start, new Date(start.getTime() + EVENT_SERIES_ROLLOVER_DELAY_MS))).toBe(true);
    expect(iso(seriesDueCutoff(new Date("2026-10-21T19:30:00.000Z")))).toBe("2026-10-21T18:30:00.000Z");
  });
});
