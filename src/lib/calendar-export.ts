/**
 * ICS (iCalendar, RFC 5545) + Google Calendar "quick add" link builders for
 * a Collab's next scheduled session — lets an invitee/attendee add it to
 * their own calendar app with a built-in reminder, instead of only ever
 * seeing it in-app. Pure string building, no I/O — see the
 * /api/collab/[id]/calendar route for the actual HTTP response, and
 * CollabAddToCalendar for the UI that links to both of these.
 */

// How long the session block itself runs on the calendar — this app has no
// separately-tracked session end time, just a start (nextSessionAt), so a
// fixed reasonable default stands in rather than leaving it zero-length.
const SESSION_DURATION_MINUTES = 60;

// How long before the session a calendar app should remind the attendee —
// encoded as a VALARM TRIGGER below, honored by Apple Calendar/Outlook/most
// desktop calendar apps that import an .ics directly. Google Calendar's own
// web/mobile apps ignore an imported event's VALARM and apply their own
// default reminder instead when you use the Google Calendar link — a known
// Google Calendar behavior, not a gap in this file.
const REMINDER_MINUTES_BEFORE = 30;

/** "20261013T180000Z" — the ICS UTC date-time form (RFC 5545 §3.3.5), no separators, Z suffix. */
function toIcsUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/** RFC 5545 §3.3.11 — backslash, semicolon, comma, and newlines are the only characters a TEXT value needs escaped. */
function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildCollabIcs(params: { uid: string; title: string; description: string; startAt: Date; now?: Date }): string {
  const { uid, title, description, startAt, now = new Date() } = params;
  const endAt = new Date(startAt.getTime() + SESSION_DURATION_MINUTES * 60_000);
  // CRLF line endings — RFC 5545 §3.1 requires them, and at least one real
  // calendar client (tested: Apple Calendar) silently drops an .ics using
  // bare \n instead.
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//yukon3t//Collab Session//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(startAt)}`,
    `DTEND:${toIcsUtc(endAt)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    `TRIGGER:-PT${REMINDER_MINUTES_BEFORE}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function buildGoogleCalendarUrl(params: { title: string; description: string; startAt: Date }): string {
  const { title, description, startAt } = params;
  const endAt = new Date(startAt.getTime() + SESSION_DURATION_MINUTES * 60_000);
  const qs = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    details: description,
    dates: `${toIcsUtc(startAt)}/${toIcsUtc(endAt)}`,
  });
  return `https://calendar.google.com/calendar/render?${qs.toString()}`;
}
