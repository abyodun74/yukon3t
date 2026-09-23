import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";

/**
 * The set of posts a viewer is allowed to see: their own; anything posted in
 * a Circle they belong to; anything posted in a PUBLIC Circle (circle posts are
 * always stored PUBLIC, see createPost — the Circle's own visibility is what
 * decides, so a PRIVATE Circle's posts, and a private channel's, stay
 * members-only); and, for everyone else's non-Circle posts,
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
      // A post in a PUBLIC Circle (and not in one of its private channels) is as public as a general post: circle posts
      // are always stored PUBLIC, and the Circle's own visibility is the boundary. Posts in a PRIVATE Circle reach only
      // the member branch above.
      {
        visibility: "PUBLIC" as const,
        circle: { visibility: "PUBLIC" as const },
        OR: [{ channelId: null }, { channel: { visibility: "PUBLIC" as const } }],
      },
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
 * A post only its Circle's members may see: made in a PRIVATE Circle, or in a
 * private channel of any Circle. (Posts in a PUBLIC Circle are general/public.)
 */
export const MEMBERS_ONLY_POST: Prisma.PostWhereInput = {
  OR: [{ circle: { visibility: "PRIVATE" } }, { channel: { visibility: "PRIVATE" } }],
};

/**
 * Where-fragment that keeps members-only content OUT of any general listing
 * (Home, the feed API, search) — even for that Circle's own members, who read
 * it on the Circle's page. Also drops a repost/share row whose original is
 * members-only (such a row is itself a plain PUBLIC post but would render the
 * original inline). NOT for single-post access (canViewPost, /post/[id]): a
 * member opening a private-Circle post from a notification must still work.
 */
export const NOT_MEMBERS_ONLY: Prisma.PostWhereInput = {
  NOT: [MEMBERS_ONLY_POST, { repostOf: MEMBERS_ONLY_POST }, { sharedPost: MEMBERS_ONLY_POST }],
};

/**
 * Keeps a multi-photo post's non-lead siblings out of any listing that
 * shows one card per post — Home, search, a profile's posts, a Circle
 * channel's feed. A multi-photo post is several Post rows sharing one
 * albumId (one photo each), ordered by albumIndex; only albumIndex 0 (the
 * "lead", which also carries the caption — see createPost in
 * actions/circles.ts) represents the whole set there, with the rest reached
 * via its own carousel (PostCard's AlbumCarousel). An ordinary post has no
 * albumId at all and passes through untouched. NOT for single-post access
 * (canViewPost, /post/[id]) — a sibling still needs its own full page, so
 * it's independently open-able/likeable/commentable/shareable exactly like
 * the lead; only *listing* queries should ever apply this.
 */
export const LEAD_POST_ONLY: Prisma.PostWhereInput = {
  OR: [{ albumId: null }, { albumIndex: 0 }],
};

/**
 * getVisiblePostsWhere for a general listing — the viewer's visible posts
 * minus anything members-only (see NOT_MEMBERS_ONLY) and minus a multi-photo
 * post's non-lead siblings (see LEAD_POST_ONLY). Combined with AND so no
 * side's own OR/NOT is clobbered.
 */
export async function getListablePostsWhere(viewerId: string) {
  return { AND: [await getVisiblePostsWhere(viewerId), NOT_MEMBERS_ONLY, LEAD_POST_ONLY] };
}

/** Pure rule behind isMembersOnlyPost: a PRIVATE Circle or a PRIVATE channel makes a post members-only. */
export function isMembersOnly(circleVisibility?: string | null, channelVisibility?: string | null) {
  return circleVisibility === "PRIVATE" || channelVisibility === "PRIVATE";
}

/**
 * Whether a post may reach beyond its Circle's members: false for a general post
 * or one in a PUBLIC Circle's public channel; true for a PRIVATE Circle's post
 * or a private channel's. Gates repost/share/notify fan-out.
 */
export async function isMembersOnlyPost(post: { circleId: string | null; channelId: string | null }) {
  if (!post.circleId) return false;
  const [circle, channel] = await Promise.all([
    prisma.circle.findUnique({ where: { id: post.circleId }, select: { visibility: true } }),
    post.channelId ? prisma.channel.findUnique({ where: { id: post.channelId }, select: { visibility: true } }) : null,
  ]);
  return isMembersOnly(circle?.visibility, channel?.visibility);
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
