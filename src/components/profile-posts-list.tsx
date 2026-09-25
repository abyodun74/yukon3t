"use client";

import { PostCard, type PostCardData } from "@/components/post-card";
import { useInfiniteScroll } from "@/lib/use-infinite-scroll";
import { loadMoreProfilePosts } from "@/app/actions/posts";
import { useOptimisticPosts } from "@/lib/optimistic-posts-store";
import { OptimisticPostCard } from "@/components/optimistic-post-card";

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
  // The store is per-browser-tab, not per-user — nothing stops it holding a
  // pending post while the viewer is looking at someone else's profile (they
  // navigated away from their own before it confirmed). Only ever show it on
  // the viewer's own profile, never anyone else's.
  const allOptimisticPosts = useOptimisticPosts();
  const optimisticPosts = profileUserId === viewerId ? allOptimisticPosts : [];

  return (
    <>
      {optimisticPosts.map((post) => (
        <OptimisticPostCard key={post.localId} post={post} />
      ))}
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
