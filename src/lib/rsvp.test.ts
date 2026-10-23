import { describe, expect, it } from "vitest";
import { applyRsvpChange, nextRsvpStatus, rsvpNotifiesAuthor } from "@/lib/rsvp";

describe("nextRsvpStatus", () => {
  it("sets a reply, switches between Going and Maybe, and takes it back on a second tap", () => {
    expect(nextRsvpStatus(null, "GOING")).toBe("GOING");
    expect(nextRsvpStatus(null, "MAYBE")).toBe("MAYBE");
    expect(nextRsvpStatus("GOING", "MAYBE")).toBe("MAYBE");
    expect(nextRsvpStatus("MAYBE", "GOING")).toBe("GOING");
    expect(nextRsvpStatus("GOING", "GOING")).toBeNull();
    expect(nextRsvpStatus("MAYBE", "MAYBE")).toBeNull();
  });
});

describe("applyRsvpChange", () => {
  const counts = { going: 3, maybe: 1 };
  it("moves one person between the counts", () => {
    expect(applyRsvpChange(counts, null, "GOING")).toEqual({ going: 4, maybe: 1 });
    expect(applyRsvpChange(counts, null, "MAYBE")).toEqual({ going: 3, maybe: 2 });
    expect(applyRsvpChange(counts, "GOING", "MAYBE")).toEqual({ going: 2, maybe: 2 });
    expect(applyRsvpChange(counts, "MAYBE", null)).toEqual({ going: 3, maybe: 0 });
    expect(applyRsvpChange(counts, "GOING", "GOING")).toBe(counts);
  });
  it("never goes below zero", () => {
    expect(applyRsvpChange({ going: 0, maybe: 0 }, "GOING", null)).toEqual({ going: 0, maybe: 0 });
  });
});

describe("rsvpNotifiesAuthor", () => {
  it("only when someone becomes Going", () => {
    expect(rsvpNotifiesAuthor(null, "GOING")).toBe(true);
    expect(rsvpNotifiesAuthor("MAYBE", "GOING")).toBe(true);
    expect(rsvpNotifiesAuthor("GOING", "GOING")).toBe(false);
    expect(rsvpNotifiesAuthor(null, "MAYBE")).toBe(false);
    expect(rsvpNotifiesAuthor("GOING", "MAYBE")).toBe(false);
    expect(rsvpNotifiesAuthor("GOING", null)).toBe(false);
  });
});
