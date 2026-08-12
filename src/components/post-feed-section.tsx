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
  label,
  initialPosts,
  viewerId,
  viewerIsAdmin,
}: {
  category: string;
  label: string;
  initialPosts: PostCardData[];
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);

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

  usePolling(poll, POLL_INTERVAL_MS, true);

  if (posts.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{label}</h2>
      <div className="mt-3 space-y-4">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} viewerId={viewerId} viewerIsAdmin={viewerIsAdmin} />
        ))}
      </div>
    </section>
  );
}
