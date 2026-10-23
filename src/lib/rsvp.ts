/**
 * Event replies (PostRsvp): "Going" or "Maybe", or no reply at all (no row). Pure and client-safe; the action is
 * setRsvp (actions/rsvp.ts), the buttons are EventRsvpButtons (components/event-rsvp.tsx).
 *
 * Everything that is about "people who replied" treats Going and Maybe alike: the reminder shortly before the start,
 * the nudge (a Maybe has replied), cancel / reschedule notices, organizer updates, the check-in list and the export
 * (which say which). Only Post.rsvpCount means Going; Post.maybeCount counts Maybe. The author is notified
 * (EVENT_RSVP) and subscribers hear about it (SUBSCRIPTION_RSVP) only when someone becomes Going.
 */

export const RSVP_STATUSES = ["GOING", "MAYBE"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export type RsvpCounts = { going: number; maybe: number };

/** What a tap on `tapped` does to a reply that is `current`: the same choice again clears it, another one switches. */
export function nextRsvpStatus(current: RsvpStatus | null, tapped: RsvpStatus): RsvpStatus | null {
  return current === tapped ? null : tapped;
}

/** The counts after one person's reply moves from `from` to `to` (for the optimistic update; never below zero). */
export function applyRsvpChange(counts: RsvpCounts, from: RsvpStatus | null, to: RsvpStatus | null): RsvpCounts {
  if (from === to) return counts;
  const next = { ...counts };
  if (from === "GOING") next.going = Math.max(0, next.going - 1);
  if (from === "MAYBE") next.maybe = Math.max(0, next.maybe - 1);
  if (to === "GOING") next.going += 1;
  if (to === "MAYBE") next.maybe += 1;
  return next;
}

/** Whether a reply change should tell the author and subscribers: only when someone becomes Going. */
export function rsvpNotifiesAuthor(from: RsvpStatus | null, to: RsvpStatus | null): boolean {
  return to === "GOING" && from !== "GOING";
}
