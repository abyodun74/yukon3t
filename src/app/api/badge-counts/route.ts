import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireViewer, AuthError } from "@/lib/auth-guards";
import { getHiddenState } from "@/lib/hidden-chats";
import { visibleNotificationWhere } from "@/lib/hidden-chats-rules";
import { circleNotificationVisibleWhere } from "@/lib/circle-visibility";
import { rememberLocale } from "@/lib/user-locale";
import { countConversationsWithUnread } from "@/lib/latest-messages";

/** Most unread notifications counted; see the count query below. */
const UNREAD_NOTIFICATIONS_COUNT_CAP = 100;

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
    user = await requireViewer();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { unreadMessages: 0, pendingConnections: 0, unreadNotifications: 0, hasNewAnnouncement: false },
        { status: 401 },
      );
    }
    throw err;
  }
  // A guest preview session (src/lib/guest-preview.ts) has no inbox, requests or bell: always zero, nothing written
  // (no rememberLocale), and nothing anyone sends to the shared guest identity can ever surface here.
  if (user.isGuestPreview) {
    return NextResponse.json({ unreadMessages: 0, pendingConnections: 0, unreadNotifications: 0, hasNewAnnouncement: false });
  }

  // The language notifications are written in follows the one this device uses (src/lib/user-locale.ts). Writes only
  // when it changed, compared against the row requireUser already read.
  await rememberLocale(user.id, user.locale);

  // Hidden chats count for nothing here: no unread dot, no bell count, no connection-request count for a hidden peer.
  // An unread message in a hidden chat must leave every badge exactly as it was.
  const hidden = await getHiddenState(user.id);

  const [unreadMessages, pendingConnections, unreadNotifications, latestAnnouncement] = await Promise.all([
    // Count conversations with an unread message, not total unread messages —
    // matches the per-conversation dot already shown on /messages. Based on
    // the caller's own ConversationMember.lastReadAt rather than
    // Message.readAt: readAt is a single field shared by every recipient,
    // which can't represent "read by some but not all" once a conversation
    // has more than one other member (group chats). One EXISTS per
    // non-hidden membership in the database (src/lib/latest-messages.ts),
    // never a load of the chats' messages.
    countConversationsWithUnread(user.id),
    prisma.connection.count({
      where: { targetId: user.id, status: "PENDING", requesterId: { notIn: hidden.peerIds } },
    }),
    prisma.notification.count({
      // Same rows /notifications lists: none from a hidden chat, none about a PRIVATE Circle the reader isn't in.
      where: {
        recipientId: user.id,
        readAt: null,
        AND: [...visibleNotificationWhere(hidden), circleNotificationVisibleWhere(user.id)],
      },
      // The bell shows "9+" past 9 (its aria-label says the number, so it reads at most 100): capping lets Postgres
      // stop there instead of evaluating the visibility filters on every unread row.
      take: UNREAD_NOTIFICATIONS_COUNT_CAP,
    }),
    prisma.announcement.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const hasNewAnnouncement =
    Boolean(latestAnnouncement) &&
    (!user.lastSeenAnnouncementAt || latestAnnouncement!.createdAt > user.lastSeenAnnouncementAt);

  return NextResponse.json({ unreadMessages, pendingConnections, unreadNotifications, hasNewAnnouncement });
}
