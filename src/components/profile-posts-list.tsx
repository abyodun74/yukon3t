"use client";

import { PostCard, type PostCardData } from "@/components/post-card";
import { useInfiniteScroll } from "@/lib/use-infinite-scroll";
import { loadMoreProfilePosts } from "@/app/actions/posts";

export function ProfilePostsList({
  profileUserId,
  initialPosts,
  initialHasMore,
  viewerId,
  viewerIsAdmin,
}: {
  profileUserId: string;
  initialPosts: PostCardData[];
  initialHasMore: boolean;
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  const { items, hasMore, loading, sentinelRef } = useInfiniteScroll({
    initialItems: initialPosts,
    initialHasMore,
    loadMore: (cursor) => loadMoreProfilePosts(profileUserId, cursor),
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
