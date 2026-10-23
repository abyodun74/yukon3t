import { csvFileName, toCsv } from "@/lib/csv";
import type { RsvpStatus } from "@/lib/rsvp";

/**
 * The organizer's CSV of one Circle event (or every date of a repeating one): who said they're going, who attended,
 * who is bringing what. Pure: the server half (lib/circle-event-organizer-data.ts) loads only what members shared with
 * the Circle by RSVPing, checking in or claiming an item (display name, @username, those times), never an email,
 * phone or anything else private, and leaves out anyone blocked either way with the organizer.
 */

export type EventExportPerson = {
  name: string | null;
  username: string | null;
  /** Their reply (Going / Maybe) and when they first replied; null for a walk-in / someone only bringing something. */
  rsvp: RsvpStatus | null;
  rsvpAt: Date | null;
  attended: boolean;
  /** The bring-list items they claimed. */
  items: readonly string[];
};

export type EventExportOccurrence = {
  title: string;
  startAt: Date;
  cancelled: boolean;
  people: readonly EventExportPerson[];
};

/** The column titles and fixed words, in the organizer's language (ui.eventTools.csv in src/lib/i18n). */
export type EventExportLabels = {
  event: string;
  start: string;
  name: string;
  username: string;
  rsvp: string;
  rsvpAt: string;
  attended: string;
  bringing: string;
  going: string;
  maybe: string;
  notGoing: string;
  yes: string;
  no: string;
  cancelled: string;
  untitled: string;
};

/** "2026-10-23 18:30 UTC": unambiguous for every reader and sortable in a spreadsheet. */
export function exportTime(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const REPLY_ORDER = { GOING: 0, MAYBE: 1 } as const;

/** Going, then Maybe (each by when they replied), then walk-ins and people only bringing something, by name. */
function sortPeople(people: readonly EventExportPerson[]): EventExportPerson[] {
  const label = (p: EventExportPerson) => (p.name ?? p.username ?? "").toLocaleLowerCase();
  return [...people].sort((a, b) => {
    if (a.rsvp && b.rsvp) {
      if (a.rsvp !== b.rsvp) return REPLY_ORDER[a.rsvp] - REPLY_ORDER[b.rsvp];
      return (a.rsvpAt?.getTime() ?? 0) - (b.rsvpAt?.getTime() ?? 0);
    }
    if (a.rsvp) return -1;
    if (b.rsvp) return 1;
    return label(a).localeCompare(label(b));
  });
}

/** The CSV text (no byte-order mark): a header row, then one row per person per date, dates in order. */
export function buildEventExportCsv(occurrences: readonly EventExportOccurrence[], labels: EventExportLabels): string {
  const rows: string[][] = [
    [labels.event, labels.start, labels.name, labels.username, labels.rsvp, labels.rsvpAt, labels.attended, labels.bringing],
  ];
  const ordered = [...occurrences].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  for (const occurrence of ordered) {
    const title = `${occurrence.title || labels.untitled}${occurrence.cancelled ? ` (${labels.cancelled})` : ""}`;
    const start = exportTime(occurrence.startAt);
    for (const person of sortPeople(occurrence.people)) {
      rows.push([
        title,
        start,
        person.name ?? "",
        // Without the "@": a cell starting with "@" is a formula to a spreadsheet and would be neutralized ('@ada).
        person.username ?? "",
        person.rsvp === "GOING" ? labels.going : person.rsvp === "MAYBE" ? labels.maybe : labels.notGoing,
        person.rsvp && person.rsvpAt ? exportTime(person.rsvpAt) : "",
        person.attended ? labels.yes : labels.no,
        person.items.join("; "),
      ]);
    }
  }
  return toCsv(rows);
}

/** The download's name: the event's title and its (first) date, e.g. "book-club-2026-10-23.csv" or "...-series.csv". */
export function eventExportFileName(title: string, startAt: Date, series: boolean): string {
  const date = startAt.toISOString().slice(0, 10);
  return csvFileName(title, series ? `${date}-series` : date, "event");
}
