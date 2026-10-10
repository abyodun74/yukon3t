import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteCallRoom } from "@/lib/daily";
import { isCronAuthorized } from "@/lib/cron-auth";
import { notifyMissedCall } from "@/lib/missed-call";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

// Same as createCallRoom's default room lifetime (daily.ts). A RINGING row
// older than this is leftover backlog rather than a call that just rang out
// (this cron was written well before it was first scheduled, and can fall
// behind again after an outage) — its Daily room has already expired on its
// own, and telling the callee about it now would be a "missed call" push for
// something that happened hours or weeks ago. Those are closed out silently.
const NOTIFY_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Triggered on a schedule, same pattern as the other src/app/api/cron/*
 * routes — protected by CRON_SECRET, not a user session. Covers the case
 * startCall/endCall don't: nobody ever hangs up or responds (the caller
 * leaves the tab open, the app is killed, etc.), so the Call row would
 * otherwise sit at RINGING forever and the callee never learns they missed
 * it. The native ring UI already gives up client-side after 55s
 * (CallForegroundService.RING_TIMEOUT_MS in the Android app) — this cutoff
 * is a little past that so, by the time this runs, the ring has already
 * stopped locally either way.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 60 * 1000);
  const notifyCutoff = new Date(Date.now() - NOTIFY_MAX_AGE_MS);

  const stale = await prisma.call.findMany({
    where: { status: "RINGING", createdAt: { lte: cutoff } },
    include: { caller: { select: { id: true, name: true } } },
    // Newest first, so a backlog bigger than one tick's `take` never delays
    // a call that only just rang out.
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  if (stale.length === 0) {
    return NextResponse.json({ error: null, missed: 0 });
  }

  let missed = 0;
  await Promise.all(
    stale.map(async (call) => {
      // Guarded on status: the callee may accept/decline between the
      // findMany above and this update, and that response should win — a
      // 0-count result means it beat us to it, so skip the notification too.
      const { count } = await prisma.call.updateMany({
        where: { id: call.id, status: "RINGING" },
        data: { status: "MISSED", endedAt: new Date() },
      });
      if (count === 0) return;

      missed++;
      if (call.createdAt < notifyCutoff) return;

      await deleteCallRoom(call.roomName);
      // Nothing else tells either side's open UI (the caller's "Calling"
      // sheet, the callee's in-app ring banner) that the status changed —
      // same signal endCall publishes, but to both parties since neither of
      // them triggered this.
      await Promise.all([
        publishEvent(REALTIME_CHANNELS.callSignal(call.callerId), "changed"),
        publishEvent(REALTIME_CHANNELS.callSignal(call.calleeId), "changed"),
      ]);
      await notifyMissedCall({
        callId: call.id,
        callerId: call.callerId,
        callerName: call.caller.name ?? "Someone",
        calleeId: call.calleeId,
      });
    }),
  );

  return NextResponse.json({ error: null, missed });
}
