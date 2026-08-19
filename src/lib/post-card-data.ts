import { prisma } from "@/lib/prisma";

type MediaType = "NONE" | "IMAGE" | "VIDEO" | "EMBED" | "LINK";
type EmbedProvider = "YOUTUBE" | "VIMEO" | "TIKTOK" | "DAILYMOTION";

type EmbeddedPostRow = {
  id: string;
  content: string;
  mediaType: MediaType;
  mediaUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
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

type ConnectionStatus = "PENDING" | "ACCEPTED" | "DECLINED" | null;

type PostRow = EmbeddedPostRow & {
  repostOf: EmbeddedPostRow | null;
  sharedPost: EmbeddedPostRow | null;
};

// Shared `include` shape for any `prisma.post.findMany`/`findUnique` call
// that will be rendered through `<PostCard>` — keeps every call site's
// selection in sync with what attachViewerState()/PostCard actually need.
export const postCardInclude = {
  author: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, openToIntents: true } },
  repostOf: {
    include: { author: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, openToIntents: true } } },
  },
  sharedPost: {
    include: { author: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, openToIntents: true } } },
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

  const [likes, myReposts, myRsvps, connections, subscriptions] = targetIds.length
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
        authorIds.length
          ? prisma.connection.findMany({
              where: {
                OR: [
                  { requesterId: viewerId, targetId: { in: authorIds } },
                  { requesterId: { in: authorIds }, targetId: viewerId },
                ],
              },
            })
          : Promise.resolve([]),
        authorIds.length
          ? prisma.subscription.findMany({
              where: { subscriberId: viewerId, subscribedToId: { in: authorIds } },
              select: { subscribedToId: true },
            })
          : Promise.resolve([]),
      ])
    : [[], [], [], [], []];

  const likedSet = new Set(likes.map((l) => l.postId));
  const repostedSet = new Set(myReposts.map((r) => r.repostOfId as string));
  const rsvpGoingSet = new Set(myRsvps.map((r) => r.postId));
  const subscribedSet = new Set(subscriptions.map((s) => s.subscribedToId));

  const connectionByAuthorId = new Map<
    string,
    { status: ConnectionStatus; isRequester: boolean }
  >();
  for (const c of connections) {
    const otherId = c.requesterId === viewerId ? c.targetId : c.requesterId;
    connectionByAuthorId.set(otherId, { status: c.status, isRequester: c.requesterId === viewerId });
  }

  // For any author the viewer is already ACCEPTED-connected to, resolve the
  // shared 2-person conversation so the Connect popover can link straight
  // into the chat — same batched approach as /connections/page.tsx.
  const acceptedAuthorIds = authorIds.filter(
    (id) => connectionByAuthorId.get(id)?.status === "ACCEPTED",
  );
  const conversations = acceptedAuthorIds.length
    ? await prisma.conversation.findMany({
        where: {
          isGroup: false,
          AND: [
            { members: { some: { userId: viewerId } } },
            { members: { some: { userId: { in: acceptedAuthorIds } } } },
          ],
        },
        include: { members: { select: { userId: true } } },
      })
    : [];
  const conversationIdByAuthorId = new Map<string, string>();
  for (const c of conversations) {
    const other = c.members.find((m) => m.userId !== viewerId);
    if (other) conversationIdByAuthorId.set(other.userId, c.id);
  }

  return posts.map((post) => {
    const target = post.sharedPost ?? post.repostOf ?? post;
    const connection = connectionByAuthorId.get(target.author.id);
    return {
      id: post.id,
      content: post.content,
      mediaType: post.mediaType,
      mediaUrls: post.mediaUrls,
      videoUrl: post.videoUrl,
      videoThumbnailUrl: post.videoThumbnailUrl,
      embedProvider: post.embedProvider,
      embedId: post.embedId,
      linkUrl: post.linkUrl,
      eventAt: post.eventAt,
      eventLocation: post.eventLocation,
      createdAt: post.createdAt,
      editedAt: post.editedAt,
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
      sharedPost: post.sharedPost,
      connectionStatus: connection?.status ?? null,
      connectionIsRequester: connection?.isRequester ?? false,
      conversationId: conversationIdByAuthorId.get(target.author.id) ?? null,
      subscribedByMe: subscribedSet.has(target.author.id),
    };
  });
}
