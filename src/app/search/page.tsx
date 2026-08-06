import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { COUNTRIES } from "@/lib/countries";
import { collabTypeLabels } from "@/lib/collab-labels";
import { SearchBar } from "@/components/search-bar";

const SORT_OPTIONS = ["relevant", "recent", "oldest", "current"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const CURRENT_AFFAIRS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// A plain helper (not the page component itself) so the Date.now() read
// doesn't trip react-hooks' purity check, which scans PascalCase component
// bodies for impure calls — same reason admin/analytics/page.tsx computes
// its `since` cutoff in a separate countsSince() helper.
function currentAffairsCutoff() {
  return new Date(Date.now() - CURRENT_AFFAIRS_WINDOW_MS);
}

function sortLabel(sort: SortOption) {
  switch (sort) {
    case "relevant":
      return "Most relevant";
    case "recent":
      return "Most recent";
    case "oldest":
      return "Oldest";
    case "current":
      return "Current affairs";
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; country?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { q: rawQuery, sort: sortParam, country } = await searchParams;
  const q = (rawQuery ?? "").trim();
  const sort: SortOption = SORT_OPTIONS.includes(sortParam as SortOption)
    ? (sortParam as SortOption)
    : "relevant";

  let people: Awaited<ReturnType<typeof prisma.user.findMany>> = [];
  let circles: Awaited<
    ReturnType<typeof prisma.circle.findMany<{ include: { _count: { select: { members: true } } } }>>
  > = [];
  let collabs: Awaited<
    ReturnType<
      typeof prisma.collabBoardPost.findMany<{
        include: {
          author: { select: { id: true; name: true } };
          _count: { select: { participants: true } };
        };
      }>
    >
  > = [];

  if (q.length >= 2) {
    const blockedIds = await getBlockedEitherWayIds(me.id);
    const currentSince = currentAffairsCutoff();

    const [peopleResult, circlesResult, collabsResult] = await Promise.all([
      prisma.user.findMany({
        where: {
          id: { notIn: [me.id, ...blockedIds] },
          status: "ACTIVE",
          discoverable: true,
          ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
          ...(sort === "current" ? { lastActiveAt: { gt: currentSince } } : {}),
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { username: { contains: q, mode: "insensitive" } },
            { bio: { contains: q, mode: "insensitive" } },
            { interests: { has: q } },
          ],
        },
        orderBy:
          sort === "recent" || sort === "current"
            ? { lastActiveAt: "desc" }
            : sort === "oldest"
              ? { createdAt: "asc" }
              : { trustScore: "desc" },
        take: 20,
      }),
      prisma.circle.findMany({
        where: {
          ...(sort === "current" ? { createdAt: { gt: currentSince } } : {}),
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy:
          sort === "recent" || sort === "current"
            ? { createdAt: "desc" }
            : sort === "oldest"
              ? { createdAt: "asc" }
              : { members: { _count: "desc" } },
        take: 20,
        include: { _count: { select: { members: true } } },
      }),
      prisma.collabBoardPost.findMany({
        where: {
          status: "OPEN",
          ...(country ? { OR: [{ worldwide: true }, { countries: { has: country } }] } : {}),
          ...(sort === "current" ? { createdAt: { gt: currentSince } } : {}),
          AND: [
            {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            },
          ],
        },
        orderBy:
          sort === "recent" || sort === "current"
            ? { createdAt: "desc" }
            : sort === "oldest"
              ? { createdAt: "asc" }
              : { participants: { _count: "desc" } },
        take: 20,
        include: { author: { select: { id: true, name: true } }, _count: { select: { participants: true } } },
      }),
    ]);

    people = peopleResult;
    circles = circlesResult;
    collabs = collabsResult;
  }

  const noResults = q.length >= 2 && people.length === 0 && circles.length === 0 && collabs.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Search</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Find people, Circles, and collaborations across YuKon3t.
      </p>

      <div className="mt-6">
        <SearchBar initialQuery={q} />
      </div>

      {q.length >= 2 && (
        <form className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="q" value={q} />
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-lg border border-line bg-surface px-3 py-2"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {sortLabel(option)}
              </option>
            ))}
          </select>
          <select
            name="country"
            defaultValue={country ?? ""}
            className="rounded-lg border border-line bg-surface px-3 py-2"
          >
            <option value="">Any location</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink"
          >
            Apply
          </button>
        </form>
      )}

      {q.length > 0 && q.length < 2 && (
        <p className="mt-8 text-sm text-foreground-soft">Keep typing — at least 2 characters.</p>
      )}
      {noResults && (
        <p className="mt-8 text-sm text-foreground-soft">
          Nothing matches &quot;{q}&quot; yet — try a different term or broaden your filters.
        </p>
      )}

      {people.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            People
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {people.map((person) => (
              <Link
                key={person.id}
                href={`/u/${person.id}`}
                className="rounded-xl border border-line p-4 hover:border-accent"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{person.name}</span>
                  <TrustBadge band={person.trustBand} />
                </div>
                <p className="mt-1 text-xs text-foreground-soft">
                  {person.country ?? "Unknown location"}
                </p>
                {person.bio && (
                  <p className="mt-1 line-clamp-2 text-sm text-foreground-soft">{person.bio}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {circles.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            Circles
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {circles.map((circle) => (
              <Link
                key={circle.id}
                href={`/circles/${circle.slug}`}
                className="rounded-xl border border-line p-4 hover:border-accent"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-teal">
                  {circle.category}
                </p>
                <h3 className="mt-1 font-semibold">{circle.name}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-foreground-soft">{circle.description}</p>
                <p className="mt-2 text-xs text-foreground-soft">
                  {circle._count.members} member{circle._count.members === 1 ? "" : "s"}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {collabs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            Collaborations
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {collabs.map((collab) => (
              <Link
                key={collab.id}
                href={`/collab/${collab.id}`}
                className="rounded-xl border border-line p-4 hover:border-accent"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-teal">
                  {collabTypeLabels[collab.type]}
                </p>
                <h3 className="mt-1 font-semibold">{collab.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-foreground-soft">{collab.description}</p>
                <p className="mt-2 text-xs text-foreground-soft">
                  by {collab.author.name} · {collab._count.participants} participant
                  {collab._count.participants === 1 ? "" : "s"}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
