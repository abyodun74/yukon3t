import { prisma } from "@/lib/prisma";

/**
 * Everyone `userId` has an ACCEPTED or PENDING connection with — used to
 * filter list views like Discover down to only people who'd actually see
 * the orange Connect button (ConnectButton's own logic falls through to
 * that same button for DECLINED, so a prior decline deliberately isn't
 * excluded here — those people should stay discoverable for a fresh
 * request).
 */
export async function getConnectedOrPendingIds(userId: string) {
  const rows = await prisma.connection.findMany({
    where: {
      status: { in: ["ACCEPTED", "PENDING"] },
      OR: [{ requesterId: userId }, { targetId: userId }],
    },
    select: { requesterId: true, targetId: true },
  });
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.requesterId === userId ? row.targetId : row.requesterId);
  }
  return ids;
}
