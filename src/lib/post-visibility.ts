import { prisma } from "@/lib/prisma";

/**
 * The set of posts a viewer is allowed to see: their own, their accepted
 * connections', and anything posted in a Circle they belong to. This is the
 * app's actual post privacy boundary (the `postsVisibility` field on User is
 * collected in settings but not yet enforced anywhere) — shared here so the
 * home feed and search stay in sync instead of drifting apart.
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
      { authorId: { in: [...connectionUserIds, viewerId] } },
    ],
  };
}
