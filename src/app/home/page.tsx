import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { PostCard, type PostCardData } from "@/components/post-card";
import { PostFeedSection } from "@/components/post-feed-section";
import { StreakBanner } from "@/components/streak-banner";
import { StoryTray } from "@/components/story-tray";
import { AdSlot } from "@/components/ad-slot";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getVisiblePostsWhere } from "@/lib/post-visibility";
import { getConnectionsStories } from "@/app/actions/stories";
import { dayNumber } from "@/lib/trust";
import { feedCategoryValues, feedCategoryLabels } from "@/lib/validations";

const PAGE_SIZE = 30;
const SECTION_PAGE_SIZE = 10;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; scope?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { before, scope } = await searchParams;
  // Admin-only "All Posts" view — never trust the query param alone, only
  // branch the query when the signed-in user is actually an admin.
  const allPostsScope = scope === "all" && me.isAdmin;

  const activeToday = Boolean(me.lastActiveAt && dayNumber(me.lastActiveAt) === dayNumber(new Date()));
  const { groups: storyGroups } = await getConnectionsStories();

  // Everything below this point only reads posts/stories the viewer is
  // normally allowed to see (getConnectionsStories above is untouched by
  // allPostsScope) — admins get a wider post feed, never wider Story or
  // profile access. See src/lib/post-visibility.ts and item 5 in the plan.
  let posts: PostCardData[] = [];
  let lastPost: { id: string } | undefined;
  let hasMore = false;

  if (allPostsScope) {
    const rawPosts = await prisma.post.findMany({
      where: {
        moderationStatus: "PUBLISHED",
        author: { status: "ACTIVE" },
        // Still respects the HIDDEN ("invisible to everyone") tier — an
        // admin's own HIDDEN posts don't leak into another admin's All
        // Posts view either.
        NOT: { author: { postsVisibility: "HIDDEN" } },
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      include: postCardInclude,
    });
    posts = await attachViewerState(rawPosts, me.id);
    lastPost = rawPosts[rawPosts.length - 1];
    hasMore = rawPosts.length === PAGE_SIZE;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Home</h1>
          <p className="mt-1 text-sm text-foreground-soft">
            {allPostsScope
              ? "Every published post on YuKon3t (admin view)."
              : "Posts from your Circles and connections."}
          </p>
        </div>
        {me.isAdmin && (
          <div className="flex overflow-hidden rounded-lg border border-line text-xs font-medium">
            <Link
              href="/home"
              className={`px-3 py-1.5 ${!allPostsScope ? "bg-accent-soft text-accent" : "text-foreground-soft"}`}
            >
              My Feed
            </Link>
            <Link
              href="/home?scope=all"
              className={`px-3 py-1.5 ${allPostsScope ? "bg-accent-soft text-accent" : "text-foreground-soft"}`}
            >
              All Posts
            </Link>
          </div>
        )}
      </div>

      <StreakBanner
        currentStreak={me.currentStreak}
        longestStreak={me.longestStreak}
        activeToday={activeToday}
      />

      <div className="mt-6">
        <StoryTray groups={storyGroups} meAvatarUrl={me.avatarUrl} meName={me.name ?? "You"} />
      </div>

      <div className="mt-6">
        <PostComposer placeholder="Share a photo, a short video, or an update..." />
      </div>

      <div className="mt-6">
        <AdSlot />
      </div>

      {allPostsScope ? (
        <div className="mt-8 space-y-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} viewerId={me.id} viewerIsAdmin={me.isAdmin} />
          ))}
          {posts.length === 0 && (
            <p className="text-sm text-foreground-soft">No posts yet.</p>
          )}
          {hasMore && lastPost && (
            <Link
              href={`/home?scope=all&before=${lastPost.id}`}
              className="block rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
            >
              Load more
            </Link>
          )}
        </div>
      ) : (
        <SectionedFeed viewerId={me.id} viewerIsAdmin={me.isAdmin} />
      )}
    </div>
  );
}

async function SectionedFeed({ viewerId, viewerIsAdmin }: { viewerId: string; viewerIsAdmin: boolean }) {
  const baseWhere = await getVisiblePostsWhere(viewerId);

  const sections = await Promise.all(
    feedCategoryValues.map(async (category) => {
      const rawPosts = await prisma.post.findMany({
        where: { ...baseWhere, feedCategory: category },
        orderBy: { createdAt: "desc" },
        take: SECTION_PAGE_SIZE,
        include: postCardInclude,
      });
      const posts = await attachViewerState(rawPosts, viewerId);
      return { category, posts };
    }),
  );

  const anyPosts = sections.some((s) => s.posts.length > 0);

  return (
    <>
      {sections.map(({ category, posts }) => (
        <PostFeedSection
          key={category}
          category={category}
          label={feedCategoryLabels[category]}
          initialPosts={posts}
          viewerId={viewerId}
          viewerIsAdmin={viewerIsAdmin}
        />
      ))}
      {!anyPosts && (
        <p className="mt-8 text-sm text-foreground-soft">
          Nothing here yet — join a Circle or connect with someone to see
          their posts.
        </p>
      )}
    </>
  );
}
