import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureError } from "@/lib/error-tracking";
import { nextOccurrence } from "@/lib/collab-schedule";

// Same reasoning as event-reminders' own window: matched to the scheduled
// function's run interval (every 15 minutes, see
// netlify/functions/collab-session-reminders.mts) plus some slack, so a
// session isn't missed if it lands right at the edge of two runs.
const REMINDER_WINDOW_MINUTES = 20;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60_000);

  const upcoming = await prisma.collabBoardPost.findMany({
    where: {
      status: "OPEN",
      nextSessionAt: { gte: now, lte: windowEnd },
      sessionReminderSentAt: null,
    },
    select: { id: true, authorId: true, title: true, nextSessionAt: true, scheduleDays: true, scheduleTime: true },
  });

  let remindersSent = 0;
  let collabsFailed = 0;

  for (const collab of upcoming) {
    // Optimistic claim: if another run already grabbed this collab between
    // our fetch above and here, count is 0 and we skip it rather than
    // double-send — same pattern as event-reminders' own claim.
    const claimed = await prisma.collabBoardPost.updateMany({
      where: { id: collab.id, sessionReminderSentAt: null },
      data: { sessionReminderSentAt: now },
    });
    if (claimed.count === 0) continue;

    // Isolated per collab: sessionReminderSentAt is already claimed above
    // (so this collab's current occurrence is never retried), so an
    // unexpected error here must not abort the loop and skip every other
    // session still due in this run.
    try {
      const participants = await prisma.collabParticipant.findMany({
        where: { collabId: collab.id },
        select: { userId: true },
      });
      const recipientIds = new Set([collab.authorId, ...participants.map((p) => p.userId)]);

      const title = collab.title.trim().slice(0, 80) || "Your collaboration";
      const body = "Starting soon";

      await prisma.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          recipientId,
          actorId: collab.authorId,
          type: "COLLAB_SESSION_REMINDER" as const,
          collabId: collab.id,
        })),
      });

      for (const recipientId of recipientIds) {
        await sendPushToUser(recipientId, { title, body, url: `/collab/${collab.id}` });
        await sendFcmActivityToUser(recipientId, {
          title,
          body,
          type: "COLLAB_SESSION_REMINDER",
          url: `/collab/${collab.id}`,
        });
      }

      remindersSent += recipientIds.size;

      // Rolls the schedule forward to its next occurrence and resets the
      // claim for it — a recurring schedule needs a fresh reminder every
      // cycle, unlike a one-off Post event (which only ever reminds once).
      // scheduleTime can't actually be null here (nextSessionAt is only
      // ever set alongside it — see createCollabPost/updateCollabPost),
      // but the check keeps this resilient rather than asserting it.
      const next =
        collab.scheduleTime && collab.nextSessionAt
          ? nextOccurrence(collab.scheduleDays, collab.scheduleTime, collab.nextSessionAt)
          : null;
      await prisma.collabBoardPost.update({
        where: { id: collab.id },
        data: { nextSessionAt: next, sessionReminderSentAt: null },
      });
    } catch (err) {
      collabsFailed += 1;
      console.error(`[collab-session-reminders] failed to notify for collab ${collab.id}`, err);
      await captureError(err, { route: "cron/collab-session-reminders", collabId: collab.id });
    }
  }

  return NextResponse.json({ error: null, collabsProcessed: upcoming.length, remindersSent, collabsFailed });
}
