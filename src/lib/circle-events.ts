/**
 * Circle events (event Posts with eventAt in a Circle): the pure rules behind the "Coming up" list, "Who's bringing
 * what", "Remind people who haven't replied" and stopping a repeating event. No I/O; the server half is
 * lib/circle-events-data.ts and actions/circle-events.ts. Recurrence maths is in lib/event-recurrence.ts.
 */

/** "Coming up" on a Circle page: first page size, and the most "Load more" returns at once. */
export const CIRCLE_EVENTS_PAGE_SIZE = 20;

/** Items on one event's bring list, and the longest an item may be. */
export const EVENT_BRING_ITEMS_MAX = 20;
export const EVENT_BRING_ITEM_MAX_LENGTH = 60;

/** One nudge per event per this long, to at most this many people. */
export const EVENT_NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const EVENT_NUDGE_MAX_RECIPIENTS = 500;

/**
 * Who organizes a Circle event: its author while still a member (or the Circle's owner), and the Circle's owner and
 * co-admins (MODERATOR). By membership role only, with no site-admin shortcut, like creating polls.
 */
export function canOrganizeCircleEvent(input: {
  viewerId: string;
  authorId: string;
  circleOwnerId: string;
  /** The viewer's CircleMembership role, null if not a member. */
  role: string | null;
}) {
  const isOwner = input.viewerId === input.circleOwnerId;
  if (isOwner || input.role === "MODERATOR") return true;
  return input.viewerId === input.authorId && input.role !== null;
}

/** Trims an item and collapses inner whitespace; null if nothing is left or it is too long. */
export function normalizeBringItemText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0 || normalized.length > EVENT_BRING_ITEM_MAX_LENGTH) return null;
  return normalized;
}

/** Whether another item fits on a list that already has `count`. */
export function canAddBringItem(count: number) {
  return count < EVENT_BRING_ITEMS_MAX;
}

/**
 * Who may clear an item's claim: the claimer themself, or an organizer (unassign). Claiming an unclaimed item is a
 * guarded write (only while claimedById is still null), so it has no rule here.
 */
export function canUnclaimBringItem(input: { viewerId: string; claimedById: string | null; isOrganizer: boolean }) {
  if (!input.claimedById) return false;
  return input.isOrganizer || input.claimedById === input.viewerId;
}

export type NudgeError = "past_event" | "too_soon";

/** Why an event can't be nudged right now: it has started, or the last nudge is under EVENT_NUDGE_COOLDOWN_MS old. */
export function nudgeError(event: { eventAt: Date; eventNudgedAt: Date | null }, now: Date): NudgeError | null {
  if (event.eventAt.getTime() <= now.getTime()) return "past_event";
  if (event.eventNudgedAt && now.getTime() - event.eventNudgedAt.getTime() < EVENT_NUDGE_COOLDOWN_MS) return "too_soon";
  return null;
}

/** When the next nudge is allowed, or null if one is allowed now. */
export function nextNudgeAt(eventNudgedAt: Date | null, now: Date): Date | null {
  if (!eventNudgedAt) return null;
  const next = new Date(eventNudgedAt.getTime() + EVENT_NUDGE_COOLDOWN_MS);
  return next.getTime() > now.getTime() ? next : null;
}

/** The nudge's claim condition: a previous nudge, if any, is older than this. */
export function nudgeClaimCutoff(now: Date) {
  return new Date(now.getTime() - EVENT_NUDGE_COOLDOWN_MS);
}

/**
 * Who a nudge goes to, from `candidates` (members who can see the event, most recently joined first): not the
 * organizer sending it, not the event's author, nobody who already RSVP'd, nobody blocked either way with the sender
 * or the author; each once, at most EVENT_NUDGE_MAX_RECIPIENTS.
 */
export function nudgeRecipients(
  candidates: readonly string[],
  exclude: {
    actorId: string;
    authorId: string;
    rsvpUserIds: ReadonlySet<string>;
    blockedIds: ReadonlySet<string>;
  },
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === exclude.actorId || id === exclude.authorId) continue;
    if (exclude.rsvpUserIds.has(id) || exclude.blockedIds.has(id)) continue;
    out.push(id);
    if (out.length >= EVENT_NUDGE_MAX_RECIPIENTS) break;
  }
  return out;
}

/** The title a Circle event is listed under: its first non-empty line, shortened. Empty when the post has no text. */
export function eventTitle(content: string, maxLength = 120) {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > maxLength ? `${line.slice(0, maxLength - 1).trimEnd()}…` : line;
}

export type CircleEventCursor = { eventAt: string; id: string };

/** The position after the last event shown, for "Load more" (soonest first, then id). */
export function circleEventCursorOf(event: { eventAt: string; id: string }): CircleEventCursor {
  return { eventAt: event.eventAt, id: event.id };
}

/** Appends a "Load more" page, dropping anything already shown. */
export function appendCircleEventPage<T extends { id: string }>(current: readonly T[], page: readonly T[]): T[] {
  const ids = new Set(current.map((e) => e.id));
  return [...current, ...page.filter((e) => !ids.has(e.id))];
}
