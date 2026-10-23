/**
 * Organizer tools on a Circle event (an event Post with eventAt in a Circle): "Organizer updates" sent to everyone
 * going, attendance check-in, and the CSV export. The pure rules only; the server half is
 * lib/circle-event-organizer-data.ts and actions/circle-event-organizer.ts. Who is an organizer is
 * canOrganizeCircleEvent (lib/circle-events.ts): the author while a member, or the Circle's owner / co-admins by role,
 * no site-admin shortcut. Every tool here is for organizers only.
 */

/** An organizer update: at most this long (after normalizing). */
export const EVENT_ANNOUNCEMENT_MAX_LENGTH = 500;
/** At most this many updates per event (all organizers together) in any EVENT_ANNOUNCEMENT_WINDOW_MS. */
export const EVENT_ANNOUNCEMENTS_PER_DAY = 5;
export const EVENT_ANNOUNCEMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** One update notifies at most this many people (like a nudge or a cancel). */
export const EVENT_ANNOUNCEMENT_MAX_RECIPIENTS = 500;
/** Updates can still be sent until this long after the start ("thanks for coming, photos are in #general"). */
export const EVENT_ANNOUNCE_AFTER_START_MS = 24 * 60 * 60 * 1000;
/** How many of the latest updates are pinned on the event. */
export const EVENT_ANNOUNCEMENTS_SHOWN = 3;

/** Check-in opens this long before the start and closes this long after it. */
export const EVENT_CHECK_IN_OPENS_BEFORE_MS = 60 * 60 * 1000;
export const EVENT_CHECK_IN_CLOSES_AFTER_MS = 24 * 60 * 60 * 1000;
/** How often an open check-in list re-reads itself (while the page is visible), so organizers see each other's ticks. */
export const EVENT_CHECK_IN_REFRESH_MS = 20_000;
/** The most people the check-in list (and one event's export) holds. */
export const EVENT_CHECK_IN_LIST_MAX = 1000;
/** "Add a walk-in": the most matches one search returns, and the shortest search. */
export const EVENT_WALK_IN_SEARCH_LIMIT = 10;
export const EVENT_WALK_IN_QUERY_MIN = 2;

/** "All dates in this series" exports at most this many occurrences (a series has at most 12 today). */
export const EVENT_EXPORT_MAX_OCCURRENCES = 52;

/** Trims an update, keeps single line breaks, collapses runs of spaces and blank lines; null when empty, false when too long. */
export function normalizeAnnouncementText(text: string | null | undefined): string | null | false {
  const normalized = (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length === 0) return null;
  if (normalized.length > EVENT_ANNOUNCEMENT_MAX_LENGTH) return false;
  return normalized;
}

export type AnnouncementError = "cancelled" | "too_late";

/** Why an update can't be sent about this event now: it was cancelled, or it ended more than a day ago. */
export function announcementError(
  event: { eventAt: Date; eventCancelledAt: Date | null },
  now: Date,
): AnnouncementError | null {
  if (event.eventCancelledAt) return "cancelled";
  if (now.getTime() > event.eventAt.getTime() + EVENT_ANNOUNCE_AFTER_START_MS) return "too_late";
  return null;
}

/** The start of the rolling window the per-event cap counts updates in. */
export function announcementWindowStart(now: Date) {
  return new Date(now.getTime() - EVENT_ANNOUNCEMENT_WINDOW_MS);
}

/** How many more updates the event can get right now, given how many it got in the window. */
export function announcementsLeft(sentInWindow: number) {
  return Math.max(0, EVENT_ANNOUNCEMENTS_PER_DAY - sentInWindow);
}

/**
 * Who an update goes to: the event's author, then everyone going (in the order given); never the organizer sending
 * it, nobody blocked either way with the sender or the author, and only people in `audience` (current members of the
 * Circle, ACTIVE, who can open the event's channel: someone who left, or a non-member who RSVP'd while it was
 * public, isn't notified). Each once, at most EVENT_ANNOUNCEMENT_MAX_RECIPIENTS.
 */
export function announcementRecipients(input: {
  actorId: string;
  authorId: string;
  rsvpUserIds: readonly string[];
  audience: ReadonlySet<string>;
  blockedIds: ReadonlySet<string>;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [input.authorId, ...input.rsvpUserIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === input.actorId || input.blockedIds.has(id) || !input.audience.has(id)) continue;
    out.push(id);
    if (out.length >= EVENT_ANNOUNCEMENT_MAX_RECIPIENTS) break;
  }
  return out;
}

