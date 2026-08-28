import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { DiscoverPeopleList } from "@/components/discover-people-list";
import { intentTagValues, intentLabels } from "@/lib/validations";
import { COUNTRIES } from "@/lib/countries";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { onlineSince } from "@/lib/presence";

const SORT_OPTIONS = ["relevant", "recent", "oldest", "online"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

function sortLabel(sort: SortOption) {
  switch (sort) {
    case "relevant":
      return "Most relevant";
    case "recent":
      return "Most recent";
    case "oldest":
      return "Oldest";
    case "online":
      return "Online now";
  }
}

// Offset (not cursor) pagination — "relevant" sorts by trustScore, which
// isn't unique, so a cursor keyed on it could skip or repeat rows at tie
// boundaries. Page-number based instead, same trade-off already accepted
// elsewhere for imprecise result-set sizes (see hasMore below).
const PAGE_SIZE = 30;

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; country?: string; sort?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { intent, country, sort: sortParam } = await searchParams;
  const sort: SortOption = SORT_OPTIONS.includes(sortParam as SortOption)
    ? (sortParam as SortOption)
    : "recent";

  const blockedIds = await getBlockedEitherWayIds(me.id);

  const people = await prisma.user.findMany({
    where: {
      id: { notIn: [me.id, ...blockedIds] },
      status: "ACTIVE",
      name: { not: null },
      discoverable: true,
      ...(intent ? { openToIntents: { has: intent as never } } : {}),
      ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
      ...(sort === "online" ? { lastSeenAt: { gt: onlineSince() } } : {}),
    },
    orderBy:
      sort === "online"
        ? { lastSeenAt: "desc" }
        : sort === "recent"
          ? { createdAt: "desc" }
          : sort === "oldest"
            ? { createdAt: "asc" }
            : { trustScore: "desc" },
    take: PAGE_SIZE,
  });
  const hasMore = people.length === PAGE_SIZE;

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

      {/* Grid (not flex-wrap) on mobile — 3 selects plus a button in a
          wrapping flex row has no predictable line count on a narrow phone
          screen (anywhere from 2 to 4 lines depending on device width and
          locale-driven label length), eating an unpredictable amount of
          vertical space above the actual results. A fixed 2-column grid is
          exactly 2 rows on mobile, every time. */}
      <form className="mt-6 grid grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <select
          name="intent"
          defaultValue={intent ?? ""}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 sm:w-auto"
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
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 sm:w-auto"
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
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 sm:w-auto"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {sortLabel(option)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink sm:w-auto"
        >
          Filter
        </button>
      </form>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DiscoverPeopleList
          initialItems={people.map((person) => {
            const connection = connectionByOtherId.get(person.id);
            return {
              person,
              connectionStatus: connection?.status ?? null,
              isRequester: connection?.requesterId === me.id,
              conversationId: conversationIdByOtherId.get(person.id) ?? null,
            };
          })}
          initialHasMore={hasMore}
          intent={intent}
          country={country}
          sort={sort}
        />
      </div>
    </div>
  );
}
