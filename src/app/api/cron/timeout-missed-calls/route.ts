import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteCallRoom } from "@/lib/daily";
import { isCronAuthorized } from "@/lib/cron-auth";
import { notifyMissedCall } from "@/lib/missed-call";

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

  const stale = await prisma.call.findMany({
    where: { status: "RINGING", createdAt: { lte: cutoff } },
    include: { caller: { select: { id: true, name: true } } },
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
      await deleteCallRoom(call.roomName);
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
