import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";

export default async function DiscoverGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { q } = await searchParams;

  const groups = await prisma.conversation.findMany({
    where: {
      isGroup: true,
      discoverable: true,
      NOT: { members: { some: { userId: me.id } } },
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
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
      <BackButton fallbackHref="/messages" />
      <div className="mt-4 flex items-center justify-between">
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

      <form className="mt-6 flex items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search groups by name..."
          className="w-full max-w-sm rounded-lg border border-line bg-surface px-4 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
        >
          Search
        </button>
      </form>

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
              {group._count.members} member{group._count.members === 1 ? "" : "s"}
            </p>
          </Link>
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {q
              ? `No groups match "${q}" — try a different search.`
              : "No discoverable groups right now — check back later, or start your own."}
          </p>
        )}
      </div>
    </div>
  );
}
