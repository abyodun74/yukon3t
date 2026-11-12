import { prisma } from "@/lib/prisma";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { activityLine, nameOrSomeone } from "@/lib/push-text";
import type { Locale } from "@/lib/i18n/locales";
import { captureError } from "@/lib/error-tracking";
import {
  announceSweepAction,
  announcementKind,
  chunk,
  LIVE_ANNOUNCE_MAX_AGE_MS,
  LIVE_ANNOUNCE_RETRY_AFTER_MS,
  LIVE_ANNOUNCE_SWEEP_LIMIT,
  liveAnnounceLockKey,
  NOTIFICATION_INSERT_BATCH,
} from "@/lib/live-stream-start";

// Generous: a host with many subscribers writes a few batched INSERTs inside this transaction.
const ANNOUNCE_TX_TIMEOUT_MS = 20_000;

/**
 * Tells the people a stream was started for that it's live: the one invited person (LIVE_STREAM_INVITE, bell +
 * push), a Circle's members (CIRCLE_LIVE, bell only) or the host's subscribers (SUBSCRIPTION_LIVE, bell only).
 *
 * Never part of the host's start: startLiveStream schedules this with next/server `after`, once the host already
 * has their room and token, and the end-inactive-streams cron retries any stream still unannounced
 * (sweepUnannouncedLiveStreams). So a slow or failing fan-out (a host with many subscribers, a database blip, a
 * push provider timeout) can never delay or fail anyone's going live.
 *
 * Exactly once, however many times it runs: the bell rows and `announcedAt` are written in one transaction under a
 * per-stream advisory lock that re-reads `announcedAt` first, so a retry after a failure (which rolled everything
 * back) sends everything, and a retry after a success, or one racing it, sends nothing. Only the invite's push is
 * sent after the commit, and only by the run that committed. Never throws.
 */
export async function announceLiveStream(liveStreamId: string): Promise<"announced" | "skipped" | "failed"> {
  try {
    const invite = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${liveAnnounceLockKey(liveStreamId)}))`;
        const stream = await tx.liveStream.findUnique({
          where: { id: liveStreamId },
          select: {
            id: true,
            hostId: true,
            circleId: true,
            targetUserId: true,
            status: true,
            roomName: true,
            announcedAt: true,
            host: { select: { name: true } },
          },
        });
        // Already announced, ended before it was announced, or never got a room (a start that failed part-way).
        if (!stream || stream.announcedAt || stream.status !== "LIVE" || !stream.roomName) return null;

        const kind = announcementKind(stream);
        if (kind === "invite") {
          await tx.notification.create({
            data: {
              recipientId: stream.targetUserId!,
              actorId: stream.hostId,
              type: "LIVE_STREAM_INVITE",
              liveStreamId: stream.id,
            },
          });
        } else if (kind === "circle") {
          // Only the Circle's own members, whether it is PUBLIC or PRIVATE: picking a Circle as the audience
          // means exactly its members are told, never the host's wider subscriber base.
          const members = await tx.circleMembership.findMany({
            where: { circleId: stream.circleId! },
            select: { userId: true },
          });
          const memberIds = members.map((m) => m.userId).filter((id) => id !== stream.hostId);
          for (const batch of chunk(memberIds, NOTIFICATION_INSERT_BATCH)) {
            await tx.notification.createMany({
              data: batch.map((recipientId) => ({
                recipientId,
                actorId: stream.hostId,
                type: "CIRCLE_LIVE" as const,
                circleId: stream.circleId,
                liveStreamId: stream.id,
              })),
            });
          }
        } else {
          await notifySubscribers(stream.hostId, "SUBSCRIPTION_LIVE", { liveStreamId: stream.id }, { db: tx });
        }

        await tx.liveStream.update({ where: { id: stream.id }, data: { announcedAt: new Date() } });
        return kind === "invite" ? { recipientId: stream.targetUserId!, hostName: stream.host.name } : undefined;
      },
      { timeout: ANNOUNCE_TX_TIMEOUT_MS },
    );

    if (invite === null) return "skipped";
    if (invite) await sendInvitePush(liveStreamId, invite.recipientId, invite.hostName);
    return "announced";
  } catch (err) {
    console.error("announceLiveStream failed:", err);
    await captureError(err, { action: "announceLiveStream", liveStreamId });
    return "failed";
  }
}

/** A stream started "with" one person is a single-recipient, happening-now invite, so it pushes as well (best-effort). */
async function sendInvitePush(liveStreamId: string, recipientId: string, hostName: string | null) {
  const invitePush = (locale: Locale) => ({
    title: nameOrSomeone(hostName, locale),
    body: activityLine("LIVE_STREAM_INVITE", locale),
    url: `/live/${liveStreamId}`,
  });
  await Promise.allSettled([
    sendPushToUser(recipientId, invitePush),
    sendFcmActivityToUser(recipientId, (locale) => ({ ...invitePush(locale), type: "LIVE_STREAM_INVITE" })),
  ]);
}

/**
 * The cron's backstop for announceLiveStream: retries LIVE streams still unannounced LIVE_ANNOUNCE_RETRY_AFTER_MS
 * after they started (the `after` callback was lost or failed), and marks ones older than LIVE_ANNOUNCE_MAX_AGE_MS
 * announced without sending (old news by then). One at a time, at most LIVE_ANNOUNCE_SWEEP_LIMIT per run.
 */
export async function sweepUnannouncedLiveStreams(now = new Date()) {
  const expired = await prisma.liveStream.updateMany({
    where: {
      status: "LIVE",
      announcedAt: null,
      startedAt: { lt: new Date(now.getTime() - LIVE_ANNOUNCE_MAX_AGE_MS) },
    },
    data: { announcedAt: now },
  });

  const due = await prisma.liveStream.findMany({
    where: {
      status: "LIVE",
      announcedAt: null,
      roomName: { not: "" },
      startedAt: { lte: new Date(now.getTime() - LIVE_ANNOUNCE_RETRY_AFTER_MS) },
    },
    orderBy: { startedAt: "asc" },
    select: { id: true, startedAt: true },
    take: LIVE_ANNOUNCE_SWEEP_LIMIT,
  });

  let announced = 0;
  for (const stream of due) {
    if (announceSweepAction(stream.startedAt, now) !== "announce") continue;
    if ((await announceLiveStream(stream.id)) === "announced") announced++;
  }
  return { announced, expired: expired.count };
}
