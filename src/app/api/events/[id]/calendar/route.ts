import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth-guards";
import { buildCollabIcs } from "@/lib/calendar-export";
import { loadCircleEventAccess } from "@/lib/circle-events-data";
import { eventIcsSequence, eventTitle } from "@/lib/circle-events";

/**
 * A Circle event post as a downloadable .ics (the "Download calendar file" next to the Google Calendar link on the
 * event, see circle-event-panel.tsx), mirroring /api/collab/[id]/calendar. Signed-in only (401), and 404 unless the id
 * is a published Circle event the viewer may see (loadCircleEventAccess: the same rules as the post itself, plus a
 * private channel's allow-list) that hasn't started yet and wasn't cancelled, so an id says nothing about whether it exists.
 *
 * No per-Circle subscribable feed: a calendar app fetches that without the session cookie, so it would need a secret
 * per-user token, which this route deliberately doesn't add.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9_]{1,64}$/i.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const access = await loadCircleEventAccess(id, user);
  // A cancelled event has no calendar file either (the button isn't offered; the post says it was cancelled).
  if (!access || access.post.eventAt.getTime() <= Date.now() || access.post.eventCancelledAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { post } = access;

  const ics = buildCollabIcs({
    // Stable for this post: re-adding doesn't duplicate it, and after a reschedule the higher SEQUENCE makes a calendar
    // app that imports it again update the event it already has instead of adding a second one.
    uid: `event-${post.id}@yukon3t.com`,
    sequence: eventIcsSequence(post),
    title: eventTitle(post.content) || post.circle.name,
    description: post.content,
    location: post.eventLocation,
    startAt: post.eventAt,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="event.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