export type CheckInState = "before" | "open" | "closed";

/** The check-in window around an event's start: not open yet, open, or closed for good. */
export function checkInWindow(eventAt: Date, now: Date): { state: CheckInState; opensAt: Date; closesAt: Date } {
  const opensAt = new Date(eventAt.getTime() - EVENT_CHECK_IN_OPENS_BEFORE_MS);
  const closesAt = new Date(eventAt.getTime() + EVENT_CHECK_IN_CLOSES_AFTER_MS);
  const t = now.getTime();
  const state: CheckInState = t < opensAt.getTime() ? "before" : t > closesAt.getTime() ? "closed" : "open";
  return { state, opensAt, closesAt };
}

export type CheckInError = "cancelled" | "too_early" | "too_late";

/** Why attendance can't be changed now: the event was cancelled, or the window isn't open (yet / any more). */
export function checkInError(event: { eventAt: Date; eventCancelledAt: Date | null }, now: Date): CheckInError | null {
  if (event.eventCancelledAt) return "cancelled";
  const { state } = checkInWindow(event.eventAt, now);
  if (state === "before") return "too_early";
  if (state === "closed") return "too_late";
  return null;
}

/**
 * What the organizer tools offer for one event, for one viewer. Everything is false for anyone but an organizer. The
 * check-in list (and the attendance summary) can be read once the window has opened, also after it closed, but only
 * changed while it is open. Export works at any time (before the event it is the RSVP and bring-list list).
 */
export function organizerToolAccess(input: {
  isOrganizer: boolean;
  eventAt: Date;
  eventCancelledAt: Date | null;
  now: Date;
}) {
  if (!input.isOrganizer) {
    return { announce: false, viewAttendance: false, editAttendance: false, exportCsv: false };
  }
  const event = { eventAt: input.eventAt, eventCancelledAt: input.eventCancelledAt };
  const checkIn = checkInWindow(input.eventAt, input.now);
  return {
    announce: announcementError(event, input.now) === null,
    viewAttendance: !input.eventCancelledAt && checkIn.state !== "before",
    editAttendance: checkInError(event, input.now) === null,
    exportCsv: true,
  };
}

/**
 * Whether `userId` may be marked as attended: someone who replied Going or Maybe (still able to see the event), or a
 * walk-in from `audience` (current ACTIVE members who can open the event's channel); never anyone blocked either way
 * with the organizer.
 */
export function canMarkAttended(input: {
  userId: string;
  hasReplied: boolean;
  audience: ReadonlySet<string>;
  blockedIds: ReadonlySet<string>;
}) {
  if (input.blockedIds.has(input.userId)) return false;
  return input.hasReplied || input.audience.has(input.userId);
}

/** "12 going · 3 maybe · 9 attended (2 walk-ins)": the organizers' summary, from the reply and attendance rows. */
export function attendanceSummary(input: {
  going: number;
  maybe: number;
  attendance: readonly { userId: string; walkIn: boolean }[];
}) {
  const walkIns = input.attendance.filter((a) => a.walkIn).length;
  return { going: input.going, maybe: input.maybe, attended: input.attendance.length, walkIns };
}

/** Who may edit an organizer update: its own author, while still an organizer of the event, until it is deleted. */
export function canEditEventUpdate(input: { viewerId: string; authorId: string; isOrganizer: boolean; deleted: boolean }) {
  return !input.deleted && input.isOrganizer && input.viewerId === input.authorId;
}

/** Who may delete an organizer update: any organizer of the event, or its author (also after they stopped organizing). */
export function canDeleteEventUpdate(input: { viewerId: string; authorId: string; isOrganizer: boolean; deleted: boolean }) {
  return !input.deleted && (input.isOrganizer || input.viewerId === input.authorId);
}

/** A walk-in search as typed: trimmed, at least EVENT_WALK_IN_QUERY_MIN characters, a leading "@" dropped. */
export function normalizeWalkInQuery(query: string): string | null {
  const normalized = query.trim().replace(/^@+/, "").slice(0, 60);
  return normalized.length >= EVENT_WALK_IN_QUERY_MIN ? normalized : null;
}
