import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ count: 0 }, { status: 401 });
  }

  // Count conversations with an unread message, not total unread messages —
  // matches the per-conversation dot already shown on /messages. Based on
  // the caller's own ConversationMember.lastReadAt rather than Message.readAt:
  // readAt is a single field shared by every recipient, which can't
  // represent "read by some but not all" once a conversation has more than
  // one other member (group chats).
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: session.user.id } } },
    select: {
      members: { where: { userId: session.user.id }, select: { lastReadAt: true } },
      messages: {
        where: { senderId: { not: session.user.id }, NOT: { deletedForUserIds: { has: session.user.id } } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const count = conversations.filter((c) => {
    const last = c.messages[0];
    const lastReadAt = c.members[0]?.lastReadAt;
    return last && (!lastReadAt || last.createdAt > lastReadAt);
  }).length;

  return NextResponse.json({ count });
}
