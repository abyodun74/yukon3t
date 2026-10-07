import { describe, it, expect } from "vitest";
import { buildCollabIcs, buildGoogleCalendarUrl } from "@/lib/calendar-export";

const startAt = new Date("2026-10-13T18:00:00Z");
const now = new Date("2026-10-07T12:00:00Z");

describe("buildCollabIcs", () => {
  it("includes the required VEVENT fields in UTC form", () => {
    const ics = buildCollabIcs({ uid: "collab-1", title: "Weekly sync", description: "Progress check-in", startAt, now });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:collab-1");
    expect(ics).toContain("DTSTAMP:20261007T120000Z");
    expect(ics).toContain("DTSTART:20261013T180000Z");
    // 60-minute default duration.
    expect(ics).toContain("DTEND:20261013T190000Z");
    expect(ics).toContain("SUMMARY:Weekly sync");
    expect(ics).toContain("DESCRIPTION:Progress check-in");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("uses CRLF line endings (RFC 5545 §3.1)", () => {
    const ics = buildCollabIcs({ uid: "collab-1", title: "x", description: "y", startAt, now });
    expect(ics).toContain("\r\n");
    expect(ics.split("\r\n").length).toBeGreaterThan(5);
  });

  it("escapes commas, semicolons, backslashes, and newlines in text fields", () => {
    const ics = buildCollabIcs({
      uid: "collab-1",
      title: "Tax prep; Q1, 2026",
      description: "Line one\nLine two \\ backslash",
      startAt,
      now,
    });
    expect(ics).toContain("SUMMARY:Tax prep\\; Q1\\, 2026");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two \\\\ backslash");
  });
});

describe("buildGoogleCalendarUrl", () => {
  it("builds a render URL with the expected query params", () => {
    const url = buildGoogleCalendarUrl({ title: "Weekly sync", description: "Progress check-in", startAt });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("Weekly sync");
    expect(parsed.searchParams.get("details")).toBe("Progress check-in");
    expect(parsed.searchParams.get("dates")).toBe("20261013T180000Z/20261013T190000Z");
  });
});
