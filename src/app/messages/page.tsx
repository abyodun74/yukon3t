import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { MarkDelivered } from "@/components/mark-delivered";
import { cn } from "@/lib/utils";

export default async function MessagesPage() {
  const me = await getOnboardedUserOrRedirect();

  const [conversations, unreadMessages] = await Promise.all([
    prisma.conversation.findMany({
      where: { members: { some: { userId: me.id } } },
      include: {
        members: { include: { user: { select: { id: true, name: true } } } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.message.findMany({
      where: {
        conversation: { members: { some: { userId: me.id } } },
        senderId: { not: me.id },
        readAt: null,
      },
      select: { conversationId: true },
    }),
  ]);
  const unreadConversationIds = new Set(unreadMessages.map((m) => m.conversationId));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <MarkDelivered />
      <h1 className="text-2xl font-semibold">Messages</h1>
      <div className="mt-6 space-y-2">
        {conversations.map((c) => {
          const other = c.members.find((m) => m.user.id !== me.id)?.user;
          const last = c.messages[0];
          const unread = unreadConversationIds.has(c.id);
          return (
            <Link
              key={c.id}
              href={`/messages/${c.id}`}
              className="flex items-center justify-between rounded-xl border border-line p-4 hover:border-accent"
            >
              <div>
                <p className={cn("font-medium", unread && "font-semibold")}>
                  {other?.name ?? "Unknown"}
                </p>
                {last && (
                  <p
                    className={cn(
                      "mt-1 line-clamp-1 text-sm",
                      unread ? "font-medium text-foreground" : "text-foreground-soft",
                    )}
                  >
                    {last.moderationStatus === "PUBLISHED"
                      ? last.content
                      : "Message under review"}
                  </p>
                )}
              </div>
              {unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />}
            </Link>
          );
        })}
        {conversations.length === 0 && (
          <p className="text-sm text-foreground-soft">
            No conversations yet. Connect with someone from Discover first.
          </p>
        )}
      </div>
    </div>
  );
}
