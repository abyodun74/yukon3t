"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { PostCard, type PostCardData } from "@/components/post-card";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { useOptimisticPosts } from "@/lib/optimistic-posts-store";
import { OptimisticPostCard } from "@/components/optimistic-post-card";

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

// Rough starting guess before a card is actually measured (a text-only or
// single-image post lands somewhere near this) — the virtualizer corrects
// itself immediately once each card's real height is measured via
// measureElement's own ResizeObserver, this is only what the very first
// paint estimates before that happens.
const ESTIMATED_POST_HEIGHT = 360;
// Items rendered outside the visible viewport as a buffer, so fast
// scrolling doesn't show blank space before a card's had a chance to
// measure/paint.
const OVERSCAN = 3;
// Matches the old `space-y-4` gap (1rem) — now the virtualizer's own `gap`
// option instead of a parent's flex/space-y margin, since it has to be part
// of the actual position math for absolutely-positioned items.
const ITEM_GAP = 16;
// Fetches the next page once the rendered range gets this close to the end
// of what's currently loaded — same "start well before you'd actually miss
// it" idea the old 600px-rootMargin IntersectionObserver sentinel used, just
// keyed off the virtualizer's own visible range instead of a DOM sentinel
// (which would sit outside the render window most of the time once
// virtualized, and never actually intersect).
const LOAD_MORE_THRESHOLD = 3;

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
  // range-watching effect below on every fetch.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });

  // Shown on every category tab regardless of `category` — the server hasn't
  // classified this post yet (classifyPostCategory runs inside createPost),
  // so there's no real category to filter by until it lands for real. A
  // pending post is gone within a few seconds either way, so being visible
  // on a tab it won't ultimately belong to is a minor, short-lived tradeoff.
  // Rendered above (outside of) the virtualized list below, not as part of
  // it — there's realistically 0-1 of these at a time and they're gone
  // within seconds, not worth folding into the index math.
  const optimisticPosts = useOptimisticPosts();

  // Distance from the top of the document to the top of the virtualized
  // list itself (the story tray, streak banner, category tabs, and any
  // optimistic-post placeholders all sit above it on the actual page) —
  // useWindowVirtualizer needs this to translate window scroll position
  // into "which post index is at the top" correctly. Measured after mount
  // (parentRef.current is still null during the render that creates it)
  // and re-measured whenever the optimistic-post count changes, since that's
  // the one thing this component itself renders above the list that can
  // change its height after the fact. Content further up the actual page
  // (outside this component) resizing later — e.g. a story-tray image
  // finishing loading — could still drift this slightly; harmless (a small,
  // self-correcting misalignment until the next recompute), not worth
  // chasing with a page-wide ResizeObserver for a first pass.
  const parentRef = useRef<HTMLDivElement>(null);
  const [parentOffset, setParentOffset] = useState(0);
  useLayoutEffect(() => {
    setParentOffset(parentRef.current?.offsetTop ?? 0);
  }, [optimisticPosts.length]);

  const virtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: () => ESTIMATED_POST_HEIGHT,
    overscan: OVERSCAN,
    gap: ITEM_GAP,
    getItemKey: (index) => posts[index]!.id,
    scrollMargin: parentOffset,
  });
  const virtualItems = virtualizer.getVirtualItems();

  const endIndex = virtualizer.range?.endIndex ?? -1;
  useEffect(() => {
    if (!hasMore || endIndex < 0) return;
    if (endIndex >= posts.length - 1 - LOAD_MORE_THRESHOLD) {
      loadMoreRef.current();
    }
  }, [endIndex, hasMore, posts.length]);

  if (posts.length === 0 && optimisticPosts.length === 0) return null;

  return (
    <div className="mt-6">
      {optimisticPosts.map((post) => (
        <OptimisticPostCard key={post.localId} post={post} />
      ))}
      <div ref={parentRef} style={{ position: "relative", height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualItem) => {
          const post = posts[virtualItem.index];
          if (!post) return null;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              // top, not transform: PostCard renders several plain
              // `fixed inset-0` modals as normal descendants (Lightbox,
              // ShareModal, LikersModal — none of them portal out to
              // document.body). A `transform` on this wrapper would make it
              // the CSS containing block for all of those `position: fixed`
              // descendants, clipping/mispositioning them to this card's own
              // small box instead of the real viewport — a real, easy-to-miss
              // bug this specific combination (absolute-positioned
              // virtualization + un-portaled fixed-position modals) would
              // otherwise cause. `top` costs a layout recalc instead of a
              // compositor-only repaint, but only on measure/prepend, not on
              // every scroll frame (the actual scrolling here is native
              // window scroll, not JS-driven repositioning) — negligible.
              style={{
                position: "absolute",
                top: virtualItem.start - parentOffset,
                left: 0,
                width: "100%",
              }}
            >
              <PostCard post={post} viewerId={viewerId} viewerIsAdmin={viewerIsAdmin} />
            </div>
          );
        })}
      </div>
      {loadingMore && (
        <p className="animate-loading-pulse flex justify-center py-4 text-xs text-foreground-soft">Loading more...</p>
      )}
    </div>
  );
}
