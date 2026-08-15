import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, AuthError } from "@/lib/auth-guards";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ unread: false }, { status: 401 });
    }
    throw err;
  }

  const latest = await prisma.announcement.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const unread = Boolean(latest) && (!user.lastSeenAnnouncementAt || latest!.createdAt > user.lastSeenAnnouncementAt);

  return NextResponse.json({ unread });
}
