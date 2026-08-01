import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ count: 0 }, { status: 401 });
  }

  // Count conversations with an unread message, not total unread messages —
  // matches the per-conversation dot already shown on /messages.
  const unread = await prisma.message.findMany({
    where: {
      conversation: { members: { some: { userId: session.user.id } } },
      senderId: { not: session.user.id },
      readAt: null,
      NOT: { deletedForUserIds: { has: session.user.id } },
    },
    select: { conversationId: true },
    distinct: ["conversationId"],
  });

  return NextResponse.json({ count: unread.length });
}
