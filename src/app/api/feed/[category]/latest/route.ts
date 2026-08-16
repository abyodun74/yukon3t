import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, AuthError } from "@/lib/auth-guards";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getVisiblePostsWhere } from "@/lib/post-visibility";
import { feedCategoryValues } from "@/lib/validations";
import { buildCategoryFilter } from "@/lib/feed-category";

const POLL_PAGE_SIZE = 10;
// Matches Home's own PAGE_SIZE (src/app/home/page.tsx) so a "Load more"
// click pulls in the same number of posts the old full-page pagination did.
const LOAD_MORE_PAGE_SIZE = 20;

/**
 * Polled by PostFeedSection (src/components/post-feed-section.tsx) every ~25s
 * to give Home's feed a near-real-time feel without new websocket/SSE
 * infrastructure — same `usePolling` pattern already used for nav badges
 * and chat (src/lib/use-polling.ts). `category` is either a FeedCategory
 * value or the literal "all" (no category filter, matching Home's "All" tab).
 *
 * Also serves Home's "Load more" button (`before` param) — fetching older
 * posts this way instead of Home's old `?before=` full-page navigation lets
 * PostFeedSection append them to its existing `posts` state in place, so
 * the page never re-renders/scrolls back to the top.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ posts: [] }, { status: 401 });
    }
    throw err;
  }

  const { category } = await params;
  const isValidCategory = feedCategoryValues.includes(category as (typeof feedCategoryValues)[number]);
  if (category !== "all" && !isValidCategory) {
    return NextResponse.json({ posts: [] }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const after = searchParams.get("after");
  const afterDate = after ? new Date(after) : null;
  if (after && (!afterDate || Number.isNaN(afterDate.getTime()))) {
    return NextResponse.json({ posts: [] }, { status: 400 });
  }
  const before = searchParams.get("before");
  // Same admin-only bypass as Home's own `allPostsScope` — never trust the
  // query param alone, only branch when the signed-in user is actually an
  // admin (see src/app/home/page.tsx).
  const allPostsScope = searchParams.get("scope") === "all" && user.isAdmin;

  const where = allPostsScope
    ? {
        moderationStatus: "PUBLISHED" as const,
        author: { status: "ACTIVE" as const },
        NOT: { author: { postsVisibility: "HIDDEN" as const } },
      }
    : await getVisiblePostsWhere(user.id);
  const categoryFilter = isValidCategory
    ? await buildCategoryFilter(category as (typeof feedCategoryValues)[number])
    : undefined;
  const rawPosts = await prisma.post.findMany({
    where: {
      AND: [
        where,
        ...(categoryFilter ? [categoryFilter] : []),
        ...(afterDate ? [{ createdAt: { gt: afterDate } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: before ? LOAD_MORE_PAGE_SIZE : POLL_PAGE_SIZE,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    include: postCardInclude,
  });

  const posts = await attachViewerState(rawPosts, user.id);
  const hasMore = before ? rawPosts.length === LOAD_MORE_PAGE_SIZE : undefined;
  return NextResponse.json({ posts, hasMore });
}
