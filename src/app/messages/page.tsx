import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { MarkDelivered } from "@/components/mark-delivered";
import { MessagesInboxList, type InboxItem } from "@/components/messages-inbox-list";

export default async function MessagesPage() {
  const me = await getOnboardedUserOrRedirect();

  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: me.id } } },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
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

  const items: InboxItem[] = conversations.map((c) => {
    const myMembership = c.members.find((m) => m.user.id === me.id);
    const other = c.members.find((m) => m.user.id !== me.id)?.user;
    const label = c.isGroup ? (c.name ?? "Group") : (other?.name ?? "Unknown");
    const last = c.messages[0];
    const unread = Boolean(
      last &&
        last.senderId !== me.id &&
        (!myMembership?.lastReadAt || last.createdAt > myMembership.lastReadAt),
    );
    return {
      id: c.id,
      label,
      isGroup: c.isGroup,
      avatarUrl: c.isGroup ? null : (other?.avatarUrl ?? null),
      last: last
        ? {
            content: last.content,
            mediaType: last.mediaType,
            moderationStatus: last.moderationStatus,
            createdAt: last.createdAt,
            mine: last.senderId === me.id,
            // Only meaningful for groups — a DM's preview never needs to
            // say who sent it, since the row itself is already that person.
            senderName: c.members.find((m) => m.user.id === last.senderId)?.user.name ?? null,
          }
        : null,
      unread,
    };
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <MarkDelivered />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <div className="flex items-center gap-1">
          <Link
            href="/messages/discover"
            aria-label="Discover groups"
            title="Discover groups"
            className="rounded-full p-2 text-foreground-soft hover:bg-line hover:text-accent"
          >
            <Users size={20} />
          </Link>
          <Link
            href="/messages/new"
            aria-label="New group"
            title="New group"
            className="rounded-full p-2 text-foreground-soft hover:bg-line hover:text-accent"
          >
            <Plus size={20} />
          </Link>
        </div>
      </div>

      <div className="mt-5">
        <MessagesInboxList items={items} />
      </div>
    </div>
  );
}
