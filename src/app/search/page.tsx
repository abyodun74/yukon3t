import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { PostCard } from "@/components/post-card";
import { UserAvatar } from "@/components/user-link";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { COUNTRIES } from "@/lib/countries";
import { collabTypeLabels } from "@/lib/collab-labels";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getVisiblePostsWhere } from "@/lib/post-visibility";
import { SearchBar } from "@/components/search-bar";
import { semanticSearch } from "@/lib/search-embeddings";

type SearchPostRow = Awaited<
  ReturnType<typeof prisma.post.findMany<{ include: typeof postCardInclude }>>
>[number];

const SORT_OPTIONS = ["relevant", "recent", "oldest", "current"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const CURRENT_AFFAIRS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Same cursor + "Load more" pattern as /connections/page.tsx, scoped to just
// the Posts section — People/Circles/Collabs/Group chats aren't paginated.
const POSTS_PAGE_SIZE = 20;

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
  searchParams: Promise<{ q?: string; sort?: string; country?: string; postsBefore?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { q: rawQuery, sort: sortParam, country, postsBefore } = await searchParams;
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
  let posts: Awaited<ReturnType<typeof attachViewerState<SearchPostRow>>> = [];
  let groupChats: Awaited<
    ReturnType<
      typeof prisma.conversation.findMany<{
        include: {
          _count: { select: { members: true } };
          createdBy: { select: { id: true; name: true } };
        };
      }>
    >
  > = [];
  let smart: Awaited<ReturnType<typeof semanticSearch>> | null = null;
  let blockedIds: string[] = [];
  let postsHaveMore = false;

  if (q.length >= 2) {
    const [blockedIdsResult, postsWhere] = await Promise.all([
      getBlockedEitherWayIds(me.id),
      getVisiblePostsWhere(me.id),
    ]);
    blockedIds = [...blockedIdsResult];
    const currentSince = currentAffairsCutoff();

    const [peopleResult, circlesResult, collabsResult, rawPostsResult, groupChatsResult] = await Promise.all([
      prisma.user.findMany({
        where: {
          id: { notIn: [me.id, ...blockedIds] },
          status: "ACTIVE",
          // Deliberately not gated on `discoverable` — that flag opts someone
          // out of *passive* algorithmic suggestions (see /discover), not out
          // of being found by someone who already knows their name and
          // explicitly searches for it. `status: ACTIVE` + the blocked-either-
          // way exclusion above remain the real safety boundary here.
          ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
          ...(sort === "current" ? { lastActiveAt: { gt: currentSince } } : {}),
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { username: { contains: q, mode: "insensitive" } },
            { bio: { contains: q, mode: "insensitive" } },
            // Prisma's `has` on a String[] is case-sensitive with no
            // case-insensitive variant, so this matches against the
            // lowercased mirror column instead of `interests` directly (see
            // User.interestsLower in schema.prisma) — otherwise "travel"
            // would miss a stored interest of "Travel".
            { interestsLower: { has: q.toLowerCase() } },
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
      prisma.post.findMany({
        where: {
          ...postsWhere,
          ...(sort === "current" ? { createdAt: { gt: currentSince } } : {}),
          content: { contains: q, mode: "insensitive" },
        },
        orderBy:
          sort === "recent" || sort === "current"
            ? { createdAt: "desc" }
            : sort === "oldest"
              ? { createdAt: "asc" }
              : { likeCount: "desc" },
        take: POSTS_PAGE_SIZE,
        ...(postsBefore ? { cursor: { id: postsBefore }, skip: 1 } : {}),
        include: postCardInclude,
      }),
      prisma.conversation.findMany({
        where: {
          isGroup: true,
          discoverable: true,
          NOT: { members: { some: { userId: me.id } } },
          ...(sort === "current" ? { createdAt: { gt: currentSince } } : {}),
          name: { contains: q, mode: "insensitive" },
        },
        orderBy:
          sort === "recent" || sort === "current"
            ? { createdAt: "desc" }
            : sort === "oldest"
              ? { createdAt: "asc" }
              : { members: { _count: "desc" } },
        take: 20,
        include: { _count: { select: { members: true } }, createdBy: { select: { id: true, name: true } } },
      }),
    ]);

    people = peopleResult;
    circles = circlesResult;
    collabs = collabsResult;
    posts = await attachViewerState(rawPostsResult, me.id);
    groupChats = groupChatsResult;
    postsHaveMore = rawPostsResult.length === POSTS_PAGE_SIZE;

    // "Relevant" is the only sort mode smart search applies to — "recent"/
    // "oldest"/"current" are explicit requests for chronological order, which
    // a semantic-similarity ranking would fight rather than serve. Only
    // triggers when the exact substring match came back sparse, since that's
    // the actual signal that the query's words weren't exact hits — and only
    // on the first page, since it's meant to backfill a thin *initial*
    // result set, not to keep firing on every "Load more" posts click.
    const exactCount = people.length + circles.length + collabs.length + posts.length + groupChats.length;
    const SPARSE_THRESHOLD = 5;
    if (sort === "relevant" && exactCount < SPARSE_THRESHOLD && !postsBefore) {
      const smartResult = await semanticSearch(q, me.id, { excludeUserIds: [me.id, ...blockedIds] });
      const exactPeopleIds = new Set(people.map((p) => p.id));
      const exactCircleIds = new Set(circles.map((c) => c.id));
      const exactCollabIds = new Set(collabs.map((c) => c.id));
      const exactPostIds = new Set(posts.map((p) => p.id));
      smart = {
        people: smartResult.people.filter((p) => !exactPeopleIds.has(p.id)),
        circles: smartResult.circles.filter((c) => !exactCircleIds.has(c.id)),
        collabs: smartResult.collabs.filter((c) => !exactCollabIds.has(c.id)),
        posts: smartResult.posts.filter((p) => !exactPostIds.has(p.id)),
      };
    }
  }

  const hasSmartResults = !!smart &&
    (smart.people.length > 0 || smart.circles.length > 0 || smart.collabs.length > 0 || smart.posts.length > 0);

  const noResults =
    q.length >= 2 &&
    people.length === 0 &&
    circles.length === 0 &&
    collabs.length === 0 &&
    posts.length === 0 &&
    groupChats.length === 0 &&
    !hasSmartResults;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Search</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Find people, usernames, Circles, group chats, collaborations, and posts across YuKon3t.
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
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={28} />
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{person.name}</span>
                      {person.username && (
                        <span className="ml-1 text-xs font-normal text-foreground-soft">
                          @{person.username}
                        </span>
                      )}
                    </span>
                  </span>
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
                <h3 className="mt-1 break-words font-semibold">{circle.name}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-foreground-soft">{circle.description}</p>
                <p className="mt-2 text-xs text-foreground-soft">
                  {circle._count.members} member{circle._count.members === 1 ? "" : "s"}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {groupChats.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            Group chats
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groupChats.map((group) => (
              <Link
                key={group.id}
                href={`/messages/${group.id}`}
                className="rounded-xl border border-line p-4 hover:border-accent"
              >
                <h3 className="break-words font-semibold">{group.name ?? "Group"}</h3>
                <p className="mt-1 text-xs text-foreground-soft">
                  Started by {group.createdBy?.name ?? "Unknown"}
                </p>
                <p className="mt-2 text-xs text-foreground-soft">
                  {group._count.members}/20 members
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
                <h3 className="mt-1 break-words font-semibold">{collab.title}</h3>
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

      {posts.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            Posts
          </h2>
          <div className="mt-3 space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} viewerId={me.id} viewerIsAdmin={me.isAdmin} />
            ))}
            {postsHaveMore && (
              <Link
                href={`/search?${new URLSearchParams({
                  q,
                  ...(sort !== "relevant" ? { sort } : {}),
                  ...(country ? { country } : {}),
                  postsBefore: posts[posts.length - 1].id,
                }).toString()}`}
                className="block rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
              >
                Load more
              </Link>
            )}
          </div>
        </div>
      )}

      {hasSmartResults && smart && (
        <div className="mt-10 border-t border-line pt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">
            Related to &quot;{q}&quot;
          </h2>
          <p className="mt-1 text-xs text-foreground-soft">
            No exact match for that, but these look related.
          </p>

          {smart.people.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">People</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {smart.people.map((person) => (
                  <Link
                    key={person.id}
                    href={`/u/${person.id}`}
                    className="rounded-xl border border-line p-4 hover:border-accent"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex min-w-0 items-center gap-2">
                        <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={28} />
                        <span className="min-w-0 truncate">
                          <span className="font-semibold">{person.name}</span>
                          {person.username && (
                            <span className="ml-1 text-xs font-normal text-foreground-soft">
                              @{person.username}
                            </span>
                          )}
                        </span>
                      </span>
                      <TrustBadge band={person.trustBand} />
                    </div>
                    {person.bio && (
                      <p className="mt-1 line-clamp-2 text-sm text-foreground-soft">{person.bio}</p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {smart.circles.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">Circles</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {smart.circles.map((circle) => (
                  <Link
                    key={circle.id}
                    href={`/circles/${circle.slug}`}
                    className="rounded-xl border border-line p-4 hover:border-accent"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-teal">{circle.category}</p>
                    <h4 className="mt-1 break-words font-semibold">{circle.name}</h4>
                    <p className="mt-1 line-clamp-2 text-sm text-foreground-soft">{circle.description}</p>
                    <p className="mt-2 text-xs text-foreground-soft">
                      {circle._count.members} member{circle._count.members === 1 ? "" : "s"}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {smart.collabs.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                Collaborations
              </h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {smart.collabs.map((collab) => (
                  <Link
                    key={collab.id}
                    href={`/collab/${collab.id}`}
                    className="rounded-xl border border-line p-4 hover:border-accent"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-teal">
                      {collabTypeLabels[collab.type]}
                    </p>
                    <h4 className="mt-1 break-words font-semibold">{collab.title}</h4>
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

          {smart.posts.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">Posts</h3>
              <div className="mt-2 space-y-4">
                {smart.posts.map((post) => (
                  <PostCard key={post.id} post={post} viewerId={me.id} viewerIsAdmin={me.isAdmin} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
