import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import {
  buildEventExportCsv,
  eventExportFileName,
  exportTime,
  type EventExportLabels,
  type EventExportOccurrence,
} from "@/lib/circle-event-export";

const labels: EventExportLabels = { ...en.ui.eventTools.csv, untitled: en.ui.events.untitled };

function rows(csv: string) {
  return csv.split("\r\n").filter((line) => line.length > 0);
}

const occurrence: EventExportOccurrence = {
  title: "Book club",
  startAt: new Date("2026-10-25T18:00:00Z"),
  cancelled: false,
  people: [
    { name: "Zed", username: "zed", rsvp: "GOING", rsvpAt: new Date("2026-10-21T09:30:00Z"), attended: false, items: [] },
    {
      name: "Ada",
      username: "ada",
      rsvp: "GOING",
      rsvpAt: new Date("2026-10-20T08:00:00Z"),
      attended: true,
      items: ["Chairs", "Cups"],
    },
    { name: "Mo", username: "mo", rsvp: "MAYBE", rsvpAt: new Date("2026-10-19T08:00:00Z"), attended: false, items: [] },
    { name: "Walk In", username: null, rsvp: null, rsvpAt: null, attended: true, items: [] },
  ],
};

describe("buildEventExportCsv", () => {
  it("has exactly the shared columns: no email, phone or anything else", () => {
    const [header] = rows(buildEventExportCsv([occurrence], labels));
    expect(header).toBe("Event,Starts (UTC),Name,Username,Reply,Replied at (UTC),Attended,Bringing");
    expect(header.toLowerCase()).not.toMatch(/mail|phone|birth|address/);
  });
  it("lists Going (by reply time), then Maybe, then walk-ins, with the reply, attendance and items", () => {
    expect(rows(buildEventExportCsv([occurrence], labels)).slice(1)).toEqual([
      "Book club,2026-10-25 18:00 UTC,Ada,ada,Going,2026-10-20 08:00 UTC,Yes,Chairs; Cups",
      "Book club,2026-10-25 18:00 UTC,Zed,zed,Going,2026-10-21 09:30 UTC,No,",
      "Book club,2026-10-25 18:00 UTC,Mo,mo,Maybe,2026-10-19 08:00 UTC,No,",
      "Book club,2026-10-25 18:00 UTC,Walk In,,No reply,,Yes,",
    ]);
  });
  it("neutralizes formula injection in names, usernames, titles and items", () => {
    const evil: EventExportOccurrence = {
      title: "=HYPERLINK(\"http://x\",\"y\")",
      startAt: occurrence.startAt,
      cancelled: false,
      people: [{ name: "@SUM(1+1)", username: "-user", rsvp: null, rsvpAt: null, attended: false, items: ["+cmd", "=x"] }],
    };
    const [, line] = rows(buildEventExportCsv([evil], labels));
    expect(line).toBe(`"'=HYPERLINK(""http://x"",""y"")",2026-10-25 18:00 UTC,'@SUM(1+1),'-user,No reply,,No,'+cmd; =x`);
    for (const cell of line.split(",")) expect(cell).not.toMatch(/^[=+\-@]/);
  });
  it("orders a series by date, marks a cancelled date and names an untitled one", () => {
    const csv = buildEventExportCsv(
      [
        { ...occurrence, startAt: new Date("2026-11-01T18:00:00Z"), cancelled: true, people: occurrence.people.slice(0, 1) },
        { ...occurrence, title: "", people: occurrence.people.slice(1, 2) },
      ],
      labels,
    );
    const lines = rows(csv).slice(1);
    expect(lines[0].startsWith("Event,2026-10-25 18:00 UTC,Ada")).toBe(true);
    expect(lines[1].startsWith("Book club (cancelled),2026-11-01 18:00 UTC,Zed")).toBe(true);
  });
  it("writes just the header for an event nobody replied to", () => {
    expect(rows(buildEventExportCsv([{ ...occurrence, people: [] }], labels))).toHaveLength(1);
  });
});

describe("export names and times", () => {
  it("formats times in UTC to the minute", () => {
    expect(exportTime(new Date("2026-10-23T07:05:59Z"))).toBe("2026-10-23 07:05 UTC");
  });
  it("names the file after the title and date, marking a series", () => {
    expect(eventExportFileName("Book club", new Date("2026-10-25T18:00:00Z"), false)).toBe("book-club-2026-10-25.csv");
    expect(eventExportFileName("Book club", new Date("2026-10-25T18:00:00Z"), true)).toBe(
      "book-club-2026-10-25-series.csv",
    );
    expect(eventExportFileName("", new Date("2026-10-25T18:00:00Z"), false)).toBe("event-2026-10-25.csv");
  });
});
