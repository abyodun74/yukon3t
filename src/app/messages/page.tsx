import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { MarkDelivered } from "@/components/mark-delivered";
import { cn } from "@/lib/utils";

export default async function MessagesPage() {
  const me = await getOnboardedUserOrRedirect();

  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: me.id } } },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <MarkDelivered />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/messages/discover"
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Discover groups
          </Link>
          <Link
            href="/messages/new"
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            New group
          </Link>
        </div>
      </div>
      <div className="mt-6 space-y-2">
        {conversations.map((c) => {
          const myMembership = c.members.find((m) => m.user.id === me.id);
          const other = c.members.find((m) => m.user.id !== me.id)?.user;
          const label = c.isGroup
            ? (c.name ?? "Group")
            : (other?.name ?? "Unknown");
          const last = c.messages[0];
          const unread = Boolean(
            last &&
              last.senderId !== me.id &&
              (!myMembership?.lastReadAt || last.createdAt > myMembership.lastReadAt),
          );
          return (
            <Link
              key={c.id}
              href={`/messages/${c.id}`}
              className="flex items-center justify-between rounded-xl border border-line p-4 hover:border-accent"
            >
              <div className="min-w-0">
                <p className={cn("break-words font-medium", unread && "font-semibold")}>{label}</p>
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
