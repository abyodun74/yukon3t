import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteCallRoom } from "@/lib/daily";
import { isCronAuthorized } from "@/lib/cron-auth";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { sweepUnannouncedLiveStreams } from "@/lib/live-stream-announce";
import { LIVE_START_PENDING_STALE_MS, ROOM_DELETE_CONCURRENCY, runWithConcurrency } from "@/lib/live-stream-start";
import { captureError } from "@/lib/error-tracking";

/** A stream whose host and co-hosts have sent no heartbeat for this long is ended. */
const INACTIVE_AFTER_MS = 30 * 60 * 1000;
const END_BATCH = 100;

/**
 * Triggered on a schedule (Netlify Scheduled Function, every minute), not by a user request — protected by a
 * shared secret, same pattern as the expire-stories cron. Three jobs, each independent of the others' failures:
 *
 * 1. Ends any LIVE stream whose host/co-hosts have gone quiet for 30+ minutes (LiveStream.lastHostActivityAt,
 *    bumped by recordLiveStreamHeartbeat), and any start that died before its room was attached (roomName still
 *    "" after LIVE_START_PENDING_STALE_MS). Reimplements endLiveStream's two core steps directly rather than
 *    calling that action — it's user-session-authenticated and a cron has no session. The status write is guarded
 *    on LIVE, so a host ending at the same moment is harmless; room deletions run a few at a time (Daily
 *    rate-limits deletes) and are best-effort (every room also has its own `exp`).
 * 2. Retries "X is live" announcements that the start's own `after` callback lost or failed
 *    (sweepUnannouncedLiveStreams), exactly once per stream.
 * 3. Tells open Home tabs when it ended anything, so an ended stream doesn't linger in "Live now".
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const cutoff = new Date(now - INACTIVE_AFTER_MS);
  const pendingCutoff = new Date(now - LIVE_START_PENDING_STALE_MS);

  let ended = 0;
  try {
    const candidates = await prisma.liveStream.findMany({
      where: {
        status: "LIVE",
        OR: [
          { startedAt: { lte: cutoff }, OR: [{ lastHostActivityAt: { lte: cutoff } }, { lastHostActivityAt: null }] },
          { roomName: "", startedAt: { lte: pendingCutoff } },
        ],
      },
      select: { id: true, roomName: true },
      take: END_BATCH,
    });

    if (candidates.length > 0) {
      const result = await prisma.liveStream.updateMany({
        where: { id: { in: candidates.map((c) => c.id) }, status: "LIVE" },
        data: { status: "ENDED", endedAt: new Date(now) },
      });
      ended = result.count;
      await runWithConcurrency(
        candidates.filter((c) => c.roomName),
        ROOM_DELETE_CONCURRENCY,
        (c) => deleteCallRoom(c.roomName),
      );
    }
  } catch (err) {
    await captureError(err, { cron: "end-inactive-streams", step: "end" });
  }

  let announce = { announced: 0, expired: 0 };
  try {
    announce = await sweepUnannouncedLiveStreams(new Date(now));
  } catch (err) {
    await captureError(err, { cron: "end-inactive-streams", step: "announce" });
  }

  if (ended > 0) {
    await publishEvent(REALTIME_CHANNELS.liveStreams(), "changed");
  }

  return NextResponse.json({ error: null, ended, ...announce });
}
