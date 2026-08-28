"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getVisiblePostsWhere } from "@/lib/post-visibility";

const SORT_OPTIONS = ["relevant", "recent", "oldest", "current"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const CURRENT_AFFAIRS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Matches /search/page.tsx's own POSTS_PAGE_SIZE (src/app/search/page.tsx).
const POSTS_PAGE_SIZE = 20;

/**
 * Auto-load-more for the "Posts" section of /search — called from the
 * client via useInfiniteScroll (src/lib/use-infinite-scroll.ts). Re-runs
 * the same content-match query as the page's own initial SSR page, minus
 * the smart/semantic backfill (that's deliberately first-page-only there
 * too — see the page's own comment above its semanticSearch call).
 */
export async function loadMoreSearchPosts(
  cursor: string,
  filters: { q: string; sort?: string },
) {
  const user = await requireUser();
  const q = filters.q.trim();
  if (q.length < 2) {
    return { items: [], hasMore: false };
  }
  const sort: SortOption = SORT_OPTIONS.includes(filters.sort as SortOption)
    ? (filters.sort as SortOption)
    : "relevant";

  const postsWhere = await getVisiblePostsWhere(user.id);
  const currentSince = new Date(Date.now() - CURRENT_AFFAIRS_WINDOW_MS);

  const rawPosts = await prisma.post.findMany({
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
    cursor: { id: cursor },
    skip: 1,
    include: postCardInclude,
  });
  const items = await attachViewerState(rawPosts, user.id);
  return { items, hasMore: rawPosts.length === POSTS_PAGE_SIZE };
}
