import { prisma } from "@/lib/prisma";
import { isOnline } from "@/lib/presence";
import { inboxPreview } from "@/lib/e2ee/secret-chat";
import type { InboxItem } from "@/components/messages-inbox-list";
import { messagesEn } from "@/lib/i18n/en";

/**
 * The rows of a conversation list for one user: "visible" is the Messages inbox, "hidden" is the PIN-locked area
 * (/messages/hidden) — the same query split on the caller's own ConversationMember.hiddenAt, so a conversation is
 * always in exactly one of the two. Callers of "hidden" must have checked isHiddenUnlocked first.
 */
export async function getInboxItems(
  userId: string,
  which: "visible" | "hidden",
  /** What a row is called when the data has no name for it, in the reader's language. */
  names: Pick<typeof messagesEn.fallback, "group" | "unknown" | "message"> = messagesEn.fallback,
): Promise<InboxItem[]> {
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId, hiddenAt: which === "hidden" ? { not: null } : null } } },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, avatarUrl: true, lastSeenAt: true } } },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, mediaType: true, moderationStatus: true, createdAt: true, senderId: true },
      },
    },
  });

  // Ordering by conversation.createdAt (when the thread was first created)
  // would leave an old thread pinned near the bottom even after a fresh
  // reply just landed in it — sort by the most recent activity instead,
  // falling back to the thread's own createdAt for a still-empty one.
  conversations.sort((a, b) => {
    const aTime = (a.messages[0]?.createdAt ?? a.createdAt).getTime();
    const bTime = (b.messages[0]?.createdAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });

  return conversations.map((c) => {
    const myMembership = c.members.find((m) => m.user.id === userId);
    const other = c.members.find((m) => m.user.id !== userId)?.user;
    const label = c.isGroup ? (c.name ?? names.group) : (other?.name ?? names.unknown);
    const last = c.messages[0];
    const unread = Boolean(
      last &&
        last.senderId !== userId &&
        (!myMembership?.lastReadAt || last.createdAt > myMembership.lastReadAt),
    );
    return {
      id: c.id,
      label,
      isGroup: c.isGroup,
      avatarUrl: c.isGroup ? null : (other?.avatarUrl ?? null),
      online: c.isGroup ? false : isOnline(other?.lastSeenAt ?? null),
      last: last
        ? {
            content: inboxPreview(last.content, names.message),
            mediaType: last.mediaType,
            moderationStatus: last.moderationStatus,
            createdAt: last.createdAt,
            mine: last.senderId === userId,
            // Only meaningful for groups — a DM's preview never needs to
            // say who sent it, since the row itself is already that person.
            senderName: c.members.find((m) => m.user.id === last.senderId)?.user.name ?? null,
          }
        : null,
      unread,
    };
  });
}
