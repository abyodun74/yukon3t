import { prisma } from "@/lib/prisma";

type MediaType = "NONE" | "IMAGE" | "VIDEO";

type EmbeddedPostRow = {
  id: string;
  content: string;
  mediaType: MediaType;
  mediaUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  eventAt: Date | null;
  eventLocation: string | null;
  createdAt: Date;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  shareCount: number;
  rsvpCount: number;
  author: { id: string; name: string | null };
};

type PostRow = EmbeddedPostRow & {
  repostOf: EmbeddedPostRow | null;
};

// Shared `include` shape for any `prisma.post.findMany`/`findUnique` call
// that will be rendered through `<PostCard>` — keeps every call site's
// selection in sync with what attachViewerState()/PostCard actually need.
export const postCardInclude = {
  author: { select: { id: true, name: true } },
  repostOf: {
    include: { author: { select: { id: true, name: true } } },
  },
} as const;

/**
 * Batches the viewer-specific like/repost lookups for a page of posts into
 * two queries total (instead of one per card), and resolves each row's
 * engagement counts/like-state to its repost root when it's a repost —
 * engagement always aggregates on the original post, never the repost row.
 */
export async function attachViewerState<T extends PostRow>(posts: T[], viewerId: string) {
  const targetIds = [...new Set(posts.map((p) => p.repostOf?.id ?? p.id))];

  const [likes, myReposts, myRsvps] = targetIds.length
    ? await Promise.all([
        prisma.like.findMany({
          where: { userId: viewerId, postId: { in: targetIds } },
          select: { postId: true },
        }),
        prisma.post.findMany({
          where: { authorId: viewerId, repostOfId: { in: targetIds } },
          select: { repostOfId: true },
        }),
        prisma.postRsvp.findMany({
          where: { userId: viewerId, postId: { in: targetIds } },
          select: { postId: true },
        }),
      ])
    : [[], [], []];

  const likedSet = new Set(likes.map((l) => l.postId));
  const repostedSet = new Set(myReposts.map((r) => r.repostOfId as string));
  const rsvpGoingSet = new Set(myRsvps.map((r) => r.postId));

  return posts.map((post) => {
    const target = post.repostOf ?? post;
    return {
      id: post.id,
      content: post.content,
      mediaType: post.mediaType,
      mediaUrls: post.mediaUrls,
      videoUrl: post.videoUrl,
      videoThumbnailUrl: post.videoThumbnailUrl,
      eventAt: post.eventAt,
      eventLocation: post.eventLocation,
      createdAt: post.createdAt,
      author: post.author,
      likeCount: target.likeCount,
      commentCount: target.commentCount,
      repostCount: target.repostCount,
      shareCount: target.shareCount,
      rsvpCount: target.rsvpCount,
      likedByMe: likedSet.has(target.id),
      repostedByMe: repostedSet.has(target.id),
      rsvpGoingByMe: rsvpGoingSet.has(target.id),
      repostOf: post.repostOf,
    };
  });
}
