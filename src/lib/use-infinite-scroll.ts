"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic auto-load-more list state: fetches the next page once a sentinel
 * div scrolls near the viewport, appending in place — same IntersectionObserver
 * pattern PostFeedSection (src/components/post-feed-section.tsx) already uses
 * for Home, generalized so every other paginated list in the app can share it
 * instead of a tap-to-load "Load more" link that forces a full page
 * navigation back to the top of the page.
 */
export function useInfiniteScroll<T>({
  initialItems,
  initialHasMore,
  loadMore,
  getCursor,
}: {
  initialItems: T[];
  initialHasMore: boolean;
  // Typically a Server Action imported directly into the calling client
  // component (see e.g. respondToConnection usage in
  // connection-response-buttons.tsx) — called here with the last-loaded
  // item's cursor.
  loadMore: (cursor: string) => Promise<{ items: T[]; hasMore: boolean }>;
  // `index` is the last item's position in the full loaded list so far —
  // most lists derive the cursor from the item itself (e.g. its id), but
  // page-number pagination (see /discover) needs the count instead.
  getCursor: (item: T, index: number) => string;
}) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [syncedInitialItems, setSyncedInitialItems] = useState(initialItems);

  // useState(initialItems) only reads initialItems on first mount — without
  // this, `items` stays frozen at whatever was passed in the very first
  // time forever, even once the parent Server Component re-renders with
  // fresh data. That re-render is exactly what a same-route
  // `router.refresh()` produces (confirmed live: posting a photo/video from
  // your own profile called router.refresh() on success, but the new post
  // never appeared in ProfilePostsList without a full page navigation,
  // since this hook backs it) — a fresh `initialItems` array is the one
  // reliable signal that new data actually exists, and prop identity
  // changes on every such re-render since the server query builds a new
  // array each time. Adjusting state during render (React's documented
  // pattern for "reset state when a prop changes") rather than in a
  // useEffect — an effect here would setState after the stale paint
  // already committed, and the render-phase check below is what
  // react-hooks/set-state-in-effect steers toward instead. Trade-off: this
  // also drops anything loaded further via infinite scroll if some
  // unrelated action happens to trigger a refresh while scrolled deep in
  // the list — a rare case, and a fresh first page beats a permanently
  // stale one.
  if (initialItems !== syncedInitialItems) {
    setSyncedInitialItems(initialItems);
    setItems(initialItems);
    setHasMore(initialHasMore);
  }

  const fetchMore = useCallback(async () => {
    if (loading || !hasMore) return;
    const last = items[items.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const { items: more, hasMore: nextHasMore } = await loadMore(getCursor(last, items.length - 1));
      setItems((prev) => [...prev, ...more]);
      setHasMore(nextHasMore);
    } catch {
      // Leave hasMore as-is so the sentinel can retry on the next intersection.
    } finally {
      setLoading(false);
    }
  }, [items, hasMore, loading, loadMore, getCursor]);

  // Always points at the latest fetchMore (which changes identity every time
  // `items` grows) without tearing down and recreating the observer below on
  // every fetch — only `hasMore` flipping false/true should do that.
  const fetchMoreRef = useRef(fetchMore);
  useEffect(() => {
    fetchMoreRef.current = fetchMore;
  });

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchMoreRef.current();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore]);

  return { items, hasMore, loading, sentinelRef };
}
