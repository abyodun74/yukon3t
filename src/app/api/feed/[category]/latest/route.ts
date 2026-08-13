import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getVisiblePostsWhere } from "@/lib/post-visibility";
import { feedCategoryValues } from "@/lib/validations";
import { buildCategoryFilter } from "@/lib/feed-category";

const PAGE_SIZE = 10;

/**
 * Polled by PostFeedSection (src/components/post-feed-section.tsx) every ~25s
 * to give Home's feed a near-real-time feel without new websocket/SSE
 * infrastructure — same `usePolling` pattern already used for nav badges
 * and chat (src/lib/use-polling.ts). `category` is either a FeedCategory
 * value or the literal "all" (no category filter, matching Home's "All" tab).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ posts: [] }, { status: 401 });
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

  const where = await getVisiblePostsWhere(session.user.id);
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
    take: PAGE_SIZE,
    include: postCardInclude,
  });

  const posts = await attachViewerState(rawPosts, session.user.id);
  return NextResponse.json({ posts });
}
