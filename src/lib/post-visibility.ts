import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";

/**
 * The set of posts a viewer is allowed to see: their own; anything posted in
 * a Circle they belong to (member-only regardless of the post's own
 * visibility — a separate boundary, and circle posts are always stored
 * PUBLIC anyway, see createPost); and, for everyone else's non-Circle posts,
 * whatever audience the author picked at compose time (Post.visibility —
 * "Everyone"/"Friends only"/"Private" in post-composer.tsx): PUBLIC posts to
 * anyone, CONNECTIONS_ONLY posts only to accepted connections, PRIVATE posts
 * to no one but the author. Blocked-either-way authors are excluded
 * regardless of any OR branch above — blocking is meant to hide content, not
 * just messaging. Shared here so the home feed and search stay in sync
 * instead of drifting apart.
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
      { circleId: null, visibility: "PUBLIC" as const },
      ...(connectionUserIds.length
        ? [{ circleId: null, visibility: "CONNECTIONS_ONLY" as const, authorId: { in: connectionUserIds } }]
        : []),
    ],
    NOT: {
      OR: [
        // HIDDEN ("invisible to everyone", admin-only account-wide tier —
        // see updatePrivacy in actions/profile.ts) stays excluded for every
        // viewer but the author regardless of the OR branches above,
        // including a post the author themselves marked PUBLIC — it's a
        // moderation override, not something a per-post choice can lift.
        { AND: [{ author: { postsVisibility: "HIDDEN" as const } }, { authorId: { not: viewerId } }] },
        ...(blockedIds.size ? [{ authorId: { in: [...blockedIds] } }] : []),
      ],
    },
  };
}

/**
 * Where-fragment that keeps Circle content OUT of any general listing (Home,
 * search, Explore). A Circle's posts are for that Circle's members and appear
 * only on that Circle's own page; the general feed shows general/public posts
 * only. Also drops a repost/share row whose original lives in a Circle — such
 * a row is itself stored circleId=null/PUBLIC but would render the members-only
 * original inline (reposting a Circle post is now refused, this covers the
 * ones made before that). NOT for single-post access (canViewPost, /post/[id]):
 * a member opening a Circle post from a notification must still work.
 */
export const NOT_CIRCLE_SCOPED: Prisma.PostWhereInput = {
  circleId: null,
  NOT: [{ repostOf: { circleId: { not: null } } }, { sharedPost: { circleId: { not: null } } }],
};

/**
 * getVisiblePostsWhere for a general listing — the viewer's visible posts
 * minus everything Circle-scoped (see NOT_CIRCLE_SCOPED). Combined with AND so
 * neither side's own OR/NOT is clobbered.
 */
export async function getListablePostsWhere(viewerId: string) {
  return { AND: [await getVisiblePostsWhere(viewerId), NOT_CIRCLE_SCOPED] };
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
