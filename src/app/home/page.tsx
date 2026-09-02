import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { PostFeedSection } from "@/components/post-feed-section";
import { StreakBanner } from "@/components/streak-banner";
import { StoryTray } from "@/components/story-tray";
import { LiveStreamStrip } from "@/components/live-stream-strip";
import { CategoryTabs } from "@/components/category-tabs";
import { AdSlot } from "@/components/ad-slot";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getVisiblePostsWhere } from "@/lib/post-visibility";
import { getConnectionsStories } from "@/app/actions/stories";
import { dayNumber } from "@/lib/trust";
import { feedCategoryValues } from "@/lib/validations";
import { buildCategoryFilter } from "@/lib/feed-category";

const PAGE_SIZE = 20;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; category?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { scope, category: categoryParam } = await searchParams;
  // Admin-only "include private posts" view — never trust the query param
  // alone, only branch the query when the signed-in user is actually an
  // admin. See src/lib/post-visibility.ts: everyone already sees everyone
  // else's PUBLIC posts by default now, so this remaining bypass only
  // matters for CONNECTIONS_ONLY posts from people the admin isn't
  // connected to.
  const allPostsScope = scope === "all" && me.isAdmin;
  const category = (feedCategoryValues as readonly string[]).includes(categoryParam ?? "")
    ? (categoryParam as (typeof feedCategoryValues)[number])
    : null;

  const activeToday = Boolean(me.lastActiveAt && dayNumber(me.lastActiveAt) === dayNumber(new Date()));
  const { groups: storyGroups } = await getConnectionsStories();

  // Everything below this point only reads posts/stories the viewer is
  // normally allowed to see (getConnectionsStories above is untouched by
  // allPostsScope) — admins get a wider post feed, never wider Story or
  // profile access.
  const baseWhere = allPostsScope
    ? {
        moderationStatus: "PUBLISHED" as const,
        author: { status: "ACTIVE" as const },
        // Still respects the HIDDEN ("invisible to everyone") tier — an
        // admin's own HIDDEN posts don't leak into another admin's view
        // either.
        NOT: { author: { postsVisibility: "HIDDEN" as const } },
      }
    : await getVisiblePostsWhere(me.id);
  // A smart hybrid filter, not a strict tag lookup — see buildCategoryFilter
  // for why this can't just be spread onto baseWhere (it may carry its own
  // top-level OR, which spreading would silently clobber baseWhere's
  // visibility OR instead of combining with it).
  const categoryFilter = await buildCategoryFilter(category);
  const where = categoryFilter ? { AND: [baseWhere, categoryFilter] } : baseWhere;

  const rawPosts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    include: postCardInclude,
  });
  const posts = await attachViewerState(rawPosts, me.id);
  const hasMore = rawPosts.length === PAGE_SIZE;

  const categoryQuery = category ? `&category=${category}` : "";

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <StoryTray groups={storyGroups} meAvatarUrl={me.avatarUrl} meName={me.name ?? "You"} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StreakBanner
          currentStreak={me.currentStreak}
          longestStreak={me.longestStreak}
          activeToday={activeToday}
        />
        <LiveStreamStrip />
      </div>

      <div className="mt-4">
        <CategoryTabs category={category} allPostsScope={allPostsScope} />
      </div>

      {me.isAdmin && (
        <div className="mt-4 flex w-fit overflow-hidden rounded-lg border border-line text-xs font-medium">
          <Link
            href={`/home${category ? `?category=${category}` : ""}`}
            className={`px-3 py-1.5 ${!allPostsScope ? "bg-accent-soft text-accent" : "text-foreground-soft"}`}
          >
            Standard
          </Link>
          <Link
            href={`/home?scope=all${categoryQuery}`}
            className={`px-3 py-1.5 ${allPostsScope ? "bg-accent-soft text-accent" : "text-foreground-soft"}`}
          >
            Admin: include private posts
          </Link>
        </div>
      )}

      <div className="mt-6">
        <PostComposer placeholder="Share a photo, a short video, or an update..." />
      </div>

      <div className="mt-6">
        <AdSlot />
      </div>

      <PostFeedSection
        // Forces a remount (and fresh client state from the new
        // initialPosts) whenever the underlying SSR dataset changes — a
        // plain prop change wouldn't reset PostFeedSection's internal
        // `posts` state, so switching category/scope tabs would otherwise
        // keep showing stale posts from the previous filter. "Load more"
        // no longer changes any of these, so it no longer needs to be part
        // of this key — see PostFeedSection's own loadMore, which appends
        // in place instead of triggering a fresh SSR render.
        key={`${category ?? "all"}-${allPostsScope}`}
        category={category ?? "all"}
        initialPosts={posts}
        initialHasMore={hasMore}
        allPostsScope={allPostsScope}
        viewerId={me.id}
        viewerIsAdmin={me.isAdmin}
        // Polling reflects each viewer's normal visibility (see
        // src/app/api/feed/[category]/latest) — the admin "include private
        // posts" bypass only applies to the initial server-rendered batch,
        // so polling stays off in that mode rather than silently narrowing
        // what's shown partway through a session.
        pollingEnabled={!allPostsScope}
      />
      {posts.length === 0 && (
        <p className="mt-8 text-sm text-foreground-soft">
          Nothing here yet — check back soon, or connect with someone / join
          a Circle to see more.
        </p>
      )}
    </div>
  );
}
