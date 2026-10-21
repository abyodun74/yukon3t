import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureError } from "@/lib/error-tracking";
import { EVENT_SERIES_CRON_BATCH, nextOccurrence, seriesDueCutoff } from "@/lib/event-recurrence";

/**
 * Repeating Circle events: posts each series' next occurrence shortly after its latest one has started
 * (EVENT_SERIES_ROLLOVER_DELAY_MS), so exactly one occurrence is ahead at a time. Scheduled every 15 minutes by
 * netlify/functions/event-series.mts, the same pattern as event-reminders.
 *
 * Each new occurrence is an ordinary event Post in the series' channel, copying its text, location and feed category
 * (the embedding is copied from the latest occurrence that has one, so no OpenAI call). It deliberately notifies nobody:
 * no subscriber/connection fan-out and no Home feed signal (members still get the usual event-reminders once they
 * RSVP). Idempotent: the series row is claimed with an updateMany guarded on the lastIndex read, inside the same
 * transaction that creates the post, and (eventSeriesId, eventSeriesIndex) is unique, so overlapping runs can't create
 * an occurrence twice.
 *
 * A series ends (endedAt) instead of continuing when no occurrence is left, when its author is no longer an ACTIVE
 * member who can post in that channel, or when any occurrence was held or removed by moderation. A deleted Circle,
 * channel or author deletes the series with it (cascade).
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.eventSeries.findMany({
    where: { endedAt: null, lastOccurrenceAt: { lte: seriesDueCutoff(now) } },
    orderBy: { lastOccurrenceAt: "asc" },
    take: EVENT_SERIES_CRON_BATCH,
    select: {
      id: true,
      circleId: true,
      channelId: true,
      authorId: true,
      frequency: true,
      anchorAt: true,
      maxOccurrences: true,
      until: true,
      content: true,
      eventLocation: true,
      feedCategory: true,
      lastIndex: true,
      author: { select: { status: true } },
      circle: { select: { createdById: true } },
      channel: { select: { id: true, type: true, visibility: true } },
    },
  });

  let created = 0;
  let ended = 0;
  let failed = 0;

  for (const series of due) {
    try {
      const end = () =>
        prisma.eventSeries.updateMany({ where: { id: series.id, endedAt: null }, data: { endedAt: now } });

      const next = nextOccurrence(series, series.lastIndex, now);
      if (!next || !(await authorCanStillPost(series)) || (await hasModeratedOccurrence(series.id))) {
        const result = await end();
        ended += result.count;
        continue;
      }

      const post = await prisma.$transaction(async (tx) => {
        const claimed = await tx.eventSeries.updateMany({
          where: { id: series.id, endedAt: null, lastIndex: series.lastIndex },
          data: { lastIndex: next.index, lastOccurrenceAt: next.at },
        });
        if (claimed.count === 0) return null;
        return tx.post.create({
          data: {
            authorId: series.authorId,
            circleId: series.circleId,
            channelId: series.channelId,
            content: series.content,
            // Inside a Circle membership is the access boundary; stored PUBLIC like every Circle post (createPost).
            visibility: "PUBLIC",
            mediaType: "NONE",
            feedCategory: series.feedCategory,
            eventAt: next.at,
            eventLocation: series.eventLocation,
            eventSeriesId: series.id,
            eventSeriesIndex: next.index,
          },
          select: { id: true },
        });
      });
      if (!post) continue;
      created += 1;

      // Best-effort: semantic search/category tabs read Post.embedding; the text is the series', so any occurrence's
      // vector is this one's too. A failure here leaves the occurrence without one, nothing worse.
      try {
        await prisma.$executeRaw`
          UPDATE "Post" SET "embedding" = (
            SELECT "embedding" FROM "Post"
            WHERE "eventSeriesId" = ${series.id} AND "embedding" IS NOT NULL AND "id" <> ${post.id}
            ORDER BY "eventSeriesIndex" DESC LIMIT 1
          )
          WHERE "id" = ${post.id}`;
      } catch (err) {
        console.error(`[event-series] embedding copy failed for post ${post.id}`, err);
      }
    } catch (err) {
      failed += 1;
      console.error(`[event-series] failed for series ${series.id}`, err);
      await captureError(err, { route: "cron/event-series", seriesId: series.id });
    }
  }

  return NextResponse.json({ error: null, seriesProcessed: due.length, created, ended, failed });
}

/** The author is ACTIVE, still a member (or the owner), and can open the channel (canAccessChannel's rule). */
async function authorCanStillPost(series: {
  circleId: string;
  authorId: string;
  author: { status: string };
  circle: { createdById: string };
  channel: { id: string; type: string; visibility: string };
}) {
  if (series.author.status !== "ACTIVE" || series.channel.type !== "TEXT") return false;
  const membership = await prisma.circleMembership.findUnique({
    where: { userId_circleId: { userId: series.authorId, circleId: series.circleId } },
    select: { role: true },
  });
  if (!membership) return false;
  if (series.channel.visibility === "PUBLIC") return true;
  if (series.circle.createdById === series.authorId || membership.role === "MODERATOR") return true;
  const allowed = await prisma.channelMembership.findUnique({
    where: { channelId_userId: { channelId: series.channel.id, userId: series.authorId } },
    select: { id: true },
  });
  return !!allowed;
}

/** Whether moderation held or removed any occurrence: the series' text is then not reposted. */
async function hasModeratedOccurrence(seriesId: string) {
  const held = await prisma.post.findFirst({
    where: { eventSeriesId: seriesId, moderationStatus: { not: "PUBLISHED" } },
    select: { id: true },
  });
  return !!held;
}
