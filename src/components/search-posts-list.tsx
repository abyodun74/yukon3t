"use client";

import { PostCard, type PostCardData } from "@/components/post-card";
import { useInfiniteScroll } from "@/lib/use-infinite-scroll";
import { loadMoreSearchPosts } from "@/app/actions/search";

export function SearchPostsList({
  query,
  sort,
  initialPosts,
  initialHasMore,
  viewerId,
  viewerIsAdmin,
}: {
  query: string;
  sort: string;
  initialPosts: PostCardData[];
  initialHasMore: boolean;
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  const { items, hasMore, loading, sentinelRef } = useInfiniteScroll({
    initialItems: initialPosts,
    initialHasMore,
    loadMore: (cursor) => loadMoreSearchPosts(cursor, { q: query, sort }),
    getCursor: (post) => post.id,
  });

  return (
    <>
      {items.map((post) => (
        <PostCard key={post.id} post={post} viewerId={viewerId} viewerIsAdmin={viewerIsAdmin} />
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loading && <span className="animate-loading-pulse text-xs text-foreground-soft">Loading more...</span>}
        </div>
      )}
    </>
  );
}
