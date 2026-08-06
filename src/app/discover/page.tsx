import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import Link from "next/link";
import { intentTagValues, intentLabels } from "@/lib/validations";
import { COUNTRIES } from "@/lib/countries";
import { getBlockedEitherWayIds } from "@/lib/blocks";

const SORT_OPTIONS = ["relevant", "recent", "oldest"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; country?: string; sort?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { intent, country, sort: sortParam } = await searchParams;
  const sort: SortOption = SORT_OPTIONS.includes(sortParam as SortOption)
    ? (sortParam as SortOption)
    : "relevant";

  const blockedIds = await getBlockedEitherWayIds(me.id);

  const people = await prisma.user.findMany({
    where: {
      id: { notIn: [me.id, ...blockedIds] },
      status: "ACTIVE",
      name: { not: null },
      discoverable: true,
      ...(intent ? { openToIntents: { has: intent as never } } : {}),
      ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
    },
    orderBy:
      sort === "recent"
        ? { createdAt: "desc" }
        : sort === "oldest"
          ? { createdAt: "asc" }
          : { trustScore: "desc" },
    take: 30,
  });

  // Batch-fetch connection state for everyone on this page, instead of one
  // query per card, so the button can reflect pending/accepted status
  // instead of always showing a fresh "Connect" prompt.
  const peopleIds = people.map((p) => p.id);
  const connections = peopleIds.length
    ? await prisma.connection.findMany({
        where: {
          OR: [
            { requesterId: me.id, targetId: { in: peopleIds } },
            { targetId: me.id, requesterId: { in: peopleIds } },
          ],
        },
      })
    : [];
  const connectionByOtherId = new Map(
    connections.map((c) => [c.requesterId === me.id ? c.targetId : c.requesterId, c]),
  );

  const acceptedOtherIds = connections
    .filter((c) => c.status === "ACCEPTED")
    .map((c) => (c.requesterId === me.id ? c.targetId : c.requesterId));
  const conversations = acceptedOtherIds.length
    ? await prisma.conversation.findMany({
        where: {
          AND: [
            { members: { some: { userId: me.id } } },
            { members: { some: { userId: { in: acceptedOtherIds } } } },
          ],
        },
        include: { members: { select: { userId: true } } },
      })
    : [];
  const conversationIdByOtherId = new Map<string, string>();
  for (const conv of conversations) {
    const other = conv.members.find((m) => m.userId !== me.id);
    if (other) conversationIdByOtherId.set(other.userId, conv.id);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Discover people</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Filter by what you&apos;re both open to — no drifting into
        conversations neither of you signed up for.
      </p>

      <form className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <select
          name="intent"
          defaultValue={intent ?? ""}
          className="rounded-lg border border-line bg-surface px-3 py-2"
        >
          <option value="">Any intent</option>
          {intentTagValues.map((tag) => (
            <option key={tag} value={tag}>
              {intentLabels[tag]}
            </option>
          ))}
        </select>
        <select
          name="country"
          defaultValue={country ?? ""}
          className="rounded-lg border border-line bg-surface px-3 py-2"
        >
          <option value="">Any country</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={sort}
          className="rounded-lg border border-line bg-surface px-3 py-2"
        >
          <option value="relevant">Most relevant</option>
          <option value="recent">Most recent</option>
          <option value="oldest">Oldest</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink"
        >
          Filter
        </button>
      </form>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((person) => {
          const connection = connectionByOtherId.get(person.id);
          return (
          <div key={person.id} className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between">
              <Link
                href={`/u/${person.id}`}
                className="font-semibold hover:text-accent"
              >
                {person.name}
              </Link>
              <TrustBadge band={person.trustBand} />
            </div>
            <p className="mt-1 text-xs text-foreground-soft">
              {person.country ?? "Unknown location"}
            </p>
            {person.bio && (
              <p className="mt-2 line-clamp-3 text-sm text-foreground-soft">
                {person.bio}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1">
              {person.openToIntents.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] text-teal"
                >
                  {intentLabels[tag]}
                </span>
              ))}
            </div>
            <div className="mt-4">
              <ConnectButton
                targetId={person.id}
                openToIntents={person.openToIntents}
                status={connection?.status ?? null}
                isRequester={connection?.requesterId === me.id}
                conversationId={conversationIdByOtherId.get(person.id) ?? null}
              />
            </div>
          </div>
          );
        })}
        {people.length === 0 && (
          <p className="text-sm text-foreground-soft">
            No one matches those filters yet — try broadening them.
          </p>
        )}
      </div>
    </div>
  );
}
