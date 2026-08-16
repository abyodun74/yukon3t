"use client";

import { useCallback, useState } from "react";
import { PostCard, type PostCardData } from "@/components/post-card";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 25_000;

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
  };
}

export function PostFeedSection({
  category,
  initialPosts,
  initialHasMore,
  allPostsScope = false,
  viewerId,
  viewerIsAdmin,
  pollingEnabled = true,
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
  pollingEnabled?: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  const poll = useCallback(async () => {
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
      // A failed poll should not be visible to the user — try again next tick.
    }
  }, [category, posts]);

  usePolling(poll, POLL_INTERVAL_MS, pollingEnabled);

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

  if (posts.length === 0) return null;

  return (
    <div className="mt-6 space-y-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} viewerId={viewerId} viewerIsAdmin={viewerIsAdmin} />
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="block w-full rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
