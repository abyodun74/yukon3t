import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendFcmEventReminderToUser } from "@/lib/fcm";
import { isCronAuthorized } from "@/lib/cron-auth";

// How far ahead to look for events that are about to start. Matched to the
// scheduled function's own run interval (every 15 minutes, see
// netlify/functions/event-reminders.mts) plus some slack, so an event isn't
// missed if it lands right at the edge of two runs.
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

  const upcoming = await prisma.post.findMany({
    where: {
      moderationStatus: "PUBLISHED",
      eventAt: { gte: now, lte: windowEnd },
      eventReminderSentAt: null,
    },
    select: { id: true, authorId: true, content: true, eventLocation: true },
  });

  let remindersSent = 0;
  let postsFailed = 0;

  for (const post of upcoming) {
    // Optimistic claim: if another run already grabbed this post between our
    // fetch above and here, count is 0 and we skip it rather than double-send.
    const claimed = await prisma.post.updateMany({
      where: { id: post.id, eventReminderSentAt: null },
      data: { eventReminderSentAt: now },
    });
    if (claimed.count === 0) continue;

    // Isolated per post: eventReminderSentAt is already claimed above (so
    // this post is never retried), so an unexpected error here must not
    // abort the loop and skip every other event still due in this run.
    try {
      const rsvps = await prisma.postRsvp.findMany({
        where: { postId: post.id },
        select: { userId: true },
      });
      const recipientIds = new Set([post.authorId, ...rsvps.map((r) => r.userId)]);

      const title = post.content.trim().slice(0, 80) || "Your event";
      const body = post.eventLocation ? `Starting soon at ${post.eventLocation}` : "Starting soon";

      await prisma.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          recipientId,
          actorId: post.authorId,
          type: "EVENT_REMINDER" as const,
          postId: post.id,
        })),
      });

      for (const recipientId of recipientIds) {
        await sendPushToUser(recipientId, { title, body, url: `/post/${post.id}` });
        await sendFcmEventReminderToUser(recipientId, { postId: post.id, title });
      }

      remindersSent += recipientIds.size;
    } catch (err) {
      postsFailed += 1;
      console.error(`[event-reminders] failed to notify for post ${post.id}`, err);
    }
  }

  return NextResponse.json({ error: null, postsProcessed: upcoming.length, remindersSent, postsFailed });
}
