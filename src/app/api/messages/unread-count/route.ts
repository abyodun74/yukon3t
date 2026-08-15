import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, AuthError } from "@/lib/auth-guards";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ count: 0 }, { status: 401 });
    }
    throw err;
  }
  // Count conversations with an unread message, not total unread messages —
  // matches the per-conversation dot already shown on /messages. Based on
  // the caller's own ConversationMember.lastReadAt rather than Message.readAt:
  // readAt is a single field shared by every recipient, which can't
  // represent "read by some but not all" once a conversation has more than
  // one other member (group chats).
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: user.id } } },
    select: {
      members: { where: { userId: user.id }, select: { lastReadAt: true } },
      messages: {
        where: { senderId: { not: user.id }, NOT: { deletedForUserIds: { has: user.id } } },
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
