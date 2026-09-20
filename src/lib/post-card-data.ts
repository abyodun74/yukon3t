import { prisma } from "@/lib/prisma";
import { isMembersOnly } from "@/lib/post-visibility";
import { getAuthorEngagementStatus, engagementStatusFor } from "@/lib/engagement-status";
import type { EmbedProvider } from "@/lib/video-embed";
import type { ReactionSummary } from "@/lib/reactions";

type MediaType = "NONE" | "IMAGE" | "VIDEO" | "EMBED" | "LINK" | "GIF";

type EmbeddedPostRow = {
  id: string;
  content: string;
  mediaType: MediaType;
  mediaUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  videoDurationSeconds: number | null;
  embedProvider: EmbedProvider | null;
  embedId: string | null;
  linkUrl: string | null;
  eventAt: Date | null;
  eventLocation: string | null;
  createdAt: Date;
  editedAt: Date | null;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  shareCount: number;
  rsvpCount: number;
  author: {
    id: string;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
    trustBand: string;
    openToIntents: string[];
  };
};

type PostRow = EmbeddedPostRow & {
  // Not on EmbeddedPostRow: only the top-level post's own audience is shown
  // (see PostCard's visibility badge) — a repost/share's embedded original
  // doesn't render one, and is always PUBLIC for a Circle post regardless.
  visibility: "PUBLIC" | "CONNECTIONS_ONLY" | "PRIVATE";
  // Present when loaded with postCardInclude: lets attachViewerState tell members-only posts (a PRIVATE Circle's or a
  // private channel's) apart, so PostCard can hide repost/share for them.
  circle?: { visibility: "PUBLIC" | "PRIVATE" } | null;
  channel?: { visibility: "PUBLIC" | "PRIVATE" } | null;
  repostOf: EmbeddedPostRow | null;
  sharedPost: EmbeddedPostRow | null;
};

// Shared `include` shape for any `prisma.post.findMany`/`findUnique` call
// that will be rendered through `<PostCard>` — keeps every call site's
// selection in sync with what attachViewerState()/PostCard actually need.
export const postCardInclude = {
  circle: { select: { visibility: true } },
  channel: { select: { visibility: true } },
  author: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, openToIntents: true } },
  repostOf: {
    include: {
      author: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, openToIntents: true } },
    },
  },
  sharedPost: {
    include: {
      author: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, openToIntents: true } },
    },
  },
} as const;

/**
 * Batches the viewer-specific like/repost lookups for a page of posts into
 * two queries total (instead of one per card), and resolves each row's
 * engagement counts/like-state to its repost root when it's a repost —
 * engagement always aggregates on the original post, never the repost row.
 */
export async function attachViewerState<T extends PostRow>(posts: T[], viewerId: string) {
  const targetIds = [...new Set(posts.map((p) => p.sharedPost?.id ?? p.repostOf?.id ?? p.id))];
  const authorIds = [
    ...new Set(
      posts
        .map((p) => (p.sharedPost ?? p.repostOf ?? p).author.id)
        .filter((id) => id !== viewerId),
    ),
  ];

  const [likes, myReposts, myRsvps, engagementByAuthorId, reactionCounts, myReactions] = targetIds.length
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
        getAuthorEngagementStatus(viewerId, authorIds),
        // Aggregated in Postgres for the whole page of posts in one query —
        // a post's response payload no longer grows with its reactor count.
        prisma.postReaction.groupBy({
          by: ["postId", "emoji"],
          where: { postId: { in: targetIds } },
          _count: { emoji: true },
        }),
        prisma.postReaction.findMany({
          where: { userId: viewerId, postId: { in: targetIds } },
          select: { postId: true, emoji: true },
        }),
      ])
    : [[], [], [], new Map(), [], []];

  const likedSet = new Set(likes.map((l) => l.postId));
  const repostedSet = new Set(myReposts.map((r) => r.repostOfId as string));
  const rsvpGoingSet = new Set(myRsvps.map((r) => r.postId));
  const myReactionByPostId = new Map(myReactions.map((r) => [r.postId, r.emoji]));
  const reactionsByPostId = new Map<string, ReactionSummary[]>();
  for (const c of reactionCounts) {
    const list = reactionsByPostId.get(c.postId) ?? [];
    list.push({ emoji: c.emoji, count: c._count.emoji, reactedByMe: c.emoji === myReactionByPostId.get(c.postId) });
    reactionsByPostId.set(c.postId, list);
  }

  return posts.map((post) => {
    const target = post.sharedPost ?? post.repostOf ?? post;
    const engagement = engagementStatusFor(engagementByAuthorId, target.author.id);
    return {
      id: post.id,
      content: post.content,
      mediaType: post.mediaType,
      mediaUrls: post.mediaUrls,
      videoUrl: post.videoUrl,
      videoThumbnailUrl: post.videoThumbnailUrl,
      videoDurationSeconds: post.videoDurationSeconds,
      embedProvider: post.embedProvider,
      embedId: post.embedId,
      linkUrl: post.linkUrl,
      eventAt: post.eventAt,
      eventLocation: post.eventLocation,
      createdAt: post.createdAt,
      editedAt: post.editedAt,
      visibility: post.visibility,
      membersOnly: isMembersOnly(post.circle?.visibility, post.channel?.visibility),
      author: post.author,
      likeCount: target.likeCount,
      commentCount: target.commentCount,
      repostCount: target.repostCount,
      shareCount: target.shareCount,
      rsvpCount: target.rsvpCount,
      reactions: reactionsByPostId.get(target.id) ?? [],
      likedByMe: likedSet.has(target.id),
      repostedByMe: repostedSet.has(target.id),
      rsvpGoingByMe: rsvpGoingSet.has(target.id),
      repostOf: post.repostOf,
      sharedPost: post.sharedPost,
      connectionStatus: engagement.connectionStatus,
      connectionIsRequester: engagement.connectionIsRequester,
      conversationId: engagement.conversationId,
      subscribedByMe: engagement.subscribedByMe,
    };
  });
}
