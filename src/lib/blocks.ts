import { prisma } from "@/lib/prisma";

/** True if either user has blocked the other — enforcement treats a block as mutual even though the row itself is directional. */
export async function isBlockedEitherWay(userAId: string, userBId: string) {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
    select: { id: true },
  });
  return !!block;
}

/** Everyone `userId` has blocked or been blocked by — used to filter list views like Discover. */
export async function getBlockedEitherWayIds(userId: string) {
  const rows = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
  }
  return ids;
}
