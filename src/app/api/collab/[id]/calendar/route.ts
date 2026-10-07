import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, AuthError } from "@/lib/auth-guards";
import { buildCollabIcs } from "@/lib/calendar-export";

/**
 * Serves the next scheduled session as a downloadable .ics — the
 * "Download calendar file" half of CollabAddToCalendar's two options (the
 * other being a direct Google Calendar link, built client-side with no
 * server round-trip needed). Gated the same way the detail page gates the
 * session room itself: the organizer or an actual joined participant, not
 * merely anyone who can view a PUBLIC collab's page — a casual browser
 * hasn't committed to attending, so there's nothing to add to their
 * calendar yet.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const collab = await prisma.collabBoardPost.findUnique({
    where: { id },
    select: {
      title: true,
      description: true,
      authorId: true,
      nextSessionAt: true,
      participants: { where: { userId: user.id }, select: { userId: true } },
    },
  });

  if (!collab || !collab.nextSessionAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const isAttendee = collab.authorId === user.id || collab.participants.length > 0 || user.isAdmin;
  if (!isAttendee) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ics = buildCollabIcs({
    // Stable across regenerations of the *same* occurrence (same
    // collab+start time) so re-adding doesn't create a duplicate event in
    // calendar apps that dedupe by UID, but changes once nextSessionAt
    // rolls forward to the next occurrence, which a calendar app should
    // treat as a new event rather than silently updating the last one.
    uid: `collab-${id}-${collab.nextSessionAt.getTime()}@yukon3t.com`,
    title: collab.title,
    description: collab.description,
    startAt: collab.nextSessionAt,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="collab-session.ics"',
    },
  });
}
