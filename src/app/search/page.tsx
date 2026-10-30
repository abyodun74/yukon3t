import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { visibleCircleWhere } from "@/lib/circle-visibility";
import { TrustBadge } from "@/components/trust-badge";
import { PostCard } from "@/components/post-card";
import { SearchPostsList } from "@/components/search-posts-list";
import { UserAvatar } from "@/components/user-link";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { COUNTRIES } from "@/lib/countries";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getListablePostsWhere } from "@/lib/post-visibility";
import { SearchBar } from "@/components/search-bar";
import { semanticSearch } from "@/lib/search-embeddings";
import { CIRCLE_CATEGORIES } from "@/lib/circle-categories";
import { isOnline } from "@/lib/presence";
import { format, plural } from "@/lib/i18n/locales";
import { vocabName } from "@/lib/i18n/language-names";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { countryName } from "@/lib/i18n/country-names";
import { SEARCH_SORT_OPTIONS, type SearchSortOption } from "@/lib/sort-options";

type SearchPostRow = Awaited<
  ReturnType<typeof prisma.post.findMany<{ include: typeof postCardInclude }>>
>[number];

const CURRENT_AFFAIRS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Same cursor pagination as /connections/page.tsx, scoped to just the Posts
// section (People/Circles/Collabs/Group chats aren't paginated), auto-loaded
// further pages as the viewer scrolls (see SearchPostsList / loadMoreSearchPosts).
const POSTS_PAGE_SIZE = 20;

