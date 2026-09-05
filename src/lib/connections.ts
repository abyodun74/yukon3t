import { prisma } from "@/lib/prisma";

/** Everyone `userId` has an ACCEPTED connection with — used to filter list views like Discover, which shouldn't resurface people you're already connected to. */
export async function getAcceptedConnectionIds(userId: string) {
  const rows = await prisma.connection.findMany({
    where: {
      status: "ACCEPTED",
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
