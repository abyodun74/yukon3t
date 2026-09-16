"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PostCard, type PostCardData } from "@/components/post-card";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

// JSON round-trips turn Date fields into strings — revive them so PostCard
// (and anything reading post.createdAt/eventAt as a Date) keeps working the
// same way it does for server-rendered initialPosts.
function reviveDates(post: PostCardData): PostCardData {
  return {
    ...post,
    createdAt: new Date(post.createdAt),
    editedAt: post.editedAt ? new Date(post.editedAt) : null,
    eventAt: post.eventAt ? new Date(post.eventAt) : null,
    repostOf: post.repostOf
      ? {
          ...post.repostOf,
          createdAt: new Date(post.repostOf.createdAt),
          editedAt: post.repostOf.editedAt ? new Date(post.repostOf.editedAt) : null,
          eventAt: post.repostOf.eventAt ? new Date(post.repostOf.eventAt) : null,
        }
      : null,
    sharedPost: post.sharedPost
      ? {
          ...post.sharedPost,
          createdAt: new Date(post.sharedPost.createdAt),
          editedAt: post.sharedPost.editedAt ? new Date(post.sharedPost.editedAt) : null,
          eventAt: post.sharedPost.eventAt ? new Date(post.sharedPost.eventAt) : null,
        }
      : null,
  };
}

export function PostFeedSection({
  category,
  initialPosts,
  initialHasMore,
  allPostsScope = false,
  viewerId,
  viewerIsAdmin,
  liveUpdatesEnabled = true,
}: {
  // "all" polls/queries with no category filter.
  category: string;
  initialPosts: PostCardData[];
  initialHasMore: boolean;
  // Forwarded to the "Load more" fetch as `&scope=all` — the API route
  // re-checks isAdmin itself server-side, this is just so the right query
  // gets requested (see src/app/home/page.tsx's own allPostsScope).
  allPostsScope?: boolean;
  viewerId: string;
  viewerIsAdmin: boolean;
  liveUpdatesEnabled?: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  const refetchNewer = useCallback(async () => {
    const latest = posts[0]?.createdAt;
    if (!latest) return;
    try {
      const res = await fetch(
        `/api/feed/${category}/latest?after=${encodeURIComponent(new Date(latest).toISOString())}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const fresh: PostCardData[] = (data.posts ?? []).map(reviveDates);
      if (fresh.length === 0) return;
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const toAdd = fresh.filter((p) => !existingIds.has(p.id));
        return toAdd.length ? [...toAdd, ...prev] : prev;
      });
    } catch {
      // A failed refetch should not be visible to the user — the next
      // realtime signal (or tab-focus resync) tries again.
    }
  }, [category, posts]);

  // Replaces the old 25s poll — createPost/repost publish onto this
  // category's home-feed:{category} channel and the global home-feed:all
  // channel (see REALTIME_CHANNELS.homeFeed in actions/circles.ts and
  // actions/reposts.ts), so a new post shows up as soon as it's published
  // instead of waiting on the next tick. useRealtimeEvent's own tab-focus
  // resync covers a missed signal.
  useRealtimeEvent(
    liveUpdatesEnabled ? REALTIME_CHANNELS.homeFeed(category) : null,
    "changed",
    refetchNewer,
  );

  // Fetches the next page and appends it in place — no navigation, so
  // scroll position is untouched (this is what replaced Home's old
  // `?before=` <Link>, which forced a full page reload back to the top).
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const last = posts[posts.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/feed/${category}/latest?before=${encodeURIComponent(last.id)}${allPostsScope ? "&scope=all" : ""}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const older: PostCardData[] = (data.posts ?? []).map(reviveDates);
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const toAdd = older.filter((p) => !existingIds.has(p.id));
        return [...prev, ...toAdd];
      });
      setHasMore(Boolean(data.hasMore));
    } catch {
      // Leave hasMore as-is so the button stays put and can be retried.
    } finally {
      setLoadingMore(false);
    }
  }, [category, posts, hasMore, loadingMore, allPostsScope]);

  // Always points at the latest loadMore (which itself changes identity
  // every time `posts` grows) without needing to tear down and recreate the
  // observer below on every fetch — only `hasMore` flipping false/true
  // should do that.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });

  // Fires loadMore automatically once the sentinel at the bottom scrolls
  // near the viewport — a generous 600px rootMargin starts the next page
  // fetching well before it's actually reached, so more posts are already
  // in place by the time you scroll to them instead of a visible pause.
  // Replaces the old tap-to-load-more button entirely.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore]);

  if (posts.length === 0) return null;

  return (
    <div className="mt-6 space-y-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} viewerId={viewerId} viewerIsAdmin={viewerIsAdmin} />
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loadingMore && <span className="animate-loading-pulse text-xs text-foreground-soft">Loading more...</span>}
        </div>
      )}
    </div>
  );
}
