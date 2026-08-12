import { prisma } from "@/lib/prisma";

/**
 * The set of posts a viewer is allowed to see: their own; anything posted in
 * a Circle they belong to (member-only regardless of the author's
 * postsVisibility — a separate boundary); their accepted connections' posts
 * (regardless of that connection's own postsVisibility); and — this is the
 * actual enforcement of `postsVisibility` promised by its Settings label
 * ("Anyone signed in") — everyone else's non-Circle posts where the author
 * has left postsVisibility at PUBLIC. CONNECTIONS_ONLY from a non-connection
 * stays excluded. Shared here so the home feed and search stay in sync
 * instead of drifting apart.
 */
export async function getVisiblePostsWhere(viewerId: string) {
  const [circleMemberships, connections] = await Promise.all([
    prisma.circleMembership.findMany({
      where: { userId: viewerId },
      select: { circleId: true },
    }),
    prisma.connection.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: viewerId }, { targetId: viewerId }] },
    }),
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
    // HIDDEN ("invisible to everyone", admin-only — see updatePrivacy in
    // actions/profile.ts) stays excluded for every viewer but the author,
    // regardless of the OR branches above.
    NOT: {
      AND: [{ author: { postsVisibility: "HIDDEN" as const } }, { authorId: { not: viewerId } }],
    },
  };
}
