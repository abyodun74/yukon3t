import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Triggered on a schedule (Netlify Scheduled Function), not by a user
 * request — protected by a shared secret, same pattern as the
 * event-reminders cron. Display already filters on expiresAt (see
 * /u/[userId]), so this is storage/DB hygiene, not what makes stories
 * actually disappear after 24h.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const expired = await prisma.story.findMany({
    where: { expiresAt: { lte: new Date() } },
    select: { id: true, mediaUrl: true, mediaThumbnailUrl: true },
    take: 200,
  });

  if (expired.length === 0) {
    return NextResponse.json({ error: null, deleted: 0 });
  }

  await prisma.story.deleteMany({ where: { id: { in: expired.map((s) => s.id) } } });

  await Promise.all(
    expired.flatMap((s) =>
      [s.mediaUrl, s.mediaThumbnailUrl]
        .filter((url): url is string => Boolean(url))
        .map((url) => {
          const key = keyFromPublicUrl(url);
          return key ? deleteObject(key) : Promise.resolve();
        }),
    ),
  );

  return NextResponse.json({ error: null, deleted: expired.length });
}
