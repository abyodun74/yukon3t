import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { pushText } from "@/lib/push-text";
import type { Locale } from "@/lib/i18n/locales";
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
  // Recurring occurrences reminded in this run, so a one-off at the very same time isn't announced twice.
  const remindedOccurrences = new Set<string>();

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
      remindersSent += await sendSessionReminders(collab);
      if (collab.nextSessionAt) remindedOccurrences.add(`${collab.id}:${collab.nextSessionAt.getTime()}`);

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

  // One-off sessions (CollabBoardPost.oneOffSessionAt, set by scheduling from a poll): the same reminder, once, from
  // its own claim column. Nothing rolls forward and nothing here touches nextSessionAt, so a recurring schedule on the
  // same collab carries on exactly as above.
  const oneOffs = await prisma.collabBoardPost.findMany({
    where: {
      status: "OPEN",
      oneOffSessionAt: { gte: now, lte: windowEnd },
      oneOffReminderSentAt: null,
    },
    select: { id: true, authorId: true, title: true, oneOffSessionAt: true },
  });
  for (const collab of oneOffs) {
    const claimed = await prisma.collabBoardPost.updateMany({
      where: { id: collab.id, oneOffReminderSentAt: null },
      data: { oneOffReminderSentAt: now },
    });
    if (claimed.count === 0) continue;
    if (remindedOccurrences.has(`${collab.id}:${collab.oneOffSessionAt!.getTime()}`)) continue;
    try {
      remindersSent += await sendSessionReminders(collab);
    } catch (err) {
      collabsFailed += 1;
      console.error(`[collab-session-reminders] failed to notify for one-off session of collab ${collab.id}`, err);
      await captureError(err, { route: "cron/collab-session-reminders", collabId: collab.id, oneOff: true });
    }
  }

  return NextResponse.json({
    error: null,
    collabsProcessed: upcoming.length + oneOffs.length,
    remindersSent,
    collabsFailed,
  });
}

/** COLLAB_SESSION_REMINDER (bell, web push, FCM) to the collab's author and every participant; how many were sent. */
async function sendSessionReminders(collab: { id: string; authorId: string; title: string }) {
  const participants = await prisma.collabParticipant.findMany({
    where: { collabId: collab.id },
    select: { userId: true },
  });
  const recipientIds = new Set([collab.authorId, ...participants.map((p) => p.userId)]);

  const collabTitle = collab.title.trim().slice(0, 80);
  // In each recipient's language: only the fallback title and the line under it are ours to word.
  const reminder = (locale: Locale) => {
    const t = pushText(locale).reminders;
    return { title: collabTitle || t.collabTitle, body: t.collabStartingSoon, url: `/collab/${collab.id}` };
  };

  await prisma.notification.createMany({
    data: [...recipientIds].map((recipientId) => ({
      recipientId,
      actorId: collab.authorId,
      type: "COLLAB_SESSION_REMINDER" as const,
      collabId: collab.id,
    })),
  });

  for (const recipientId of recipientIds) {
    await sendPushToUser(recipientId, reminder);
    await sendFcmActivityToUser(recipientId, (locale) => ({ ...reminder(locale), type: "COLLAB_SESSION_REMINDER" }));
  }

  return recipientIds.size;
}
