import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";

/**
 * The set of posts a viewer is allowed to see: their own; anything posted in
 * a Circle they belong to (member-only regardless of the author's
 * postsVisibility — a separate boundary); their accepted connections' posts
 * (regardless of that connection's own postsVisibility); and — this is the
 * actual enforcement of `postsVisibility` promised by its Settings label
 * ("Anyone signed in") — everyone else's non-Circle posts where the author
 * has left postsVisibility at PUBLIC. CONNECTIONS_ONLY from a non-connection
 * stays excluded. Blocked-either-way authors are excluded regardless of any
 * OR branch above — blocking is meant to hide content, not just messaging.
 * Shared here so the home feed and search stay in sync instead of drifting
 * apart.
 */
export async function getVisiblePostsWhere(viewerId: string) {
  const [circleMemberships, connections, blockedIds] = await Promise.all([
    prisma.circleMembership.findMany({
      where: { userId: viewerId },
      select: { circleId: true },
    }),
    prisma.connection.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: viewerId }, { targetId: viewerId }] },
    }),
    getBlockedEitherWayIds(viewerId),
  ]);

  const circleIds = circleMemberships.map((m) => m.circleId);
  const connectionUserIds = connections.map((c) =>
    c.requesterId === viewerId ? c.targetId : c.requesterId,
  );

  return {
    moderationStatus: "PUBLISHED" as const,
    author: { status: "ACTIVE" as const },
    OR: [
      ...(circleIds.length ? [{ circleId: { in: circleIds } }] : []),
      { authorId: viewerId },
      ...(connectionUserIds.length
        ? [{ circleId: null, authorId: { in: connectionUserIds } }]
        : []),
      { circleId: null, author: { postsVisibility: "PUBLIC" as const } },
    ],
    NOT: {
      OR: [
        // HIDDEN ("invisible to everyone", admin-only — see updatePrivacy in
        // actions/profile.ts) stays excluded for every viewer but the
        // author, regardless of the OR branches above.
        { AND: [{ author: { postsVisibility: "HIDDEN" as const } }, { authorId: { not: viewerId } }] },
        ...(blockedIds.size ? [{ authorId: { in: [...blockedIds] } }] : []),
      ],
    },
  };
}

/**
 * Whether a single post is visible to a given viewer — same rules as
 * getVisiblePostsWhere (Circle membership, blocked users, HIDDEN,
 * postsVisibility), just scoped to one id instead of a feed query. Use this
 * before any engagement action (like/comment/RSVP/repost/share) touches a
 * postId supplied by the client — the id alone doesn't prove the caller was
 * ever allowed to see that post (e.g. a private Circle's post shared outside
 * it, or leaked via a notification).
 */
export async function canViewPost(postId: string, viewerId: string) {
  const post = await prisma.post.findFirst({
    where: { id: postId, ...(await getVisiblePostsWhere(viewerId)) },
    select: { id: true },
  });
  return Boolean(post);
}
