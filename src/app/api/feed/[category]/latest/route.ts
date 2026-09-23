import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, AuthError } from "@/lib/auth-guards";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getListablePostsWhere, NOT_MEMBERS_ONLY, LEAD_POST_ONLY } from "@/lib/post-visibility";
import { feedCategoryValues } from "@/lib/validations";
import { buildCategoryFilter } from "@/lib/feed-category";

const LATEST_PAGE_SIZE = 10;
// Matches Home's own PAGE_SIZE (src/app/home/page.tsx) so a "Load more"
// click pulls in the same number of posts the old full-page pagination did.
const LOAD_MORE_PAGE_SIZE = 20;

/**
 * Fetched by PostFeedSection (src/components/post-feed-section.tsx) whenever
 * a realtime "changed" signal lands on this category's home-feed:{category}
 * channel (createPost/repost publish onto it — see REALTIME_CHANNELS.homeFeed
 * in actions/circles.ts/actions/reposts.ts), rather than on a polling
 * interval. `category` is either a FeedCategory value or the literal "all"
 * (no category filter, matching Home's "All" tab).
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
        // Never lists a multi-photo post's non-lead siblings as their own
        // separate cards — see LEAD_POST_ONLY's own comment.
        AND: [NOT_MEMBERS_ONLY, LEAD_POST_ONLY],
      }
    : await getListablePostsWhere(user.id);
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
    take: before ? LOAD_MORE_PAGE_SIZE : LATEST_PAGE_SIZE,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    include: postCardInclude,
  });

  const posts = await attachViewerState(rawPosts, user.id);
  const hasMore = before ? rawPosts.length === LOAD_MORE_PAGE_SIZE : undefined;
  return NextResponse.json({ posts, hasMore });
}
