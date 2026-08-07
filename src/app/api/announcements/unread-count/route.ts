import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ unread: false }, { status: 401 });
  }

  const [user, latest] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { lastSeenAnnouncementAt: true },
    }),
    prisma.announcement.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const unread = Boolean(latest) && (!user?.lastSeenAnnouncementAt || latest!.createdAt > user.lastSeenAnnouncementAt);

  return NextResponse.json({ unread });
}
