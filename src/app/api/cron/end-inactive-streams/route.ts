import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteCallRoom } from "@/lib/daily";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Triggered on a schedule (Netlify Scheduled Function), not by a user
 * request — protected by a shared secret, same pattern as the
 * expire-stories cron. Ends any LIVE stream whose host/co-admins have gone
 * quiet for 30+ minutes (LiveStream.lastHostActivityAt, bumped by
 * recordLiveStreamHeartbeat). Reimplements endLiveStream's two core steps
 * directly rather than calling that action — it's user-session-authenticated
 * and a cron has no session.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 30 * 60 * 1000);

  const candidates = await prisma.liveStream.findMany({
    where: {
      status: "LIVE",
      startedAt: { lte: cutoff },
      OR: [{ lastHostActivityAt: { lte: cutoff } }, { lastHostActivityAt: null }],
    },
    select: { id: true, roomName: true },
    take: 100,
  });

  if (candidates.length === 0) {
    return NextResponse.json({ error: null, ended: 0 });
  }

  await Promise.all(
    candidates.map(async (stream) => {
      await prisma.liveStream.update({
        where: { id: stream.id },
        data: { status: "ENDED", endedAt: new Date() },
      });
      await deleteCallRoom(stream.roomName);
    }),
  );

  return NextResponse.json({ error: null, ended: candidates.length });
}
