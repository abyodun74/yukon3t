import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, AuthError } from "@/lib/auth-guards";

/**
 * Combines what used to be 4 separately-polled endpoints (messages/
 * connections/notifications/announcements unread-count) into one — Nav
 * mounts all 4 badges for every signed-in user on every page, so 4
 * independent poll loops used to mean 4 separate requests (each re-running
 * requireUser()'s own DB lookup) every ~25s per active tab. One combined
 * fetch cuts that to 1 request and 1 requireUser() call, with the 4 actual
 * count queries run in parallel below — now triggered by a realtime signal
 * (see REALTIME_CHANNELS.navBadges) instead of a timer. See
 * src/lib/use-nav-badges.ts for the client side.
 */
export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { unreadMessages: 0, pendingConnections: 0, unreadNotifications: 0, hasNewAnnouncement: false },
        { status: 401 },
      );
    }
    throw err;
  }

  const [conversations, pendingConnections, unreadNotifications, latestAnnouncement] = await Promise.all([
    // Count conversations with an unread message, not total unread messages —
    // matches the per-conversation dot already shown on /messages. Based on
    // the caller's own ConversationMember.lastReadAt rather than
    // Message.readAt: readAt is a single field shared by every recipient,
    // which can't represent "read by some but not all" once a conversation
    // has more than one other member (group chats).
    prisma.conversation.findMany({
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
    }),
    prisma.connection.count({ where: { targetId: user.id, status: "PENDING" } }),
    prisma.notification.count({ where: { recipientId: user.id, readAt: null } }),
    prisma.announcement.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const unreadMessages = conversations.filter((c) => {
    const last = c.messages[0];
    const lastReadAt = c.members[0]?.lastReadAt;
    return last && (!lastReadAt || last.createdAt > lastReadAt);
  }).length;

  const hasNewAnnouncement =
    Boolean(latestAnnouncement) &&
    (!user.lastSeenAnnouncementAt || latestAnnouncement!.createdAt > user.lastSeenAnnouncementAt);

  return NextResponse.json({ unreadMessages, pendingConnections, unreadNotifications, hasNewAnnouncement });
}