// A plain helper (not the page component itself) so the Date.now() read
// doesn't trip react-hooks' purity check, which scans PascalCase component
// bodies for impure calls — same reason admin/analytics/page.tsx computes
// its `since` cutoff in a separate countsSince() helper.
function currentAffairsCutoff() {
  return new Date(Date.now() - CURRENT_AFFAIRS_WINDOW_MS);
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; country?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.pages.search;
  const sortText = dictionary.pages.sort;
  const { q: rawQuery, sort: sortParam, country } = await searchParams;
  const q = (rawQuery ?? "").trim();
  const sort: SearchSortOption = SEARCH_SORT_OPTIONS.includes(sortParam as SearchSortOption)
    ? (sortParam as SearchSortOption)
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
      getListablePostsWhere(me.id),
    ]);
    blockedIds = [...blockedIdsResult];
    const currentSince = currentAffairsCutoff();
    const matchingCategories = CIRCLE_CATEGORIES.filter((c) =>
      c.toLowerCase().includes(q.toLowerCase()),
    );

    const [peopleResult, circlesResult, collabsResult, rawPostsResult, groupChatsResult] = await Promise.all([
      prisma.user.findMany({
        where: {
          id: { notIn: [me.id, ...blockedIds] },
          status: "ACTIVE",
          // Site admins are invisible platform-wide, not just opted out of
          // algorithmic suggestions — see the same exclusion in discover.ts/
          // search-embeddings.ts and the isAdmin check on /u/[userId] itself.
          isAdmin: false,
          // Never the shared guest-preview identity (src/lib/guest-preview.ts), searched for by name or not.
          isGuestPreview: false,
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
            { category: { hasSome: matchingCategories } },
          ],
          // A PRIVATE Circle is never found by anyone but its members (lib/circle-visibility.ts).
          AND: [visibleCircleWhere(me.id)],
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
          visibility: "PUBLIC",
          // Admins are invisible platform-wide — a collab they authored
          // shouldn't surface their name in results either.
          author: { isAdmin: false },
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
        include: postCardInclude,
      }),
      prisma.conversation.findMany({
        where: {
          isGroup: true,
          discoverable: true,
          // Two independent exclusions — Prisma's NOT accepts an array,
          // AND-ing "not both" rather than the last one silently
          // overwriting the other in a single object literal. A group with
          // no creator left (account deleted, createdBy SetNull) doesn't
          // match the isAdmin condition either way, so it stays visible —
          // only an admin-created group is excluded here.
          NOT: [{ members: { some: { userId: me.id } } }, { createdBy: { isAdmin: true } }],
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
    // the actual signal that the query's words weren't exact hits. This page
    // itself only ever renders the first page of results (further pages are
    // auto-loaded client-side by SearchPostsList/loadMoreSearchPosts, which
    // doesn't call semanticSearch) so there's no separate "not the first
    // page" case to guard against here.
    const exactCount = people.length + circles.length + collabs.length + posts.length + groupChats.length;
    const SPARSE_THRESHOLD = 5;
    if (sort === "relevant" && exactCount < SPARSE_THRESHOLD) {
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
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {t.intro}
      </p>

      <div className="mt-6">
        <SearchBar initialQuery={q} labels={{ placeholder: t.placeholder, label: t.label }} />
      </div>

      {q.length >= 2 && (
        <form data-guest-ok className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="q" value={q} />
          <select
            name="sort"
            aria-label={sortText.label}
            defaultValue={sort}
            className="rounded-lg border border-line bg-surface px-3 py-2"
          >
            {SEARCH_SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {sortText[option]}
              </option>
            ))}
          </select>
          <select
            name="country"
            aria-label={t.locationLabel}
            defaultValue={country ?? ""}
            className="rounded-lg border border-line bg-surface px-3 py-2"
          >
            <option value="">{t.anyLocation}</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {countryName(c, locale)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink"
          >
            {t.apply}
          </button>
        </form>
      )}

      {q.length > 0 && q.length < 2 && (
        <p className="mt-8 text-sm text-foreground-soft">{t.keepTyping}</p>
      )}
      {noResults && (
        <p className="mt-8 text-sm text-foreground-soft">
          {format(t.noResults, { query: q })}
        </p>
      )}

      {people.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {t.people}
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
                    <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={28} online={isOnline(person.lastSeenAt)} />
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{person.name}</span>
                      {person.username && (
                        <span className="ms-1 text-xs font-normal text-foreground-soft">
                          @{person.username}
                        </span>
                      )}
                    </span>
                  </span>
                  <TrustBadge band={person.trustBand} />
                </div>
                <p className="mt-1 text-xs text-foreground-soft">
                  {person.country ? countryName(person.country, locale) : t.unknownLocation}
                </p>
                {person.bio && (
                  <p dir="auto" className="mt-1 line-clamp-2 text-sm text-foreground-soft">{person.bio}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {circles.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {t.circles}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {circles.map((circle) => (
              <Link
                key={circle.id}
                href={`/circles/${circle.slug}`}
                className="min-w-0 rounded-xl border border-line p-4 hover:border-accent"
              >
                <p className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-teal">
                  {circle.category
                    .map((category) => vocabName(category, dictionary.vocab.circleCategories))
                    .join(dictionary.ui.listSeparator)}
                </p>
                <h3 dir="auto" className="mt-1 break-words font-semibold">{circle.name}</h3>
                <p dir="auto" className="mt-1 line-clamp-2 text-sm text-foreground-soft">{circle.description}</p>
                <p className="mt-2 text-xs text-foreground-soft">
                  {plural(locale, t.members, circle._count.members)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {groupChats.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {t.groupChats}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groupChats.map((group) => (
              <Link
                key={group.id}
                href={`/messages/${group.id}`}
                className="rounded-xl border border-line p-4 hover:border-accent"
              >
                <h3 dir="auto" className="break-words font-semibold">{group.name ?? t.group}</h3>
                <p className="mt-1 text-xs text-foreground-soft">
                  {format(t.startedBy, { name: group.createdBy?.name ?? t.unknown })}
                </p>
                <p className="mt-2 text-xs text-foreground-soft">
                  {format(t.groupMembers, { count: group._count.members, max: 20 })}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {collabs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {t.collaborations}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {collabs.map((collab) => (
              <Link
                key={collab.id}
                href={`/collab/${collab.id}`}
                className="rounded-xl border border-line p-4 hover:border-accent"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-teal">
                  {vocabName(collab.type, dictionary.vocab.collabTypes)}
                </p>
                <h3 dir="auto" className="mt-1 break-words font-semibold">{collab.title}</h3>
                <p dir="auto" className="mt-1 line-clamp-2 text-sm text-foreground-soft">{collab.description}</p>
                <p className="mt-2 text-xs text-foreground-soft">
                  {`${format(t.by, { name: collab.author.name ?? t.unknown })} · ${plural(locale, t.participants, collab._count.participants)}`}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {posts.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {t.posts}
          </h2>
          <div className="mt-3 space-y-4">
            <SearchPostsList
              // Remounts (fresh client state) when the query/sort changes —
              // same reasoning as Home's own PostFeedSection key (see
              // src/app/home/page.tsx).
              key={`${q}-${sort}`}
              query={q}
              sort={sort}
              initialPosts={posts}
              initialHasMore={postsHaveMore}
              viewerId={me.id}
              viewerIsAdmin={me.isAdmin}
            />
          </div>
        </div>
      )}

      {hasSmartResults && smart && (
        <div className="mt-10 border-t border-line pt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">
            {format(t.relatedTo, { query: q })}
          </h2>
          <p className="mt-1 text-xs text-foreground-soft">
            {t.relatedIntro}
          </p>

          {smart.people.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">{t.people}</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {smart.people.map((person) => (
                  <Link
                    key={person.id}
                    href={`/u/${person.id}`}
                    className="rounded-xl border border-line p-4 hover:border-accent"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex min-w-0 items-center gap-2">
                        <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={28} online={isOnline(person.lastSeenAt)} />
                        <span className="min-w-0 truncate">
                          <span className="font-semibold">{person.name}</span>
                          {person.username && (
                            <span className="ms-1 text-xs font-normal text-foreground-soft">
                              @{person.username}
                            </span>
                          )}
                        </span>
                      </span>
                      <TrustBadge band={person.trustBand} />
                    </div>
                    {person.bio && (
                      <p dir="auto" className="mt-1 line-clamp-2 text-sm text-foreground-soft">{person.bio}</p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {smart.circles.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">{t.circles}</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {smart.circles.map((circle) => (
                  <Link
                    key={circle.id}
                    href={`/circles/${circle.slug}`}
                    className="min-w-0 rounded-xl border border-line p-4 hover:border-accent"
                  >
                    <p className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-teal">{circle.category
                    .map((category) => vocabName(category, dictionary.vocab.circleCategories))
                    .join(dictionary.ui.listSeparator)}</p>
                    <h4 dir="auto" className="mt-1 break-words font-semibold">{circle.name}</h4>
                    <p dir="auto" className="mt-1 line-clamp-2 text-sm text-foreground-soft">{circle.description}</p>
                    <p className="mt-2 text-xs text-foreground-soft">
                      {plural(locale, t.members, circle._count.members)}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {smart.collabs.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                {t.collaborations}
              </h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {smart.collabs.map((collab) => (
                  <Link
                    key={collab.id}
                    href={`/collab/${collab.id}`}
                    className="rounded-xl border border-line p-4 hover:border-accent"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-teal">
                      {vocabName(collab.type, dictionary.vocab.collabTypes)}
                    </p>
                    <h4 dir="auto" className="mt-1 break-words font-semibold">{collab.title}</h4>
                    <p dir="auto" className="mt-1 line-clamp-2 text-sm text-foreground-soft">{collab.description}</p>
                    <p className="mt-2 text-xs text-foreground-soft">
                      {`${format(t.by, { name: collab.author.name ?? t.unknown })} · ${plural(locale, t.participants, collab._count.participants)}`}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {smart.posts.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">{t.posts}</h3>
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
