import { prisma } from "@/lib/prisma";

/**
 * Co-admins are CollabParticipant rows with role "MODERATOR" — same shape as
 * isCircleAdmin, so a Collab's author gets the same co-admin delegation
 * powers a Circle owner already has.
 */
export function isCollabAdmin(
  collab: { authorId: string },
  membership: { role: string } | null,
  user: { id: string; isAdmin: boolean },
) {
  return collab.authorId === user.id || membership?.role === "MODERATOR" || user.isAdmin;
}

export function getCollabMembership(collabId: string, userId: string) {
  return prisma.collabParticipant.findUnique({
    where: { userId_collabId: { userId, collabId } },
  });
}
