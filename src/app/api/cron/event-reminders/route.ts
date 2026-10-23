import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { pushText } from "@/lib/push-text";
import { format, type Locale } from "@/lib/i18n/locales";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureError } from "@/lib/error-tracking";
import { filterCircleContentViewers } from "@/lib/circle-permissions";

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
      // A cancelled event reminds nobody. A rescheduled one had eventReminderSentAt cleared, so it is reminded for its
      // new time (rescheduleCircleEvent in actions/circle-events.ts).
      eventCancelledAt: null,
    },
    select: { id: true, authorId: true, circleId: true, content: true, eventLocation: true },
  });

  let remindersSent = 0;
  let postsFailed = 0;

  for (const post of upcoming) {
    // Optimistic claim: if another run already grabbed this post between our
    // fetch above and here, count is 0 and we skip it rather than double-send.
    const claimed = await prisma.post.updateMany({
      where: { id: post.id, eventReminderSentAt: null, eventCancelledAt: null, eventAt: { gte: now, lte: windowEnd } },
      data: { eventReminderSentAt: now },
    });
    if (claimed.count === 0) continue;

    // Isolated per post: eventReminderSentAt is already claimed above (so
    // this post is never retried), so an unexpected error here must not
    // abort the loop and skip every other event still due in this run.
    try {
      // Everyone who replied, Going or Maybe: a Maybe is still deciding and the reminder is what helps them (src/lib/rsvp.ts).
      const rsvps = await prisma.postRsvp.findMany({
        where: { postId: post.id },
        select: { userId: true },
      });
      // A PRIVATE Circle's event reminds its current members only: someone who RSVP'd and has since left (or was
      // removed, or RSVP'd while the Circle was public), and an author who left, no longer see it (lib/circle-visibility.ts).
      const candidates = [...new Set([post.authorId, ...rsvps.map((r) => r.userId)])];
      const recipientIds = new Set(
        post.circleId ? await filterCircleContentViewers(post.circleId, candidates) : candidates,
      );
      if (recipientIds.size === 0) continue;

      const eventTitle = post.content.trim().slice(0, 80);
      const location = post.eventLocation;
      // In each recipient's language: only the fallback title and the line under it are ours to word.
      const titleFor = (locale: Locale) => eventTitle || pushText(locale).reminders.eventTitle;
      const reminder = (locale: Locale) => {
        const t = pushText(locale).reminders;
        return {
          title: titleFor(locale),
          body: location ? format(t.eventStartingSoonAt, { location }) : t.eventStartingSoon,
          url: `/post/${post.id}`,
        };
      };

      await prisma.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          recipientId,
          actorId: post.authorId,
          type: "EVENT_REMINDER" as const,
          postId: post.id,
        })),
      });

      for (const recipientId of recipientIds) {
        await sendPushToUser(recipientId, reminder);
        // A visible notification that opens the event post, like the web push above. (It used to be a data-only
        // message, which neither app ever displayed.)
        await sendFcmActivityToUser(recipientId, (locale) => ({ ...reminder(locale), type: "EVENT_REMINDER" }));
      }

      remindersSent += recipientIds.size;
    } catch (err) {
      postsFailed += 1;
      console.error(`[event-reminders] failed to notify for post ${post.id}`, err);
      await captureError(err, { route: "cron/event-reminders", postId: post.id });
    }
  }

  return NextResponse.json({ error: null, postsProcessed: upcoming.length, remindersSent, postsFailed });
}
