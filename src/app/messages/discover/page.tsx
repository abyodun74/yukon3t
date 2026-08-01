import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";

export default async function DiscoverGroupsPage() {
  const me = await getOnboardedUserOrRedirect();

  const groups = await prisma.conversation.findMany({
    where: {
      isGroup: true,
      discoverable: true,
      NOT: { members: { some: { userId: me.id } } },
    },
    include: {
      _count: { select: { members: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Discover groups</h1>
          <p className="mt-1 text-sm text-foreground-soft">
            Public group chats you can request to join.
          </p>
        </div>
        <Link
          href="/messages/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          New group
        </Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <Link
            key={group.id}
            href={`/messages/${group.id}`}
            className="rounded-xl border border-line p-4 hover:border-accent"
          >
            <h2 className="font-semibold">{group.name ?? "Group"}</h2>
            <p className="mt-1 text-xs text-foreground-soft">
              Started by {group.createdBy?.name ?? "Unknown"}
            </p>
            <p className="mt-3 text-xs text-foreground-soft">
              {group._count.members}/20 members
            </p>
          </Link>
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-foreground-soft">
            No discoverable groups right now — check back later, or start your own.
          </p>
        )}
      </div>
    </div>
  );
}
