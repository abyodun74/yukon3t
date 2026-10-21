import { describe, expect, it } from "vitest";
import {
  EVENT_CHANGE_MAX_RECIPIENTS,
  EVENT_CHANGE_REASON_MAX_LENGTH,
  EVENT_RESCHEDULE_MAX_AHEAD_MS,
  eventChangeError,
  eventChangeRecipients,
  eventIcsSequence,
  normalizeEventChangeReason,
  nudgeError,
  rescheduleTimeError,
} from "@/lib/circle-events";

const now = new Date("2026-10-21T12:00:00Z");
const later = new Date("2026-10-25T18:00:00Z");

describe("eventChangeError (cancel / reschedule eligibility)", () => {
  it("allows an upcoming event that wasn't cancelled", () => {
    expect(eventChangeError({ eventAt: later, eventCancelledAt: null }, now)).toBeNull();
  });
  it("refuses a cancelled event, even an upcoming one", () => {
    expect(eventChangeError({ eventAt: later, eventCancelledAt: now }, now)).toBe("cancelled");
  });
  it("refuses an event that has started", () => {
    expect(eventChangeError({ eventAt: now, eventCancelledAt: null }, now)).toBe("past_event");
    expect(eventChangeError({ eventAt: new Date(now.getTime() - 1), eventCancelledAt: null }, now)).toBe("past_event");
  });
});

describe("nudgeError on a cancelled event", () => {
  it("refuses to nudge about a cancelled event", () => {
    expect(nudgeError({ eventAt: later, eventNudgedAt: null, eventCancelledAt: now }, now)).toBe("cancelled");
  });
});

describe("rescheduleTimeError", () => {
  it("accepts a different future time within a year", () => {
    expect(rescheduleTimeError(later, new Date("2026-10-26T18:00:00Z"), now)).toBeNull();
  });
  it("refuses the past, now, an invalid date and more than a year ahead", () => {
    expect(rescheduleTimeError(later, new Date("2026-10-20T18:00:00Z"), now)).toBe("invalid_time");
    expect(rescheduleTimeError(later, now, now)).toBe("invalid_time");
    expect(rescheduleTimeError(later, new Date("nope"), now)).toBe("invalid_time");
    expect(rescheduleTimeError(later, new Date(now.getTime() + EVENT_RESCHEDULE_MAX_AHEAD_MS + 60_000), now)).toBe(
      "invalid_time",
    );
  });
  it("refuses the same minute", () => {
    expect(rescheduleTimeError(later, new Date(later.getTime() + 30_000), now)).toBe("same_time");
  });
});

describe("normalizeEventChangeReason", () => {
  it("treats blank as no reason", () => {
    expect(normalizeEventChangeReason("   \n ")).toBeNull();
    expect(normalizeEventChangeReason(null)).toBeNull();
    expect(normalizeEventChangeReason(undefined)).toBeNull();
  });
  it("trims and collapses spaces and long runs of blank lines", () => {
    expect(normalizeEventChangeReason("  Venue   closed\r\n\r\n\r\n\r\nSorry  ")).toBe("Venue closed\n\nSorry");
  });
  it("refuses a reason past the limit", () => {
    expect(normalizeEventChangeReason("a".repeat(EVENT_CHANGE_REASON_MAX_LENGTH))).toHaveLength(
      EVENT_CHANGE_REASON_MAX_LENGTH,
    );
    expect(normalizeEventChangeReason("a".repeat(EVENT_CHANGE_REASON_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("eventChangeRecipients (who hears about a cancel / reschedule)", () => {
  const base = { actorId: "org", authorId: "author", blockedIds: new Set<string>() };

  it("includes the author, everyone going and every claimer, each once", () => {
    expect(
      eventChangeRecipients({ ...base, rsvpUserIds: ["a", "b", "author"], claimerIds: ["b", "c", null] }),
    ).toEqual(["author", "a", "b", "c"]);
  });
  it("never includes the organizer acting, even when they are going, bringing something or the author", () => {
    expect(eventChangeRecipients({ ...base, actorId: "author", rsvpUserIds: ["author", "a"], claimerIds: ["author"] })).toEqual([
      "a",
    ]);
    expect(eventChangeRecipients({ ...base, rsvpUserIds: ["org", "a"], claimerIds: ["org"] })).toEqual(["author", "a"]);
  });
  it("skips anyone blocked either way with the organizer", () => {
    expect(
      eventChangeRecipients({ ...base, blockedIds: new Set(["a", "author"]), rsvpUserIds: ["a", "b"], claimerIds: ["a"] }),
    ).toEqual(["b"]);
  });
  it("is capped", () => {
    const many = Array.from({ length: EVENT_CHANGE_MAX_RECIPIENTS + 50 }, (_, i) => `u${i}`);
    const out = eventChangeRecipients({ ...base, rsvpUserIds: many, claimerIds: [] });
    expect(out).toHaveLength(EVENT_CHANGE_MAX_RECIPIENTS);
    expect(out[0]).toBe("author");
  });
});

describe("eventIcsSequence", () => {
  it("is 0 for an unchanged event", () => {
    expect(eventIcsSequence({ eventRescheduledAt: null, eventCancelledAt: null })).toBe(0);
  });
  it("grows with each later change and stays a 32-bit integer", () => {
    const first = eventIcsSequence({ eventRescheduledAt: new Date("2026-10-21T12:00:00Z"), eventCancelledAt: null });
    const second = eventIcsSequence({ eventRescheduledAt: new Date("2026-10-22T12:00:00Z"), eventCancelledAt: null });
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(Number.isInteger(second)).toBe(true);
    expect(eventIcsSequence({ eventRescheduledAt: new Date("2060-01-01T00:00:00Z"), eventCancelledAt: null })).toBeLessThan(
      2 ** 31,
    );
  });
});
