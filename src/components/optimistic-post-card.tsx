"use client";

import { X } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { removeOptimisticPost, type OptimisticPost } from "@/lib/optimistic-posts-store";

/**
 * The "still sending" placeholder PostFeedSection/ProfilePostsList render at
 * the top of their list the instant PostComposer hands off to
 * optimistic-posts-store — before the upload, before createPost, before any
 * server round trip at all. Deliberately not a real <PostCard>: most of what
 * that needs (engagement status, reaction counts, connection state) only
 * exists server-side, and isn't worth a round trip just to render a few
 * seconds of "Posting…". Not interactive beyond dismiss/retry — there's no
 * real postId yet for a like/comment button to act on.
 *
 * Success is silent: this card is removed the moment createPost resolves,
 * and the real one appears moments later via the same realtime-triggered
 * refetch that already shows everyone else's new posts (see
 * REALTIME_CHANNELS.homeFeed in post-feed-section.tsx) — no separate
 * "swap in the real data" step needed here.
 */
export function OptimisticPostCard({ post }: { post: OptimisticPost }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <UserAvatar avatarUrl={post.authorAvatarUrl} name={post.authorName} size={36} />
          <div>
            <p className="text-sm font-semibold">{post.authorName}</p>
            <p className="text-xs text-foreground-soft">
              {post.status === "sending" ? (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
                  Posting…
                </span>
              ) : (
                <span className="text-danger">{post.errorMessage ?? "Couldn't post"}</span>
              )}
            </p>
          </div>
        </div>
        {post.status === "error" && (
          <button
            type="button"
            onClick={() => removeOptimisticPost(post.localId)}
            aria-label="Dismiss"
            className="text-foreground-soft hover:text-danger"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {post.content && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground-soft">{post.content}</p>
      )}

      {post.previewUrl &&
        (post.previewKind === "video" ? (
          <video
            src={post.previewUrl}
            className="mt-3 max-h-72 w-full rounded-lg bg-black object-contain opacity-80"
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a transient blob: URL, not a real asset next/image can optimize
          <img
            src={post.previewUrl}
            alt=""
            className="mt-3 max-h-72 w-full rounded-lg object-contain opacity-80"
          />
        ))}
    </div>
  );
}
